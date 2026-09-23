import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  expectHeldOnlyByEligibility,
  primaryCta,
  renderWithQueryClient,
  routeEligibilityFrom,
  selectNetwork,
  waitForRouteVerdict,
} from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import { BridgeForm } from "@/features/bridge/BridgeForm";

/**
 * The network-first bridge form.
 *
 * A user picks two networks; the route is derived. These tests drive the
 * two selectors exactly as a person would, and assert on what the form
 * then does — which route it quotes, which route it creates, and what it
 * says when a pair cannot be used.
 *
 * The old design put one card per route on the page. The properties that
 * matter now are different: that the derived route is right, that an
 * unusable pair is explained rather than hidden, and that reversing
 * direction never leaves an address from the previous network behind.
 */

const getStatus = vi.fn();
const getChains = vi.fn();
const getLimits = vi.fn();
const getReserve = vi.fn();
const getQuote = vi.fn();
const createTransfer = vi.fn();
const listTransfers = vi.fn();
const getSolToGlcRecipientEligibility = vi.fn();

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
    }),
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
  // The FROM panel reads a source balance; with no wallet connected the
  // hook short-circuits before the query, so a minimal stub is enough.
  useTokenBalance: () => ({ isPending: true, isError: false, data: undefined }),
  isTokenBalanceAvailable: () => true,
  walletQueryKeys: { balances: () => ["solana", "balance"] },
  // The FROM panel's Solana connect control: desktop, so the wallet list
  // rather than the deep-link flow, and no error to suppress.
  needsDeepLink: () => false,
  isUserRejection: () => false,
}));

const EVM_RECIPIENT = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const SOLANA_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

function quoteFor(direction: string) {
  return {
    direction,
    gross_amount: "100000000000",
    gross_display_amount: "1000.00000000",
    fee_bps: 300,
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
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getChains.mockResolvedValue(fixtures.chainsFixture(() => new Date()));
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getQuote.mockImplementation((request: { direction: string }) =>
    Promise.resolve(quoteFor(request.direction)),
  );
  listTransfers.mockResolvedValue({ items: [], next_cursor: null, as_of: 1_700_000_000 });
  getSolToGlcRecipientEligibility.mockResolvedValue({
    direction: "SolToGlc",
    address: "unused",
    wallet: null,
    eligible: true,
    blocked_reason: null,
    retry_after: null,
    retry_after_seconds: null,
    window_seconds: 86_400,
  });
});

/** The route the summary is currently describing. */
function summaryRoute() {
  return screen.getByText("Route").parentElement?.textContent ?? "";
}

describe("BridgeForm — the two selectors", () => {
  it("defaults to Goldcoin → Solana", async () => {
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    expect(screen.getByRole("button", { name: "Source network" })).toHaveTextContent(
      "Goldcoin",
    );
    expect(screen.getByRole("button", { name: "Destination network" })).toHaveTextContent(
      "Solana",
    );
    expect(summaryRoute()).toContain("Goldcoin → Solana");
  });

  it("exposes both selectors as listboxes with named options", async () => {
    // The whole navigation model is these two controls, so they have to be
    // reachable and describable without sight.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await user.click(screen.getByRole("button", { name: "Destination network" }));
    const listbox = await screen.findByRole("listbox", { name: "Destination network" });
    const options = within(listbox).getAllByRole("option");
    // Every network the build describes appears, including the one that is
    // the current source and therefore not choosable.
    expect(options).toHaveLength(3);
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("Goldcoin"),
      expect.stringContaining("Solana"),
      expect.stringContaining("Robinhood Chain"),
    ]);
  });

  it("shows the network family beside each network", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await user.click(screen.getByRole("button", { name: "Source network" }));
    const listbox = await screen.findByRole("listbox", { name: "Source network" });
    expect(within(listbox).getByRole("option", { name: /Goldcoin/ })).toHaveTextContent(
      "Native Network",
    );
    expect(
      within(listbox).getByRole("option", { name: /Robinhood Chain/ }),
    ).toHaveTextContent("EVM");
  });

  it("refuses the source network as its own destination", async () => {
    // There is no self-route: this bridge moves GLC between networks.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await user.click(screen.getByRole("button", { name: "Destination network" }));
    const listbox = await screen.findByRole("listbox", { name: "Destination network" });
    const sameNetwork = within(listbox).getByRole("option", { name: /Goldcoin/ });
    expect(sameNetwork).toBeDisabled();
    expect(sameNetwork).toHaveTextContent("Same network");
  });
});

describe("BridgeForm — the pair drives the route", () => {
  it("quotes GlcToSol for Goldcoin → Solana", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await user.type(screen.getByLabelText(/Amount in GLC/i), "1000");
    await waitFor(() =>
      expect(getQuote).toHaveBeenCalledWith(
        expect.objectContaining({ direction: "GlcToSol" }),
        expect.anything(),
      ),
    );
  });

  it("quotes SolToGlc for Solana → Goldcoin", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Solana/);
    await user.type(screen.getByLabelText(/Amount in GLC/i), "1000");
    await waitFor(() =>
      expect(getQuote).toHaveBeenCalledWith(
        expect.objectContaining({ direction: "SolToGlc" }),
        expect.anything(),
      ),
    );
    expect(summaryRoute()).toContain("Solana → Goldcoin");
  });

  it("asks for the destination network's own address format", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    expect(screen.getByLabelText("Solana recipient address")).toBeInTheDocument();

    await selectNetwork(user, "Source network", /Solana/);
    expect(screen.getByLabelText("Goldcoin destination address")).toBeInTheDocument();
  });
});

describe("BridgeForm — Robinhood pairs in their shipping (closed) state", () => {
  it("lets a closed destination be selected, then explains it", async () => {
    // Selectable on purpose: hiding it would leave a user unable to find
    // out whether the network is supported at all.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Destination network", /Robinhood Chain/);

    expect(summaryRoute()).toContain("Goldcoin → Robinhood Chain");
    // "Currently unavailable", never "Coming soon". Every route the backend
    // names is built and settling, so a closed one is switched off rather
    // than unreleased — and promising a launch would be this UI inventing
    // one.
    expect(screen.getByText("Currently unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.queryByText(/in development/i)).toBeNull();
    // The backend's own sentence, not a locally-authored one.
    expect(
      screen.getAllByText(/switched off on this deployment/i).length,
    ).toBeGreaterThan(0);
  });

  it("disables the CTA and says the route is unavailable", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Destination network", /Robinhood Chain/);

    const cta = screen.getByRole("button", { name: /Route unavailable/i });
    expect(cta).toBeDisabled();
  });

  it("resolves Solana → Robinhood and reports it closed, not absent", async () => {
    // `SolToRhn` has settlement machinery and ships shut, so it reads as a
    // route that is switched off rather than one that does not exist ("Not
    // available"). The distinction is the whole reason `implemented` is a
    // separate field from `enabled`.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Solana/);
    await selectNetwork(user, "Destination network", /Robinhood Chain/);

    expect(summaryRoute()).toContain("Solana → Robinhood Chain");
    expect(screen.getByText("Currently unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Not available")).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    // Closed is still closed: nothing here opens a route.
    expect(screen.getByRole("button", { name: /Route unavailable/i })).toBeDisabled();
  });

  it("resolves Robinhood → Solana and reports it closed, not absent", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Robinhood Chain/);
    await selectNetwork(user, "Destination network", /Solana/);

    expect(summaryRoute()).toContain("Robinhood Chain → Solana");
    expect(screen.getByText("Currently unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Not available")).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.getByRole("button", { name: /Route unavailable/i })).toBeDisabled();
  });

  it("never asks for a wallet on a route that cannot run", async () => {
    // Ordering: a closed route is stated before any wallet is requested,
    // so nobody is sent through a connect prompt for nothing.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Robinhood Chain/);
    await selectNetwork(user, "Destination network", /Solana/);

    expect(screen.queryByRole("button", { name: /Connect/i })).not.toBeInTheDocument();
  });
});

describe("BridgeForm — GlcToRhn once the backend opens the route", () => {
  beforeEach(() => {
    getChains.mockResolvedValue(
      fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true }),
    );
  });

  it("asks for a Robinhood Chain address and rejects a Solana one", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Destination network", /Robinhood Chain/);
    const field = screen.getByLabelText("Robinhood Chain recipient address");
    await user.type(field, SOLANA_ADDRESS);

    expect(
      await screen.findByText(/not a valid Robinhood Network address/i),
    ).toBeVisible();
  });

  it("derives GlcToRhn from the pair, and creates nothing while eligibility is unestablished", async () => {
    // The route DERIVATION is what this test is about, and it is
    // unchanged. What changed is that a Goldcoin-sourced route cannot
    // currently clear the rolling-24h gate — the backend publishes no
    // eligibility endpoint for it — so the transfer is refused rather
    // than created. The quote proves the derived route reached the
    // backend correctly.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Destination network", /Robinhood Chain/);
    await user.type(screen.getByLabelText(/Amount in GLC/i), "1000");
    await user.type(
      screen.getByLabelText("Robinhood Chain recipient address"),
      EVM_RECIPIENT,
    );

    await waitFor(() =>
      expect(getQuote).toHaveBeenCalledWith(
        expect.objectContaining({ direction: "GlcToRhn" }),
        expect.anything(),
      ),
    );
    await expectHeldOnlyByEligibility();
    await user.click(primaryCta());
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it("shows the received amount from the backend quote, never a local calculation", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Destination network", /Robinhood Chain/);
    await user.type(screen.getByLabelText(/Amount in GLC/i), "1000");

    // The backend's own `net_display_amount`, laid out at the shared
    // two-decimal display precision — not a figure this form derived.
    const estimate = await screen.findByLabelText(/Estimated amount received/i);
    await waitFor(() => expect(estimate).toHaveTextContent("970.00"));
  });

  it("shows the new route's OWN maximum, never the previous route's", async () => {
    /*
     * Switching destination switches the limit with it. This used to drop
     * the maximum entirely on a Robinhood pair — `GET /limits` describes
     * the SOLANA program's `BridgeConfig`, and relabelling its ceiling for
     * a Robinhood route would have published one that route does not have.
     * Dropping it was the right call against the wrong alternative: both
     * routes publish their own limit, so the form shows each route its
     * own.
     *
     * Here the two happen to differ — `GlcToSol` at 20,000 against
     * `GlcToRhn`'s own figure — and the assertion is that the line tracks
     * the route rather than carrying a stale number across the switch.
     *
     * The MINIMUM is a different kind of figure and deliberately DOES
     * survive: one policy floor published per route, identical on every
     * route. Carrying it across is not relabelling a Solana number — it is
     * the same number.
     */
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    const solanaLine = (await screen.findByText(/^Min /)).textContent;
    expect(solanaLine).toContain(
      `Max ${Number(fixtures.ROUTE_MAX_TRANSFER_DISPLAY.GlcToSol).toLocaleString("en-US")} GLC`,
    );

    await selectNetwork(user, "Destination network", /Robinhood Chain/);

    const expectedRobinhood = `Max ${Number(
      fixtures.ROUTE_MAX_TRANSFER_DISPLAY.GlcToRhn,
    ).toLocaleString("en-US")} GLC`;
    await waitFor(() =>
      expect(screen.getByText(/^Min /).textContent).toContain(expectedRobinhood),
    );
    const robinhoodLine = screen.getByText(/^Min /).textContent;
    // The same floor, carried across.
    expect(robinhoodLine).toContain(solanaLine.slice(0, solanaLine.indexOf(" · ")));
  });
});

describe("BridgeForm — RhnToGlc with no environment configuration at all", () => {
  beforeEach(() => {
    getChains.mockResolvedValue(
      fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true }),
    );
  });

  /**
   * The regression this replaced.
   *
   * This test used to assert that an unconfigured deployment said
   * "Robinhood Network is not configured for this deployment" — and
   * production said exactly that, on a healthy backend, because the chain
   * id, the custody contract and the token are compile-time constants
   * while the resolver still demanded all four environment variables be
   * present. An unset optional RPC URL removed the connect control
   * entirely.
   *
   * No environment variable is set in this suite, which is precisely the
   * production case. The deployment must therefore RESOLVE, and the
   * deposit must still be refused — by the gates that actually govern it.
   */
  it("never claims the network is unconfigured when nothing is configured", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Robinhood Chain/);

    expect(
      screen.queryByText(/Robinhood Network is not configured for this deployment/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/a wallet cannot be connected here/i),
    ).not.toBeInTheDocument();
  });

  it("still refuses the deposit — by the route and wallet gates, not by config", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Robinhood Chain/);

    // Fail-closed is unchanged: no wallet is connected in this suite, so
    // the form asks for one rather than offering a transfer. What it no
    // longer does is call the network unsupported.
    await waitFor(() => expect(primaryCta()).toBeDisabled());
  });

  it("asks for a Goldcoin destination and carries the exchange-address warning", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    // BOTH selectors, because with every Robinhood route open the source
    // change alone no longer implies this pair: `RhnToSol` is open too, so
    // the Solana destination already selected is kept rather than falling
    // through to Goldcoin. Naming the destination is what makes this test
    // about `RhnToGlc` rather than about the landing rule.
    await selectNetwork(user, "Source network", /Robinhood Chain/);
    await selectNetwork(user, "Destination network", /Goldcoin/);

    expect(screen.getByLabelText("Goldcoin destination address")).toBeInTheDocument();
    expect(screen.getByText(/Sending to an exchange\?/i)).toBeInTheDocument();
  });
});

describe("BridgeForm — reversing direction", () => {
  it("swaps the two networks", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await user.click(screen.getByRole("button", { name: /Reverse transfer direction/i }));

    expect(screen.getByRole("button", { name: "Source network" })).toHaveTextContent(
      "Solana",
    );
    expect(screen.getByRole("button", { name: "Destination network" })).toHaveTextContent(
      "Goldcoin",
    );
    expect(summaryRoute()).toContain("Solana → Goldcoin");
  });

  it("clears an address that belonged to the previous destination network", async () => {
    // The most expensive thing this control could leave behind: a Solana
    // address sitting in a field that now wants a Goldcoin one.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await user.type(screen.getByLabelText("Solana recipient address"), SOLANA_ADDRESS);
    await user.type(screen.getByLabelText(/Amount in GLC/i), "1000");

    await user.click(screen.getByRole("button", { name: /Reverse transfer direction/i }));

    expect(screen.getByLabelText("Goldcoin destination address")).toHaveValue("");
    expect(screen.getByLabelText(/Amount in GLC/i)).toHaveValue("");
  });

  it("clears the address when the destination changes without a reversal too", async () => {
    getChains.mockResolvedValue(
      fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true }),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await user.type(screen.getByLabelText("Solana recipient address"), SOLANA_ADDRESS);
    await selectNetwork(user, "Destination network", /Robinhood Chain/);

    expect(screen.getByLabelText("Robinhood Chain recipient address")).toHaveValue("");
  });

  it("re-quotes on the new route after a reversal", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await user.click(screen.getByRole("button", { name: /Reverse transfer direction/i }));
    await user.type(screen.getByLabelText(/Amount in GLC/i), "1000");

    await waitFor(() =>
      expect(getQuote).toHaveBeenCalledWith(
        expect.objectContaining({ direction: "SolToGlc" }),
        expect.anything(),
      ),
    );
  });

  it("keeps the source selection valid when a destination becomes undefined", async () => {
    // Changing source to one that cannot reach the current destination
    // moves the destination rather than leaving the form on a pair with no
    // route.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Solana/);
    expect(
      screen.getByRole("button", { name: "Destination network" }),
    ).not.toHaveTextContent("Solana");
  });
});

/**
 * Which destination the form lands on when the SOURCE selector changes.
 *
 * # The bug
 *
 * `onSourceChange` kept the current destination whenever that pair was
 * merely `implemented`. While every implemented route was also open the
 * two were indistinguishable — and they stopped being so as soon as
 * `SolToRhn`/`RhnToSol` shipped built and switched off. From the default
 * Goldcoin → Solana, switching the SOURCE to Robinhood kept Solana and
 * landed on `RhnToSol`: a closed route, chosen over `RhnToGlc` which was
 * open.
 *
 * Being implemented says the settlement machinery exists. It is not
 * permission to move value, and it is not a reason to put someone in front
 * of a route that cannot run.
 *
 * The same argument now covers a second case, for the same reason: a route
 * the backend reports OPEN that this app cannot construct a source
 * transaction for (`@/lib/bridge/route-execution`). Landing on one is worse
 * than landing on a closed route, because every other signal in the UI says
 * it is available. So "open" for ranking purposes means open AND startable
 * here.
 *
 * # What is pinned
 *
 * That a startable OPEN destination wins over one that is merely open or
 * merely exists, that nothing here opens a route, and that a source with no
 * such destination still lands somewhere coherent.
 */
describe("BridgeForm — default destination when the source changes", () => {
  /** The two chain ids the summary names, as "Source → Destination". */
  function landedOn() {
    return summaryRoute();
  }

  it("prefers the OPEN Goldcoin route over a closed Solana one", async () => {
    // The regression itself, against a backend with the cross route
    // explicitly shut: Robinhood then has exactly one open destination and
    // it is not the one currently selected.
    const chains = fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true });
    getChains.mockResolvedValue({
      ...chains,
      routes: chains.routes.map((route) =>
        route.id === "RhnToSol"
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
    expect(landedOn()).toContain("Goldcoin → Solana");

    await selectNetwork(user, "Source network", /Robinhood Chain/);

    await waitFor(() => expect(landedOn()).toContain("Robinhood Chain → Goldcoin"));
    expect(landedOn()).not.toContain("→ Solana");
  });

  it("does not pick a closed route merely because it is implemented", async () => {
    // Stated separately from the case above so it fails on its own terms:
    // `RhnToSol` is implemented in the fixture, and that alone must never
    // be enough to be chosen.
    const chains = fixtures.chainsFixture(() => new Date());
    const crossRoute = chains.routes.find((r) => r.id === "RhnToSol");
    expect(crossRoute?.implemented, "the fixture ships it built").toBe(true);
    expect(crossRoute?.enabled, "and switched off by default").toBe(false);

    getChains.mockResolvedValue(chains);
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Robinhood Chain/);
    await waitFor(() => expect(landedOn()).toContain("Robinhood Chain → Goldcoin"));
  });

  it("keeps the destination the user chose when the cross route is open", async () => {
    // The preference is the USER's choice first and the registry's order
    // second. With every Robinhood route open, switching the source to
    // Robinhood while Solana is selected lands on `RhnToSol` — the open
    // pair that was already chosen — rather than snapping to Goldcoin,
    // which is merely first in the table.
    //
    // This case was previously unreachable: the cross routes shipped shut,
    // and before that this app could not construct their deposits, so the
    // rule had nothing to demonstrate it on.
    getChains.mockResolvedValue(
      fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true }),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    expect(landedOn()).toContain("Goldcoin → Solana");

    await selectNetwork(user, "Source network", /Robinhood Chain/);

    await waitFor(() => expect(landedOn()).toContain("Robinhood Chain → Solana"));
  });

  it("still lands somewhere coherent when no destination is open", async () => {
    // The shipping default: every Robinhood route shut. There is no open
    // choice to prefer, so the registry's own order decides — and that is
    // Goldcoin, not the closed cross route that happened to be selected.
    getChains.mockResolvedValue(fixtures.chainsFixture(() => new Date()));
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Robinhood Chain/);
    await waitFor(() => expect(landedOn()).toContain("Robinhood Chain → Goldcoin"));
  });

  it("opens no route by landing on it", async () => {
    // The selector chooses where to point; it never changes a verdict.
    // Landing on a closed route still reports it closed and still refuses
    // to submit.
    getChains.mockResolvedValue(fixtures.chainsFixture(() => new Date()));
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Robinhood Chain/);
    await waitFor(() => expect(landedOn()).toContain("Robinhood Chain → Goldcoin"));
    expect(screen.getByRole("button", { name: /Route unavailable/i })).toBeDisabled();
  });
});
