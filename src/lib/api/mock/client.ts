import type {
  BridgeApiClient,
  ListExplorerEventsParams,
  ListReserveHistoryParams,
  ListTransfersParams,
} from "../client";
import { badRequestError, directionUnavailableError, notFoundError } from "../errors";
import {
  bridgeStatusSchema,
  publicHealthSchema,
  reserveAvailabilitySchema,
  transferLimitsSchema,
} from "../schemas/status";
import { bridgeStatsSchema } from "../schemas/stats";
import { chainsViewSchema } from "../schemas/chains";
import { explorerEventListSchema } from "../schemas/explorer";
import { reserveHistoryListSchema } from "../schemas/reserves";
import { quoteOutputSchema, type QuoteOutputDto } from "../schemas/quote";
import { recipientEligibilitySchema } from "../schemas/eligibility";
import {
  createTransferOutputSchema,
  createTransferRequestSchema,
  transferListSchema,
  transferViewSchema,
  type CreateTransferOutputDto,
  type CreateTransferRequest,
  type TransferViewDto,
} from "../schemas/transfer";
import * as fixtures from "./fixtures";
import type { SettlementRoute } from "../schemas/common";
import { ROBINHOOD_DECIMALS } from "@/lib/bridge/robinhood-amount";

export type MockScenario =
  | "operational"
  | "paused"
  | "insufficient-liquidity"
  | "quota-exhausted"
  | "quota-paused"
  /**
   * Mock-only: reports both Robinhood routes as OPEN in `GET /chains`, so
   * the `GlcToRhn`/`RhnToGlc` flows can be exercised end to end.
   *
   * Not a production state and not reachable from one. The real backend
   * ships both routes disabled behind three independent gates plus the
   * custody contract's own `routeEnabled`, and nothing in this UI can open
   * them — this scenario only changes what the in-memory fixture answers.
   */
  | "robinhood-open";

export interface MockClientOptions {
  readonly scenario?: MockScenario;
  readonly latencyMs?: number;
  readonly now?: () => Date;
}

const GOLDCOIN_DECIMALS = 8;
const SOLANA_DECIMALS = 6;

/**
 * Exact atomic -> decimal string. Integer/BigInt arithmetic only: the real
 * backend computes these with checked integer math and a float here would
 * make the mock disagree with production for large amounts.
 */
function formatDisplay(atomic: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const negative = atomic < 0n;
  const magnitude = negative ? -atomic : atomic;
  const whole = magnitude / scale;
  const fraction = (magnitude % scale).toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * In-memory client backing `NEXT_PUBLIC_BRIDGE_API_MODE=mock`.
 *
 * Every fixture is parsed through the same schema a live response would be —
 * a fixture that would not survive the real boundary fails the test suite.
 * `createTransfer` re-derives its fee/net figures with the same 3% math the
 * real backend uses, purely so the mock stays internally consistent; the
 * frontend proper never performs this calculation itself.
 */
export class MockBridgeClient implements BridgeApiClient {
  private readonly scenario: MockScenario;
  private readonly latencyMs: number;
  private readonly now: () => Date;
  private nextId = 5000;

  constructor(options: MockClientOptions = {}) {
    this.scenario = options.scenario ?? "operational";
    this.latencyMs = options.latencyMs ?? 220;
    this.now = options.now ?? (() => new Date());
  }

  private async delay<T>(value: T): Promise<T> {
    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    return value;
  }

  async getStatus() {
    const raw =
      this.scenario === "paused"
        ? fixtures.pausedStatusFixture()
        : this.scenario === "quota-exhausted"
          ? fixtures.quotaExhaustedStatusFixture()
          : this.scenario === "quota-paused"
            ? fixtures.quotaPausedStatusFixture()
            : fixtures.statusFixture(this.now);
    return this.delay(bridgeStatusSchema.parse(raw));
  }

  async getChains() {
    return this.delay(
      chainsViewSchema.parse(
        fixtures.chainsFixture(this.now, {
          robinhoodOpen: this.scenario === "robinhood-open",
        }),
      ),
    );
  }

  async getLimits() {
    return this.delay(transferLimitsSchema.parse(fixtures.limitsFixture()));
  }

  async getReserve() {
    const raw =
      this.scenario === "insufficient-liquidity"
        ? fixtures.insufficientReserveFixture()
        : fixtures.reserveFixture();
    return this.delay(reserveAvailabilitySchema.parse(raw));
  }

  async getHealth() {
    return this.delay(publicHealthSchema.parse(fixtures.healthFixture()));
  }

  async getStats() {
    return this.delay(bridgeStatsSchema.parse(fixtures.statsFixture()));
  }

  /**
   * Per-route decimals and asset names, mirroring the backend's own match
   * in `BridgeApi::quote`. Goldcoin is 8, Solana's mint is 6, and
   * Robinhood's token is a compile-time 18 — the backend calls that last
   * one "a compile-time constant, not a live read", because an 18-decimal
   * token is what makes a separate Robinhood unit necessary at all.
   */
  private quoteUnits(route: SettlementRoute): {
    source: number;
    destination: number;
    sourceAsset: string;
    destinationAsset: string;
  } {
    switch (route) {
      case "GlcToSol":
        return {
          source: GOLDCOIN_DECIMALS,
          destination: SOLANA_DECIMALS,
          sourceAsset: "GLC (Goldcoin)",
          destinationAsset: "GLC (Solana)",
        };
      case "SolToGlc":
        return {
          source: SOLANA_DECIMALS,
          destination: GOLDCOIN_DECIMALS,
          sourceAsset: "GLC (Solana)",
          destinationAsset: "GLC (Goldcoin)",
        };
      case "GlcToRhn":
        return {
          source: GOLDCOIN_DECIMALS,
          destination: ROBINHOOD_DECIMALS,
          sourceAsset: "GLC (Goldcoin)",
          destinationAsset: "GLC (Robinhood)",
        };
      case "RhnToGlc":
        return {
          source: ROBINHOOD_DECIMALS,
          destination: GOLDCOIN_DECIMALS,
          sourceAsset: "GLC (Robinhood)",
          destinationAsset: "GLC (Goldcoin)",
        };
    }
  }

  async getQuote(request: {
    direction: SettlementRoute;
    gross_amount: string;
  }): Promise<QuoteOutputDto> {
    const gross = BigInt(request.gross_amount);
    if (gross <= 0n) throw badRequestError("gross_amount must be greater than zero");

    // A quote for a route the gate refuses is refused too, exactly as the
    // real backend does — it parses `direction` as a `Route` and returns
    // the same cause-agnostic 409 a create would, so "not open" is
    // distinguishable from "you sent nonsense".
    if (!this.routeOpen(request.direction)) throw directionUnavailableError();

    const feeBps = fixtures.BRIDGE_FEE_BPS;
    const fee = (gross * BigInt(feeBps)) / 10_000n;
    const net = gross - fee;
    const units = this.quoteUnits(request.direction);

    const output = {
      direction: request.direction,
      gross_amount: gross.toString(),
      gross_display_amount: formatDisplay(gross, GOLDCOIN_DECIMALS),
      fee_bps: feeBps,
      fee_amount: fee.toString(),
      fee_display_amount: formatDisplay(fee, GOLDCOIN_DECIMALS),
      net_amount: net.toString(),
      net_display_amount: formatDisplay(net, GOLDCOIN_DECIMALS),
      source_decimals: units.source,
      destination_decimals: units.destination,
      source_asset: units.sourceAsset,
      destination_asset: units.destinationAsset,
    };
    return this.delay(quoteOutputSchema.parse(output));
  }

  /** The fixture's own route gate — the single place mock availability is decided. */
  private routeOpen(route: SettlementRoute): boolean {
    const chains = fixtures.chainsFixture(this.now, {
      robinhoodOpen: this.scenario === "robinhood-open",
    });
    return chains.routes.find((entry) => entry.id === route)?.enabled ?? false;
  }

  async getSolToGlcRecipientEligibility(address: string, wallet: string | null) {
    // The mock never records SolToGlc payouts (that direction is created
    // on-chain, not through this API), so every recipient/wallet reads as
    // eligible — the blocked shape is exercised by unit tests, not by a
    // mock-mode scenario.
    return this.delay(
      recipientEligibilitySchema.parse({
        direction: "SolToGlc",
        address: address.trim(),
        wallet: wallet ?? null,
        eligible: true,
        blocked_reason: null,
        retry_after: null,
        retry_after_seconds: null,
        window_seconds: 86_400,
      }),
    );
  }

  async getTransfer(id: number) {
    const found =
      this.created.get(id) ?? fixtures.transfersFixture().find((t) => t.id === id);
    if (!found) throw notFoundError("transfer");
    return this.delay(transferViewSchema.parse(found));
  }

  private created = new Map<number, TransferViewDto>();

  async createTransfer(request: CreateTransferRequest): Promise<CreateTransferOutputDto> {
    const validated = createTransferRequestSchema.parse(request);
    // An absent `route` means `GlcToSol`, exactly as the backend defaults
    // it — the default applies only to an ABSENT field, never as a
    // fallback for a route that was named and refused.
    const route = validated.route ?? "GlcToSol";

    // A route this fixture reports as closed is refused before anything is
    // created, leaving no request behind — the backend gates the route
    // ahead of every fee computation, capacity reservation and ledger
    // write for the same reason.
    if (!this.routeOpen(route)) throw directionUnavailableError();
    if (route !== "GlcToSol" && route !== "GlcToRhn") {
      throw badRequestError(`route ${route} is not created through this endpoint`);
    }

    // Every unavailable cause returns the backend's single cause-agnostic
    // 409, exactly like the real service (DIRECTION_UNAVAILABLE_MESSAGE).
    if (this.scenario !== "operational" && this.scenario !== "robinhood-open") {
      throw directionUnavailableError();
    }

    const id = this.nextId++;
    const feeBps = fixtures.BRIDGE_FEE_BPS;
    const gross = BigInt(validated.amount_atomic);
    const fee = (gross * BigInt(feeBps)) / 10_000n;

    this.created.set(id, {
      id,
      direction: route,
      state: "AwaitingDeposit",
      gross_amount_atomic: gross.toString(),
      fee_bps: feeBps,
      fee_amount_atomic: fee.toString(),
      net_amount_atomic: (gross - fee).toString(),
      created_at: Math.floor(this.now().getTime() / 1000),
      source_txid: null,
      source_confirmations: 0,
      required_source_confirmations: 12,
      destination_txid: null,
      failure_reason: null,
      // A brand-new request has settled nothing and refunded nothing.
      refund: null,
    });

    // A distinct mock address per request id, so dev/test flows exercise
    // "each new request gets a different deposit address" realistically.
    const output = {
      request_id: id,
      deposit_address: `GLCDep0sit${id.toString().padStart(6, "0")}1111111111111111111111`,
    };
    return this.delay(createTransferOutputSchema.parse(output));
  }

  async listTransfers(params: ListTransfersParams) {
    let items = [...fixtures.transfersFixture(), ...this.created.values()];
    if (params.state) items = items.filter((t) => t.state === params.state);
    items = items.sort((a, b) => b.created_at - a.created_at);
    return this.delay(
      transferListSchema.parse({
        items,
        next_cursor: null,
        as_of: Math.floor(this.now().getTime() / 1000),
      }),
    );
  }

  async listExplorerEvents(params: ListExplorerEventsParams) {
    let items = fixtures.explorerEventsFixture();
    if (params.direction) items = items.filter((e) => e.direction === params.direction);
    if (params.state) items = items.filter((e) => e.to_state === params.state);
    return this.delay(
      explorerEventListSchema.parse({
        items,
        next_cursor: null,
        as_of: Math.floor(this.now().getTime() / 1000),
      }),
    );
  }

  async listReserveHistory(params: ListReserveHistoryParams) {
    let items = fixtures.reserveHistoryFixture();
    if (params.direction) {
      const target =
        params.direction === "goldcoin" ? "GoldcoinReserve" : "SolanaReserve";
      items = items.filter((e) => e.direction === target);
    }
    return this.delay(
      reserveHistoryListSchema.parse({
        items,
        next_cursor: null,
        as_of: Math.floor(this.now().getTime() / 1000),
      }),
    );
  }
}
