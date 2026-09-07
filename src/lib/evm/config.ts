import type { Address } from "viem";
import { env } from "@/lib/config/env";

/**
 * The Robinhood Network deployment this build talks to — or, today, the
 * absence of one.
 *
 * # Absent by design, not by oversight
 *
 * The `GlcRobinhoodBridge` custody contract is **not deployed**. Its
 * address, its EIP-155 chain id and its indexer start block are all
 * recorded as unknown in the backend's own
 * `docs/32-robinhood-settlement-phase-f.md`. Every field below is
 * therefore unset in every environment right now, and
 * `robinhoodDepositCapability` refuses with a stated reason rather than
 * offering an action that cannot work.
 *
 * There is no default, no well-known address, and no "probably this
 * chain" fallback anywhere in this module. A guessed chain id signs a
 * transaction for the wrong network; a guessed contract address sends
 * real GLC to something that is not the bridge. Both are unrecoverable,
 * and neither failure is visible until after the user has signed — so
 * unconfigured resolves to disabled, exactly as an unset
 * `NEXT_PUBLIC_RESERVE_PROGRAM_ID` already disables the Solana deposit.
 *
 * # Configured is still not open
 *
 * Resolving a deployment says this UI COULD build a deposit. Whether it
 * may is decided elsewhere and always: by `GET /chains`' `enabled` for
 * the route, and — for anything that actually touches the contract — by
 * the contract's own `isRouteLive`, read live immediately before use.
 * Nothing in this file is an availability signal.
 */

export interface RobinhoodDeployment {
  readonly chainId: number;
  readonly chainName: string;
  readonly rpcUrl: string;
  readonly bridgeAddress: Address;
  readonly tokenAddress: Address;
}

/**
 * The resolved deployment, or `null` when ANY required field is missing.
 *
 * All-or-nothing on purpose: a chain id without a contract address, or a
 * contract without the token it holds, cannot produce a valid deposit, and
 * a partially-configured deployment that looked usable would fail at the
 * wallet instead of at the form.
 */
export function robinhoodDeployment(): RobinhoodDeployment | null {
  const {
    robinhoodChainId,
    robinhoodRpcUrl,
    robinhoodBridgeAddress,
    robinhoodTokenAddress,
  } = env;
  if (
    robinhoodChainId === undefined ||
    robinhoodRpcUrl === undefined ||
    robinhoodBridgeAddress === undefined ||
    robinhoodTokenAddress === undefined
  ) {
    return null;
  }
  return {
    chainId: robinhoodChainId,
    chainName: env.robinhoodChainName ?? "Robinhood Network",
    rpcUrl: robinhoodRpcUrl,
    bridgeAddress: robinhoodBridgeAddress as Address,
    tokenAddress: robinhoodTokenAddress as Address,
  };
}

export function isRobinhoodDeploymentConfigured(): boolean {
  return robinhoodDeployment() !== null;
}

export type RobinhoodDepositReason =
  | "deployment-unconfigured"
  | "no-injected-wallet"
  | "wallet-disconnected"
  | "wrong-chain"
  | "route-not-open"
  | "amount-not-canonical"
  | "destination-invalid";

export interface RobinhoodDepositCapability {
  readonly available: boolean;
  readonly reason: RobinhoodDepositReason | null;
  readonly message: string | null;
}

const AVAILABLE: RobinhoodDepositCapability = {
  available: true,
  reason: null,
  message: null,
};

export interface RobinhoodDepositContext {
  readonly deployment: RobinhoodDeployment | null;
  /** Whether the browser exposes any EIP-1193 provider at all. */
  readonly injectedWalletAvailable: boolean;
  readonly walletConnected: boolean;
  /** The chain the connected wallet is currently on, or null when unknown. */
  readonly connectedChainId: number | null;
  /** `GET /chains`' verdict for `RhnToGlc`. Never re-derived locally. */
  readonly routeOpen: boolean;
  /** Whether the entered amount is an exact multiple of the contract's canonical scale. */
  readonly amountIsCanonical: boolean;
  /** Whether the Goldcoin destination validated and encoded. */
  readonly destinationValid: boolean;
}

/**
 * Every reason a Robinhood deposit cannot be built right now, in the order
 * a user can act on them. Ordering matters: telling someone to switch
 * networks before telling them the route is closed would send them
 * through a wallet prompt for nothing.
 */
export function robinhoodDepositCapability(
  context: RobinhoodDepositContext,
): RobinhoodDepositCapability {
  if (!context.deployment) {
    return {
      available: false,
      reason: "deployment-unconfigured",
      message:
        "Robinhood Network transfers are not configured for this deployment, so this route cannot be used here.",
    };
  }
  if (!context.routeOpen) {
    return {
      available: false,
      reason: "route-not-open",
      message: "This route is not open for transfers right now.",
    };
  }
  if (!context.injectedWalletAvailable) {
    return {
      available: false,
      reason: "no-injected-wallet",
      message:
        "No browser wallet was detected. Install an EVM wallet extension to deposit from Robinhood Network.",
    };
  }
  if (!context.walletConnected) {
    return {
      available: false,
      reason: "wallet-disconnected",
      message: "Connect a Robinhood Network wallet to deposit.",
    };
  }
  if (context.connectedChainId !== context.deployment.chainId) {
    return {
      available: false,
      reason: "wrong-chain",
      message: `Your wallet is on the wrong network. Switch it to ${context.deployment.chainName} to continue.`,
    };
  }
  if (!context.destinationValid) {
    return {
      available: false,
      reason: "destination-invalid",
      message: "Enter a valid Goldcoin destination address.",
    };
  }
  if (!context.amountIsCanonical) {
    return {
      available: false,
      reason: "amount-not-canonical",
      message:
        "That amount has more decimal places than the bridge can settle. The contract rejects it rather than rounding.",
    };
  }
  return AVAILABLE;
}
