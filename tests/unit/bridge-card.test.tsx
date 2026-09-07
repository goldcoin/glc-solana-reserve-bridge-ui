import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQueryClient } from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import { BridgeCard } from "@/features/bridge/BridgeCard";

/**
 * Component-level coverage for the primary bridge form. Every backend call
 * is mocked so each test controls exactly one condition (paused, insufficient
 * liquidity, a specific quote) without depending on the mock backend's own
 * scenario wiring, which is already covered separately in mock-client.test.ts.
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
  // BridgeCard imports this error factory alongside bridgeApi; the real
  // implementation is pure copy/shaping, so pass it through unmocked.
  recipientRateLimitedError: (await import("@/lib/api/errors")).recipientRateLimitedError,
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const walletConnection = {
  status: "disconnected" as const,
  address: null as string | null,
  wallet: null,
  wallets: [],
  canSign: false,
  error: null,
  platform: "desktop" as const,
  connect: vi.fn(),
  disconnect: vi.fn(),
  dismissError: vi.fn(),
};

const depositCapability = vi.fn(() => ({
  available: false,
  reason: "wallet-disconnected" as const,
  message: "Connect a Solana wallet to deposit.",
}));
const depositFn = vi.fn();

vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => walletConnection,
  useDepositToReserve: () => ({ capability: depositCapability, deposit: depositFn }),
  isValidAddress: (value: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),
}));

const VALID_SOLANA_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

function goodQuote(overrides: Partial<ReturnType<typeof baseQuote>> = {}) {
  return { ...baseQuote(), ...overrides };
}

function baseQuote() {
  return {
    direction: "GlcToSol" as const,
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
  push.mockReset();
  walletConnection.status = "disconnected";
  walletConnection.address = null;
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  // The route registry every gate now consults. The default fixture is
  // the real shipping state: both legacy routes open, both Robinhood
  // routes implemented-but-disabled, the Solana<->Robinhood pair inert.
  getChains.mockResolvedValue(fixtures.chainsFixture(() => new Date()));
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getQuote.mockResolvedValue(baseQuote());
  getSolToGlcRecipientEligibility.mockResolvedValue({
    direction: "SolToGlc",
    address: "unused-in-these-tests",
    eligible: true,
    retry_after: null,
    retry_after_seconds: null,
    window_seconds: 86_400,
  });
  depositCapability.mockReturnValue({
    available: false,
    reason: "wallet-disconnected",
    message: "Connect a Solana wallet to deposit.",
  });
});

describe("BridgeCard — direction switching", () => {
  it("defaults to Goldcoin -> Solana and switches to Solana -> Goldcoin", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    expect(screen.getByLabelText(/Amount in GLC/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Solana recipient address")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /GLC on Solana.*GLC L1/i }));

    expect(screen.getByLabelText("Goldcoin destination address")).toBeInTheDocument();
  });

  it("clears amount and recipient when switching direction", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    const amountInput = screen.getByLabelText(/Amount in GLC/i);
    await user.type(amountInput, "100");
    expect(amountInput).toHaveValue("100");

    await user.click(screen.getByRole("radio", { name: /GLC on Solana.*GLC L1/i }));

    const newAmountInput = screen.getByLabelText(/Amount in GLC/i);
    expect(newAmountInput).toHaveValue("");
  });
});

describe("BridgeCard — amount entry and validation", () => {
  it("shows a validation message for a malformed amount", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    await waitFor(() => expect(getLimits).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/Amount in GLC/i), "12.34.56");

    await waitFor(() =>
      expect(screen.getAllByText(/digits only/i).length).toBeGreaterThan(0),
    );
  });

  it("rejects an amount below the published minimum", async () => {
    getLimits.mockResolvedValue({
      min_transfer_amount: "10000000000",
      per_transfer_limit: "25000000000000",
      bridge_fee_bps: 100,
    });
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    await waitFor(() => expect(getLimits).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/Amount in GLC/i), "1");

    await waitFor(() =>
      expect(screen.getAllByText(/minimum transfer is/i).length).toBeGreaterThan(0),
    );
  });
});

describe("BridgeCard — POST /quote integration and fee presentation", () => {
  it("requests a quote for the canonical gross amount and shows the exact 3% breakdown", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    await waitFor(() => expect(getLimits).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/Amount in GLC/i), "1000");

    await waitFor(() => {
      expect(getQuote).toHaveBeenCalledWith(
        { direction: "GlcToSol", gross_amount: "100000000000" },
        expect.anything(),
      );
    });

    // "You bridge" is now also the amount field's own visible label, so
    // both occurrences are asserted rather than assuming just one.
    await waitFor(() =>
      expect(screen.getAllByText("You bridge").length).toBeGreaterThan(0),
    );
    expect(screen.getByText("Bridge fee (3%)")).toBeInTheDocument();
    expect(screen.getByText("You receive")).toBeInTheDocument();
    // The backend's own figures, at the shared two-decimal display precision.
    expect(screen.getByText(/1,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/−30\.00/)).toBeInTheDocument();
    expect(screen.getByText(/970\.00/)).toBeInTheDocument();
  });

  it("never displays a fee/net figure it computed itself — only what the quote returned", async () => {
    getQuote.mockResolvedValue(
      goodQuote({ fee_display_amount: "7.77000000", net_display_amount: "992.23000000" }),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    await waitFor(() => expect(getLimits).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/Amount in GLC/i), "1000");

    // Formatting-only: these are the quote's fee/net strings, not a fee this
    // component derived from the gross amount (which would read 30 / 970).
    expect(await screen.findByText(/7\.77/)).toBeInTheDocument();
    expect(screen.getByText(/992\.23/)).toBeInTheDocument();
    expect(screen.queryByText(/−30\.00/)).not.toBeInTheDocument();
  });
});

describe("BridgeCard — reserve capacity and pause gating", () => {
  it("disables submission with a stated reason when the direction is paused", async () => {
    getStatus.mockResolvedValue(fixtures.pausedStatusFixture());
    renderWithQueryClient(<BridgeCard />);

    expect((await screen.findAllByText(/is currently paused\./i)).length).toBeGreaterThan(
      0,
    );
    const submit = screen.getByRole("button", { name: /Create deposit request/i });
    expect(submit).toBeDisabled();
  });

  it("disables submission with a stated reason when reserve capacity is exhausted", async () => {
    getReserve.mockResolvedValue({
      goldcoin_available_capacity: "500000000000",
      solana_available_capacity: "0",
    });
    renderWithQueryClient(<BridgeCard />);

    expect(
      await screen.findByText(/insufficient reserve liquidity/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Create deposit request/i }),
    ).toBeDisabled();
  });
});

describe("BridgeCard — transfer submission", () => {
  it("creates a GlcToSol transfer and shows the unique deposit address and exact amount, with no OP_RETURN", async () => {
    createTransfer.mockResolvedValue({
      request_id: 4242,
      deposit_address: "GLCVau1t111111111111111111111111111111111",
    });
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    await waitFor(() => expect(getLimits).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/Amount in GLC/i), "1000");
    await user.type(
      screen.getByLabelText("Solana recipient address"),
      VALID_SOLANA_ADDRESS,
    );

    const submit = await screen.findByRole("button", { name: /Create deposit request/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(await screen.findByText(/Send your deposit/i)).toBeInTheDocument();
    expect(screen.getByText(/Send exactly/i)).toBeInTheDocument();
    expect(screen.getByText(/1,000\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/OP_RETURN/i)).not.toBeInTheDocument();
    // `route` is sent explicitly even though `GlcToSol` is the backend's
    // own default for an absent field: what a request creates is stated by
    // the caller rather than inherited from a server-side default.
    expect(createTransfer).toHaveBeenCalledWith({
      amount_atomic: "100000000000",
      recipient: VALID_SOLANA_ADDRESS,
      route: "GlcToSol",
    });
  });

  it("surfaces a submission failure as an error state without fabricating success", async () => {
    createTransfer.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    await waitFor(() => expect(getLimits).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/Amount in GLC/i), "1000");
    await user.type(
      screen.getByLabelText("Solana recipient address"),
      VALID_SOLANA_ADDRESS,
    );

    const submit = await screen.findByRole("button", { name: /Create deposit request/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Send your deposit/i)).not.toBeInTheDocument();
  });
});

describe("BridgeCard — API failure states", () => {
  it("states the bridge status is unavailable rather than assuming operational", async () => {
    getStatus.mockRejectedValue(new Error("network down"));
    renderWithQueryClient(<BridgeCard />);

    expect(await screen.findByText(/Bridge status is unavailable/i)).toBeInTheDocument();
  });
});

describe("BridgeCard — Solana -> Goldcoin wallet-disconnected gating", () => {
  it("keeps submission disabled while no wallet is connected", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    await user.click(screen.getByRole("radio", { name: /GLC on Solana.*GLC L1/i }));
    await waitFor(() => expect(getLimits).toHaveBeenCalled());

    await user.type(screen.getByLabelText(/Amount in GLC/i), "100");
    await user.type(
      screen.getByLabelText("Goldcoin destination address"),
      "not-checked-here",
    );

    const submit = await screen.findByRole("button", { name: /Deposit from wallet/i });
    expect(submit).toBeDisabled();
  });
});

describe("BridgeCard — loading states", () => {
  it("does not enable submission before limits/status/reserve have loaded", () => {
    getStatus.mockReturnValue(new Promise(() => {}));
    getLimits.mockReturnValue(new Promise(() => {}));
    getReserve.mockReturnValue(new Promise(() => {}));

    renderWithQueryClient(<BridgeCard />);

    expect(screen.getByText(/Loading bridge status/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Create deposit request/i }),
    ).toBeDisabled();
  });
});

describe("BridgeCard — rolling 24h quota states (backend 2026-08-22 workflow)", () => {
  it("shows the approved quota-exhausted message and disables submission", async () => {
    getStatus.mockResolvedValue(fixtures.quotaExhaustedStatusFixture());
    renderWithQueryClient(<BridgeCard />);

    expect(
      await screen.findByText("24-hour bridge capacity reached for this direction."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/New transfers are temporarily unavailable\./).length,
    ).toBeGreaterThan(0);
    const submit = screen.getByRole("button", { name: /Create deposit request/i });
    expect(submit).toBeDisabled();
  });

  it("shows the approved quota-paused refill message, including the Telegram line", async () => {
    getStatus.mockResolvedValue(fixtures.quotaPausedStatusFixture());
    renderWithQueryClient(<BridgeCard />);

    expect(
      await screen.findByText("Bridge capacity reached for this direction."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        /Transfers are temporarily paused while reserves are replenished\./,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/Please check the official Telegram for reopening updates\./),
    ).toBeInTheDocument();
  });

  it("never renders automatic-reset promises in any quota state", async () => {
    for (const fixture of [
      fixtures.quotaExhaustedStatusFixture(),
      fixtures.quotaPausedStatusFixture(),
    ]) {
      getStatus.mockResolvedValue(fixture);
      const { unmount } = renderWithQueryClient(<BridgeCard />);
      await screen.findAllByText(/capacity reached for this direction/i);
      const text = document.body.textContent as string;
      expect(text).not.toMatch(/midnight/i);
      expect(text).not.toMatch(/automatic/i);
      expect(text).not.toMatch(/resets?\s+(at|in)/i);
      expect(text).not.toMatch(/reopens?\s+in\s+24/i);
      unmount();
    }
  });

  it("keeps the opposite direction fully usable while one is quota-blocked", async () => {
    // GlcToSol exhausted, SolToGlc healthy in the fixture.
    getStatus.mockResolvedValue(fixtures.quotaExhaustedStatusFixture());
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);
    await screen.findByText("24-hour bridge capacity reached for this direction.");

    await user.click(screen.getByRole("radio", { name: /GLC on Solana.*GLC L1/i }));

    await waitFor(() =>
      expect(
        screen.queryByText("24-hour bridge capacity reached for this direction."),
      ).not.toBeInTheDocument(),
    );
    // The form is workable: the amount field accepts input and the only
    // remaining gate is the wallet connection, not a direction blocker.
    await user.type(screen.getByLabelText(/Amount in GLC/i), "500");
    expect(screen.getByLabelText(/Amount in GLC/i)).toHaveValue("500");
  });

  it("displays the remaining 24h capacity from /status", async () => {
    // Default fixture: 17,500 GLC remaining for GlcToSol (mint-atomic 6dp).
    renderWithQueryClient(<BridgeCard />);
    expect(await screen.findByText(/17,500 GLC\s+remaining today/)).toBeInTheDocument();
  });

  it("blocks submission when the amount exceeds remaining capacity, without altering the amount", async () => {
    getStatus.mockResolvedValue({
      ...fixtures.statusFixture(() => new Date()),
      glc_to_sol_rolling_volume_remaining: "5000000000", // 5,000 GLC left
    });
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);
    await waitFor(() => expect(getLimits).toHaveBeenCalled());

    // 9,000 GLC: inside the 10,000 per-transfer max, above the 5,000
    // remaining window.
    await user.type(screen.getByLabelText(/Amount in GLC/i), "9000");

    expect(
      await screen.findByText(
        /exceeds the remaining 24-hour bridge capacity for this direction \(5,000 GLC remaining\)/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Amount in GLC/i)).toHaveValue("9000");
    const submit = screen.getByRole("button", { name: /Create deposit request/i });
    expect(submit).toBeDisabled();
  });

  it("keeps the backend-unavailable state distinct from every quota state", async () => {
    getStatus.mockRejectedValue(new Error("network down"));
    renderWithQueryClient(<BridgeCard />);
    expect(
      await screen.findByText(/We could not reach the bridge status service/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/capacity reached for this direction/i),
    ).not.toBeInTheDocument();
  });
});
