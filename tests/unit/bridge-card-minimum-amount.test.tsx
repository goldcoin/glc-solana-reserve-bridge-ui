import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { primaryCta, renderWithQueryClient, selectNetwork } from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import { encodeBase58Check } from "@/lib/bridge/glc-address";
import { BridgeCard } from "@/features/bridge/BridgeCard";
import type * as EnvModule from "@/lib/config/env";

/**
 * Regression coverage for the "Min 99 GLC" bug, and its later "Min 100 GLC"
 * recurrence once the real bridge fee moved from 1% to 6%.
 *
 * The UI used to display and enforce `GET /limits`' `min_transfer_amount`
 * (a NET-side on-chain check, `limits.rs::enforce_transfer_amount` compares
 * it against the amount AFTER the bridge fee) directly as the GROSS
 * entry-side minimum. Then it used a fixed "100 GLC" constant tuned
 * specifically for a 1% fee (100 GLC gross nets to exactly 99 GLC at 1%) —
 * which silently went stale and under-shot the real on-chain floor once the
 * fee became 6% (100 GLC gross nets to only 94 GLC at 6%, BELOW the real
 * 100 GLC on-chain minimum).
 *
 * The correct GROSS entry-side minimum is now DERIVED at use time from
 * `/limits`' own `min_transfer_amount` (99 GLC, the live production
 * NET-side floor — docs/22-production-readiness-review.md's 2026-08-29
 * update note) and `bridge_fee_bps` (300, i.e. 3%) via
 * `minimumGrossCanonicalForMinTransferAmount`
 * (`src/lib/bridge/canonical.ts`) — the exact smallest gross that still
 * nets to at least 99 GLC after a 3% fee, which is 102.06185566 GLC
 * (canonical, Goldcoin-source precision) / 102.061856 GLC (ceiled to
 * Solana's 6-decimal source precision). There is no longer a fixed
 * constant to keep in sync with the real fee rate.
 *
 * `limitsFixture()` reports the real production `min_transfer_amount` (99
 * GLC) and `bridge_fee_bps` (300) so these tests exercise the actual
 * derivation, not a hand-picked coincidence.
 *
 * Kept as its own file (not added to bridge-card.test.tsx) for the same
 * reason as bridge-card-sol-to-glc-redirect.test.tsx: the SolToGlc cases
 * need a `glcAddressVersions` env mock and a connected wallet that the
 * shared file's other ~30 tests do not need.
 */

const GLC_TO_SOL_MINIMUM_DISPLAY = "102.06185566 GLC";
const GLC_TO_SOL_MINIMUM_INPUT = "102.06185566";
const GLC_TO_SOL_JUST_BELOW_MINIMUM_INPUT = "102.06185565";

const SOL_TO_GLC_MINIMUM_DISPLAY = "102.061856 GLC";
const SOL_TO_GLC_MINIMUM_INPUT = "102.061856";
const SOL_TO_GLC_JUST_BELOW_MINIMUM_INPUT = "102.061855";

const getStatus = vi.fn();
const getChains = vi.fn();
const getLimits = vi.fn();
const getReserve = vi.fn();
const getQuote = vi.fn();
const createTransfer = vi.fn();
const listTransfers = vi.fn();

vi.mock("@/lib/api", async () => ({
  bridgeApi: {
    getStatus: (...args: unknown[]) => getStatus(...args),
    getChains: (...args: unknown[]) => getChains(...args),
    getLimits: (...args: unknown[]) => getLimits(...args),
    getReserve: (...args: unknown[]) => getReserve(...args),
    getQuote: (...args: unknown[]) => getQuote(...args),
    createTransfer: (...args: unknown[]) => createTransfer(...args),
    listTransfers: (...args: unknown[]) => listTransfers(...args),
    // These tests exercise the minimum-amount bound, not the recipient
    // rate limit — every address here reads as eligible so the amount
    // validation stays the only variable under test.
    getSolToGlcRecipientEligibility: (address: unknown) =>
      Promise.resolve({
        direction: "SolToGlc",
        address: String(address),
        eligible: true,
        retry_after: null,
        retry_after_seconds: null,
        window_seconds: 86_400,
      }),
  },
  // BridgeCard imports this error factory alongside bridgeApi; the real
  // implementation is pure copy/shaping, so pass it through unmocked.
  recipientRateLimitedError: (await import("@/lib/api/errors")).recipientRateLimitedError,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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
const VALID_SOLANA_RECIPIENT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const VALID_GOLDCOIN_RECIPIENT = encodeBase58Check(111, new Uint8Array(20));

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

vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => walletConnection,
  useDepositToReserve: () => ({ capability: depositCapability, deposit: vi.fn() }),
  isValidAddress: (value: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),
  // The FROM panel reads a source balance; with no wallet connected the
  // hook short-circuits before the query, so a minimal stub is enough.
  useTokenBalance: () => ({ isPending: true, isError: false, data: undefined }),
  isTokenBalanceAvailable: () => true,
  walletQueryKeys: { balances: () => ["solana", "balance"] },
}));

function glcToSolQuote() {
  return {
    direction: "GlcToSol" as const,
    gross_amount: "50000000000",
    gross_display_amount: "500.00000000",
    fee_bps: 300,
    fee_amount: "3000000000",
    fee_display_amount: "30.00000000",
    net_amount: "470000000",
    net_display_amount: "470.000000",
    source_decimals: 8,
    destination_decimals: 6,
    source_asset: "GLC (Goldcoin)",
    destination_asset: "GLC (Solana)",
  };
}

function solToGlcQuote() {
  return {
    direction: "SolToGlc" as const,
    gross_amount: "500000000",
    gross_display_amount: "500.000000",
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

beforeEach(() => {
  vi.resetAllMocks();
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
  depositCapability.mockReturnValue({ available: true });
});

async function typeGlcToSolAmount(
  user: ReturnType<typeof userEvent.setup>,
  amount: string,
) {
  renderWithQueryClient(<BridgeCard />);
  await waitFor(() => expect(getLimits).toHaveBeenCalled());
  await user.type(screen.getByLabelText(/Amount in GLC/i), amount);
  await user.type(
    screen.getByLabelText("Solana recipient address"),
    VALID_SOLANA_RECIPIENT,
  );
}

/** The "minimum transfer" message renders in more than one place at once
 * (an inline field error and an accessible description on the disabled
 * submit button), so it must be asserted with `findAllByText`, not
 * `findByText` (which throws on more than one match). */
async function expectMinimumMessage(minimumDisplay: string) {
  expect(
    (
      await screen.findAllByText(
        new RegExp(`The minimum transfer is ${minimumDisplay}`, "i"),
      )
    ).length,
  ).toBeGreaterThan(0);
}

async function typeSolToGlcAmount(
  user: ReturnType<typeof userEvent.setup>,
  amount: string,
) {
  renderWithQueryClient(<BridgeCard />);
  // Networks are chosen in the two selectors; the route is derived from
  // the pair. `selectNetwork` waits for `GET /chains` to answer first —
  // availability is never assumed, so the control is genuinely disabled
  // until then.
  await selectNetwork(user, "Source network", /Solana/);
  await waitFor(() => expect(getLimits).toHaveBeenCalled());
  await user.type(screen.getByLabelText(/Amount in GLC/i), amount);
  await user.type(
    screen.getByLabelText("Goldcoin destination address"),
    VALID_GOLDCOIN_RECIPIENT,
  );
}

describe("BridgeCard — minimum bridge amount (Goldcoin -> Solana)", () => {
  beforeEach(() => {
    getQuote.mockResolvedValue(glcToSolQuote());
  });

  it("displays the fee-derived 102.06185566 GLC minimum, never the backend's raw 99 GLC net-side figure", async () => {
    const user = userEvent.setup();
    await typeGlcToSolAmount(user, "500");
    expect(
      await screen.findByText(new RegExp(`Min ${GLC_TO_SOL_MINIMUM_DISPLAY}`)),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Min 99 GLC\b/)).not.toBeInTheDocument();
  });

  it("rejects one atomic unit below the exact minimum", async () => {
    const user = userEvent.setup();
    await typeGlcToSolAmount(user, GLC_TO_SOL_JUST_BELOW_MINIMUM_INPUT);
    await expectMinimumMessage(GLC_TO_SOL_MINIMUM_DISPLAY);
    expect(primaryCta()).toBeDisabled();
  });

  it("rejects 100 GLC (the stale pre-fix minimum, now well under the real floor)", async () => {
    const user = userEvent.setup();
    await typeGlcToSolAmount(user, "100");
    await expectMinimumMessage(GLC_TO_SOL_MINIMUM_DISPLAY);
    expect(primaryCta()).toBeDisabled();
  });

  it("accepts exactly the minimum, 102.06185566 GLC", async () => {
    const user = userEvent.setup();
    await typeGlcToSolAmount(user, GLC_TO_SOL_MINIMUM_INPUT);
    const submit = primaryCta();
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByText(/minimum transfer is/i)).not.toBeInTheDocument();
  });

  it("accepts a normal amount above the minimum", async () => {
    const user = userEvent.setup();
    await typeGlcToSolAmount(user, "500");
    const submit = primaryCta();
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByText(/minimum transfer is/i)).not.toBeInTheDocument();
  });
});

describe("BridgeCard — minimum bridge amount (Solana -> Goldcoin)", () => {
  beforeEach(() => {
    getQuote.mockResolvedValue(solToGlcQuote());
  });

  it("displays the fee-derived 102.061856 GLC minimum, never the backend's raw 99 GLC net-side figure", async () => {
    const user = userEvent.setup();
    await typeSolToGlcAmount(user, "500");
    expect(
      await screen.findByText(new RegExp(`Min ${SOL_TO_GLC_MINIMUM_DISPLAY}`)),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Min 99 GLC\b/)).not.toBeInTheDocument();
  });

  it("rejects one atomic unit below the exact minimum", async () => {
    const user = userEvent.setup();
    await typeSolToGlcAmount(user, SOL_TO_GLC_JUST_BELOW_MINIMUM_INPUT);
    await expectMinimumMessage(SOL_TO_GLC_MINIMUM_DISPLAY);
    expect(primaryCta()).toBeDisabled();
  });

  it("rejects 100 GLC (the stale pre-fix minimum, now well under the real floor)", async () => {
    const user = userEvent.setup();
    await typeSolToGlcAmount(user, "100");
    await expectMinimumMessage(SOL_TO_GLC_MINIMUM_DISPLAY);
    expect(primaryCta()).toBeDisabled();
  });

  it("accepts exactly the minimum, 102.061856 GLC", async () => {
    const user = userEvent.setup();
    await typeSolToGlcAmount(user, SOL_TO_GLC_MINIMUM_INPUT);
    const submit = primaryCta();
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByText(/minimum transfer is/i)).not.toBeInTheDocument();
  });

  it("accepts a normal amount above the minimum", async () => {
    const user = userEvent.setup();
    await typeSolToGlcAmount(user, "500");
    const submit = primaryCta();
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByText(/minimum transfer is/i)).not.toBeInTheDocument();
  });
});
