"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { env } from "@/lib/config/env";
import { useWalletConnectionBridge } from "./adapter/bridge";
import { fetchSolBalance, fetchTokenBalance } from "./balances";
import { getConnection, isMintConfigured, isWalletConfigured } from "./connection";
import type { WalletBalance, WalletConnection } from "./types";

/**
 * The public wallet API.
 *
 * Everything outside `src/lib/solana` uses these hooks and the types in
 * `./types`. Nothing here returns, accepts, or leaks a wallet-adapter or
 * web3.js value.
 */

export function useWalletConnection(): WalletConnection {
  return useWalletConnectionBridge();
}

export const walletQueryKeys = {
  /**
   * Every balance query for this chain, for invalidating them together
   * after a transaction has moved one. Named rather than sliced off a
   * fuller key by index, which would break silently if a key gained a
   * segment.
   */
  balances: () => ["solana", "balance"] as const,
  solBalance: (address: string | null) => ["solana", "balance", "sol", address] as const,
  tokenBalance: (address: string | null, mint: string | undefined) =>
    ["solana", "balance", "token", address, mint] as const,
} as const;

/** Balances refresh often enough to feel live without hammering a public RPC. */
const BALANCE_POLL_MS = 30_000;

/**
 * SOL balance for the connected wallet.
 *
 * Disabled until a wallet is connected, so no RPC call is made for a user who
 * has not opted in to anything.
 */
export function useSolBalance(): UseQueryResult<WalletBalance> {
  const { address, status } = useWalletConnection();

  return useQuery({
    queryKey: walletQueryKeys.solBalance(address),
    enabled: status === "connected" && Boolean(address),
    refetchInterval: BALANCE_POLL_MS,
    queryFn: async () => {
      const connection = getConnection();
      if (!connection || !address) {
        throw new Error("Solana RPC is not configured");
      }
      return fetchSolBalance(connection, address);
    },
  });
}

/**
 * Canonical Solana GLC (Token-2022) balance for the connected wallet.
 *
 * Only runs when the canonical mint is configured. Without it the UI states
 * the balance is unavailable — it never displays zero, because a zero
 * balance and an unknown balance mean very different things to someone about
 * to bridge.
 */
export function useTokenBalance(): UseQueryResult<WalletBalance> {
  const { address, status } = useWalletConnection();
  const mint = env.reserveMintAddress;

  return useQuery({
    queryKey: walletQueryKeys.tokenBalance(address, mint),
    enabled: status === "connected" && Boolean(address) && isMintConfigured(),
    refetchInterval: BALANCE_POLL_MS,
    queryFn: async () => {
      const connection = getConnection();
      if (!connection || !address || !mint) {
        throw new Error("Solana RPC or the reserve mint is not configured");
      }
      return fetchTokenBalance(connection, address, mint, "GLC");
    },
  });
}

/** Whether a Solana GLC balance can be shown at all in this deployment. */
export function isTokenBalanceAvailable(): boolean {
  return isMintConfigured();
}

export { isWalletConfigured };
