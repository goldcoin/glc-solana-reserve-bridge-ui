import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WalletBalances } from "@/features/wallet/WalletBalances";

/**
 * Network-scoped balance display.
 *
 * Balances always come from THIS deployment's configured RPC — on a
 * localnet/devnet deployment a wallet with real mainnet funds correctly
 * reads zero, which is confusing unless the figures are visibly scoped to
 * the connected network. On mainnet the label disappears and the same
 * component shows the wallet's actual balances.
 */

type BalanceData = { raw: string; decimals: number; symbol: string } | undefined;

const { envState, solState, tokenState } = vi.hoisted(() => ({
  envState: {
    solanaCluster: "localnet" as string,
    reserveMintAddress: "GLCzUtuEUJJRBozMrwH3BN5TEy2T7XftGH8TR3yNX5HH",
  },
  solState: {
    isPending: false,
    isError: false,
    data: undefined as { raw: string; decimals: number; symbol: string } | undefined,
  },
  tokenState: {
    isPending: false,
    isError: false,
    data: undefined as { raw: string; decimals: number; symbol: string } | undefined,
  },
}));
void (undefined as BalanceData);
vi.mock("@/lib/config/env", () => ({
  env: envState,
  GOLDCOIN_DECIMALS: 8,
}));
vi.mock("@/lib/solana", () => ({
  useSolBalance: () => solState,
  useTokenBalance: () => tokenState,
  isTokenBalanceAvailable: () => true,
}));

beforeEach(() => {
  envState.solanaCluster = "localnet";
  solState.isPending = false;
  solState.isError = false;
  solState.data = undefined;
  tokenState.isPending = false;
  tokenState.isError = false;
  tokenState.data = undefined;
});

describe("WalletBalances — network scoping", () => {
  it("labels balances with the connected cluster on localnet, with an explanatory tooltip", () => {
    tokenState.data = { raw: "2500000", decimals: 6, symbol: "GLC" };
    solState.data = { raw: "1500000000", decimals: 9, symbol: "SOL" };
    render(<WalletBalances />);

    const label = screen.getByText("Localnet:");
    expect(label).toBeInTheDocument();
    expect(label).toHaveAttribute(
      "title",
      "Balances shown are for the connected bridge network (Localnet), not Solana mainnet.",
    );
    // Real localnet balances render alongside the label.
    expect(screen.getByText(/2\.50/)).toBeInTheDocument();
    expect(screen.getByText(/1\.5/)).toBeInTheDocument();
  });

  it("shows zero localnet balances as scoped zeros, never as a bare empty wallet", () => {
    // The confusing case this exists for: a wallet with real MAINNET funds
    // connected to a localnet deployment genuinely holds zero HERE. The
    // zeros render, but scoped to the network they describe.
    tokenState.data = { raw: "0", decimals: 6, symbol: "GLC" };
    solState.data = { raw: "0", decimals: 9, symbol: "SOL" };
    render(<WalletBalances />);

    expect(screen.getByText("Localnet:")).toBeInTheDocument();
    expect(screen.getAllByText(/GLC/).length).toBeGreaterThan(0);
    expect(screen.getByText("Balance network")).toBeInTheDocument(); // sr-only dt
  });

  it("shows no cluster label on mainnet-beta", () => {
    envState.solanaCluster = "mainnet-beta";
    tokenState.data = { raw: "2500000", decimals: 6, symbol: "GLC" };
    solState.data = { raw: "1500000000", decimals: 9, symbol: "SOL" };
    render(<WalletBalances />);

    expect(
      screen.queryByText(/Localnet|Devnet|Testnet|mainnet/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/2\.50/)).toBeInTheDocument();
  });

  it("labels devnet deployments too", () => {
    envState.solanaCluster = "devnet";
    solState.data = { raw: "0", decimals: 9, symbol: "SOL" };
    render(<WalletBalances />);
    expect(screen.getByText("Devnet:")).toBeInTheDocument();
  });

  it("still renders an unreadable balance as unavailable, never zero, with the label", () => {
    tokenState.isError = true;
    solState.isError = true;
    render(<WalletBalances />);
    expect(screen.getByText("Localnet:")).toBeInTheDocument();
    expect(screen.getByText("— GLC")).toBeInTheDocument();
    expect(screen.getByText("— SOL")).toBeInTheDocument();
  });
});
