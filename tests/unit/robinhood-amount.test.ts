import { describe, expect, it } from "vitest";
import {
  CANONICAL_TO_ROBINHOOD_SCALE,
  ROBINHOOD_DECIMALS,
  canonicalToRobinhoodRaw,
  isCanonicalRobinhoodAmount,
  largestCanonicalRobinhoodAmountAtMost,
  robinhoodRawToCanonicalExact,
} from "@/lib/bridge/robinhood-amount";

/**
 * Robinhood's GLC is an 18-decimal token; the bridge accounts in
 * Goldcoin's 8. The gap is exactly the reason this module exists, and the
 * rule is that NOTHING rounds: widening is always exact, narrowing either
 * succeeds exactly or fails.
 *
 * The same policy the backend applies in
 * `service/src/amount_conversion/robinhood.rs`, and the same one the
 * custody contract enforces on the way in with
 * `amount % CANONICAL_SCALE == 0`.
 */

describe("scale constants", () => {
  it("is 10^10 — the gap between 18 and 8 decimals", () => {
    expect(ROBINHOOD_DECIMALS).toBe(18);
    expect(CANONICAL_TO_ROBINHOOD_SCALE).toBe(10_000_000_000n);
  });
});

describe("canonicalToRobinhoodRaw", () => {
  it("widens exactly", () => {
    expect(canonicalToRobinhoodRaw("1")).toBe("10000000000");
    // 1 GLC canonical (1e8) becomes 1 GLC at 18 decimals (1e18).
    expect(canonicalToRobinhoodRaw("100000000")).toBe("1000000000000000000");
  });

  it("stays exact far above Number.MAX_SAFE_INTEGER", () => {
    // 20,000 GLC — the per-transfer maximum — is ~2e22 at 18 decimals,
    // six orders of magnitude past what a double represents exactly.
    expect(canonicalToRobinhoodRaw("2000000000000")).toBe("20000000000000000000000");
  });

  it("widens zero to zero", () => {
    expect(canonicalToRobinhoodRaw("0")).toBe("0");
  });
});

describe("isCanonicalRobinhoodAmount", () => {
  it("accepts an amount that is an exact multiple of the scale", () => {
    expect(isCanonicalRobinhoodAmount("1000000000000000000")).toBe(true);
    expect(isCanonicalRobinhoodAmount("10000000000")).toBe(true);
    expect(isCanonicalRobinhoodAmount("0")).toBe(true);
  });

  it("rejects an amount with more precision than the bridge settles", () => {
    // One atomic unit past a clean multiple — the contract would revert
    // with NonCanonicalAmount rather than round it.
    expect(isCanonicalRobinhoodAmount("10000000001")).toBe(false);
    expect(isCanonicalRobinhoodAmount("1")).toBe(false);
  });
});

describe("robinhoodRawToCanonicalExact", () => {
  it("narrows an exact multiple", () => {
    expect(robinhoodRawToCanonicalExact("1000000000000000000")).toBe("100000000");
    expect(robinhoodRawToCanonicalExact("10000000000")).toBe("1");
  });

  it("returns null rather than a rounded value when the amount does not fit", () => {
    // The whole point: a floored value would strand the remainder in the
    // reserve, and a ceiling would claim GLC that was never deposited.
    expect(robinhoodRawToCanonicalExact("10000000001")).toBeNull();
    expect(robinhoodRawToCanonicalExact("9999999999")).toBeNull();
  });

  it("round-trips with the widening direction", () => {
    for (const canonical of ["1", "100000000", "2000000000000", "0"]) {
      expect(robinhoodRawToCanonicalExact(canonicalToRobinhoodRaw(canonical))).toBe(
        canonical,
      );
    }
  });
});

describe("largestCanonicalRobinhoodAmountAtMost", () => {
  it("names the nearest acceptable amount at or below the input", () => {
    expect(largestCanonicalRobinhoodAmountAtMost("10000000001")).toBe("10000000000");
    expect(largestCanonicalRobinhoodAmountAtMost("19999999999")).toBe("10000000000");
  });

  it("leaves an already-acceptable amount alone", () => {
    expect(largestCanonicalRobinhoodAmountAtMost("20000000000")).toBe("20000000000");
  });

  it("is only ever used to build a message, so it floors to zero rather than failing", () => {
    expect(largestCanonicalRobinhoodAmountAtMost("1")).toBe("0");
  });
});
