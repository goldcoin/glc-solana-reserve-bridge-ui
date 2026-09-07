import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQueryClient, selectNetwork, waitForRouteVerdict } from "./test-utils";
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
  },
  recipientRateLimitedError: (await import("@/lib/api/errors")).recipientRateLimitedError,
  sourceWalletRateLimitedError: (await import("@/lib/api/errors"))
    .sourceWalletRateLimitedError,
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
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    // The backend's own sentence, not a locally-authored one.
    expect(
      screen.getAllByText(
        /Robinhood Chain support is in development|Robinhood Network support is in development/i,
      ).length,
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

  it("resolves Solana → Robinhood but reports it as never available", async () => {
    // `SolToRhn` has no settlement machinery on either side, so it reads
    // differently from a route that is merely switched off.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Solana/);
    await selectNetwork(user, "Destination network", /Robinhood Chain/);

    expect(summaryRoute()).toContain("Solana → Robinhood Chain");
    expect(screen.getByText("Not available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Route unavailable/i })).toBeDisabled();
  });

  it("resolves Robinhood → Solana but reports it as never available", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Robinhood Chain/);
    await selectNetwork(user, "Destination network", /Solana/);

    expect(summaryRoute()).toContain("Robinhood Chain → Solana");
    expect(screen.getByText("Not available")).toBeInTheDocument();
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

  it("creates the transfer on the derived route", async () => {
    createTransfer.mockResolvedValue({
      request_id: 5001,
      deposit_address: "DtTTf6RR6bt3tCoZBfX5yVCp6xgANb1GWb",
    });
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Destination network", /Robinhood Chain/);
    await user.type(screen.getByLabelText(/Amount in GLC/i), "1000");
    await user.type(
      screen.getByLabelText("Robinhood Chain recipient address"),
      EVM_RECIPIENT,
    );

    const cta = await screen.findByRole("button", { name: /Bridge GLC/i });
    await waitFor(() => expect(cta).toBeEnabled());
    await user.click(cta);

    await waitFor(() =>
      expect(createTransfer).toHaveBeenCalledWith({
        amount_atomic: "100000000000",
        recipient: EVM_RECIPIENT,
        route: "GlcToRhn",
      }),
    );
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

  it("shows no Min/Max, because no Robinhood limit is published", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    expect(await screen.findByText(/^Min /)).toBeInTheDocument();
    await selectNetwork(user, "Destination network", /Robinhood Chain/);
    await waitFor(() => expect(screen.queryByText(/^Min /)).not.toBeInTheDocument());
  });
});

describe("BridgeForm — RhnToGlc stays fail-closed without a deployed contract", () => {
  beforeEach(() => {
    getChains.mockResolvedValue(
      fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true }),
    );
  });

  it("offers the route but refuses the deposit, naming the missing configuration", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Robinhood Chain/);

    // The custody contract is not deployed, so no env names it.
    expect(
      await screen.findByText(/Robinhood Network is not configured for this deployment/i),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Route unavailable/i })).toBeDisabled();
  });

  it("asks for a Goldcoin destination and carries the exchange-address warning", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Robinhood Chain/);

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
