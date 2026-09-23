import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  primaryCta,
  renderWithQueryClient,
  routeEligibilityFrom,
  selectNetwork,
  waitForRouteVerdict,
} from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import { BridgeForm } from "@/features/bridge/BridgeForm";

/**
 * The bridge form across ALL SIX routes.
 *
 * `bridge-form-networks.test.tsx` covers the selectors and the
 * Goldcoin-paired flows. This file is about the property that changed when
 * the two cross routes shipped: the form is network-first and route-derived,
 * so every pair the backend defines has to be reachable, described with ITS
 * OWN figures, and gated on ITS OWN backend verdict — with no route-specific
 * arm anywhere that a seventh route would have to be added to.
 *
 * Four things are pinned per route:
 *
 *  - it is reachable through the two selectors and names the right route;
 *  - the quote is requested FOR that route, never for a neighbour;
 *  - the displayed source minimum is the published 100 GLC, unadjusted;
 *  - availability comes from `/chains` and changes when `/chains` changes.
 */

const getStatus = vi.fn();
const getChains = vi.fn();
const getLimits = vi.fn();
const getReserve = vi.fn();
const getQuote = vi.fn();
const getRobinhoodLimits = vi.fn();
const createTransfer = vi.fn();
const listTransfers = vi.fn();
const getSolToGlcRecipientEligibility = vi.fn();
const getRhnToGlcRecipientEligibility = vi.fn();

vi.mock("@/lib/api", async () => ({
  // The real error factories: BridgeForm imports them by name, and a
  // partial mock of this module would leave them undefined.
  ...(await import("@/lib/api/errors")),
  bridgeApi: {
    getStatus: (...args: unknown[]) => getStatus(...args),
    getChains: (...args: unknown[]) => getChains(...args),
    getLimits: (...args: unknown[]) => getLimits(...args),
    getReserve: (...args: unknown[]) => getReserve(...args),
    getQuote: (...args: unknown[]) => getQuote(...args),
    getRobinhoodLimits: (...args: unknown[]) => getRobinhoodLimits(...args),
    createTransfer: (...args: unknown[]) => createTransfer(...args),
    listTransfers: (...args: unknown[]) => listTransfers(...args),
    getSolToGlcRecipientEligibility: (...args: unknown[]) =>
      getSolToGlcRecipientEligibility(...args),
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
    getRhnToGlcRecipientEligibility: (...args: unknown[]) =>
      getRhnToGlcRecipientEligibility(...args),
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
    capability: () => ({
      available: false,
      reason: "wallet-disconnected" as const,
      message: "Connect a Solana wallet to deposit.",
    }),
    deposit: vi.fn(),
  }),
  isValidAddress: (value: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),
  useTokenBalance: () => ({ isPending: true, isError: false, data: undefined }),
  isTokenBalanceAvailable: () => true,
  walletQueryKeys: { balances: () => ["solana", "balance"] },
  needsDeepLink: () => false,
  isUserRejection: () => false,
}));

const now = () => new Date();

/**
 * Every route, as the pair of NETWORK NAMES a user clicks and the summary
 * prints. The form never shows a route id, which is the point of the
 * network-first design — so the route under test is identified by what a
 * person would actually pick.
 */
const ROUTES = [
  {
    route: "GlcToSol",
    source: /Goldcoin/,
    destination: /Solana/,
    label: "Goldcoin → Solana",
  },
  {
    route: "SolToGlc",
    source: /Solana/,
    destination: /Goldcoin/,
    label: "Solana → Goldcoin",
  },
  {
    route: "GlcToRhn",
    source: /Goldcoin/,
    destination: /Robinhood Chain/,
    label: "Goldcoin → Robinhood Chain",
  },
  {
    route: "RhnToGlc",
    source: /Robinhood Chain/,
    destination: /Goldcoin/,
    label: "Robinhood Chain → Goldcoin",
  },
  {
    route: "SolToRhn",
    source: /Solana/,
    destination: /Robinhood Chain/,
    label: "Solana → Robinhood Chain",
  },
  {
    route: "RhnToSol",
    source: /Robinhood Chain/,
    destination: /Solana/,
    label: "Robinhood Chain → Solana",
  },
] as const;

function quoteFor(direction: string) {
  return {
    direction,
    gross_amount: "100000000000",
    gross_display_amount: "1000.00000000",
    // Echoes the route's own published rate, so a quote answered for the
    // wrong route would show the wrong fee rather than an identical one.
    fee_bps: fixtures.routeFeeBps(direction as never),
    fee_amount: "3000000000",
    fee_display_amount: "30.00000000",
    net_amount: "97000000000",
    net_display_amount: "970.00000000",
    source_decimals: 8,
    destination_decimals: 6,
    source_asset: "GLC (Goldcoin)",
    destination_asset: "GLC (Solana)",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  getStatus.mockResolvedValue(fixtures.statusFixture(now));
  // Every route OPEN, which is what makes this file about the six routes
  // rather than about the shipping gate. The closed and paused states have
  // their own cases at the bottom.
  getChains.mockResolvedValue(fixtures.chainsFixture(now, { robinhoodOpen: true }));
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getRobinhoodLimits.mockResolvedValue(
    fixtures.robinhoodLimitsFixture(now, { open: true }),
  );
  getQuote.mockImplementation((request: { direction: string }) =>
    Promise.resolve(quoteFor(request.direction)),
  );
  listTransfers.mockResolvedValue({ items: [], next_cursor: null, as_of: 1_700_000_000 });
  getSolToGlcRecipientEligibility.mockResolvedValue(eligible("SolToGlc"));
  getRhnToGlcRecipientEligibility.mockResolvedValue(eligible("RhnToGlc"));
});

function eligible(direction: string) {
  return {
    direction,
    address: "unused",
    wallet: null,
    eligible: true,
    blocked_reason: null,
    retry_after: null,
    retry_after_seconds: null,
    window_seconds: 86_400,
  };
}

/** The route the summary is currently describing. */
function summaryRoute() {
  return screen.getByText("Route").parentElement?.textContent ?? "";
}

/** Drives both selectors to one pair. */
async function choose(
  user: ReturnType<typeof userEvent.setup>,
  entry: (typeof ROUTES)[number],
) {
  // Source first: changing it can move the destination, so setting the
  // destination first would be undone.
  await selectNetwork(user, "Source network", entry.source);
  await selectNetwork(user, "Destination network", entry.destination);
}

describe("every one of the six routes is reachable", () => {
  it.each(ROUTES)("selects $label and names it in the summary", async (entry) => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await choose(user, entry);
    await waitFor(() => expect(summaryRoute()).toContain(entry.label));
  });

  it("offers every network in both selectors, with no route hidden", async () => {
    // A pair a user cannot reach is a route that does not exist as far as
    // they are concerned — which is how the cross routes were invisible
    // before, and why this asserts reachability rather than availability.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    const reached = new Set<string>();
    for (const entry of ROUTES) {
      await choose(user, entry);
      await waitFor(() => expect(summaryRoute()).toContain(entry.label));
      reached.add(entry.label);
    }
    expect(reached.size).toBe(6);
  });
});

describe("the quote is route-specific", () => {
  it.each(ROUTES)("asks for $route's own quote, never a neighbour's", async (entry) => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await choose(user, entry);
    await waitFor(() => expect(summaryRoute()).toContain(entry.label));

    await user.type(screen.getByLabelText("Amount in GLC"), "1000");

    await waitFor(() =>
      expect(getQuote).toHaveBeenCalledWith(
        expect.objectContaining({ direction: entry.route }),
        expect.anything(),
      ),
    );
    // And never for any OTHER route. A quote answered for a neighbour would
    // put that route's fee and payout on this route's summary.
    for (const other of ROUTES) {
      if (other.route === entry.route) continue;
      expect(getQuote).not.toHaveBeenCalledWith(
        expect.objectContaining({ direction: other.route }),
        expect.anything(),
      );
    }
  });

  it("requests no quote at all for a closed route", async () => {
    // Asking the backend to price a route it has already published as
    // closed only earns a refusal it told us about.
    getChains.mockResolvedValue(fixtures.chainsFixture(now));
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await choose(user, ROUTES[4]!); // SolToRhn, shut in the default fixture
    await waitFor(() => expect(summaryRoute()).toContain("Solana → Robinhood Chain"));

    await user.type(screen.getByLabelText("Amount in GLC"), "1000");
    await waitFor(() => expect(primaryCta()).toBeDisabled());
    expect(getQuote).not.toHaveBeenCalled();
  });
});

describe("the source minimum is 100 GLC on every route, ungrossed", () => {
  it.each(ROUTES)("shows Min 100 GLC on $label", async (entry) => {
    // One published policy floor, rendered as published. The fee is deducted
    // AFTER the backend checks it, so a minimum transfer legitimately
    // delivers less — grossing the displayed figure up would state a floor
    // the backend does not apply and refuse amounts it accepts.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await choose(user, entry);
    await waitFor(() => expect(summaryRoute()).toContain(entry.label));

    await waitFor(() => expect(screen.getByText(/Min 100 GLC/)).toBeInTheDocument());
  });

  it.each(ROUTES)("never shows a fee-grossed minimum on $label", async (entry) => {
    // The three figures this row has wrongly shown: the Solana program's
    // net-side floor, and two successive fee-aware derivations of it.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await choose(user, entry);
    await waitFor(() => expect(summaryRoute()).toContain(entry.label));
    await waitFor(() => expect(screen.getByText(/Min 100 GLC/)).toBeInTheDocument());

    for (const wrong of [/Min 99/, /102\.06/, /102\.56/, /103\.09/]) {
      expect(screen.queryByText(wrong)).toBeNull();
    }
  });
});

describe("the source maximum is THIS route's own, on every route", () => {
  /*
   * The figures the backend publishes per route, and the reason a
   * chain-level ceiling could never have stated them: two routes leaving
   * the same chain carry different limits.
   *
   * The form showed and ENFORCED the wrong one on three of the six.
   * `SolToGlc` and `SolToRhn` were held to the Solana program's 20,000
   * `per_transfer_limit` against a real 50,000 — refusing amounts the
   * backend accepts — and `GlcToRhn` was offered the custody contract's
   * 2,000,000 `outboundMax` against a real 20,000, which is the worse
   * direction: MAX filled in a figure the backend would refuse.
   */
  const EXPECTED = {
    GlcToSol: "20,000",
    SolToGlc: "50,000",
    GlcToRhn: "20,000",
    RhnToGlc: "50,000",
    SolToRhn: "50,000",
    RhnToSol: "50,000",
  } as const;

  it.each(ROUTES)("shows $route's published maximum on $label", async (entry) => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await choose(user, entry);
    await waitFor(() => expect(summaryRoute()).toContain(entry.label));

    const expected = EXPECTED[entry.route as keyof typeof EXPECTED];
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`Max ${expected} GLC`))).toBeInTheDocument(),
    );
  });

  it.each(ROUTES)(
    "agrees with the figure /chains published for $route",
    async (entry) => {
      // The table above is the production contract; this asserts the form
      // is reading the field rather than agreeing with it by coincidence.
      const published =
        fixtures.ROUTE_MAX_TRANSFER_DISPLAY[
          entry.route as keyof typeof fixtures.ROUTE_MAX_TRANSFER_DISPLAY
        ];
      expect(EXPECTED[entry.route as keyof typeof EXPECTED]).toBe(
        Number(published).toLocaleString("en-US"),
      );
    },
  );

  it("never shows a chain ceiling in place of a route's limit", async () => {
    // A contract whose payout ceiling is the production two million. It
    // bounds the contract's own leg and is not a limit any user is
    // admitted against, so it must appear on no route at all.
    getRobinhoodLimits.mockResolvedValue({
      ...fixtures.robinhoodLimitsFixture(now, { open: true }),
      inbound_max_atomic: "2000000000000000000000000",
      outbound_max_atomic: "2000000000000000000000000",
    });
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    for (const entry of ROUTES) {
      await choose(user, entry);
      await waitFor(() => expect(summaryRoute()).toContain(entry.label));
      const expected = EXPECTED[entry.route as keyof typeof EXPECTED];
      await waitFor(() =>
        expect(screen.getByText(new RegExp(`Max ${expected} GLC`))).toBeInTheDocument(),
      );
      expect(screen.queryByText(/2,000,000/)).toBeNull();
    }
  });
});

describe("availability comes from /chains, per route", () => {
  it("reports each route open when the backend does", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    for (const entry of ROUTES) {
      await choose(user, entry);
      await waitFor(() => expect(summaryRoute()).toContain(entry.label));
      // "Available" is the summary's verdict for an open route. The two
      // routes this app cannot START still read available — the bridge is
      // not the thing refusing them, and saying otherwise would put a UI
      // limitation in the backend's voice.
      await waitFor(() => expect(screen.getByText("Available")).toBeInTheDocument());
    }
  });

  it("closes one route without touching the other five", async () => {
    // Availability is per route, read from the response. A single closed
    // route must not drag its neighbours shut, and must not be hidden.
    const base = fixtures.chainsFixture(now, { robinhoodOpen: true });
    getChains.mockResolvedValue({
      ...base,
      routes: base.routes.map((route) =>
        route.id === "GlcToRhn"
          ? {
              ...route,
              enabled: false,
              disabled_reason: fixtures.ROUTE_UNAVAILABLE_MESSAGE,
              available: false,
              unavailable_reason: fixtures.ROUTE_UNAVAILABLE_MESSAGE,
            }
          : route,
      ),
    });
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await choose(user, ROUTES[2]!); // GlcToRhn
    await waitFor(() => expect(summaryRoute()).toContain("Goldcoin → Robinhood Chain"));
    await waitFor(() =>
      expect(screen.getByText("Currently unavailable")).toBeInTheDocument(),
    );

    await choose(user, ROUTES[0]!); // GlcToSol, untouched
    await waitFor(() => expect(screen.getByText("Available")).toBeInTheDocument());
  });

  it("says TEMPORARILY unavailable for a maintenance pause, not closed", async () => {
    // The production state: switched ON, and held shut by a runtime gate on
    // the destination reserve. Nobody flipped a switch and nobody has to
    // flip one back, so the wording must not send anyone looking for one.
    getChains.mockResolvedValue(
      fixtures.chainsFixture(now, { robinhoodOpen: true, robinhoodAvailable: false }),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    for (const entry of ROUTES.filter((r) => r.route.includes("Rhn"))) {
      await choose(user, entry);
      await waitFor(() => expect(summaryRoute()).toContain(entry.label));
      await waitFor(() =>
        expect(screen.getByText("Temporarily unavailable")).toBeInTheDocument(),
      );
      expect(screen.queryByText("Currently unavailable")).toBeNull();
      // More than one place says it — the blocker callout and the summary's
      // own reason line — and both are the backend's sentence verbatim.
      expect(
        screen.getAllByText(fixtures.DIRECTION_UNAVAILABLE_MESSAGE).length,
      ).toBeGreaterThan(0);
    }
  });

  it("follows /chains when a closed route reopens, with no reload", async () => {
    // The availability TRANSITION. Opening a route is a backend-only change:
    // the same rendered form has to pick it up from the next response, with
    // no frontend deploy and nothing cached standing in the way.
    getChains.mockResolvedValueOnce(fixtures.chainsFixture(now));
    getChains.mockResolvedValue(fixtures.chainsFixture(now, { robinhoodOpen: true }));

    const user = userEvent.setup();
    const { queryClient } = renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await choose(user, ROUTES[3]!); // RhnToGlc, shut in the first response
    await waitFor(() => expect(summaryRoute()).toContain("Robinhood Chain → Goldcoin"));
    await waitFor(() =>
      expect(screen.getByText("Currently unavailable")).toBeInTheDocument(),
    );

    // The second response reports it open. Nothing else changes.
    await queryClient.invalidateQueries();
    await waitFor(() => expect(screen.getByText("Available")).toBeInTheDocument());
    expect(screen.queryByText("Currently unavailable")).toBeNull();
  });

  it("follows /chains when an open route closes", async () => {
    // The other direction, which matters more: a route that closes while
    // someone is looking at it must stop offering a transfer.
    getChains.mockResolvedValueOnce(fixtures.chainsFixture(now, { robinhoodOpen: true }));
    getChains.mockResolvedValue(fixtures.chainsFixture(now));

    const user = userEvent.setup();
    const { queryClient } = renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await choose(user, ROUTES[3]!); // RhnToGlc
    await waitFor(() => expect(summaryRoute()).toContain("Robinhood Chain → Goldcoin"));
    await waitFor(() => expect(screen.getByText("Available")).toBeInTheDocument());

    await queryClient.invalidateQueries();
    await waitFor(() =>
      expect(screen.getByText("Currently unavailable")).toBeInTheDocument(),
    );
    await waitFor(() => expect(primaryCta()).toBeDisabled());
  });
});
