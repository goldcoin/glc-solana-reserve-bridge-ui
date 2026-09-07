import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  primaryCta,
  renderWithQueryClient,
  selectNetwork,
  waitForRouteVerdict,
} from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import type * as EvmModule from "@/lib/evm";
import { BridgeForm } from "@/features/bridge/BridgeForm";

/**
 * Source-wallet balance and MAX.
 *
 * The rule these tests exist to hold: this form never shows a number it
 * does not have. A balance that failed to load, a wallet that is not
 * connected, and a network with no balance source are three different
 * states, and none of them may render as `0` — because someone about to
 * press MAX reads `0` as "you hold nothing", which is a different fact.
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

/** Mutable Solana wallet + balance, driven per test. */
const solana = vi.hoisted(() => ({
  status: "disconnected" as "connected" | "disconnected",
  address: null as string | null,
  balance: { isPending: false, isError: false, data: undefined } as {
    isPending: boolean;
    isError: boolean;
    data: { raw: string; decimals: number; symbol: string } | undefined;
  },
  mintConfigured: true,
}));

vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => ({
    status: solana.status,
    address: solana.address,
    wallet: null,
    wallets: [],
    canSign: solana.status === "connected",
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
  isValidAddress: (value: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),
  useTokenBalance: () => solana.balance,
  isTokenBalanceAvailable: () => solana.mintConfigured,
  walletQueryKeys: { balances: () => ["solana", "balance"] },
}));

/** Mutable EVM wallet + balance, driven per test. */
const evm = vi.hoisted(() => ({
  deployment: null as null | {
    chainId: number;
    chainName: string;
    rpcUrl: string;
    bridgeAddress: string;
    tokenAddress: string;
  },
  address: null as string | null,
  chainId: null as number | null,
  balance: { isPending: false, isError: false, data: undefined } as {
    isPending: boolean;
    isError: boolean;
    data: { raw: string; decimals: number; symbol: string } | undefined;
  },
}));

vi.mock("@/lib/evm", async (importOriginal) => {
  const actual = await importOriginal<typeof EvmModule>();
  return {
    ...actual,
    robinhoodDeployment: () => evm.deployment,
    useEvmWallet: () => ({
      wallets: [],
      hasInjectedWallet: true,
      address: evm.address,
      chainId: evm.chainId,
      connecting: false,
      deployment: evm.deployment,
      onExpectedChain: evm.deployment !== null && evm.chainId === evm.deployment.chainId,
      connect: vi.fn(),
      disconnect: vi.fn(),
      switchChain: vi.fn(),
      getProvider: () => null,
    }),
    useRobinhoodDeposit: () => ({ deposit: vi.fn() }),
    useRobinhoodGlcBalance: () => evm.balance,
  };
});

const DEPLOYMENT = {
  chainId: 4663,
  chainName: "Robinhood Chain",
  rpcUrl: "https://rpc.example.invalid",
  bridgeAddress: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  tokenAddress: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
};

const SOLANA_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EVM_ADDRESS = "0xdD870fA1b7C4700F2BD7f44238821C26f7392148";

/** 1 GLC at Robinhood Chain's 18 decimals. */
const ONE_GLC_18 = 1_000_000_000_000_000_000n;

beforeEach(() => {
  vi.resetAllMocks();
  solana.status = "disconnected";
  solana.address = null;
  solana.balance = { isPending: false, isError: false, data: undefined };
  solana.mintConfigured = true;
  evm.deployment = null;
  evm.address = null;
  evm.chainId = null;
  evm.balance = { isPending: false, isError: false, data: undefined };

  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getChains.mockResolvedValue(fixtures.chainsFixture(() => new Date()));
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
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
      destination_decimals: 6,
      source_asset: "GLC (Goldcoin)",
      destination_asset: "GLC (Solana)",
    }),
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

function maxButton() {
  return screen.queryByRole("button", { name: "MAX" });
}

function amountField() {
  return screen.getByLabelText(/Amount in GLC/i);
}

/** Puts the form on Solana → Goldcoin with a connected, funded wallet. */
async function solanaSource(user: ReturnType<typeof userEvent.setup>) {
  await waitForRouteVerdict();
  await selectNetwork(user, "Source network", /Solana/);
}

describe("Solana source", () => {
  beforeEach(() => {
    solana.status = "connected";
    solana.address = SOLANA_ADDRESS;
    // 12,450.32 GLC at the mint's 6 decimals.
    solana.balance = {
      isPending: false,
      isError: false,
      data: { raw: "12450320000", decimals: 6, symbol: "GLC" },
    };
  });

  it("shows the connected wallet's balance", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await solanaSource(user);

    expect(await screen.findByText(/12,450\.32 GLC/)).toBeVisible();
  });

  it("shows no balance and no MAX while the wallet is disconnected", async () => {
    // Nothing is fabricated for a wallet that has not been connected.
    solana.status = "disconnected";
    solana.address = null;
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await solanaSource(user);

    expect(screen.queryByText(/Balance/)).not.toBeInTheDocument();
    expect(maxButton()).not.toBeInTheDocument();
  });

  it("fills the amount field when MAX is pressed", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await solanaSource(user);

    await user.click(maxButton()!);
    // Bounded by the per-transfer maximum from `/limits` (20,000 GLC),
    // which is above this balance, so the balance is the answer.
    expect(amountField()).toHaveValue("12450.32");
  });

  it("clamps MAX to the route's per-transfer limit when the balance exceeds it", async () => {
    // A MAX that filled in the whole balance would be rejected by the very
    // next validation step.
    solana.balance = {
      isPending: false,
      isError: false,
      data: { raw: "99000000000", decimals: 6, symbol: "GLC" },
    };
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await solanaSource(user);

    await user.click(maxButton()!);
    await waitFor(() => expect(amountField()).not.toHaveValue(""));
    const filled = (amountField() as HTMLInputElement).value;
    expect(Number(filled.replace(/,/g, ""))).toBeLessThanOrEqual(20_000);
  });

  it("disables MAX on a zero balance", async () => {
    // Zero is a real, known balance — the row still shows it — but there
    // is nothing to fill in.
    solana.balance = {
      isPending: false,
      isError: false,
      data: { raw: "0", decimals: 6, symbol: "GLC" },
    };
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await solanaSource(user);

    expect(await screen.findByText(/0\.00 GLC/)).toBeVisible();
    expect(maxButton()).toBeDisabled();
  });

  it("says the balance is unavailable rather than showing zero when the read fails", async () => {
    solana.balance = { isPending: false, isError: true, data: undefined };
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await solanaSource(user);

    expect(await screen.findByText("Balance unavailable")).toBeVisible();
    expect(screen.queryByText(/Balance: 0/)).not.toBeInTheDocument();
    expect(maxButton()).toBeDisabled();
  });

  it("triggers a fresh quote for the filled amount", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await solanaSource(user);

    await user.click(maxButton()!);
    await waitFor(() =>
      expect(getQuote).toHaveBeenCalledWith(
        expect.objectContaining({ direction: "SolToGlc" }),
        expect.anything(),
      ),
    );
  });
});

describe("Robinhood source", () => {
  beforeEach(() => {
    getChains.mockResolvedValue(
      fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true }),
    );
    evm.deployment = DEPLOYMENT;
    evm.address = EVM_ADDRESS;
    evm.chainId = DEPLOYMENT.chainId;
    evm.balance = {
      isPending: false,
      isError: false,
      data: { raw: (12_450n * ONE_GLC_18).toString(), decimals: 18, symbol: "GLC" },
    };
  });

  async function robinhoodSource(user: ReturnType<typeof userEvent.setup>) {
    await waitForRouteVerdict();
    await selectNetwork(user, "Source network", /Robinhood Chain/);
  }

  it("shows the ERC-20 balance for the connected EVM wallet", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    expect(await screen.findByText(/12,450\.00 GLC/)).toBeVisible();
  });

  it("shows no balance while the EVM wallet is disconnected", async () => {
    evm.address = null;
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    expect(screen.queryByText(/Balance/)).not.toBeInTheDocument();
  });

  it("attempts no read at all when the token contract is not configured", async () => {
    // Today's state in every environment: the custody contract is not
    // deployed, so there is no token address to read.
    evm.deployment = null;
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    expect(screen.queryByText(/Balance/)).not.toBeInTheDocument();
    expect(maxButton()).not.toBeInTheDocument();
  });

  it("says unavailable rather than zero when the RPC read fails", async () => {
    evm.balance = { isPending: false, isError: true, data: undefined };
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    expect(await screen.findByText("Balance unavailable")).toBeVisible();
    expect(maxButton()).toBeDisabled();
  });

  it("says unavailable when the wallet is on the wrong network", async () => {
    // A balance read against the wrong chain returns a real number for the
    // wrong asset — worse than no number.
    evm.chainId = 1;
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    expect(await screen.findByText("Balance unavailable")).toBeVisible();
  });

  it("fills MAX with the exact 18-decimal amount, without a JS number", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    await user.click(maxButton()!);
    expect(amountField()).toHaveValue("12450");
  });

  it("keeps every digit of a balance beyond Number.MAX_SAFE_INTEGER", async () => {
    // 12,450.000000000000000009 GLC — the trailing digits are exactly what
    // a double would lose.
    const dusty = 12_450n * ONE_GLC_18 + 9n;
    evm.balance = {
      isPending: false,
      isError: false,
      data: { raw: dusty.toString(), decimals: 18, symbol: "GLC" },
    };
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    await user.click(maxButton()!);
    // Floored to the 10^10 boundary — the dust is dropped, never rounded up.
    expect(amountField()).toHaveValue("12450");
  });

  it("rounds non-canonical dust DOWN to the 10^10 boundary", async () => {
    // 1.00000000_0000000001 GLC: one base unit above a bridgeable amount.
    // The custody contract reverts anything that is not an exact multiple,
    // so MAX must land at or below the balance, on the boundary.
    evm.balance = {
      isPending: false,
      isError: false,
      data: { raw: (ONE_GLC_18 + 1n).toString(), decimals: 18, symbol: "GLC" },
    };
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    await user.click(maxButton()!);
    expect(amountField()).toHaveValue("1");
  });

  it("disables MAX when the entire balance is sub-canonical dust", async () => {
    evm.balance = {
      isPending: false,
      isError: false,
      data: { raw: "9999999999", decimals: 18, symbol: "GLC" },
    };
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    expect(maxButton()).toBeDisabled();
  });

  it("refreshes the balance when the account changes", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);
    expect(await screen.findByText(/12,450\.00 GLC/)).toBeVisible();

    evm.address = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    evm.balance = {
      isPending: false,
      isError: false,
      data: { raw: ONE_GLC_18.toString(), decimals: 18, symbol: "GLC" },
    };
    rerender(<BridgeForm />);

    expect(await screen.findByText(/1\.00 GLC/)).toBeVisible();
    expect(screen.queryByText(/12,450\.00 GLC/)).not.toBeInTheDocument();
  });

  it("refreshes the balance when the wallet switches network", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);
    expect(await screen.findByText(/12,450\.00 GLC/)).toBeVisible();

    evm.chainId = 1;
    rerender(<BridgeForm />);

    expect(await screen.findByText("Balance unavailable")).toBeVisible();
  });
});

describe("Goldcoin source", () => {
  it("shows no balance and no MAX — there is no wallet to read one from", async () => {
    // And it is never derived from bridge reserve statistics: the reserve
    // is the bridge's holdings, not the user's.
    solana.status = "connected";
    solana.address = SOLANA_ADDRESS;
    solana.balance = {
      isPending: false,
      isError: false,
      data: { raw: "12450320000", decimals: 6, symbol: "GLC" },
    };
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    // Goldcoin is the default source.
    expect(screen.queryByText(/Balance/)).not.toBeInTheDocument();
    expect(maxButton()).not.toBeInTheDocument();
  });
});

describe("switching source networks", () => {
  it("never carries a balance across from the previous network", async () => {
    solana.status = "connected";
    solana.address = SOLANA_ADDRESS;
    solana.balance = {
      isPending: false,
      isError: false,
      data: { raw: "12450320000", decimals: 6, symbol: "GLC" },
    };
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Solana/);
    expect(await screen.findByText(/12,450\.32 GLC/)).toBeVisible();

    // Back to Goldcoin, which has no balance source at all.
    await selectNetwork(user, "Source network", /Goldcoin/);
    await waitFor(() =>
      expect(screen.queryByText(/12,450\.32 GLC/)).not.toBeInTheDocument(),
    );
    expect(maxButton()).not.toBeInTheDocument();
  });
});

describe("MAX is a shortcut, never a bypass", () => {
  it("still cannot submit on a route the backend has not opened", async () => {
    // Pressing MAX fills an amount and nothing more: the route gate is
    // unaffected, and the CTA stays refused.
    evm.deployment = DEPLOYMENT;
    evm.address = EVM_ADDRESS;
    evm.chainId = DEPLOYMENT.chainId;
    evm.balance = {
      isPending: false,
      isError: false,
      data: { raw: (12_450n * ONE_GLC_18).toString(), decimals: 18, symbol: "GLC" },
    };
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    // The default fixture keeps both Robinhood routes closed. The balance
    // still shows — it is a fact about the wallet, not about the route —
    // and MAX still fills the field. What must not change is the verdict.
    await selectNetwork(user, "Source network", /Robinhood Chain/);
    expect(await screen.findByText(/12,450\.00 GLC/)).toBeVisible();

    await user.click(maxButton()!);
    expect(amountField()).toHaveValue("12450");

    expect(primaryCta()).toBeDisabled();
    expect(primaryCta()).toHaveTextContent(/Route unavailable/i);
  });
});
