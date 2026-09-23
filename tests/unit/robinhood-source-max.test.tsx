import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderWithQueryClient,
  routeEligibilityFrom,
  selectNetwork,
  waitForRouteVerdict,
} from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import { BridgeForm } from "@/features/bridge/BridgeForm";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_GLC_TOKEN_ADDRESS,
  ROBINHOOD_V2_BRIDGE_ADDRESS,
} from "@/lib/evm/robinhood-target";
import type * as EnvModule from "@/lib/config/env";
import type * as EvmModule from "@/lib/evm";

/**
 * The Robinhood FROM panel's balance row and MAX button.
 *
 * # The inconsistency this closes
 *
 * A Solana source showed `Balance: <amount> GLC` and a MAX button; a
 * Robinhood source showed only the connected wallet address — no balance,
 * no MAX. The cause was that the balance read depended on the DEPOSIT
 * deployment, so it also depended on
 * `NEXT_PUBLIC_ROBINHOOD_TOKEN_ADDRESS` and
 * `NEXT_PUBLIC_ROBINHOOD_BRIDGE_ADDRESS` agreeing with their pins.
 * A balance is a user's own holding of a pinned token read over their own
 * wallet's provider; it involves neither the bridge contract nor any
 * configured address.
 *
 * # What MAX means here
 *
 * `min(wallet GLC balance, route per-transfer maximum)`, floored to the
 * custody contract's settlement granularity. The per-transfer maximum is
 * the contract's own `inboundMax` via `GET /robinhood/limits` — 20,000 GLC
 * — and is never invented locally.
 *
 * Nothing is withheld for gas: gas on Robinhood Network is paid in the
 * chain's NATIVE asset, so subtracting from a GLC balance would refuse
 * GLC the user holds.
 */

const ONE_GLC = 10n ** 18n;

const getStatus = vi.fn();
const getChains = vi.fn();
const getLimits = vi.fn();
const getReserve = vi.fn();
const getQuote = vi.fn();
const listTransfers = vi.fn();
const getRobinhoodLimits = vi.fn();
const getRhnToGlcRecipientEligibility = vi.fn();

vi.mock("@/lib/api", async () => ({
  ...(await import("@/lib/api/errors")),
  bridgeApi: {
    getStatus: (...a: unknown[]) => getStatus(...a),
    getChains: (...a: unknown[]) => getChains(...a),
    getLimits: (...a: unknown[]) => getLimits(...a),
    getReserve: (...a: unknown[]) => getReserve(...a),
    getQuote: (...a: unknown[]) => getQuote(...a),
    listTransfers: (...a: unknown[]) => listTransfers(...a),
    getRobinhoodLimits: (...a: unknown[]) => getRobinhoodLimits(...a),
    getRhnToGlcRecipientEligibility: (...a: unknown[]) =>
      getRhnToGlcRecipientEligibility(...a),
    getRouteEligibility: routeEligibilityFrom({
      RhnToGlc: (address: string, wallet: string | null) =>
        getRhnToGlcRecipientEligibility(address, wallet),
    }),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/bridge",
  useSearchParams: () => new URLSearchParams(),
}));

const envState = vi.hoisted(() => ({ glcAddressVersions: [111] as number[] }));
vi.mock("@/lib/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return {
    ...actual,
    env: { ...actual.env, glcAddressVersions: envState.glcAddressVersions },
  };
});

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
    capability: () => ({ available: true, reason: null, message: null }),
    deposit: vi.fn(),
  }),
  isValidAddress: (value: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),
  useTokenBalance: () => ({ isPending: true, isError: false, data: undefined }),
  isTokenBalanceAvailable: () => true,
  walletQueryKeys: { balances: () => ["solana", "balance"] },
  needsDeepLink: () => false,
  isUserRejection: () => false,
  buildDeepLinks: () => [],
}));

const EVM_ADDRESS = "0xdD870fA1b7C4700F2BD7f44238821C26f7392148";

/** The resolved deposit deployment, entirely from the pins. */
const DEPLOYMENT = {
  chainId: ROBINHOOD_CHAIN_ID,
  chainName: "Robinhood Chain",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  bridgeAddress: ROBINHOOD_V2_BRIDGE_ADDRESS,
  tokenAddress: ROBINHOOD_GLC_TOKEN_ADDRESS,
};

const evm = vi.hoisted(() => ({
  address: null as string | null,
  chainId: null as number | null,
  deployment: null as unknown,
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
    robinhoodDeploymentProblem: () => null,
    useEvmWallet: () => ({
      wallets: [],
      hasInjectedWallet: true,
      address: evm.address,
      chainId: evm.chainId,
      connecting: false,
      network: {
        chainId: ROBINHOOD_CHAIN_ID,
        chainName: DEPLOYMENT.chainName,
        rpcUrl: DEPLOYMENT.rpcUrl,
      },
      deployment: evm.deployment,
      // Mirrors the real hook: against the PINNED chain id.
      onExpectedChain: evm.chainId === ROBINHOOD_CHAIN_ID,
      connect: vi.fn(),
      disconnect: vi.fn(),
      switchChain: vi.fn(),
      getProvider: () => null,
    }),
    useRobinhoodDeposit: () => ({ deposit: vi.fn() }),
    useRobinhoodGlcBalance: () => evm.balance,
  };
});

function amountField() {
  return screen.getByLabelText(/Amount in GLC/i);
}

function maxButton() {
  return screen.queryByRole("button", { name: "MAX" });
}

/** Picks Robinhood as the source, so this pair is `RhnToGlc`. */
async function robinhoodSource(user: ReturnType<typeof userEvent.setup>) {
  await waitForRouteVerdict();
  await selectNetwork(user, "Source network", /Robinhood Chain/);
}

/**
 * One route's published maximum as a whole-GLC string, read off the same
 * `/chains` field the form reads — never written out as a literal that
 * would survive the backend changing it.
 */
function routeMaxWhole(route: "GlcToRhn" | "RhnToGlc"): string {
  const [whole = "0"] = fixtures.ROUTE_MAX_TRANSFER_DISPLAY[route].split(".");
  return whole;
}

function balanceOf(glc: bigint) {
  return {
    isPending: false,
    isError: false,
    data: { raw: (glc * ONE_GLC).toString(), decimals: 18, symbol: "GLC" },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  envState.glcAddressVersions = [111];
  evm.address = EVM_ADDRESS;
  evm.chainId = ROBINHOOD_CHAIN_ID;
  evm.deployment = DEPLOYMENT;
  evm.balance = balanceOf(1_000n);
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getChains.mockResolvedValue(
    fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true }),
  );
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  // The contract's own bounds: 20,000 GLC per transfer, both directions.
  getRobinhoodLimits.mockResolvedValue(
    fixtures.robinhoodLimitsFixture(() => new Date(), { open: true }),
  );
  getQuote.mockResolvedValue({
    direction: "RhnToGlc",
    gross_amount: "50000000000",
    gross_display_amount: "500.00000000",
    fee_bps: 300,
    fee_amount: "1500000000",
    fee_display_amount: "15.00000000",
    net_amount: "48500000000",
    net_display_amount: "485.00000000",
    source_decimals: 18,
    destination_decimals: 8,
    source_asset: "GLC",
    destination_asset: "GLC",
  });
  listTransfers.mockResolvedValue({ items: [], next_cursor: null, as_of: 0 });
});

describe("Robinhood source — the balance row", () => {
  it("shows Balance: X GLC, the same shape a Solana source shows", async () => {
    evm.balance = balanceOf(12_450n);
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    expect(await screen.findByText(/12,450\.00 GLC/)).toBeVisible();
    expect(screen.getByText(/Balance:/)).toBeVisible();
    expect(maxButton()).toBeEnabled();
  });

  it("shows it with NO deposit deployment resolved", async () => {
    // The production shape: a deployment refused for a stale or absent
    // token variable. A balance does not involve the bridge contract.
    evm.deployment = null;
    evm.balance = balanceOf(12_450n);
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    expect(await screen.findByText(/12,450\.00 GLC/)).toBeVisible();
    expect(maxButton()).toBeEnabled();
  });

  it("renders no balance row at all while the wallet is disconnected", async () => {
    // Not "Balance: —": a placeholder implies a figure is coming.
    evm.address = null;
    evm.balance = { isPending: true, isError: false, data: undefined };
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    expect(screen.queryByText(/Balance/)).not.toBeInTheDocument();
    expect(maxButton()).not.toBeInTheDocument();
  });

  it("says unavailable — never zero — when the balance read fails", async () => {
    // A read that failed and a balance of zero mean entirely different
    // things to someone about to press MAX.
    evm.balance = { isPending: false, isError: true, data: undefined };
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    expect(await screen.findByText("Balance unavailable")).toBeVisible();
    expect(screen.queryByText(/Balance: 0/)).not.toBeInTheDocument();
    // MAX is present but inert, with the reason on the control itself.
    expect(maxButton()).toBeDisabled();
    expect(maxButton()).toHaveAttribute("title", expect.stringContaining("No amount"));
  });

  it("says unavailable while the wallet is on the wrong chain", async () => {
    // A balanceOf answered by another network is a real number for a
    // different asset — worse than no number.
    evm.chainId = 1;
    evm.balance = balanceOf(12_450n);
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    expect(await screen.findByText("Balance unavailable")).toBeVisible();
    expect(screen.queryByText(/12,450/)).not.toBeInTheDocument();
    expect(maxButton()).toBeDisabled();
  });

  it("shows a loading state rather than a zero while the read is in flight", async () => {
    evm.balance = { isPending: true, isError: false, data: undefined };
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    expect(await screen.findByText("Balance: …")).toBeVisible();
    expect(maxButton()).toBeDisabled();
  });
});

describe("Robinhood source — MAX", () => {
  it("fills in the whole balance when it is below the 20,000 GLC route max", async () => {
    evm.balance = balanceOf(1_234n);
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    await waitFor(() => expect(maxButton()).toBeEnabled());
    await user.click(maxButton()!);

    expect(amountField()).toHaveValue("1234");
  });

  it("CAPS at this route's published maximum when the balance is larger", async () => {
    // `RhnToGlc`'s own limit from `GET /chains`, not the custody
    // contract's `inboundMax` — MAX = min(balance, route max), never the
    // raw balance.
    evm.balance = balanceOf(75_000n);
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    await waitFor(() => expect(maxButton()).toBeEnabled());
    await user.click(maxButton()!);

    expect(amountField()).toHaveValue(routeMaxWhole("RhnToGlc"));
  });

  it("takes the balance when it is exactly the route max", async () => {
    evm.balance = balanceOf(BigInt(routeMaxWhole("RhnToGlc")));
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    await waitFor(() => expect(maxButton()).toBeEnabled());
    await user.click(maxButton()!);

    expect(amountField()).toHaveValue(routeMaxWhole("RhnToGlc"));
  });

  it("subtracts nothing for gas — gas is paid in the native asset, not GLC", async () => {
    // Withholding a gas allowance from a GLC balance would refuse GLC the
    // user holds, on a chain whose fees are not denominated in it.
    evm.balance = balanceOf(500n);
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    await waitFor(() => expect(maxButton()).toBeEnabled());
    await user.click(maxButton()!);

    expect(amountField()).toHaveValue("500");
  });

  it("fills in an amount the form then ACCEPTS, not one it rejects", async () => {
    // The point of capping: MAX must never produce a figure the amount
    // validator immediately refuses.
    evm.balance = balanceOf(75_000n);
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    await waitFor(() => expect(maxButton()).toBeEnabled());
    await user.click(maxButton()!);

    expect(screen.queryByText(/maximum transfer/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/more decimal places/i)).not.toBeInTheDocument();
  });

  it("is disabled when the balance is not known", async () => {
    evm.balance = { isPending: false, isError: true, data: undefined };
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    await waitFor(() => expect(maxButton()).toBeDisabled());
    await user.click(maxButton()!);
    // Inert: no amount was invented from a balance nobody could read.
    expect(amountField()).toHaveValue("");
  });

  it("is disabled on a zero balance rather than filling in 0", async () => {
    evm.balance = balanceOf(0n);
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    await waitFor(() => expect(maxButton()).toBeDisabled());
  });

  it("falls back to the balance alone when no ceiling bounds it below that", async () => {
    // An absent limit is skipped, never treated as zero: "we do not know
    // this ceiling" must not present as "you may bridge nothing".
    getRobinhoodLimits.mockResolvedValue(
      fixtures.robinhoodLimitsFixture(() => new Date()),
    );
    evm.balance = balanceOf(1_234n);
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await robinhoodSource(user);

    await waitFor(() => expect(maxButton()).toBeEnabled());
    await user.click(maxButton()!);
    expect(amountField()).toHaveValue("1234");
  });
});
