"use client";

import {
  isTokenBalanceAvailable,
  useTokenBalance,
  useWalletConnection,
} from "@/lib/solana";
import { useRobinhoodGlcBalance, type EvmWalletState } from "@/lib/evm";

/**
 * The connected wallet's spendable GLC on the SOURCE network.
 *
 * # Why the states are this granular
 *
 * "No balance" has several causes and they are not interchangeable. A
 * balance that failed to load must never render as `0`: zero means "you
 * hold none", and someone about to press MAX needs those told apart. So
 * every non-numeric outcome has its own state and its own rendering, and
 * nothing here ever substitutes a number it does not have.
 *
 * # Per-chain dispatch, in one place
 *
 * Both underlying hooks are called unconditionally — React requires that —
 * and each is already disabled unless its own preconditions hold, so no
 * request is made for a chain that is not selected. The selection below is
 * what guarantees a Solana balance can never be shown while Robinhood
 * Chain is the source, or the reverse: the other chain's result is simply
 * not read.
 */

export type SourceBalanceState =
  /** This build has no balance source for the source network. Render nothing. */
  | { readonly kind: "unsupported" }
  /** A source exists, but no wallet is connected to read it from. */
  | { readonly kind: "disconnected" }
  | { readonly kind: "loading" }
  /** A read was attempted and did not produce a trustworthy figure. */
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "known";
      /** Integer string of source-chain base units. Never a float. */
      readonly raw: string;
      readonly decimals: number;
      readonly symbol: string;
    };

export function useSourceBalance(
  sourceChainId: string,
  evmWallet: EvmWalletState,
): SourceBalanceState {
  const solanaWallet = useWalletConnection();
  const solanaBalance = useTokenBalance();
  const robinhoodBalance = useRobinhoodGlcBalance(evmWallet);

  switch (sourceChainId) {
    case "solana": {
      if (solanaWallet.status !== "connected" || !solanaWallet.address) {
        return { kind: "disconnected" };
      }
      // Without the canonical mint there is nothing to read a balance OF.
      if (!isTokenBalanceAvailable()) return { kind: "unavailable" };
      if (solanaBalance.isPending) return { kind: "loading" };
      if (solanaBalance.isError) return { kind: "unavailable" };
      return { kind: "known", ...solanaBalance.data };
    }

    case "robinhood": {
      // No deployment means no token address, so no read is attempted at
      // all. The form's own capability message already explains that this
      // build cannot reach the network; a second "balance unavailable"
      // line would only repeat it.
      if (!evmWallet.deployment) return { kind: "unsupported" };
      if (!evmWallet.address) return { kind: "disconnected" };
      // A balance read against the wrong network returns a real number for
      // the wrong asset — worse than no number.
      if (!evmWallet.onExpectedChain) return { kind: "unavailable" };
      if (robinhoodBalance.isPending) return { kind: "loading" };
      if (robinhoodBalance.isError) return { kind: "unavailable" };
      return { kind: "known", ...robinhoodBalance.data };
    }

    // Goldcoin, and any network this build does not describe.
    //
    // There is no connected Goldcoin wallet in this app and no native
    // balance source, so no balance is shown. It is deliberately NOT
    // derived from bridge reserve statistics: the reserve is the bridge's
    // own holdings, not the user's, and presenting one as the other would
    // be the most misleading number this form could display.
    default:
      return { kind: "unsupported" };
  }
}
