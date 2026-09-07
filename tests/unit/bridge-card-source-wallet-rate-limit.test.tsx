import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { primaryCta, renderWithQueryClient, selectNetwork } from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import { encodeBase58Check } from "@/lib/bridge/glc-address";
import { RECIPIENT_RATE_LIMIT_TITLE } from "@/lib/bridge/recipient-rate-limit";
import { SOURCE_WALLET_RATE_LIMIT_TITLE } from "@/lib/bridge/source-wallet-rate-limit";
import { BridgeCard } from "@/features/bridge/BridgeCard";
import type * as EnvModule from "@/lib/config/env";
import type { WalletStatus } from "@/lib/solana/types";

/**
 * The SolToGlc per-source-wallet rate limit, from the form's point of
 * view — the dual-key twin of bridge-card-recipient-rate-limit.test.tsx.
 * A single Solana wallet may make at most one qualifying deposit inside
 * the backend's rolling 24-hour window, REGARDLESS of which Goldcoin
 * address it targets — this is the exact production bypass the dual
 * limit closes (previously: one wallet, many different recipients, many
 * deposits inside the same 24 hours). These tests pin down that the form
 * warns before the wallet is invoked, re-checks fresh immediately before
 * submission, and never opens Phantom or creates a Solana obligation for
 * a wallet the backend has already said is blocked — while confirming
 * the pre-existing, independent recipient rule keeps working unchanged
 * alongside it.
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
const OTHER_ADDRESS = encodeBase58Check(111, new Uint8Array(20).fill(1));
const RETRY_AFTER_UNIX = 1_787_000_000;

const walletConnection = {
  status: "connected" as WalletStatus,
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
  // The FROM panel reads a source balance; with no wallet connected the
  // hook short-circuits before the query, so a minimal stub is enough.
  useTokenBalance: () => ({ isPending: true, isError: false, data: undefined }),
  isTokenBalanceAvailable: () => true,
  walletQueryKeys: { balances: () => ["solana", "balance"] },
}));

function eligible(address: string) {
  return {
    direction: "SolToGlc" as const,
    address,
    wallet: WALLET_ADDRESS as string | null,
    eligible: true,
    blocked_reason: null,
    retry_after: null,
    retry_after_seconds: null,
    window_seconds: 86_400,
  };
}

function sourceWalletBlocked(address: string) {
  return {
    direction: "SolToGlc" as const,
    address,
    wallet: WALLET_ADDRESS as string | null,
    eligible: false,
    blocked_reason: "source_wallet_rate_limited" as const,
    retry_after: RETRY_AFTER_UNIX,
    retry_after_seconds: 40_000,
    window_seconds: 86_400,
  };
}

function recipientBlocked(address: string) {
  return {
    direction: "SolToGlc" as const,
    address,
    wallet: WALLET_ADDRESS as string | null,
    eligible: false,
    blocked_reason: "recipient_rate_limited" as const,
    retry_after: RETRY_AFTER_UNIX,
    retry_after_seconds: 40_000,
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
  // Networks are chosen in the two selectors; the route is derived from
  // the pair. `selectNetwork` waits for `GET /chains` to answer first —
  // availability is never assumed, so the control is genuinely disabled
  // until then.
  await selectNetwork(user, "Source network", /Solana/);
  await waitFor(() => expect(getLimits).toHaveBeenCalled());
  await user.type(screen.getByLabelText(/Amount in GLC/i), "500");
  await user.type(screen.getByLabelText("Goldcoin destination address"), address);
}

function submitButton() {
  return primaryCta();
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

describe("BridgeCard — SolToGlc source-wallet rate limit", () => {
  it("allows a fresh wallet and a fresh (different) recipient: no warning, submit enabled", async () => {
    getSolToGlcRecipientEligibility.mockResolvedValue(eligible(FRESH_ADDRESS));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlcForm(user, FRESH_ADDRESS);

    await waitFor(() => expect(submitButton()).toBeEnabled());
    expect(screen.queryByText(SOURCE_WALLET_RATE_LIMIT_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByText(RECIPIENT_RATE_LIMIT_TITLE)).not.toBeInTheDocument();
    expect(getSolToGlcRecipientEligibility).toHaveBeenCalledWith(
      FRESH_ADDRESS,
      WALLET_ADDRESS,
      expect.anything(),
    );
  });

  it("same wallet, different (fresh) Goldcoin address: blocked with ONLY the wallet message, submit disabled, wallet never invoked", async () => {
    // The recipient itself has no history (it would read eligible on its
    // own) — only the source-wallet leg blocks. This is exactly the
    // bypass the dual limit closes: one wallet, a fresh recipient.
    getSolToGlcRecipientEligibility.mockResolvedValue(sourceWalletBlocked(FRESH_ADDRESS));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlcForm(user, FRESH_ADDRESS);

    expect(
      (await screen.findAllByText(SOURCE_WALLET_RATE_LIMIT_TITLE)).length,
    ).toBeGreaterThan(0);
    // "show only" — the recipient-specific message must NOT also appear.
    expect(screen.queryByText(RECIPIENT_RATE_LIMIT_TITLE)).not.toBeInTheDocument();
    await waitFor(() => expect(submitButton()).toBeDisabled());

    // A click on the disabled button must be inert: Phantom (depositFn) is
    // never invoked, and no obligation/request is created.
    await user.click(submitButton());
    expect(depositFn).not.toHaveBeenCalled();
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it("different wallet, same (already-paid) recipient: still blocked, by the pre-existing recipient rule", async () => {
    // The wallet itself has no history — only the recipient leg blocks.
    // Confirms the dual limit never REPLACED the recipient rule.
    getSolToGlcRecipientEligibility.mockResolvedValue(recipientBlocked(OTHER_ADDRESS));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlcForm(user, OTHER_ADDRESS);

    expect(
      (await screen.findAllByText(RECIPIENT_RATE_LIMIT_TITLE)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(SOURCE_WALLET_RATE_LIMIT_TITLE)).not.toBeInTheDocument();
    await waitFor(() => expect(submitButton()).toBeDisabled());

    await user.click(submitButton());
    expect(depositFn).not.toHaveBeenCalled();
  });

  it("re-checks at submit time: a wallet that becomes rate-limited between the form check and the click never reaches the wallet", async () => {
    // Form-time verdict: eligible — the button enables. Every later
    // verdict (the fresh pre-submit re-check, and the refetch it
    // triggers): blocked by the source-wallet rule — another deposit from
    // this same wallet (a different tab, a race) landed in between.
    getSolToGlcRecipientEligibility
      .mockResolvedValueOnce(eligible(FRESH_ADDRESS))
      .mockResolvedValue(sourceWalletBlocked(FRESH_ADDRESS));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlcForm(user, FRESH_ADDRESS);
    await waitFor(() => expect(submitButton()).toBeEnabled());

    await user.click(submitButton());

    expect(await screen.findAllByText(SOURCE_WALLET_RATE_LIMIT_TITLE)).not.toHaveLength(
      0,
    );
    // Decisively: the wallet was never invoked and no Solana obligation
    // was created — the race was caught BEFORE Phantom opened.
    expect(depositFn).not.toHaveBeenCalled();
    expect(createTransfer).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    // The pre-submit check really was a second, fresh read.
    expect(getSolToGlcRecipientEligibility.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("unblocks on its own once the 24-hour window expires (next poll returns eligible)", async () => {
    getSolToGlcRecipientEligibility
      .mockResolvedValueOnce(sourceWalletBlocked(FRESH_ADDRESS))
      .mockResolvedValue(eligible(FRESH_ADDRESS));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlcForm(user, FRESH_ADDRESS);

    expect(
      (await screen.findAllByText(SOURCE_WALLET_RATE_LIMIT_TITLE)).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(submitButton()).toBeDisabled());

    await vi.advanceTimersByTimeAsync(30_000);

    await waitFor(() => expect(submitButton()).toBeEnabled());
    expect(screen.queryByText(SOURCE_WALLET_RATE_LIMIT_TITLE)).not.toBeInTheDocument();
  });

  it("omits the wallet query parameter before a wallet is connected, checking the recipient leg only", async () => {
    walletConnection.status = "disconnected";
    walletConnection.address = null;
    getSolToGlcRecipientEligibility.mockResolvedValue(eligible(FRESH_ADDRESS));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlcForm(user, FRESH_ADDRESS);

    await waitFor(() =>
      expect(getSolToGlcRecipientEligibility).toHaveBeenCalledWith(
        FRESH_ADDRESS,
        null,
        expect.anything(),
      ),
    );
  });
});
