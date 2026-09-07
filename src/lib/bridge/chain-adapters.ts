import { validateEvmAddress } from "@/lib/evm";
import { isValidAddress as isValidSolanaAddress } from "@/lib/solana";
import { goldcoinAddressRules } from "./address-rules";
import { descriptorFor, type ChainDescriptor } from "./chain-registry";
import { isReportableAddressProblem, validateGoldcoinAddress } from "./glc-address";

/**
 * Per-network behaviour, in one table.
 *
 * # Why this exists
 *
 * The bridge form renders ONE layout for every network pair. What differs
 * between pairs — how a transfer is funded, what an address on the
 * destination looks like, what the field is called — is looked up here,
 * keyed by chain id. The form asks the adapter; it does not ask which
 * route is selected.
 *
 * That is the difference between a form that scales and one that does not.
 * A `switch (route)` inside the form grows a new arm for every network
 * pair — six today, twelve at four networks — and each arm is a place for
 * one chain's rule to be applied to another chain's address. A table keyed
 * by chain grows one row per NETWORK, and the form never changes.
 *
 * # What an adapter may and may not decide
 *
 * An adapter describes a network: its token's precision, how value leaves
 * it, and whether a string is a valid address on it. It never decides
 * whether a transfer may happen — that is `GET /chains` via
 * `./route-availability`, plus (for the contract-funded sources) the
 * chain's own live preflight.
 */

/**
 * How value leaves a network — the one structural difference between
 * sources, and the reason the form has three submit paths rather than six.
 *
 * - `goldcoin-deposit-address` — the backend creates the request and
 *   returns a per-request address to send to (`POST /transfers`).
 * - `solana-program` / `evm-contract` — no backend create endpoint exists
 *   by design; the user's own wallet calls the chain and the backend's
 *   indexer folds the resulting obligation.
 */
export type FundingKind = "goldcoin-deposit-address" | "solana-program" | "evm-contract";

/** The result of checking a string against one network's address format. */
export interface AddressCheck {
  readonly valid: boolean;
  /** `null` while a field is merely empty — not something to shout about mid-typing. */
  readonly message: string | null;
}

export interface ChainAdapter {
  readonly chain: ChainDescriptor;
  readonly funding: FundingKind;
  /** Field label when this network is the DESTINATION. */
  readonly addressLabel: string;
  readonly addressPlaceholder: string;
  /**
   * Validates an address ON this network. The client-side mirror of what
   * the backend does with `CreateTransferInput::recipient`, which parses
   * the field as the destination chain's own address type and refuses a
   * mismatch outright.
   */
  readonly validateAddress: (value: string) => AddressCheck;
  /**
   * Whether an address on this network is ever entered by hand. Solana
   * destinations are usually filled from the connected wallet, but the
   * field stays editable — this only decides whether the form offers the
   * "use connected wallet" shortcut.
   */
  readonly offersConnectedWalletShortcut: boolean;
}

const EMPTY: AddressCheck = { valid: false, message: null };

function requireDescriptor(chainId: string): ChainDescriptor {
  const descriptor = descriptorFor(chainId);
  // Unreachable: every adapter below is declared for a chain this build
  // describes. Written as a throw rather than a fallback so adding an
  // adapter without a descriptor fails loudly at startup instead of
  // rendering a network with invented properties.
  if (!descriptor) throw new Error(`no chain descriptor for ${chainId}`);
  return descriptor;
}

const goldcoinAdapter: ChainAdapter = {
  chain: requireDescriptor("goldcoin"),
  funding: "goldcoin-deposit-address",
  addressLabel: "Goldcoin destination address",
  addressPlaceholder: "Goldcoin address",
  validateAddress: (value) => {
    const result = validateGoldcoinAddress(value, goldcoinAddressRules());
    return {
      valid: result.valid,
      message: isReportableAddressProblem(result.problem) ? result.message : null,
    };
  },
  offersConnectedWalletShortcut: false,
};

const solanaAdapter: ChainAdapter = {
  chain: requireDescriptor("solana"),
  funding: "solana-program",
  addressLabel: "Solana recipient address",
  addressPlaceholder: "Solana address",
  validateAddress: (value) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return EMPTY;
    return isValidSolanaAddress(trimmed)
      ? { valid: true, message: null }
      : { valid: false, message: "That is not a valid Solana address." };
  },
  offersConnectedWalletShortcut: true,
};

const robinhoodAdapter: ChainAdapter = {
  chain: requireDescriptor("robinhood"),
  funding: "evm-contract",
  addressLabel: "Robinhood Chain recipient address",
  addressPlaceholder: "0x…",
  validateAddress: (value) => {
    const result = validateEvmAddress(value);
    return { valid: result.valid, message: result.message };
  },
  offersConnectedWalletShortcut: false,
};

const ADAPTERS: Readonly<Record<string, ChainAdapter>> = {
  goldcoin: goldcoinAdapter,
  solana: solanaAdapter,
  robinhood: robinhoodAdapter,
};

/**
 * The adapter for a network, or `null` when this build has none.
 *
 * `null` is a real state, not a defect: `GET /chains` can name a network
 * added after this build shipped. Every caller treats a missing adapter as
 * "this build cannot transact on that network" — it never falls back to
 * another network's address rules, which is precisely how a Solana address
 * would end up validated as if it were an EVM one.
 */
export function adapterFor(chainId: string): ChainAdapter | null {
  return ADAPTERS[chainId] ?? null;
}
