import { GOLDCOIN_DECIMALS } from "@/lib/config/env";

/**
 * Robinhood Network atomic amounts, and their exact conversion to and from
 * the bridge's canonical accounting unit.
 *
 * A direct mirror of `service/src/amount_conversion/robinhood.rs`, kept as
 * its own module for the same reason the backend does: Robinhood's GLC has
 * **18 decimals**, and at 18 decimals no amount in this app may share a
 * representation with a canonical (8-decimal) one. The backend enforces
 * that with a distinct `RobinhoodAtomic` type; here the equivalent
 * discipline is that every function below is explicitly named for the
 * direction it converts, and none of them is reachable from the generic
 * `./canonical` helpers — which throw outright above 8 decimals rather
 * than silently truncating.
 *
 * ```text
 * SCALE = 10^(18 - 8) = 10^10
 * canonical -> robinhood (widening):  R = C * SCALE          always exact
 * robinhood -> canonical (narrowing): require R % SCALE == 0
 * ```
 *
 * Nothing here rounds, truncates or saturates. Narrowing a value that is
 * not an exact multiple of the scale FAILS — it is never floored. Rounding
 * down would strand the depositor's entitlement to the remainder inside
 * the reserve; rounding up would claim GLC that was never deposited. The
 * custody contract takes the identical position and reverts a deposit
 * whose amount is not a multiple of its own `CANONICAL_SCALE`, so a UI
 * that floored here would simply build a transaction that reverts.
 */

/** Robinhood GLC's token precision. A protocol constant, never read at runtime. */
export const ROBINHOOD_DECIMALS = 18;

/**
 * `10^(18 - 8)`. The custody contract calls this `CANONICAL_SCALE` and
 * enforces `amount % CANONICAL_SCALE == 0` on every deposit
 * (`GlcRobinhoodBridge._requireCanonicalAmount`); the indexer independently
 * re-derives `amount == canonicalAmount * CANONICAL_SCALE` when decoding
 * the resulting event. This is a wire contract with deployed bytecode.
 */
export const CANONICAL_TO_ROBINHOOD_SCALE =
  10n ** BigInt(ROBINHOOD_DECIMALS - GOLDCOIN_DECIMALS);

/** Widening canonical -> Robinhood. Exact for every representable input. */
export function canonicalToRobinhoodRaw(canonical: string): string {
  return (BigInt(canonical) * CANONICAL_TO_ROBINHOOD_SCALE).toString();
}

/**
 * Whether an 18-decimal amount is expressible in canonical units without
 * loss — i.e. whether the contract would accept it. The UI checks this
 * BEFORE opening a wallet, so a user learns their amount has too many
 * decimal places from the form rather than from a reverted transaction.
 */
export function isCanonicalRobinhoodAmount(robinhoodRaw: string): boolean {
  return BigInt(robinhoodRaw) % CANONICAL_TO_ROBINHOOD_SCALE === 0n;
}

/**
 * Narrowing Robinhood -> canonical. Returns `null` — never a rounded
 * value — when the amount is not an exact multiple of the scale.
 */
export function robinhoodRawToCanonicalExact(robinhoodRaw: string): string | null {
  const value = BigInt(robinhoodRaw);
  if (value % CANONICAL_TO_ROBINHOOD_SCALE !== 0n) return null;
  return (value / CANONICAL_TO_ROBINHOOD_SCALE).toString();
}

/**
 * The largest canonical-expressible amount at or below `robinhoodRaw`,
 * for telling a user what their amount would have to be trimmed TO. Used
 * only to build that message — never to alter a submitted amount.
 */
export function largestCanonicalRobinhoodAmountAtMost(robinhoodRaw: string): string {
  const value = BigInt(robinhoodRaw);
  return (
    (value / CANONICAL_TO_ROBINHOOD_SCALE) *
    CANONICAL_TO_ROBINHOOD_SCALE
  ).toString();
}
