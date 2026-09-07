"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { numberToHex, type Address, type EIP1193Provider, type Hex } from "viem";
import { evmSendError } from "@/lib/api/errors";
import { fetchRobinhoodGlcBalance, type EvmTokenBalance } from "./balance";
import { isEvmAddress } from "./address";
import { robinhoodDeployment, type RobinhoodDeployment } from "./config";
import {
  subscribeToInjectedWallets,
  type InjectedWallet,
  type InjectedWalletInfo,
} from "./provider";
import {
  depositToRobinhoodReserve,
  type RobinhoodDepositResult,
  type RobinhoodDepositStep,
} from "./deposit";

/**
 * The React surface of the Robinhood (EVM) wallet.
 *
 * The boundary rule this module keeps is the same one `@/lib/solana/send`
 * keeps for the Solana side: components see plain strings, numbers and
 * booleans. No viem client, no provider object and no `Hex` value escapes
 * into `src/features`, so swapping how the chain is reached never reaches
 * the UI.
 *
 * Connection is EXPLICIT and never automatic. There is no eager
 * `eth_requestAccounts` on mount and no reconnect-on-load: an unsolicited
 * wallet prompt from merely opening a bridge page is a pattern users are
 * right to distrust. Accounts are read passively (`eth_accounts`, which
 * prompts nobody) so an already-authorised wallet shows as connected,
 * and the prompt happens only when someone presses connect.
 */

export interface EvmWalletState {
  /** Injected wallets discovered via EIP-6963, or a legacy fallback. */
  readonly wallets: readonly InjectedWalletInfo[];
  readonly hasInjectedWallet: boolean;
  readonly address: Address | null;
  /** The chain the wallet is currently on. Null until known. */
  readonly chainId: number | null;
  readonly connecting: boolean;
  readonly deployment: RobinhoodDeployment | null;
  /** Whether the wallet is on the deployment's chain. False when either is unknown. */
  readonly onExpectedChain: boolean;
  readonly connect: (uuid?: string) => Promise<void>;
  readonly disconnect: () => void;
  /** Asks the wallet to switch to the deployment's chain, adding it if unknown. */
  readonly switchChain: () => Promise<void>;
  /**
   * The selected EIP-1193 provider, for `useRobinhoodDeposit` alone.
   *
   * Deliberately a getter rather than a field so it is never read during
   * render, and deliberately not used anywhere in `src/features` — the
   * provider is the one piece of chain machinery that has to cross from
   * this hook to the deposit hook, and a getter keeps that crossing
   * explicit instead of matching wallets up by index and hoping.
   */
  readonly getProvider: () => EIP1193Provider | null;
}

/** EIP-1193's "user rejected the request". */
const USER_REJECTED = 4001;
/** EIP-1193's "the wallet does not know this chain" — the cue to try adding it. */
const UNRECOGNISED_CHAIN = 4902;

function errorCode(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code?: unknown };
    return typeof code === "number" ? code : null;
  }
  return null;
}

export function useEvmWallet(): EvmWalletState {
  const [wallets, setWallets] = useState<readonly InjectedWallet[]>([]);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  // Held in a ref, not state: the provider is an identity the effects below
  // subscribe to, and re-rendering on it would churn those subscriptions.
  const providerRef = useRef<EIP1193Provider | null>(null);

  const deployment = useMemo(() => robinhoodDeployment(), []);

  useEffect(() => subscribeToInjectedWallets(setWallets), []);

  const selected = useMemo(
    () =>
      wallets.find((wallet) => wallet.info.uuid === selectedUuid) ??
      (wallets.length === 1 ? wallets[0] : null),
    [wallets, selectedUuid],
  );

  // Passive resume: `eth_accounts` returns an already-authorised account
  // without prompting, and returns empty otherwise. This is what makes a
  // page reload keep the connection without ever opening a wallet dialog.
  useEffect(() => {
    const provider = selected?.provider ?? null;
    providerRef.current = provider;
    // No provider means nothing to read and nothing to subscribe to. The
    // stale account/chain are NOT cleared here — clearing them would be a
    // synchronous setState in an effect body, which cascades a render.
    // They are derived away at the return instead: with no selected
    // wallet, the exposed address and chain are null regardless of what
    // the last provider left behind.
    if (!provider) return;

    let cancelled = false;

    const readChain = async () => {
      try {
        const hex = (await provider.request({ method: "eth_chainId" })) as Hex;
        if (!cancelled) setChainId(Number(BigInt(hex)));
      } catch {
        if (!cancelled) setChainId(null);
      }
    };

    const readAccounts = async () => {
      try {
        const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
        const account = accounts[0];
        if (!cancelled) {
          setAddress(account && isEvmAddress(account) ? account : null);
        }
      } catch {
        if (!cancelled) setAddress(null);
      }
    };

    void readChain();
    void readAccounts();

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      const account = accounts?.[0];
      setAddress(account && isEvmAddress(account) ? account : null);
    };
    const onChainChanged = (...args: unknown[]) => {
      const hex = args[0] as Hex | undefined;
      setChainId(hex ? Number(BigInt(hex)) : null);
    };

    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);

    return () => {
      cancelled = true;
      provider.removeListener("accountsChanged", onAccountsChanged);
      provider.removeListener("chainChanged", onChainChanged);
    };
  }, [selected]);

  const connect = useCallback(
    async (uuid?: string) => {
      const target = uuid
        ? (wallets.find((wallet) => wallet.info.uuid === uuid) ?? null)
        : selected;
      if (!target) return;
      setSelectedUuid(target.info.uuid);
      setConnecting(true);
      try {
        const accounts = (await target.provider.request({
          method: "eth_requestAccounts",
        })) as string[];
        const account = accounts[0];
        setAddress(account && isEvmAddress(account) ? account : null);
      } catch (cause) {
        // A user closing the wallet dialog is not an error worth throwing
        // at the page — it is the wallet working as intended.
        if (errorCode(cause) !== USER_REJECTED) throw evmSendError(cause, "approval");
      } finally {
        setConnecting(false);
      }
    },
    [wallets, selected],
  );

  const disconnect = useCallback(() => {
    // EIP-1193 has no disconnect method: a dapp cannot revoke its own
    // authorisation, only forget it locally. Said plainly rather than
    // pretending the wallet was disconnected.
    setSelectedUuid(null);
    setAddress(null);
    setChainId(null);
  }, []);

  const switchChain = useCallback(async () => {
    const provider = providerRef.current;
    if (!provider || !deployment) return;
    const chainIdHex = numberToHex(deployment.chainId);
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
    } catch (cause) {
      if (errorCode(cause) === USER_REJECTED) return;
      if (errorCode(cause) !== UNRECOGNISED_CHAIN) throw cause;
      // The wallet has never heard of this chain. Offer to add it, using
      // only configured values — nothing about the chain is invented here.
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName: deployment.chainName,
            rpcUrls: [deployment.rpcUrl],
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          },
        ],
      });
    }
  }, [deployment]);

  // Derived rather than stored: a wallet that is no longer selected has no
  // address and no chain, whatever the last one read.
  const activeAddress = selected ? address : null;
  const activeChainId = selected ? chainId : null;

  return {
    wallets: useMemo(() => wallets.map((wallet) => wallet.info), [wallets]),
    hasInjectedWallet: wallets.length > 0,
    address: activeAddress,
    chainId: activeChainId,
    connecting,
    deployment,
    onExpectedChain:
      deployment !== null &&
      activeChainId !== null &&
      activeChainId === deployment.chainId,
    connect,
    disconnect,
    switchChain,
    getProvider: () => providerRef.current,
  };
}

export interface RobinhoodDepositParams {
  readonly amountRaw: bigint;
  readonly destination: Hex;
  readonly onStep?: (step: RobinhoodDepositStep) => void;
}

/**
 * The deposit action, bound to whichever injected wallet `useEvmWallet`
 * currently holds. Returns a plain transaction hash string — no viem type
 * crosses back into a component.
 */
export function useRobinhoodDeposit(wallet: EvmWalletState): {
  readonly deposit: (params: RobinhoodDepositParams) => Promise<{ hash: string }>;
} {
  const deposit = useCallback(
    async (params: RobinhoodDepositParams): Promise<{ hash: string }> => {
      const { deployment, address } = wallet;
      if (!deployment) throw new Error("Robinhood Network is not configured");
      if (!address) throw new Error("Wallet is not connected");
      const provider = wallet.getProvider();
      if (!provider) throw new Error("Wallet provider is unavailable");

      const result: RobinhoodDepositResult = await depositToRobinhoodReserve({
        provider,
        deployment,
        account: address,
        amountRaw: params.amountRaw,
        destination: params.destination,
        // Spread rather than passed as `onStep: params.onStep`: under
        // `exactOptionalPropertyTypes`, an absent callback and one
        // explicitly set to `undefined` are different types.
        ...(params.onStep ? { onStep: params.onStep } : {}),
      });
      return { hash: result.hash };
    },
    [wallet],
  );

  return { deposit };
}

/** Balance polling cadence, matching the Solana wallet's. */
const BALANCE_POLL_MS = 30_000;

export const evmWalletQueryKeys = {
  /** Every EVM balance query, for invalidating them together. See `walletQueryKeys.balances`. */
  balances: () => ["evm", "balance"] as const,
  /**
   * Keyed by chain, token and account together.
   *
   * All three matter: switching networks, switching accounts, or a
   * deployment change must each produce a different cache entry, so a
   * balance from one context can never be shown in another. That is the
   * cache-level half of "never retain a balance from the previous chain";
   * the component half is that a non-Robinhood source reads this hook's
   * result not at all.
   */
  glcBalance: (
    deployment: RobinhoodDeployment | null,
    chainId: number | null,
    account: string | null,
  ) =>
    [
      "evm",
      "balance",
      "glc",
      deployment?.chainId ?? null,
      deployment?.tokenAddress ?? null,
      deployment?.rpcUrl ?? null,
      chainId,
      account,
    ] as const,
} as const;

/**
 * The connected EVM wallet's GLC balance.
 *
 * Disabled unless a deployment is configured AND a wallet is connected AND
 * that wallet is on the deployment's chain. Each of those is a real
 * refusal rather than a loading state:
 *
 * - no deployment (today's state everywhere) — there is no token address to
 *   read, so nothing is attempted;
 * - no wallet — there is no account to read a balance FOR, and asking would
 *   mean prompting someone who has not opted in to anything;
 * - wrong chain — a balance read against the wrong network would return a
 *   real number for the wrong asset, which is worse than no number.
 */
export function useRobinhoodGlcBalance(
  wallet: EvmWalletState,
): UseQueryResult<EvmTokenBalance> {
  const { deployment, address, chainId, onExpectedChain } = wallet;

  return useQuery({
    queryKey: evmWalletQueryKeys.glcBalance(deployment, chainId, address),
    enabled: Boolean(deployment) && Boolean(address) && onExpectedChain,
    refetchInterval: BALANCE_POLL_MS,
    // A failed balance read is reported as unavailable rather than retried
    // into a long spinner: the form has a correct answer for "we do not
    // know", and it is better than a stale one.
    retry: false,
    queryFn: async () => {
      if (!deployment || !address) {
        throw new Error("Robinhood Chain is not configured, or no wallet is connected");
      }
      return fetchRobinhoodGlcBalance({ deployment, account: address });
    },
  });
}
