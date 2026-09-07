import { describe, expect, it } from "vitest";
import { maximumBridgeableAmount } from "@/lib/bridge/max-amount";
import { CANONICAL_TO_ROBINHOOD_SCALE } from "@/lib/bridge/robinhood-amount";

/**
 * What MAX actually fills in.
 *
 * The property that matters is one-directional: every bound may only
 * narrow the result, and the granularity floor may only move it DOWN.
 * Rounding up — by even one base unit — would fill in an amount above a
 * limit that was just applied, which is precisely the failure a MAX button
 * exists to prevent.
 */

/** 1 GLC at Robinhood Chain's 18 decimals. */
const ONE_GLC_18 = "1000000000000000000";

describe("maximumBridgeableAmount — bounds", () => {
  it("uses the wallet balance when it is the only bound available", () => {
    // The Robinhood case: no published per-transfer limit and no rolling
    // window, so the balance is the whole answer.
    expect(maximumBridgeableAmount({ balanceRaw: "500" })).toBe("500");
  });

  it("takes the route maximum when it is lower than the balance", () => {
    expect(maximumBridgeableAmount({ balanceRaw: "1000", routeMaximumRaw: "400" })).toBe(
      "400",
    );
  });

  it("takes the remaining window when it is the tightest bound", () => {
    expect(
      maximumBridgeableAmount({
        balanceRaw: "1000",
        routeMaximumRaw: "800",
        remainingCapacityRaw: "250",
      }),
    ).toBe("250");
  });

  it("keeps the balance when every other bound is higher", () => {
    expect(
      maximumBridgeableAmount({
        balanceRaw: "100",
        routeMaximumRaw: "800",
        remainingCapacityRaw: "250",
      }),
    ).toBe("100");
  });

  it("skips an absent bound rather than treating it as zero", () => {
    // "We do not know this limit" must never present as "you may bridge
    // nothing" — which is exactly what a null-as-zero would produce for
    // every Robinhood-legged route.
    for (const absent of [null, undefined]) {
      expect(
        maximumBridgeableAmount({
          balanceRaw: "1000",
          routeMaximumRaw: absent,
          remainingCapacityRaw: absent,
        }),
      ).toBe("1000");
    }
  });

  it("skips a malformed bound rather than trusting it", () => {
    expect(
      maximumBridgeableAmount({ balanceRaw: "1000", routeMaximumRaw: "not-a-number" }),
    ).toBe("1000");
  });

  it("returns null for an unusable balance", () => {
    expect(maximumBridgeableAmount({ balanceRaw: "" })).toBeNull();
    expect(maximumBridgeableAmount({ balanceRaw: "1.5" })).toBeNull();
    expect(maximumBridgeableAmount({ balanceRaw: "0" })).toBeNull();
  });

  it("returns null when a bound floors the result to zero", () => {
    // A MAX of zero is not a usable amount, and a button that fills in `0`
    // and then reports "enter an amount" is worse than a disabled one.
    expect(
      maximumBridgeableAmount({ balanceRaw: "1000", remainingCapacityRaw: "0" }),
    ).toBeNull();
  });
});

describe("maximumBridgeableAmount — exactness", () => {
  it("is exact far beyond Number.MAX_SAFE_INTEGER", () => {
    // 12,450.32 GLC at 18 decimals is ~1.245e22 — eleven orders of
    // magnitude past what a double represents exactly.
    const balance = "12450320000000000000000";
    expect(maximumBridgeableAmount({ balanceRaw: balance })).toBe(balance);
  });

  it("compares bounds numerically, not lexicographically", () => {
    // "9" > "10" as strings; 9 < 10 as numbers. A string comparison here
    // would pick the wrong bound.
    expect(
      maximumBridgeableAmount({
        balanceRaw: "9000000000000000000000",
        routeMaximumRaw: "10",
      }),
    ).toBe("10");
  });
});

describe("maximumBridgeableAmount — Robinhood granularity", () => {
  const granularity = CANONICAL_TO_ROBINHOOD_SCALE;

  it("leaves an already-bridgeable balance untouched", () => {
    expect(maximumBridgeableAmount({ balanceRaw: ONE_GLC_18, granularity })).toBe(
      ONE_GLC_18,
    );
  });

  it("rounds dust DOWN to the nearest bridgeable amount", () => {
    // One base unit of dust above 1 GLC. The custody contract reverts a
    // non-canonical amount rather than rounding it, so MAX must land on
    // the boundary at or BELOW the balance.
    const withDust = (BigInt(ONE_GLC_18) + 1n).toString();
    expect(maximumBridgeableAmount({ balanceRaw: withDust, granularity })).toBe(
      ONE_GLC_18,
    );
  });

  it("rounds down from just under the next boundary, never up to it", () => {
    const justUnder = (BigInt(ONE_GLC_18) + granularity - 1n).toString();
    expect(maximumBridgeableAmount({ balanceRaw: justUnder, granularity })).toBe(
      ONE_GLC_18,
    );
  });

  it("returns null when the whole balance is dust", () => {
    // Less than one canonical unit: there is nothing bridgeable to offer.
    expect(
      maximumBridgeableAmount({ balanceRaw: (granularity - 1n).toString(), granularity }),
    ).toBeNull();
  });

  it("applies the floor AFTER the other bounds, so the result clears them all", () => {
    // A limit that is not itself a multiple must not leak through: the
    // result has to be both under the limit and on the boundary.
    const limit = (BigInt(ONE_GLC_18) + granularity + 5n).toString();
    const result = maximumBridgeableAmount({
      balanceRaw: "9000000000000000000000",
      routeMaximumRaw: limit,
      granularity,
    });
    expect(result).toBe((BigInt(ONE_GLC_18) + granularity).toString());
    expect(BigInt(result!) % granularity).toBe(0n);
    expect(BigInt(result!) <= BigInt(limit)).toBe(true);
  });

  it("defaults to no granularity constraint", () => {
    // Every non-Robinhood source settles at its own precision, so a
    // default of 1 must leave the value alone.
    expect(maximumBridgeableAmount({ balanceRaw: "12345" })).toBe("12345");
  });

  it("refuses a nonsensical granularity rather than dividing by zero", () => {
    expect(() => maximumBridgeableAmount({ balanceRaw: "100", granularity: 0n })).toThrow(
      /positive/,
    );
  });
});
