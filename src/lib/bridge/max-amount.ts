/**
 * The largest amount a user can actually bridge right now.
 *
 * # Why MAX is not "your balance"
 *
 * A MAX button that fills in the wallet balance is a promise the form
 * cannot keep: the amount is then rejected by a per-transfer limit, or by
 * the remaining 24-hour window, or — on Robinhood Chain — by the custody
 * contract's granularity rule, and the user has to work out which. So MAX
 * is the minimum of every bound that is BOTH authoritative and currently
 * known, floored to something the destination can actually settle.
 *
 * # Only real bounds count
 *
 * Every limit here is optional, and an absent one is simply not applied.
 * That matters most for Robinhood-legged routes: `GET /limits` describes
 * the SOLANA program's reserve, so passing it here for a Robinhood source
 * would invent a ceiling that neither chain enforces. The caller passes
 * only limits that govern the route in question, in the SOURCE chain's own
 * base units.
 *
 * # Everything is exact
 *
 * Base-unit integer strings in, base-unit integer string out, `BigInt`
 * throughout. At 18 decimals a balance exceeds `Number.MAX_SAFE_INTEGER`
 * by eleven orders of magnitude, so a single float here would hand someone
 * a MAX amount they do not hold.
 */

export interface MaximumBridgeableInput {
  /** The connected wallet's balance, source-chain base units. */
  readonly balanceRaw: string;
  /**
   * The route's per-transfer maximum, source-chain base units, when the
   * backend publishes one that governs THIS route.
   */
  readonly routeMaximumRaw?: string | null | undefined;
  /**
   * Headroom left in the route's rolling window, source-chain base units,
   * when the backend publishes one that governs THIS route.
   */
  readonly remainingCapacityRaw?: string | null | undefined;
  /**
   * The settlement granularity the destination enforces, in source-chain
   * base units. `1n` (the default) means any amount settles.
   *
   * For a Robinhood source this is 10^10: the custody contract reverts an
   * amount that is not an exact multiple, so a MAX that ignored it would
   * fill in a number guaranteed to fail.
   */
  readonly granularity?: bigint | undefined;
}

/**
 * The maximum, or `null` when there is nothing to offer — an unknown
 * balance, or a result that floors to zero.
 *
 * `null` is what disables the MAX button. A zero MAX is not a usable
 * amount, and a button that fills in `0` and then reports "enter an
 * amount" is worse than one that is plainly unavailable.
 */
export function maximumBridgeableAmount(input: MaximumBridgeableInput): string | null {
  const { balanceRaw, routeMaximumRaw, remainingCapacityRaw, granularity = 1n } = input;

  if (!/^\d+$/.test(balanceRaw)) return null;
  if (granularity <= 0n) throw new Error("granularity must be positive");

  let max = BigInt(balanceRaw);

  // Each bound narrows; none may widen. An absent or malformed bound is
  // skipped rather than treated as zero — "we do not know this limit" must
  // never present as "you may bridge nothing".
  for (const bound of [routeMaximumRaw, remainingCapacityRaw]) {
    if (bound === null || bound === undefined || !/^\d+$/.test(bound)) continue;
    const value = BigInt(bound);
    if (value < max) max = value;
  }

  // Floor, never round: rounding UP would produce an amount above one of
  // the bounds just applied, which is the one direction this function must
  // never move in.
  max = (max / granularity) * granularity;

  return max > 0n ? max.toString() : null;
}
