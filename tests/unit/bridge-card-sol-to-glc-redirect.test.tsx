import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { primaryCta, renderWithQueryClient, selectNetwork } from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import { encodeBase58Check } from "@/lib/bridge/glc-address";
import { BridgeCard } from "@/features/bridge/BridgeCard";
import type * as EnvModule from "@/lib/config/env";

/**
 * Regression coverage for the Solana -> Goldcoin post-deposit redirect bug:
 * a wallet with an EXISTING SolToGlc request (any state — completed,
 * abandoned, anything) submitted a NEW deposit, and the UI redirected to
 * the old request instead of the one this deposit just created, because
 * the poll loop matched the first `direction === "SolToGlc"` item in the
 * wallet's transfer list rather than the specific request this submission
 * produced.
 *
 * Kept as its own file (not added to bridge-card.test.tsx) because it needs
 * an env mock (`glcAddressVersions`) to get a real Goldcoin address past
 * validation, which the shared file's ~30 other tests do not need and
 * should not be made to depend on.
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

const envState = vi.hoisted(() => ({ glcAddressVersions: [111] as number[] }));
vi.mock("@/lib/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return {
    ...actual,
    env: { ...actual.env, glcAddressVersions: envState.glcAddressVersions },
  };
});

const WALLET_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const GOLDCOIN_ADDRESS = encodeBase58Check(111, new Uint8Array(20));

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
  // The FROM panel reads a source balance; with no wallet connected the
  // hook short-circuits before the query, so a minimal stub is enough.
  useTokenBalance: () => ({ isPending: true, isError: false, data: undefined }),
  isTokenBalanceAvailable: () => true,
  walletQueryKeys: { balances: () => ["solana", "balance"] },
}));

function quote() {
  return {
    direction: "SolToGlc" as const,
    gross_amount: "500000000",
    gross_display_amount: "500.000000",
    fee_bps: 100,
    fee_amount: "5000000",
    fee_display_amount: "5.000000",
    net_amount: "49500000000",
    net_display_amount: "495.00000000",
    source_decimals: 6,
    destination_decimals: 8,
    source_asset: "GLC (Solana)",
    destination_asset: "GLC (Goldcoin)",
  };
}

/** One page of `GET /transfers`, matching the real endpoint's `id DESC` order. */
function page(items: Array<{ id: number; direction: "SolToGlc" | "GlcToSol" }>) {
  return {
    items: items.map((item) => ({
      id: item.id,
      direction: item.direction,
      state: "SourceFinalized" as const,
      gross_amount_atomic: "50000000000",
      fee_bps: 100,
      fee_amount_atomic: "500000000",
      net_amount_atomic: "49500000000",
      created_at: 1_700_000_000,
      source_txid: null,
      source_confirmations: 0,
      required_source_confirmations: null,
      destination_txid: null,
      failure_reason: null,
    })),
    next_cursor: null,
    as_of: 1_700_000_000,
  };
}

async function fillAndSubmitSolToGlc(user: ReturnType<typeof userEvent.setup>) {
  renderWithQueryClient(<BridgeCard />);
  // Networks are chosen in the two selectors; the route is derived from
  // the pair. `selectNetwork` waits for `GET /chains` to answer first —
  // availability is never assumed, so the control is genuinely disabled
  // until then.
  await selectNetwork(user, "Source network", /Solana/);
  await waitFor(() => expect(getLimits).toHaveBeenCalled());

  await user.type(screen.getByLabelText(/Amount in GLC/i), "500");
  await user.type(
    screen.getByLabelText("Goldcoin destination address"),
    GOLDCOIN_ADDRESS,
  );

  const submit = primaryCta();
  await waitFor(() => expect(submit).toBeEnabled());
  await user.click(submit);
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
  getSolToGlcRecipientEligibility.mockResolvedValue({
    direction: "SolToGlc",
    address: GOLDCOIN_ADDRESS,
    eligible: true,
    retry_after: null,
    retry_after_seconds: null,
    window_seconds: 86_400,
  });
  depositCapability.mockReturnValue({ available: true });
});

describe("BridgeCard — Solana -> Goldcoin post-deposit redirect correlation", () => {
  it("redirects to the newly created request, not an older SolToGlc request already in the wallet's list", async () => {
    // The wallet already has an older SolToGlc request (id 9) — the exact
    // shape of the bug report. The baseline read (before the wallet signs)
    // sees only it; the first poll after submission sees BOTH the old
    // request and the new one (id 11) the backend has by then folded.
    listTransfers
      .mockResolvedValueOnce(page([{ id: 9, direction: "SolToGlc" }])) // baseline, pre-submit
      .mockResolvedValueOnce(
        page([
          { id: 11, direction: "SolToGlc" },
          { id: 9, direction: "SolToGlc" },
        ]),
      ); // first poll
    depositFn.mockResolvedValue({ signature: "sig-abc" });

    const user = userEvent.setup({ delay: null });
    await fillAndSubmitSolToGlc(user);

    expect(await screen.findByText(/Deposit submitted/i)).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(4_000);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/bridge/11"));
    expect(push).not.toHaveBeenCalledWith("/bridge/9");
  });

  it("keeps waiting across multiple polls until the new request appears, never settling for the old one", async () => {
    listTransfers
      .mockResolvedValueOnce(page([{ id: 9, direction: "SolToGlc" }])) // baseline
      .mockResolvedValueOnce(page([{ id: 9, direction: "SolToGlc" }])) // poll 1: not indexed yet
      .mockResolvedValueOnce(page([{ id: 9, direction: "SolToGlc" }])) // poll 2: still not yet
      .mockResolvedValueOnce(
        page([
          { id: 11, direction: "SolToGlc" },
          { id: 9, direction: "SolToGlc" },
        ]),
      ); // poll 3: finally indexed
    depositFn.mockResolvedValue({ signature: "sig-abc" });

    const user = userEvent.setup({ delay: null });
    await fillAndSubmitSolToGlc(user);
    await screen.findByText(/Deposit submitted/i);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(push).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(push).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4_000);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/bridge/11"));
  });

  it("falls back to the wallet's own activity list rather than guessing when no baseline could be established", async () => {
    listTransfers.mockRejectedValueOnce(new Error("network down")); // baseline fetch fails
    depositFn.mockResolvedValue({ signature: "sig-abc" });

    const user = userEvent.setup({ delay: null });
    await fillAndSubmitSolToGlc(user);
    await screen.findByText(/Deposit submitted/i);

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/activity?address=${WALLET_ADDRESS}`),
    );
    // Never silently redirected into ANY specific request without a real
    // correlation, which is exactly the bug this replaces.
    expect(push).not.toHaveBeenCalledWith(expect.stringMatching(/^\/bridge\//));
  });

  it("redirects immediately when the wallet has no prior SolToGlc requests at all", async () => {
    listTransfers
      .mockResolvedValueOnce(page([])) // baseline: no prior transfers
      .mockResolvedValueOnce(page([{ id: 11, direction: "SolToGlc" }]));
    depositFn.mockResolvedValue({ signature: "sig-abc" });

    const user = userEvent.setup({ delay: null });
    await fillAndSubmitSolToGlc(user);
    await screen.findByText(/Deposit submitted/i);

    await vi.advanceTimersByTimeAsync(4_000);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/bridge/11"));
  });
});
