/**
 * The networks this build knows how to present, and how to describe them.
 *
 * # Scalability is the point of this file
 *
 * Adding a network to the bridge must be: add a descriptor here, and let
 * the backend map its routes. It must NOT be: add a card, add a layout, or
 * touch the bridge form. Nothing below is written against "the three
 * chains" — the registry is a lookup keyed by the backend's own chain id,
 * every consumer iterates it, and the form renders one shape regardless of
 * how many entries exist.
 *
 * # Presentation lives here, availability does not
 *
 * A descriptor says what a network is CALLED and how its addresses and
 * amounts behave. It never says whether the network can be used: that is
 * `GET /chains`' answer alone, resolved per route pair by
 * `./route-resolution` and `./route-availability`. A network can be listed,
 * fully described, and completely unusable — which is exactly the state
 * Robinhood Network ships in.
 *
 * # A chain the backend names but this build does not describe
 *
 * `descriptorFor` returns `null` rather than inventing a descriptor. The
 * selector renders such a chain as present-but-unsupported, so a backend
 * that adds a network ahead of the frontend degrades to "this build cannot
 * use that yet" instead of a crash or, worse, a guess about its address
 * format.
 */

/**
 * The network family, shown as a small secondary label in the selector.
 *
 * Deliberately descriptive rather than technical-exhaustive: it exists so
 * a user can tell at a glance that two networks share an address format
 * and a wallet, which is the practical question when picking one.
 */
export type ChainFamily = "Native Network" | "Solana" | "EVM";

/**
 * GLC as it exists on one network.
 *
 * The same asset throughout — this bridge releases GLC already held in
 * reserve and never mints, burns or wraps — but its atomic precision is a
 * property of the network it sits on, which is why decimals live here and
 * not on a single global token constant.
 */
export interface TokenDescriptor {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

/**
 * Token display names, naming the asset by where it already lives. There
 * is no "native" versus "wrapped" pair to distinguish — that is the point
 * of a reserve-backed bridge.
 */
export const GOLDCOIN_GLC: TokenDescriptor = {
  symbol: "GLC",
  name: "GLC L1",
  decimals: 8,
};

export const SOLANA_GLC: TokenDescriptor = {
  symbol: "GLC",
  name: "GLC on Solana",
  decimals: 6,
};

/**
 * The same GLC again, at Robinhood Chain's own 18 decimals. The precision
 * is a protocol constant asserted against the deployed token at backend
 * preflight, not a live read — see `./robinhood-amount`.
 */
export const ROBINHOOD_GLC: TokenDescriptor = {
  symbol: "GLC",
  name: "GLC on Robinhood",
  decimals: 18,
};

export interface ChainDescriptor {
  /** The backend's own chain id (`Chain::as_str`). The key for everything. */
  readonly id: string;
  /** Human-readable network name. Never parsed. */
  readonly name: string;
  readonly family: ChainFamily;
  /** GLC as it exists on this network — the decimals differ per chain. */
  readonly token: TokenDescriptor;
  /**
   * Tailwind text-colour class for this network's identity mark. Identity
   * only, never status — the same rule `ChainBadge` documents.
   */
  readonly markClassName: string;
}

const GOLDCOIN: ChainDescriptor = {
  id: "goldcoin",
  name: "Goldcoin",
  family: "Native Network",
  token: GOLDCOIN_GLC,
  markClassName: "text-chain-goldcoin",
};

const SOLANA: ChainDescriptor = {
  id: "solana",
  name: "Solana",
  family: "Solana",
  token: SOLANA_GLC,
  markClassName: "text-chain-solana",
};

const ROBINHOOD: ChainDescriptor = {
  id: "robinhood",
  name: "Robinhood Chain",
  family: "EVM",
  token: ROBINHOOD_GLC,
  markClassName: "text-chain-robinhood",
};

/**
 * Every network this build can describe, in presentation order.
 *
 * Order is stable and independent of availability: a network does not move
 * around the list as routes open and close.
 */
export const CHAIN_DESCRIPTORS: readonly ChainDescriptor[] = [
  GOLDCOIN,
  SOLANA,
  ROBINHOOD,
];

const BY_ID = new Map(CHAIN_DESCRIPTORS.map((chain) => [chain.id, chain]));

/** The descriptor for a backend chain id, or `null` if this build has none. */
export function descriptorFor(chainId: string): ChainDescriptor | null {
  return BY_ID.get(chainId) ?? null;
}

/**
 * A usable descriptor for any chain id, real or unknown.
 *
 * An unknown network still has to be nameable — the selector shows it as
 * unsupported rather than omitting it — so this falls back to the raw id
 * with a neutral family and no token assumptions. It is used for DISPLAY
 * only; `descriptorFor` returning `null` is what gates every code path
 * that would need to know the network's real behaviour.
 */
export function displayDescriptorFor(chainId: string): ChainDescriptor {
  return (
    descriptorFor(chainId) ?? {
      id: chainId,
      name: chainId,
      family: "EVM",
      // No token assumption is safe for an unknown network, and none is
      // needed: nothing may transact on a chain with no real descriptor.
      token: { symbol: "GLC", name: "GLC", decimals: 0 },
      markClassName: "text-ink-400",
    }
  );
}
