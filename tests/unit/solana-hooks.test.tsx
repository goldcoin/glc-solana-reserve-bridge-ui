import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const bridgeConnection = {
  status: "disconnected" as string,
  address: null as string | null,
};

vi.mock("@/lib/solana/adapter/bridge", () => ({
  useWalletConnectionBridge: () => bridgeConnection,
}));

const fetchSolBalance = vi.fn();
const fetchTokenBalance = vi.fn();
vi.mock("@/lib/solana/balances", () => ({
  fetchSolBalance: (...args: unknown[]) => fetchSolBalance(...args),
  fetchTokenBalance: (...args: unknown[]) => fetchTokenBalance(...args),
}));

let connectionConfigured = true;
let mintConfigured = true;
vi.mock("@/lib/solana/connection", () => ({
  getConnection: () => (connectionConfigured ? {} : null),
  isMintConfigured: () => mintConfigured,
  isWalletConfigured: () => connectionConfigured,
}));

import {
  isTokenBalanceAvailable,
  useSolBalance,
  useTokenBalance,
  useWalletConnection,
} from "@/lib/solana/hooks";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  bridgeConnection.status = "disconnected";
  bridgeConnection.address = null;
  connectionConfigured = true;
  mintConfigured = true;
});

describe("useWalletConnection", () => {
  it("delegates directly to the adapter bridge", () => {
    bridgeConnection.status = "connected";
    bridgeConnection.address = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    const { result } = renderHook(() => useWalletConnection());
    expect(result.current).toBe(bridgeConnection);
  });
});

describe("useSolBalance", () => {
  it("does not query when disconnected", () => {
    bridgeConnection.status = "disconnected";
    const { result } = renderHook(() => useSolBalance(), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchSolBalance).not.toHaveBeenCalled();
  });

  it("queries the connection once connected with an address", async () => {
    bridgeConnection.status = "connected";
    bridgeConnection.address = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    fetchSolBalance.mockResolvedValue({ raw: "5000000000", decimals: 9, symbol: "SOL" });

    const { result } = renderHook(() => useSolBalance(), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({
      raw: "5000000000",
      decimals: 9,
      symbol: "SOL",
    });
    expect(fetchSolBalance).toHaveBeenCalledWith(
      {},
      "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    );
  });

  it("throws when the connection is unavailable at query time", async () => {
    connectionConfigured = false;
    bridgeConnection.status = "connected";
    bridgeConnection.address = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

    const { result } = renderHook(() => useSolBalance(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useTokenBalance", () => {
  it("does not query when the mint is not configured", () => {
    mintConfigured = false;
    bridgeConnection.status = "connected";
    bridgeConnection.address = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

    const { result } = renderHook(() => useTokenBalance(), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("queries the canonical mint's balance once connected", async () => {
    bridgeConnection.status = "connected";
    bridgeConnection.address = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    fetchTokenBalance.mockResolvedValue({ raw: "0", decimals: 0, symbol: "GLC" });

    const { result } = renderHook(() => useTokenBalance(), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(fetchTokenBalance).toHaveBeenCalledWith(
      {},
      "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      "GLCzUtuEUJJRBozMrwH3BN5TEy2T7XftGH8TR3yNX5HH",
      "GLC",
    );
  });
});

describe("isTokenBalanceAvailable", () => {
  it("reflects whether the mint is configured", () => {
    mintConfigured = true;
    expect(isTokenBalanceAvailable()).toBe(true);
    mintConfigured = false;
    expect(isTokenBalanceAvailable()).toBe(false);
  });
});
