import { describe, expect, it, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderWithQueryClient,
  routeEligibilityFrom,
  selectNetwork,
  waitForRouteVerdict,
} from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import type * as EvmModule from "@/lib/evm";
import { BridgeForm } from "@/features/bridge/BridgeForm";
import { ROBINHOOD_DECIMALS, robinhoodRollingRemaining } from "@/lib/bridge";
import { atomicRescaleFloor } from "@/lib/bridge/canonical";
import { robinhoodLimitsSchema } from "@/lib/api/schemas/robinhood";
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";
import { formatBaseUnits } from "@/lib/format/amount";

/**
 * The whole limits line on both Robinhood routes:
 * "Min X GLC · Max Y GLC · Z GLC remaining today".
 *
 * # The gap this file closes
 *
 * The maximum arrived first and the rest of the line did not. A Robinhood
 * route showed a ceiling with no floor beside it and no rolling remainder
 * at all, while the Solana pairs showed all three — so the one number a
 * user needs to answer "can I still bridge today" was missing exactly
 * where the contract enforces it hardest.
 *
 * # What is pinned here
 *
 * That each route reads ITS OWN direction's contract fields — `RhnToGlc`
 * the inbound min/max and the inbound accumulator, `GlcToRhn` the outbound
 * ones — that the floor on `GlcToRhn` is grossed up through that route's
 * fee (the contract's `outboundMin` bounds the NET payout, so the raw
 * figure is the "Min 99 GLC" bug), that the remainder comes from the
 * backend's published window rather than anything computed here, and that
 * an unread contract still shows nothing rather than a zero.
 *
 * Every expectation is derived from the fixture standing in for the
 * backend. No 100, no 20,000 and no 5,000,000 appears in this file.
 */
const getStatus = vi.fn();
const getChains = vi.fn();
const getLimits = vi.fn();
const getReserve = vi.fn();
const getQuote = vi.fn();
const listTransfers = vi.fn();
const getRobinhoodLimits = vi.fn();
const getSolToGlcRecipientEligibility = vi.fn();
const getRhnToGlcRecipientEligibility = vi.fn();

vi.mock("@/lib/api", async () => ({
  // The real error factories: BridgeForm imports them by name, and a
  // partial mock of this module would leave them undefined.
  ...(await import("@/lib/api/errors")),
  bridgeApi: {
    getStatus: (...a: unknown[]) => getStatus(...a),
    getChains: (...a: unknown[]) => getChains(...a),
    getLimits: (...a: unknown[]) => getLimits(...a),
    getReserve: (...a: unknown[]) => getReserve(...a),
    getQuote: (...a: unknown[]) => getQuote(...a),
    createTransfer: vi.fn(),
    listTransfers: (...a: unknown[]) => listTransfers(...a),
    getRobinhoodLimits: (...a: unknown[]) => getRobinhoodLimits(...a),
    getSolToGlcRecipientEligibility: (...a: unknown[]) =>
      getSolToGlcRecipientEligibility(...a),
    // The one method `fetchRouteEligibility` calls. Built from the
    // per-route mocks above by the same rule `HttpBridgeClient` uses, so
    // a route with no landed endpoint rejects here exactly as it would
    // against the real backend.
    getRouteEligibility: routeEligibilityFrom({
      SolToGlc: (address: string, wallet: string | null) =>
        getSolToGlcRecipientEligibility(address, wallet),
      RhnToGlc: (address: string, wallet: string | null) =>
        getRhnToGlcRecipientEligibility(address, wallet),
    }),
    getRhnToGlcRecipientEligibility: (...a: unknown[]) =>
      getRhnToGlcRecipientEligibility(...a),
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => ({
    status: "disconnected" as const,
    address: null,
    wallet: null,
    wallets: [],
    canSign: false,
    error: null,
    platform: "desktop" as const,
    connect: vi.fn(),
    disconnect: vi.fn(),
    dismissError: vi.fn(),
  }),
  useDepositToReserve: () => ({
    capability: () => ({ available: true, reason: null, message: null }),
    deposit: vi.fn(),
  }),
  isValidAddress: (v: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v),
  useTokenBalance: () => ({ isPending: false, isError: false, data: undefined }),
  isTokenBalanceAvailable: () => true,
  walletQueryKeys: { balances: () => ["solana", "balance"] },
  needsDeepLink: () => false,
  isUserRejection: () => false,
}));

vi.mock("@/lib/evm", async (importOriginal) => {
  const actual = await importOriginal<typeof EvmModule>();
  const deployment = {
    chainId: 4663,
    chainName: "Robinhood Chain",
    rpcUrl: "https://rpc.example.invalid",
    bridgeAddress: "0xbaEdFFdAC19fC9c1F025f8F6F74e633aB2708DBf",
    tokenAddress: "0xaf0172DDEa4ce60dB3EBab05748A00B14fC8e433",
  };
  return {
    ...actual,
    robinhoodDeployment: () => deployment,
    useEvmWallet: () => ({
      // The NETWORK identity, which the real hook always resolves: it is
      // what the wallet control reads, and it never depends on contract
      // configuration or on a route being open.
      network: {
        chainId: deployment.chainId,
        chainName: deployment.chainName,
        rpcUrl: deployment.rpcUrl,
      },
      wallets: [],
      hasInjectedWallet: true,
      address: null,
      chainId: null,
      connecting: false,
      deployment,
      onExpectedChain: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      switchChain: vi.fn(),
      getProvider: () => null,
    }),
    useRobinhoodDeposit: () => ({ deposit: vi.fn() }),
    useRobinhoodGlcBalance: () => ({
      isPending: false,
      isError: false,
      data: undefined,
    }),
  };
});

/**
 * The limits line under the amount field, as one string.
 *
 * Matches the remainder as well as the bounds, because the remainder can
 * be the only part present: the bounds and the window arrive from
 * different requests on the Solana pairs, and either can still be in
 * flight.
 */
function limitsLine(): string | null {
  const paragraphs = Array.from(document.querySelectorAll("p"));
  const line = paragraphs.find((p) =>
    /(^|\s)(Min|Max)\s|remaining today/.test(p.textContent),
  );
  return line?.textContent ?? null;
}

beforeEach(() => {
  vi.resetAllMocks();
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getChains.mockResolvedValue(
    fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true }),
  );
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getRobinhoodLimits.mockResolvedValue(
    fixtures.robinhoodLimitsFixture(() => new Date(), { open: true }),
  );
  getQuote.mockImplementation((request: { direction: string }) =>
    Promise.resolve({
      direction: request.direction,
      gross_amount: "100000000000",
      gross_display_amount: "1000.00000000",
      fee_bps: 300,
      fee_amount: "3000000000",
      fee_display_amount: "30.00000000",
      net_amount: "97000000000",
      net_display_amount: "970.00000000",
      source_decimals: 8,
      destination_decimals: 18,
      source_asset: "GLC (Goldcoin)",
      destination_asset: "GLC (Robinhood)",
    }),
  );
  listTransfers.mockResolvedValue({ items: [], next_cursor: null, as_of: 1_700_000_000 });
  const eligible = {
    address: "unused",
    wallet: null,
    eligible: true,
    blocked_reason: null,
    retry_after: null,
    retry_after_seconds: null,
    window_seconds: 86_400,
  };
  getSolToGlcRecipientEligibility.mockResolvedValue({
    ...eligible,
    direction: "SolToGlc",
  });
  getRhnToGlcRecipientEligibility.mockResolvedValue({
    ...eligible,
    direction: "RhnToGlc",
  });
});

/** The backend DTO the form is being fed, parsed as the app parses it. */
function openLimits() {
  return robinhoodLimitsSchema.parse(
    fixtures.robinhoodLimitsFixture(() => new Date(), { open: true }),
  );
}

/** The source token's decimals on each Robinhood route. */
const DECIMALS = {
  deposit: ROBINHOOD_DECIMALS,
  payout: GOLDCOIN_DECIMALS,
} as const;

/** One base-unit figure formatted exactly as the limits line formats it. */
function asDisplayed(raw: string, decimals: number): string {
  return `${formatBaseUnits(raw, decimals, { minFractionDigits: 0 })} GLC`;
}

/**
 * One route's published maximum, formatted as the line renders it. The
 * source token's precision does not change the text: the figure is a
 * whole number of GLC, and the display trims to significant digits.
 */
function routeMax(route: "GlcToRhn" | "RhnToGlc"): string {
  const [whole = "0"] = fixtures.ROUTE_MAX_TRANSFER_DISPLAY[route].split(".");
  return `${BigInt(whole).toLocaleString("en-US")} GLC`;
}

/**
 * The three parts the line must carry for one leg, each derived from the
 * fixture rather than written out.
 *
 * `deposit` is `RhnToGlc` (source Robinhood, 18dp); `payout` is
 * `GlcToRhn` (source Goldcoin, 8dp).
 */
function expected(leg: "deposit" | "payout") {
  const limits = openLimits();
  const decimals = DECIMALS[leg];
  const remaining = robinhoodRollingRemaining(leg, limits, decimals);
  if (remaining === undefined) {
    throw new Error("the open fixture must publish a window");
  }
  return {
    // Neither BOUND is a contract figure, and neither is per leg: both
    // are published per route by the backend, which is why they are read
    // straight from the route fixture rather than derived here. Only the
    // remainder comes from the contract's own accumulator.
    min: asDisplayed(fixtures.SOURCE_MINIMUM_ATOMIC, GOLDCOIN_DECIMALS),
    max: routeMax(leg === "deposit" ? "RhnToGlc" : "GlcToRhn"),
    remaining: asDisplayed(remaining, decimals),
  };
}

/** Puts the form on `GlcToRhn`. */
async function selectGlcToRhn(user: ReturnType<typeof userEvent.setup>) {
  await selectNetwork(user, "Destination network", /Robinhood Chain/);
}

/**
 * Puts the form on `RhnToGlc` by selecting the SOURCE alone.
 *
 * Deliberately not naming the destination: `onSourceChange` prefers an
 * OPEN destination, and with this fixture `RhnToGlc` is open while
 * `RhnToSol` is built and shut. Landing anywhere else would mean the
 * selector had gone back to preferring a route for merely existing.
 */
async function selectRhnToGlc(user: ReturnType<typeof userEvent.setup>) {
  await selectNetwork(user, "Source network", /Robinhood Chain/);
}

describe("GlcToRhn — the whole line", () => {
  it("shows Min · Max from the route, and remaining today from the contract", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectGlcToRhn(user);

    const want = expected("payout");
    await waitFor(() => expect(limitsLine()).toContain("remaining today"));
    const line = limitsLine();
    expect(line).toContain(`Min ${want.min}`);
    expect(line).toContain(`Max ${want.max}`);
    expect(line).toContain(`${want.remaining} remaining today`);
  });

  it("reads the OUTBOUND accumulator, the one executePayout charges", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectGlcToRhn(user);

    await waitFor(() => expect(limitsLine()).toContain("remaining today"));
    // The inbound window's remainder, in this route's own units, must not
    // be what appears — the fixture keeps the two deliberately unequal.
    const limits = openLimits();
    const inbound = limits.rhn_to_glc_rolling_window;
    if (!inbound) throw new Error("the open fixture must publish both windows");
    const crossed = asDisplayed(
      atomicRescaleFloor(inbound.remaining_atomic, ROBINHOOD_DECIMALS, GOLDCOIN_DECIMALS),
      GOLDCOIN_DECIMALS,
    );
    expect(limitsLine()).not.toContain(`${crossed} remaining today`);
  });

  it("does not publish the Solana route's rolling remainder", async () => {
    // `GET /status`'s quota fields describe a Solana PDA and are named per
    // Solana route. Relabelling one for a Robinhood route would publish
    // headroom that route does not have.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectGlcToRhn(user);

    await waitFor(() => expect(limitsLine()).toContain("remaining today"));
    const status = fixtures.statusFixture(() => new Date());
    const solana = asDisplayed(
      atomicRescaleFloor(
        String(status.glc_to_sol_rolling_volume_remaining),
        6,
        GOLDCOIN_DECIMALS,
      ),
      GOLDCOIN_DECIMALS,
    );
    expect(limitsLine()).not.toContain(`${solana} remaining today`);
  });
});

describe("RhnToGlc — the whole line", () => {
  it("shows Min · Max from the route, and remaining today from the contract", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectRhnToGlc(user);

    const want = expected("deposit");
    await waitFor(() => expect(limitsLine()).toContain("remaining today"));
    const line = limitsLine();
    expect(line).toContain(`Min ${want.min}`);
    expect(line).toContain(`Max ${want.max}`);
    expect(line).toContain(`${want.remaining} remaining today`);
  });

  it("reads the INBOUND accumulator, the one deposit() charges", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectRhnToGlc(user);

    await waitFor(() => expect(limitsLine()).toContain("remaining today"));
    const limits = openLimits();
    const outbound = limits.glc_to_rhn_rolling_window;
    if (!outbound) throw new Error("the open fixture must publish both windows");
    expect(limitsLine()).not.toContain(
      `${asDisplayed(outbound.remaining_atomic, ROBINHOOD_DECIMALS)} remaining today`,
    );
  });

  it("states the minimum as the contract's inboundMin, unadjusted", async () => {
    // This leg's floor bounds the DEPOSIT, which is exactly what the user
    // types — the fee is charged later, at fold time, on the Goldcoin
    // side. Grossing this one up would refuse amounts the contract takes.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectRhnToGlc(user);

    const limits = openLimits();
    const raw = limits.inbound_min_atomic;
    if (raw === null) throw new Error("the open fixture must publish a floor");
    await waitFor(() => expect(limitsLine()).toContain("Min "));
    expect(limitsLine()).toContain(`Min ${asDisplayed(raw, ROBINHOOD_DECIMALS)}`);
  });

  it("formats all three in Robinhood's own 18 decimals", async () => {
    // The source token here IS the 18-decimal one. A figure narrowed to 8
    // and then formatted as 18 reads ten orders of magnitude small.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectRhnToGlc(user);

    await waitFor(() => expect(limitsLine()).toContain("remaining today"));
    expect(limitsLine()).not.toMatch(/(Min|Max) 0[.,]/);
    expect(limitsLine()).not.toMatch(/\s0\.\d+ GLC remaining today/);
  });
});

describe("each route reads its OWN window", () => {
  beforeEach(() => {
    // A deployment whose two windows have drifted far apart. Whether that
    // is reachable in production is beside the point: if it reaches a
    // browser, each route must show the accumulator that actually bounds
    // it rather than whichever field was read first.
    getRobinhoodLimits.mockResolvedValue({
      ...fixtures.robinhoodLimitsFixture(() => new Date(), { open: true }),
      rhn_to_glc_rolling_window: {
        limit_atomic: "100000000000000000000000",
        used_atomic: "99000000000000000000000",
        remaining_atomic: "1000000000000000000000",
        resets_at: 1_700_043_200,
        is_current: true,
      },
      glc_to_rhn_rolling_window: {
        limit_atomic: "100000000000000000000000",
        used_atomic: "1000000000000000000000",
        remaining_atomic: "99000000000000000000000",
        resets_at: 1_700_043_200,
        is_current: true,
      },
    });
  });

  it("GlcToRhn shows the outbound window's remainder", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectGlcToRhn(user);

    await waitFor(() => expect(limitsLine()).toContain("99,000 GLC remaining today"));
    expect(limitsLine()).not.toContain("1,000 GLC remaining today");
  });

  it("RhnToGlc shows the inbound window's remainder", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectRhnToGlc(user);

    await waitFor(() => expect(limitsLine()).toContain("1,000 GLC remaining today"));
    expect(limitsLine()).not.toContain("99,000 GLC remaining today");
  });
});

describe("an unread window publishes nothing", () => {
  it("shows no remainder when the contract could not be read", async () => {
    getRobinhoodLimits.mockResolvedValue(
      fixtures.robinhoodLimitsFixture(() => new Date(), { open: false }),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectGlcToRhn(user);

    await waitFor(() => expect(getRobinhoodLimits).toHaveBeenCalled());
    // Not "0 GLC remaining today", which would say the route is done for
    // the day when nobody actually asked the chain.
    expect(limitsLine()).not.toContain("remaining today");
    // BOTH bounds survive. They never came from the contract — the
    // maximum stopped doing so when the backend began publishing it per
    // route — so an unreachable contract cannot make either unknown.
    expect(limitsLine()).toContain(`Min ${expected("payout").min}`);
    expect(limitsLine()).toContain(`Max ${routeMax("GlcToRhn")}`);
  });

  it("keeps Min and Max when only the window is missing", async () => {
    // A backend too old to publish the windows omits the keys. The bounds
    // it DOES publish must still appear — losing them would be a
    // regression on a deployment that was working before.
    const older = fixtures.robinhoodLimitsFixture(() => new Date(), { open: true });
    delete (older as Record<string, unknown>).rhn_to_glc_rolling_window;
    delete (older as Record<string, unknown>).glc_to_rhn_rolling_window;
    getRobinhoodLimits.mockResolvedValue(older);

    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectGlcToRhn(user);

    await waitFor(() => expect(limitsLine()).toContain("Max "));
    expect(limitsLine()).toContain("Min ");
    expect(limitsLine()).not.toContain("remaining today");
  });
});

describe("the Solana routes are untouched", () => {
  it("still reads GET /status's quota, and never asks for Robinhood's", async () => {
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    const status = fixtures.statusFixture(() => new Date());
    const solana = asDisplayed(
      atomicRescaleFloor(
        String(status.glc_to_sol_rolling_volume_remaining),
        6,
        GOLDCOIN_DECIMALS,
      ),
      GOLDCOIN_DECIMALS,
    );
    await waitFor(() => expect(limitsLine()).toContain("remaining today"));
    expect(limitsLine()).toContain(`${solana} remaining today`);
    expect(getRobinhoodLimits).not.toHaveBeenCalled();
  });

  it("keeps its own line after a trip through a Robinhood route and back", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    const status = fixtures.statusFixture(() => new Date());
    const solana = asDisplayed(
      atomicRescaleFloor(
        String(status.glc_to_sol_rolling_volume_remaining),
        6,
        GOLDCOIN_DECIMALS,
      ),
      GOLDCOIN_DECIMALS,
    );
    await waitFor(() => expect(limitsLine()).toContain(`${solana} remaining today`));

    await selectGlcToRhn(user);
    const rhn = expected("payout");
    await waitFor(() =>
      expect(limitsLine()).toContain(`${rhn.remaining} remaining today`),
    );
    expect(limitsLine()).not.toContain(`${solana} remaining today`);

    await selectNetwork(user, "Destination network", /Solana/);
    await waitFor(() => expect(limitsLine()).toContain(`${solana} remaining today`));
  });
});
