import type { Chain, Route, SettlementRoute } from "@/lib/api/schemas/common";
import { isSettlementRoute } from "@/lib/api/schemas/common";
import { ROBINHOOD_DECIMALS } from "./robinhood-amount";

/**
 * The direction model.
 *
 * Each direction names its source and destination chain and the token that
 * moves on each side — the same existing GLC on both, never a synthetic
 * derivative. The bridge form reads from this table rather than branching on
 * the direction at every call site.
 *
 * Minimums, maximums, the fee rate, and reserve capacity are NOT here —
 * those are policy, they change without a frontend deploy, and they come
 * from `GET /limits`, `GET /reserve`, `GET /status`. Decimals ARE here as a
 * display default (Goldcoin's 8 is protocol-fixed; the Solana Token-2022
 * mint's 6 is the published canonical value) — `POST /quote` reports the
 * live decimals actually used for a given amount and is authoritative
 * whenever it disagrees.
 */

export interface ChainDescriptor {
  readonly id: Chain;
  readonly name: string;
}

export interface TokenDescriptor {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

export interface DirectionSide {
  readonly chain: ChainDescriptor;
  readonly token: TokenDescriptor;
}

export interface DirectionDescriptor {
  readonly id: SettlementRoute;
  readonly from: DirectionSide;
  readonly to: DirectionSide;
  readonly label: string;
  /** The reserve this direction draws its payout from (`Direction::destination_reserve()`). */
  readonly destinationReserve: "goldcoin" | "solana" | "robinhood";
  /**
   * How the SOURCE side of this route is funded by the user.
   *
   * - `goldcoin-deposit-address` — the backend creates the request and
   *   returns a per-request Goldcoin address to send to (`POST /transfers`).
   * - `solana-program` / `robinhood-contract` — there is no backend create
   *   endpoint; the user's own wallet calls the chain directly and the
   *   backend's indexer folds the resulting on-chain obligation. This is a
   *   deliberate backend design, not a gap (`service/src/api.rs`).
   */
  readonly funding: "goldcoin-deposit-address" | "solana-program" | "robinhood-contract";
}

const GOLDCOIN: ChainDescriptor = { id: "goldcoin", name: "Goldcoin" };
const SOLANA: ChainDescriptor = { id: "solana", name: "Solana" };
const ROBINHOOD: ChainDescriptor = { id: "robinhood", name: "Robinhood Network" };

/**
 * Token display names, used everywhere a direction is described to a user.
 * "GLC L1" / "GLC on Solana" names the asset by where it already lives,
 * which is the point of a reserve-backed bridge — there is no "native" vs
 * "wrapped" pair to distinguish, just the same GLC on two networks.
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
 * The same GLC again, on Robinhood Network, at that token's own
 * 18 decimals. The precision is a protocol constant asserted against the
 * deployed token at backend preflight, not a live read — see
 * `./robinhood-amount`.
 */
export const ROBINHOOD_GLC: TokenDescriptor = {
  symbol: "GLC",
  name: "GLC on Robinhood",
  decimals: ROBINHOOD_DECIMALS,
};

// The minimum GROSS amount a user may enter/bridge, in either direction,
// is no longer a fixed constant here — a hardcoded "100 GLC" quietly went
// stale when the real bridge fee moved from 1% to 6% (later 3%), since
// it was tuned to that specific rate (100 GLC gross nets to exactly
// 99 GLC at 1%; at 6% it nets to only 94, UNDER the on-chain floor). It
// is now computed at
// use time from `GET /limits`' own `min_transfer_amount`/`bridge_fee_bps`
// — see `minimumGrossCanonicalForMinTransferAmount` in `./canonical` and
// its call site in `BridgeCard.tsx` — so it can never drift out of sync
// with either value again.

/**
 * Descriptors for the four routes that HAVE backend settlement machinery.
 *
 * Being in this table says the UI knows how to render and (for an open
 * route) drive the flow — it says nothing about availability. Both
 * Robinhood routes ship disabled backend-side and stay that way until
 * `GET /chains` reports otherwise; `./route-availability` is the only
 * thing that answers "can this be used". `SolToRhn`/`RhnToSol` are absent
 * by design: they have no settlement machinery on either side, so there
 * is no flow to describe.
 */
export const directions: Record<SettlementRoute, DirectionDescriptor> = {
  GlcToSol: {
    id: "GlcToSol",
    from: { chain: GOLDCOIN, token: GOLDCOIN_GLC },
    to: { chain: SOLANA, token: SOLANA_GLC },
    label: `${GOLDCOIN_GLC.name} → ${SOLANA_GLC.name}`,
    destinationReserve: "solana",
    funding: "goldcoin-deposit-address",
  },
  SolToGlc: {
    id: "SolToGlc",
    from: { chain: SOLANA, token: SOLANA_GLC },
    to: { chain: GOLDCOIN, token: GOLDCOIN_GLC },
    label: `${SOLANA_GLC.name} → ${GOLDCOIN_GLC.name}`,
    destinationReserve: "goldcoin",
    funding: "solana-program",
  },
  GlcToRhn: {
    id: "GlcToRhn",
    from: { chain: GOLDCOIN, token: GOLDCOIN_GLC },
    to: { chain: ROBINHOOD, token: ROBINHOOD_GLC },
    label: `${GOLDCOIN_GLC.name} → ${ROBINHOOD_GLC.name}`,
    destinationReserve: "robinhood",
    funding: "goldcoin-deposit-address",
  },
  RhnToGlc: {
    id: "RhnToGlc",
    from: { chain: ROBINHOOD, token: ROBINHOOD_GLC },
    to: { chain: GOLDCOIN, token: GOLDCOIN_GLC },
    label: `${ROBINHOOD_GLC.name} → ${GOLDCOIN_GLC.name}`,
    destinationReserve: "goldcoin",
    funding: "robinhood-contract",
  },
};

const OPPOSITES: Record<SettlementRoute, SettlementRoute> = {
  GlcToSol: "SolToGlc",
  SolToGlc: "GlcToSol",
  GlcToRhn: "RhnToGlc",
  RhnToGlc: "GlcToRhn",
};

/** The reverse route. Being the reverse of an open route implies nothing about availability. */
export function oppositeDirection(direction: SettlementRoute): SettlementRoute {
  return OPPOSITES[direction];
}

/**
 * Presentation for EVERY route the backend can name, including the two
 * with no settlement machinery.
 *
 * `directions` above covers only routes the UI can drive. This covers the
 * whole wire vocabulary, because a route with no flow still has to be
 * NAMEABLE: `GET /chains` lists all six so a disabled `SolToRhn` can
 * render as visibly unavailable rather than silently missing, and a
 * response could in principle carry any of them.
 *
 * Having a label here is not an implication that a route works. It is the
 * opposite — it is what lets the UI say clearly that one does not.
 */
export interface RouteDisplay {
  readonly from: DirectionSide;
  readonly to: DirectionSide;
  readonly label: string;
}

const NON_SETTLEMENT_DISPLAY: Record<Exclude<Route, SettlementRoute>, RouteDisplay> = {
  SolToRhn: {
    from: { chain: SOLANA, token: SOLANA_GLC },
    to: { chain: ROBINHOOD, token: ROBINHOOD_GLC },
    label: `${SOLANA_GLC.name} → ${ROBINHOOD_GLC.name}`,
  },
  RhnToSol: {
    from: { chain: ROBINHOOD, token: ROBINHOOD_GLC },
    to: { chain: SOLANA, token: SOLANA_GLC },
    label: `${ROBINHOOD_GLC.name} → ${SOLANA_GLC.name}`,
  },
};

export function routeDisplay(route: Route): RouteDisplay {
  if (isSettlementRoute(route)) {
    const descriptor = directions[route];
    return { from: descriptor.from, to: descriptor.to, label: descriptor.label };
  }
  return NON_SETTLEMENT_DISPLAY[route];
}
