import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";
import { formatBaseUnits } from "@/lib/format/amount";

/**
 * The per-transaction maximum on the two Robinhood routes.
 *
 * # What this file used to pin, and why it changed
 *
 * The form once showed no maximum at all on a Robinhood route, then
 * showed the custody contract's `inboundMax`/`outboundMax`. That was an
 * improvement on nothing, and still wrong: the contract's ceilings bound
 * the CONTRACT's own leg, and a payout ceiling in particular is not a
 * statement about what a user may deposit. Live, `GlcToRhn` was offered
 * 2,000,000 — the contract's `outboundMax` — while the backend admitted
 * 20,000.
 *
 * The backend publishes the source-side user limit per route now
 * (`GET /chains`' `max_transfer_display`), so that is what the form shows
 * and validates against, on every route.
 *
 * # What is pinned here
 *
 * That the maximum comes from the ROUTE's own registry entry, that it is
 * formatted in the source token's own decimals, that a drifting contract
 * ceiling cannot move it, and that a route the registry publishes no
 * maximum for shows none rather than a number nobody stated. Every figure
 * lives in the fixture standing in for the backend — never in the
 * component, and never in an expectation that would survive the backend
 * changing it.
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

const DEPLOYMENT = {
  chainId: 4663,
  chainName: "Robinhood Chain",
  rpcUrl: "https://rpc.example.invalid",
  bridgeAddress: "0xbaEdFFdAC19fC9c1F025f8F6F74e633aB2708DBf",
  tokenAddress: "0xaf0172DDEa4ce60dB3EBab05748A00B14fC8e433",
};

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
        chainId: DEPLOYMENT.chainId,
        chainName: DEPLOYMENT.chainName,
        rpcUrl: DEPLOYMENT.rpcUrl,
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

/** The limits line under the amount field, as one string. */
function boundsLine(): string | null {
  const paragraphs = Array.from(document.querySelectorAll("p"));
  const line = paragraphs.find((p) => /(^|\s)(Min|Max)\s/.test(p.textContent));
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

/**
 * The whole-GLC maximum the mock backend publishes for one ROUTE, read
 * off the same `/chains` field the form reads. Never the custody
 * contract's ceilings, which bound a different thing.
 */
function publishedMax(route: "GlcToRhn" | "RhnToGlc"): bigint {
  const [whole = "0"] = fixtures.ROUTE_MAX_TRANSFER_DISPLAY[route].split(".");
  return BigInt(whole);
}

/** "20,000" — grouped exactly as the form renders it. */
function grouped(whole: bigint): string {
  return whole.toLocaleString("en-US");
}

/**
 * The floor the form must show for one leg, formatted as the line
 * formats it — derived from the mock backend's own DTO, never written
 * out as a literal.
 *
 * `deposit` sources from Robinhood, so the contract's floor bounds the
 * typed amount directly. `payout` sources from Goldcoin and the
 * contract's floor bounds the NET, so the displayed figure is the
 * smallest gross that clears it at this route's own fee.
 */
function publishedMinimum(): string {
  // Canonical 8dp on the wire; the display trims to significant digits,
  // so the same policy floor renders identically at either source
  // chain's precision.
  return `${formatBaseUnits(fixtures.SOURCE_MINIMUM_ATOMIC, GOLDCOIN_DECIMALS, {
    minFractionDigits: 0,
  })} GLC`;
}

describe("GlcToRhn — Goldcoin → Robinhood Chain", () => {
  it("shows the maximum published for this route", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Destination network", /Robinhood Chain/);

    const expected = `Max ${grouped(publishedMax("GlcToRhn"))} GLC`;
    await waitFor(() => expect(boundsLine()).toContain(expected));
  });

  it("takes the figure from GET /chains, not from either chain's ceiling", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Destination network", /Robinhood Chain/);

    await waitFor(() => expect(boundsLine()).toContain("Max "));
    // Neither chain ceiling is what this route displays: the Solana
    // program's `per_transfer_limit` is a different number in a different
    // unit, and the contract's outbound ceiling bounds the payout leg.
    const solana = fixtures.limitsFixture();
    expect(boundsLine()).not.toContain(solana.per_transfer_limit);
    expect(boundsLine()).toContain(`Max ${grouped(publishedMax("GlcToRhn"))} GLC`);
  });

  it("states the POLICY minimum, not a figure derived from the contract", async () => {
    // The minimum is one published rule, identical on every route, and
    // owes nothing to `outboundMin`. Two earlier shapes are both wrong
    // and both asserted against here: the contract's raw floor (which
    // bounds the NET payout, not the gross a user types), and the
    // fee-grossed-up derivation of it that this form used to compute.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Destination network", /Robinhood Chain/);

    await waitFor(() => expect(boundsLine()).toContain("Min "));
    expect(boundsLine()).toContain(`Min ${publishedMinimum()}`);
    // Neither the raw contract floor nor any fee-adjusted derivation of
    // it. At the fixture's 250 bps that derivation would be 102.56410256.
    expect(boundsLine()).not.toContain("102.56410256");
  });

  it("refuses an amount above the published maximum", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Destination network", /Robinhood Chain/);
    await waitFor(() => expect(boundsLine()).toContain("Max "));

    const over = (publishedMax("GlcToRhn") + 1n).toString();
    await user.type(screen.getByLabelText(/Amount in GLC/i), over);

    // The form states the refusal in more than one place (beside the
    // field and in the route summary), so this counts them rather than
    // demanding exactly one.
    const refusals = await screen.findAllByText(
      new RegExp(`maximum transfer is ${grouped(publishedMax("GlcToRhn"))} GLC`),
    );
    expect(refusals.length).toBeGreaterThan(0);
  });

  it("accepts the maximum exactly", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Destination network", /Robinhood Chain/);
    await waitFor(() => expect(boundsLine()).toContain("Max "));

    await user.type(
      screen.getByLabelText(/Amount in GLC/i),
      publishedMax("GlcToRhn").toString(),
    );
    expect(screen.queryAllByText(/maximum transfer is/)).toHaveLength(0);
  });
});

describe("RhnToGlc — Robinhood Chain → Goldcoin", () => {
  it("shows the maximum published for this route", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Robinhood Chain/);

    const expected = `Max ${grouped(publishedMax("RhnToGlc"))} GLC`;
    await waitFor(() => expect(boundsLine()).toContain(expected));
  });

  it("formats it in Robinhood's own 18 decimals, not the canonical 8", async () => {
    // The source token here IS the 18-decimal one. A figure narrowed to 8
    // and then formatted as 18 would read ten orders of magnitude small.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Source network", /Robinhood Chain/);

    await waitFor(() => expect(boundsLine()).toContain("Max "));
    expect(boundsLine()).toContain(`${grouped(publishedMax("RhnToGlc"))} GLC`);
    expect(boundsLine()).not.toMatch(/Max 0[.,]/);
  });
});

describe("the custody contract's own ceilings cannot move it", () => {
  beforeEach(() => {
    /*
     * The exact production shape this change exists for: a contract whose
     * outbound ceiling is two million. Reading it for `GlcToRhn` is what
     * offered a user a hundred times the limit the backend would admit,
     * and both figures below must now be absent from the line.
     */
    getRobinhoodLimits.mockResolvedValue({
      ...fixtures.robinhoodLimitsFixture(() => new Date(), { open: true }),
      inbound_max_atomic: "1500000000000000000000000",
      outbound_max_atomic: "2000000000000000000000000",
    });
  });

  it("GlcToRhn shows its published limit, not the contract's outboundMax", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Destination network", /Robinhood Chain/);

    await waitFor(() =>
      expect(boundsLine()).toContain(`Max ${grouped(publishedMax("GlcToRhn"))} GLC`),
    );
    expect(boundsLine()).not.toContain("2,000,000");
  });

  it("RhnToGlc shows its published limit, not the contract's inboundMax", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Source network", /Robinhood Chain/);

    await waitFor(() =>
      expect(boundsLine()).toContain(`Max ${grouped(publishedMax("RhnToGlc"))} GLC`),
    );
    expect(boundsLine()).not.toContain("1,500,000");
  });

  it("keeps showing a maximum when the contract could not be read at all", async () => {
    // It used to blank on an unreadable contract, because the contract
    // WAS the source. The limit does not come from there any more, so an
    // unreachable contract cannot hide a limit the bridge enforces —
    // exactly the argument that already kept the minimum on screen.
    getRobinhoodLimits.mockRejectedValue(new Error("404"));
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Destination network", /Robinhood Chain/);
    await waitFor(() =>
      expect(boundsLine()).toContain(`Max ${grouped(publishedMax("GlcToRhn"))} GLC`),
    );
    expect(boundsLine()).toContain(`Min ${publishedMinimum()}`);
  });
});

describe("a route the registry states no maximum for", () => {
  /** `/chains` from a backend predating `max_transfer_display`. */
  function withoutMaxima() {
    const base = fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true });
    return {
      ...base,
      routes: base.routes.map(({ max_transfer_display: _omit, ...rest }) => rest),
    };
  }

  it("shows no maximum rather than falling back to a chain ceiling", async () => {
    getChains.mockResolvedValue(withoutMaxima());
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Destination network", /Robinhood Chain/);
    await waitFor(() => expect(boundsLine()).toContain("Min "));
    // Not "Max 0 GLC", which would say the route takes nothing — and not
    // the contract's or the Solana program's ceiling standing in for it.
    expect(boundsLine()).not.toContain("Max ");
    // The MINIMUM is unaffected: it comes from its own published field.
    expect(boundsLine()).toContain(`Min ${publishedMinimum()}`);
  });
});

describe("the Solana routes are untouched", () => {
  it("still shows Min · Max from GET /limits, and never asks for Robinhood's", async () => {
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await waitFor(() => expect(boundsLine()).toContain("Min "));
    expect(boundsLine()).toContain("Max ");
    // 20,000 GLC, from the Solana `BridgeConfig`'s own 6-decimal figure.
    expect(boundsLine()).toContain("Max 20,000 GLC");
    expect(getRobinhoodLimits).not.toHaveBeenCalled();
  });

  it("keeps showing them after a trip through a Robinhood route and back", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await waitFor(() => expect(boundsLine()).toContain("Min "));

    // The MINIMUM is the same on both — one policy floor — so what
    // distinguishes the two lines is the MAXIMUM, which really is each
    // chain's own. A minimum that CHANGED across this switch would mean
    // the form had gone back to deriving it per route.
    await selectNetwork(user, "Destination network", /Robinhood Chain/);
    await waitFor(() => expect(boundsLine()).toContain("remaining today"));
    expect(boundsLine()).toContain(`Min ${publishedMinimum()}`);
    expect(boundsLine()).toContain("Max ");

    await selectNetwork(user, "Destination network", /Solana/);
    await waitFor(() => expect(boundsLine()).toContain("Max 20,000 GLC"));
    expect(boundsLine()).toContain(`Min ${publishedMinimum()}`);
  });
});

/** Pins that DEPLOYMENT above stays the shape `@/lib/evm` is mocked with. */
it("uses the Robinhood Chain deployment the mock announces", () => {
  expect(DEPLOYMENT.chainId).toBe(4663);
});
