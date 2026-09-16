import { DISPLAY_FRACTION_DIGITS, formatBaseUnits } from "./amount";

/**
 * Bridge-rate formatting.
 *
 * The backend serves the bridge rate as a decimal string with twelve places
 * (`BridgeQuoteView.bridge_rate`, e.g. `"3.430000000000"`), rendered from two
 * integer prices by integer arithmetic. Twelve places is an audit figure, not
 * a reading figure: a user comparing `3.430000000000` against `0.291208743591`
 * is counting zeros to find the magnitude. Two places is what they came for.
 *
 * The reduction here is the same exact BigInt path every amount goes through
 * (`formatBaseUnits`) — the rate string is read as base units at its own
 * precision, never through `parseFloat`. The value itself is never modified:
 * callers keep the backend's full-precision string, and nothing in this
 * application performs arithmetic on a rate at all.
 */

/** A non-negative fixed-point decimal, which is all the backend ever sends. */
const RATE_PATTERN = /^\d+(\.\d+)?$/;

/**
 * The bridge rate at two decimal places, or `null` for a string this cannot
 * read exactly.
 *
 * `null` rather than a fallback: a rate is a figure a user judges a transfer
 * by, and an unparseable one means this UI does not know the rate. Callers
 * render an em dash. That is recoverable; a guessed rate is not.
 *
 * # The zero guard
 *
 * Two places is the rule, with one exception it exists to prevent: a real,
 * non-zero rate small enough to round to `0.00` would read as "this transfer
 * is free", which is the opposite of what a rate below 0.005 means. In that
 * one case the precision widens — never beyond what the backend actually sent
 * — to the first two SIGNIFICANT digits, so the figure carries the same two
 * digits of meaning `3.43` does rather than the bare one `0.0000001` would.
 * A rate that IS zero still renders `0.00`, because that is true.
 */
export function formatBridgeRate(rate: string): string | null {
  const trimmed = rate.trim();
  if (!RATE_PATTERN.test(trimmed)) return null;

  const [whole = "", fraction = ""] = trimmed.split(".");
  const units = `${whole}${fraction}`;
  const decimals = fraction.length;
  if (decimals > 30) return null;

  const standard = format(units, decimals, DISPLAY_FRACTION_DIGITS);
  if (standard === null) return null;
  if (!isZero(standard)) return standard;

  // Below the two-place floor. Widen to the first place that shows a digit,
  // then one further for a second significant one — stopping at whatever
  // precision the backend actually sent, which is the most this can honestly
  // claim.
  for (let digits = DISPLAY_FRACTION_DIGITS + 1; digits <= decimals; digits += 1) {
    const formatted = format(units, decimals, digits);
    if (formatted === null) return null;
    if (isZero(formatted)) continue;
    if (digits === decimals) return formatted;
    return format(units, decimals, digits + 1) ?? formatted;
  }
  // A rate that really is zero.
  return standard;
}

function format(units: string, decimals: number, digits: number): string | null {
  try {
    return formatBaseUnits(units, decimals, {
      minFractionDigits: Math.min(DISPLAY_FRACTION_DIGITS, digits),
      maxFractionDigits: digits,
      rounding: "nearest",
      grouping: true,
    });
  } catch {
    return null;
  }
}

/** Whether a formatted figure is all zeros — `"0"`, `"0.00"`, `"0.0000"`. */
function isZero(formatted: string): boolean {
  return /^0(\.0+)?$/.test(formatted);
}

/**
 * The rate as the sentence a user can act on: "1 GLC on Goldcoin = 3.43 GLC
 * on Solana".
 *
 * A bare `3.43` is ambiguous about which way it points, and getting that
 * backwards is the difference between a transfer doubling and halving. The
 * networks are named rather than the assets, because both sides of every
 * route are GLC — the thing that differs is which chain it is GLC on.
 */
export function formatBridgeRateSentence(
  rate: string,
  sourceNetwork: string,
  destinationNetwork: string,
  symbol: string,
): string | null {
  const formatted = formatBridgeRate(rate);
  if (formatted === null) return null;
  return `1 ${symbol} on ${sourceNetwork} = ${formatted} ${symbol} on ${destinationNetwork}`;
}
