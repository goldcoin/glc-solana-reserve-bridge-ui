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
import { robinhoodLimitsSchema, robinhoodReserveSchema } from "../schemas/robinhood";
import { chainsViewSchema } from "../schemas/chains";
import { explorerEventListSchema } from "../schemas/explorer";
import { reserveHistoryListSchema } from "../schemas/reserves";
import { quoteOutputSchema, type QuoteOutputDto } from "../schemas/quote";
import {
  recipientEligibilitySchema,
  routeWalletEligibilitySchema,
} from "../schemas/eligibility";
import {
  EligibilityEndpointUnpublishedError,
  isEligibilityRoute,
  normalizeRecipientEligibility,
  normalizeRouteWalletEligibility,
} from "@/lib/bridge/eligibility";
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
import { directions } from "@/lib/bridge/direction";

/**
 * The spelling the real backend echoes for an address it evaluated.
 *
 * It canonicalizes before keying a wallet's window, which for an EVM
 * address means lowercase however the caller spelled it; base58 and
 * Base58Check are already canonical and are echoed verbatim. Reproduced
 * here so the fixtures exercise the caller's stale-answer check against
 * the same mismatch the real service produces, rather than a friendlier
 * one that would hide a regression in it.
 */
function canonicalMockAddress(address: string): string {
  return address.startsWith("0x") ? address.toLowerCase() : address;
}

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

/**
 * The asset names `BridgeApi::quote` echoes per chain. Keyed by chain id so
 * a route's two names come from the same place its two decimals do.
 */
const QUOTE_ASSET_NAME: Readonly<Record<string, string>> = {
  goldcoin: "GLC (Goldcoin)",
  solana: "GLC (Solana)",
  robinhood: "GLC (Robinhood)",
};

/**
 * Throws rather than falling back, because a mock quoting an asset it has
 * no name for would be a silently mislabelled response — and mock mode is
 * what the UI's own tests read.
 */
function quoteAssetName(chainId: string): string {
  const name = QUOTE_ASSET_NAME[chainId];
  if (name === undefined) throw new Error(`mock: no quote asset name for ${chainId}`);
  return name;
}

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
    return this.delay(
      bridgeStatsSchema.parse(
        // Same scenario flag `getRobinhoodReserve` reads, so the two
        // endpoints never disagree about whether this deployment has a
        // Robinhood reserve at all.
        fixtures.statsFixture({ robinhoodOpen: this.scenario === "robinhood-open" }),
      ),
    );
  }

  /**
   * `GET /robinhood/reserve`. Answers "not configured" in every scenario
   * but `robinhood-open`, which is what the real backend answers today —
   * a deployment with no `[reserve.robinhood]` section has no reserve to
   * report, and reporting zeroes would claim an empty one exists.
   */
  async getRobinhoodReserve() {
    return this.delay(
      robinhoodReserveSchema.parse(
        fixtures.robinhoodReserveFixture(this.now, {
          open: this.scenario === "robinhood-open",
        }),
      ),
    );
  }

  /**
   * `GET /robinhood/limits`. Gated on the same scenario as
   * `getRobinhoodReserve`, because the two describe one deployment: a
   * mock that published contract ceilings for a Robinhood the reserve
   * endpoint calls unconfigured would be a state no backend can reach.
   */
  async getRobinhoodLimits() {
    return this.delay(
      robinhoodLimitsSchema.parse(
        fixtures.robinhoodLimitsFixture(this.now, {
          open: this.scenario === "robinhood-open",
        }),
      ),
    );
  }

  /**
   * Per-route decimals and asset names, mirroring the backend's own match
   * in `BridgeApi::quote`. Goldcoin is 8, Solana's mint is 6, and
   * Robinhood's token is a compile-time 18 — the backend calls that last
   * one "a compile-time constant, not a live read", because an 18-decimal
   * token is what makes a separate Robinhood unit necessary at all.
   *
   * Read off the route descriptor rather than a six-arm `switch`. The
   * switch was four arms and total over the old vocabulary, so widening the
   * route enum broke it loudly — which is the behaviour that design is for
   * — but the arms were six restatements of two facts the registry already
   * holds: which chain is on each side, and that chain's decimals.
   */
  private quoteUnits(route: SettlementRoute): {
    source: number;
    destination: number;
    sourceAsset: string;
    destinationAsset: string;
  } {
    const descriptor = directions[route];
    return {
      source: descriptor.from.token.decimals,
      destination: descriptor.to.token.decimals,
      sourceAsset: quoteAssetName(descriptor.from.chain.id),
      destinationAsset: quoteAssetName(descriptor.to.chain.id),
    };
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

    // The route's OWN rate, off the same `route_fees` table `/stats`
    // publishes. It used to be `BRIDGE_FEE_BPS` for every route, which
    // quoted a Robinhood transfer at the Solana program's rate — the exact
    // display bug the per-route table exists to prevent, reproduced by the
    // mock the UI is developed against.
    const feeBps = fixtures.routeFeeBps(request.direction);
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
    return this.delay(this.eligibility("SolToGlc", address, wallet));
  }

  /**
   * The `RhnToGlc` twin, answering the same shape for the same reason.
   * Kept on one private builder with its Solana sibling so the two can
   * never drift into describing the limits differently — on the backend
   * they are literally one `from_windows`.
   */
  async getRhnToGlcRecipientEligibility(address: string, wallet: string | null) {
    return this.delay(this.eligibility("RhnToGlc", address, wallet));
  }

  /**
   * The rolling-24h verdict for ANY of the six routes.
   *
   * # Why the fixture client answers all six when the real backend
   * answers two
   *
   * Because that is what a fixture backend is for. `MockBridgeClient`
   * stands in for the bridge API so the app can be exercised end to end
   * without one — it already invents deposit addresses, quotes and
   * transfer histories. Modelling the eligibility endpoint the real
   * backend is expected to serve is the same kind of statement, and
   * without it four of six routes are unreachable in mock mode and every
   * flow behind them (the Goldcoin deposit address, its QR, the
   * submit-failure paths) is untestable.
   *
   * This weakens nothing in production. The gate is not a flag: the only
   * way to a cleared verdict is a client returning an authoritative
   * answer, and in production the client is `HttpBridgeClient`, which
   * asks the real backend and refuses when it 404s. Mock mode reaches no
   * chain and moves no value — `isMockMode` is surfaced in the shell for
   * exactly that reason.
   *
   * Every route reads clear, for the same reason the two per-route
   * answers do: this fixture keeps no history to rate-limit against. The
   * blocked, stale, unevaluated and unpublished shapes are exercised by
   * unit tests, which construct them directly.
   */
  async getRouteEligibility(route: string, source: string | null, destination: string) {
    if (route === "SolToGlc" || route === "RhnToGlc") {
      // Through the SAME per-route builder the real client uses, so the
      // two landed endpoints behave identically in both modes.
      return this.delay(
        normalizeRecipientEligibility(
          this.eligibility(route, destination, source),
          route,
        ),
      );
    }
    if (!isEligibilityRoute(route)) {
      throw new EligibilityEndpointUnpublishedError(route);
    }
    return this.delay(
      normalizeRouteWalletEligibility(
        routeWalletEligibilitySchema.parse({
          route,
          // A leg per side ASKED about, `null` for a side that was not —
          // the real backend's shape. A Goldcoin-sourced route is funded
          // by sending to an address the backend issues, so the client
          // sends no `?source=` and the source leg comes back `null`.
          // Modelled rather than short-circuited, so the caller's
          // handling of a null leg is exercised here exactly as it is
          // against the real service.
          source:
            source === null
              ? null
              : {
                  // Echoed back canonicalized, as the backend does: an EVM
                  // address comes back lowercase whatever was sent. That
                  // is what exercises the caller's stale-answer check
                  // rather than defeating it.
                  address: canonicalMockAddress(source),
                  eligible: true,
                  reason: null,
                  retry_after: null,
                  retry_after_seconds: null,
                },
          destination: {
            address: canonicalMockAddress(destination.trim()),
            eligible: true,
            reason: null,
            retry_after: null,
            retry_after_seconds: null,
          },
          eligible: true,
          blocked_reason: null,
          blocked_reasons: [],
          retry_after: null,
          retry_after_seconds: null,
          window_seconds: 86_400,
          as_of: Math.floor(this.now().getTime() / 1000),
        }),
        route,
      ),
    );
  }

  private eligibility(
    direction: "SolToGlc" | "RhnToGlc",
    address: string,
    wallet: string | null,
  ) {
    return recipientEligibilitySchema.parse({
      direction,
      // Echoed back exactly as the backend does, because a caller racing
      // form edits discards a verdict whose echo does not match what it
      // now holds — a mock that echoed something else would make that
      // check look broken.
      address: address.trim(),
      wallet: wallet ?? null,
      eligible: true,
      blocked_reason: null,
      blocked_reasons: [],
      retry_after: null,
      retry_after_seconds: null,
      source_wallet_retry_after: null,
      recipient_retry_after: null,
      window_seconds: 86_400,
    });
  }

  /**
   * Robinhood rows exist only in the one scenario where `GET /chains`
   * reports the routes open. Serving a `GlcToRhn` transfer alongside a
   * `/chains` response calling that route unavailable would be a fixture
   * describing a state the real backend cannot be in.
   */
  private transfers(): TransferViewDto[] {
    return this.scenario === "robinhood-open"
      ? fixtures.mixedTransfersFixture()
      : fixtures.transfersFixture();
  }

  async getTransfer(id: number) {
    const found = this.created.get(id) ?? this.transfers().find((t) => t.id === id);
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
      // A brand-new request has settled nothing and refunded nothing —
      // automatically or by hand — and has not been closed.
      refund: null,
      manual_refund: null,
      disposition: null,
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
    let items = [...this.transfers(), ...this.created.values()];
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
    let items =
      this.scenario === "robinhood-open"
        ? fixtures.mixedExplorerEventsFixture()
        : fixtures.explorerEventsFixture();
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
