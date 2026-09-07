import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQueryClient } from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import { BridgeCard } from "@/features/bridge/BridgeCard";

/**
 * The Robinhood routes in the bridge form.
 *
 * Two things are being pinned. First, the SHIPPING state: both Robinhood
 * routes are closed backend-side, so they must be visible and
 * unselectable, and the Solana<->Robinhood pair must read as structurally
 * unavailable rather than temporarily paused. Second, that opening a route
 * is a purely backend-side change — the same build drives `GlcToRhn`
 * correctly the moment `GET /chains` says it is open, with no config and
 * no deploy.
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
}));

/** A real checksummed EVM address, and a Solana one for the mismatch case. */
const EVM_RECIPIENT = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const SOLANA_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

function glcToRhnQuote() {
  return {
    direction: "GlcToRhn" as const,
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
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getChains.mockResolvedValue(fixtures.chainsFixture(() => new Date()));
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getQuote.mockResolvedValue(glcToRhnQuote());
  listTransfers.mockResolvedValue({ items: [], next_cursor: null, as_of: 1_700_000_000 });
});

/** The selector's radio for a route, by the token names it shows. */
function radio(name: RegExp) {
  return screen.getByRole("radio", { name });
}

/**
 * Waits until `GET /chains` has actually answered.
 *
 * Every route is disabled BEFORE that — unknown availability fails closed
 * — so asserting "the Robinhood route is disabled" too early would pass
 * for the wrong reason. A legacy route becoming enabled is the signal that
 * a real verdict has arrived.
 */
async function waitForRouteVerdict() {
  await waitFor(() => expect(radio(/GLC L1.*GLC on Solana/i)).toBeEnabled());
}

describe("BridgeCard — Robinhood routes in their shipping (closed) state", () => {
  it("shows both Robinhood settlement routes, disabled, with the backend's own reason", async () => {
    renderWithQueryClient(<BridgeCard />);

    await waitForRouteVerdict();
    expect(radio(/GLC L1.*GLC on Robinhood/i)).toBeDisabled();
    expect(radio(/GLC on Robinhood.*GLC L1/i)).toBeDisabled();

    // The copy is the backend's, not this UI's — it never authors its own
    // sentence about why a route is closed.
    expect(
      screen.getAllByText(/Robinhood Network support is in development/i).length,
    ).toBeGreaterThan(0);
  });

  it("shows the Solana<->Robinhood pair as structurally unavailable, not merely paused", async () => {
    renderWithQueryClient(<BridgeCard />);

    await waitForRouteVerdict();
    expect(radio(/GLC on Solana.*GLC on Robinhood/i)).toBeDisabled();
    expect(radio(/GLC on Robinhood.*GLC on Solana/i)).toBeDisabled();
    // `implemented: false` reads differently from a closed route: no
    // operator action opens these, so they must not promise one.
    expect(screen.getAllByText("Not available").length).toBe(2);
  });

  it("leaves the two legacy routes selectable", async () => {
    renderWithQueryClient(<BridgeCard />);
    await waitFor(() => expect(radio(/GLC L1.*GLC on Solana/i)).toBeEnabled());
    expect(radio(/GLC on Solana.*GLC L1/i)).toBeEnabled();
  });

  it("does not let a closed route be selected by clicking it", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    await waitForRouteVerdict();
    const glcToRhn = radio(/GLC L1.*GLC on Robinhood/i);
    expect(glcToRhn).toBeDisabled();
    await user.click(glcToRhn);

    // Still on the default route: the recipient field is Solana's.
    expect(screen.getByLabelText("Solana recipient address")).toBeInTheDocument();
  });
});

describe("BridgeCard — GlcToRhn once the backend opens the route", () => {
  beforeEach(() => {
    getChains.mockResolvedValue(
      fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true }),
    );
  });

  async function selectGlcToRhn(user: ReturnType<typeof userEvent.setup>) {
    const glcToRhn = radio(/GLC L1.*GLC on Robinhood/i);
    await waitFor(() => expect(glcToRhn).toBeEnabled());
    await user.click(glcToRhn);
  }

  it("asks for a Robinhood Network address, not a Solana one", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);
    await selectGlcToRhn(user);

    expect(
      screen.getByLabelText("Robinhood Network recipient address"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Solana recipient address")).not.toBeInTheDocument();
  });

  it("rejects a Solana address in the Robinhood recipient field", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);
    await selectGlcToRhn(user);

    await user.type(
      screen.getByLabelText("Robinhood Network recipient address"),
      SOLANA_ADDRESS,
    );
    // The backend refuses the same mismatch; saying so here means the user
    // is not told by a 400 after submitting.
    expect(
      await screen.findByText(/not a valid Robinhood Network address/i),
    ).toBeVisible();
  });

  it("rejects the all-zero address, matching the backend's own refusal", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);
    await selectGlcToRhn(user);

    await user.type(
      screen.getByLabelText("Robinhood Network recipient address"),
      "0x0000000000000000000000000000000000000000",
    );
    expect(await screen.findByText(/destroyed permanently/i)).toBeVisible();
  });

  it("shows no Min/Max line, because no Robinhood limit is published", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);
    // The legacy route does show bounds, from the Solana program's config.
    expect(await screen.findByText(/^Min /)).toBeInTheDocument();

    await selectGlcToRhn(user);

    // `GET /limits` describes the Solana reserve. Relabelling that figure
    // as Robinhood's would be a number this app invented.
    await waitFor(() => expect(screen.queryByText(/^Min /)).not.toBeInTheDocument());
  });

  it("creates the transfer naming the route explicitly", async () => {
    createTransfer.mockResolvedValue({
      request_id: 5001,
      deposit_address: "DtTTf6RR6bt3tCoZBfX5yVCp6xgANb1GWb",
    });
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);
    await selectGlcToRhn(user);

    await user.type(screen.getByLabelText(/Amount in GLC/i), "1000");
    await user.type(
      screen.getByLabelText("Robinhood Network recipient address"),
      EVM_RECIPIENT,
    );

    const submit = await screen.findByRole("button", { name: /Create deposit request/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() =>
      expect(createTransfer).toHaveBeenCalledWith({
        amount_atomic: "100000000000",
        recipient: EVM_RECIPIENT,
        route: "GlcToRhn",
      }),
    );
  });

  it("quotes the route as GlcToRhn", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);
    await selectGlcToRhn(user);

    await user.type(screen.getByLabelText(/Amount in GLC/i), "1000");
    await waitFor(() =>
      expect(getQuote).toHaveBeenCalledWith(
        expect.objectContaining({ direction: "GlcToRhn" }),
        expect.anything(),
      ),
    );
  });
});

describe("BridgeCard — RhnToGlc stays fail-closed without a deployed contract", () => {
  beforeEach(() => {
    getChains.mockResolvedValue(
      fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true }),
    );
  });

  it("offers the route but refuses the deposit, naming the missing configuration", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    const rhnToGlc = radio(/GLC on Robinhood.*GLC L1/i);
    await waitFor(() => expect(rhnToGlc).toBeEnabled());
    await user.click(rhnToGlc);

    // The custody contract is not deployed, so no env names it — and the
    // UI says exactly that rather than offering an action that cannot work.
    expect(
      await screen.findByText(/Robinhood Network is not configured for this deployment/i),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Deposit from wallet/i })).toBeDisabled();
  });

  it("asks for a Goldcoin destination on this route", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    const rhnToGlc = radio(/GLC on Robinhood.*GLC L1/i);
    await waitFor(() => expect(rhnToGlc).toBeEnabled());
    await user.click(rhnToGlc);

    expect(screen.getByLabelText("Goldcoin destination address")).toBeInTheDocument();
    // Paying out on Goldcoin carries the same exchange-address warning the
    // other Goldcoin-destination route has always shown.
    expect(screen.getByText(/Sending to an exchange\?/i)).toBeInTheDocument();
  });
});
