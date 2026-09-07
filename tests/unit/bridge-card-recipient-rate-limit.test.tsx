import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQueryClient } from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import { encodeBase58Check } from "@/lib/bridge/glc-address";
import { RECIPIENT_RATE_LIMIT_TITLE } from "@/lib/bridge/recipient-rate-limit";
import { BridgeCard } from "@/features/bridge/BridgeCard";
import type * as EnvModule from "@/lib/config/env";

/**
 * The SolToGlc per-recipient rate limit, from the form's point of view: a
 * Goldcoin destination that already received a bridge payout inside the
 * backend's rolling 24-hour window must be warned about BEFORE the wallet
 * is ever invoked — blocked at the form gate once the address is typed,
 * and re-checked fresh immediately before submission so a verdict that
 * changed in between still never reaches the wallet. The backend stays
 * the enforcing authority either way; what these tests pin down is that
 * the UI never opens Phantom (`depositFn`) and never creates a Solana
 * obligation for an address the backend has already said is blocked.
 *
 * Own file (not bridge-card.test.tsx) for the same reason as
 * bridge-card-sol-to-glc-redirect.test.tsx: it needs the env mock
 * (`glcAddressVersions`) to get real Goldcoin addresses past validation.
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
  sourceWalletRateLimitedError: (await import("@/lib/api/errors"))
    .sourceWalletRateLimitedError,
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const envState = vi.hoisted(() => ({ glcAddressVersions: [111] as number[] }));
vi.mock("@/lib/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return {
    ...actual,
    env: { ...actual.env, glcAddressVersions: envState.glcAddressVersions },
  };
});

const WALLET_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const FRESH_ADDRESS = encodeBase58Check(111, new Uint8Array(20));
const PAID_ADDRESS = encodeBase58Check(111, new Uint8Array(20).fill(1));
const RETRY_AFTER_UNIX = 1_787_000_000;

const walletConnection = {
  status: "connected" as const,
  address: WALLET_ADDRESS as string | null,
  wallet: null,
  wallets: [],
  canSign: true,
  error: null,
  platform: "desktop" as const,
  connect: vi.fn(),
  disconnect: vi.fn(),
  dismissError: vi.fn(),
};

const depositCapability = vi.fn(() => ({ available: true as const }));
const depositFn = vi.fn();

vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => walletConnection,
  useDepositToReserve: () => ({ capability: depositCapability, deposit: depositFn }),
  isValidAddress: (value: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),
}));

function eligibilityFor(address: string, eligible: boolean) {
  return {
    direction: "SolToGlc" as const,
    address,
    wallet: WALLET_ADDRESS as string | null,
    eligible,
    blocked_reason: eligible ? null : ("recipient_rate_limited" as const),
    retry_after: eligible ? null : RETRY_AFTER_UNIX,
    retry_after_seconds: eligible ? null : 40_000,
    window_seconds: 86_400,
  };
}

function quote() {
  return {
    direction: "SolToGlc" as const,
    gross_amount: "50000000000",
    gross_display_amount: "500.00000000",
    fee_bps: 300,
    fee_amount: "3000000000",
    fee_display_amount: "30.00000000",
    net_amount: "47000000000",
    net_display_amount: "470.00000000",
    source_decimals: 6,
    destination_decimals: 8,
    source_asset: "GLC (Solana)",
    destination_asset: "GLC (Goldcoin)",
  };
}

/** One empty page of `GET /transfers` — enough for the baseline read. */
function emptyPage() {
  return { items: [], next_cursor: null, as_of: 1_700_000_000 };
}

async function fillSolToGlcForm(
  user: ReturnType<typeof userEvent.setup>,
  address: string,
) {
  // A route is unselectable until `GET /chains` has answered — availability
  // is never assumed, so the control is genuinely disabled until then.
  const solToGlc = screen.getByRole("radio", { name: /GLC on Solana.*GLC L1/i });
  await waitFor(() => expect(solToGlc).toBeEnabled());
  await user.click(solToGlc);
  await waitFor(() => expect(getLimits).toHaveBeenCalled());
  await user.type(screen.getByLabelText(/Amount in GLC/i), "500");
  await user.type(screen.getByLabelText("Goldcoin destination address"), address);
}

function submitButton() {
  return screen.getByRole("button", { name: /Deposit from wallet/i });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  push.mockReset();
  envState.glcAddressVersions = [111];
  walletConnection.status = "connected";
  walletConnection.address = WALLET_ADDRESS;
  walletConnection.canSign = true;
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  // The route registry every gate now consults. The default fixture is
  // the real shipping state: both legacy routes open, both Robinhood
  // routes implemented-but-disabled, the Solana<->Robinhood pair inert.
  getChains.mockResolvedValue(fixtures.chainsFixture(() => new Date()));
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getQuote.mockResolvedValue(quote());
  listTransfers.mockResolvedValue(emptyPage());
  depositCapability.mockReturnValue({ available: true });
});

describe("BridgeCard — SolToGlc recipient rate limit", () => {
  it("allows an unused recipient: no warning, submit enabled", async () => {
    getSolToGlcRecipientEligibility.mockResolvedValue(
      eligibilityFor(FRESH_ADDRESS, true),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlcForm(user, FRESH_ADDRESS);

    await waitFor(() => expect(submitButton()).toBeEnabled());
    expect(screen.queryByText(RECIPIENT_RATE_LIMIT_TITLE)).not.toBeInTheDocument();
    expect(getSolToGlcRecipientEligibility).toHaveBeenCalledWith(
      FRESH_ADDRESS,
      WALLET_ADDRESS,
      expect.anything(),
    );
  });

  it("blocks a recently paid recipient: single-sentence warning, submit disabled, wallet never invoked", async () => {
    getSolToGlcRecipientEligibility.mockResolvedValue(
      eligibilityFor(PAID_ADDRESS, false),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlcForm(user, PAID_ADDRESS);

    // The exact required copy — and ONLY it: the retry-after time the
    // backend still returns is deliberately not displayed anywhere
    // (product decision, see @/lib/bridge/recipient-rate-limit).
    expect(
      (await screen.findAllByText(RECIPIENT_RATE_LIMIT_TITLE)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/Try again/i)).not.toBeInTheDocument();
    await waitFor(() => expect(submitButton()).toBeDisabled());

    // A click on the disabled button must be inert: no wallet prompt, no
    // Solana obligation, no GlcToSol request either.
    await user.click(submitButton());
    expect(depositFn).not.toHaveBeenCalled();
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it("unblocks on its own once the 24-hour window expires (next poll returns eligible)", async () => {
    // First verdict: blocked. Every later verdict (the 30s background
    // refetch after the window has passed): eligible.
    getSolToGlcRecipientEligibility
      .mockResolvedValueOnce(eligibilityFor(PAID_ADDRESS, false))
      .mockResolvedValue(eligibilityFor(PAID_ADDRESS, true));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlcForm(user, PAID_ADDRESS);

    expect(
      (await screen.findAllByText(RECIPIENT_RATE_LIMIT_TITLE)).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(submitButton()).toBeDisabled());

    // The eligibility query refetches every 30s while the form is open.
    await vi.advanceTimersByTimeAsync(30_000);

    await waitFor(() => expect(submitButton()).toBeEnabled());
    expect(screen.queryByText(RECIPIENT_RATE_LIMIT_TITLE)).not.toBeInTheDocument();
  });

  it("treats recipients independently: switching to a different address clears the block", async () => {
    getSolToGlcRecipientEligibility.mockImplementation((address: unknown) =>
      Promise.resolve(eligibilityFor(String(address), String(address) !== PAID_ADDRESS)),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlcForm(user, PAID_ADDRESS);

    expect(
      (await screen.findAllByText(RECIPIENT_RATE_LIMIT_TITLE)).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(submitButton()).toBeDisabled());

    const recipientInput = screen.getByLabelText("Goldcoin destination address");
    await user.clear(recipientInput);
    await user.type(recipientInput, FRESH_ADDRESS);

    await waitFor(() => expect(submitButton()).toBeEnabled());
    expect(screen.queryByText(RECIPIENT_RATE_LIMIT_TITLE)).not.toBeInTheDocument();
  });

  it("re-checks at submit time: a recipient paid between the form check and the click never reaches the wallet", async () => {
    // Form-time verdict: eligible — the button enables. Every later
    // verdict (the fresh pre-submit re-check, and the refetch it
    // triggers): blocked — the payout landed in between.
    getSolToGlcRecipientEligibility
      .mockResolvedValueOnce(eligibilityFor(PAID_ADDRESS, true))
      .mockResolvedValue(eligibilityFor(PAID_ADDRESS, false));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlcForm(user, PAID_ADDRESS);
    await waitFor(() => expect(submitButton()).toBeEnabled());

    await user.click(submitButton());

    // The submit-time error carries the same required copy…
    expect(await screen.findAllByText(RECIPIENT_RATE_LIMIT_TITLE)).not.toHaveLength(0);
    // …and, decisively: the wallet was never invoked and no Solana
    // obligation was created.
    expect(depositFn).not.toHaveBeenCalled();
    expect(createTransfer).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    // The pre-submit check really was a second, fresh read — not a reuse
    // of the form-time answer.
    expect(getSolToGlcRecipientEligibility.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("fails open on an eligibility READ error, leaving enforcement to the backend", async () => {
    // A network blip is not a blocked verdict: the form must not brick
    // the direction, and the backend still enforces at admission.
    getSolToGlcRecipientEligibility.mockRejectedValue(new Error("network down"));
    depositFn.mockResolvedValue({ signature: "sig-abc" });

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlcForm(user, FRESH_ADDRESS);

    await waitFor(() => expect(submitButton()).toBeEnabled());
    await user.click(submitButton());

    await waitFor(() => expect(depositFn).toHaveBeenCalledTimes(1));
  });
});
