import { describe, expect, it } from "vitest";
import { formatBridgeRate, formatBridgeRateSentence } from "@/lib/format/rate";

/**
 * Bridge-rate display.
 *
 * The backend serves the rate as a twelve-place decimal string derived from
 * two integer prices (`BridgeQuoteView.bridge_rate`). This module reduces it
 * to two places for reading, through the same exact BigInt path every amount
 * goes through — never `parseFloat`, and never arithmetic on the rate.
 *
 * The cases below are the six live Phase 2B rates from
 * glc-solana-reserve-bridge `docs/38-elastic-bridge-rate.md`, plus the
 * boundaries where a two-place rule could state something untrue.
 */
describe("formatBridgeRate", () => {
  it("renders the fixed Phase 2A unit rate", () => {
    expect(formatBridgeRate("1.000000000000")).toBe("1.00");
  });

  it.each([
    ["GlcToSol", "3.431197993000", "3.43"],
    ["SolToGlc", "0.291409000000", "0.29"],
    ["GlcToRhn", "4.481632000000", "4.48"],
    ["RhnToGlc", "0.223133000000", "0.22"],
    ["SolToRhn", "1.306250000000", "1.31"],
    ["RhnToSol", "0.765596000000", "0.77"],
  ])("renders the live %s rate as %s -> %s", (_route, rate, expected) => {
    expect(formatBridgeRate(rate)).toBe(expected);
  });

  it("rounds to nearest rather than truncating", () => {
    // Truncation would read 3.43, understating the rate by a hundredth on
    // every figure derived from it.
    expect(formatBridgeRate("3.435000000000")).toBe("3.44");
    expect(formatBridgeRate("3.434999999999")).toBe("3.43");
  });

  it("groups a large rate", () => {
    expect(formatBridgeRate("1234.500000000000")).toBe("1,234.50");
  });

  it("never renders a non-zero rate as zero", () => {
    // Two places is the rule; stating "0.00" for a real rate would read as
    // "this transfer is free", which is the opposite of what a rate below
    // 0.005 means. Below the floor the precision widens to two significant
    // digits — the same two digits of meaning "3.43" carries — and no
    // further than the backend's own precision.
    expect(formatBridgeRate("0.004000000000")).toBe("0.004");
    expect(formatBridgeRate("0.000000123000")).toBe("0.00000012");
    expect(formatBridgeRate("0.000000000001")).toBe("0.000000000001");
    // Rounds at the widened precision too, never truncates.
    expect(formatBridgeRate("0.000000128000")).toBe("0.00000013");
  });

  it("renders a genuinely zero rate at two places", () => {
    // What the backend sends for a destination price of zero, which no
    // quote can carry — it is a display path that must not invent digits.
    expect(formatBridgeRate("0.000000000000")).toBe("0.00");
    expect(formatBridgeRate("0")).toBe("0.00");
  });

  it("returns null for anything it cannot read exactly", () => {
    // Not a fallback: an unreadable rate means this build does not know the
    // rate, and the caller renders nothing rather than a guess.
    expect(formatBridgeRate("")).toBeNull();
    expect(formatBridgeRate("1.0e2")).toBeNull();
    expect(formatBridgeRate("-1.000000000000")).toBeNull();
    expect(formatBridgeRate("abc")).toBeNull();
    expect(formatBridgeRate("1.2.3")).toBeNull();
    expect(formatBridgeRate(`0.${"0".repeat(31)}1`)).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(formatBridgeRate("  3.430000000000  ")).toBe("3.43");
  });
});

describe("formatBridgeRateSentence", () => {
  it("says which way the rate points", () => {
    // A bare "3.43" is ambiguous about direction, and reading it backwards
    // is the difference between a transfer doubling and halving.
    expect(formatBridgeRateSentence("3.431197993000", "Goldcoin", "Solana", "GLC")).toBe(
      "1 GLC on Goldcoin = 3.43 GLC on Solana",
    );
  });

  it("points the other way on the reverse route", () => {
    expect(formatBridgeRateSentence("0.291409000000", "Solana", "Goldcoin", "GLC")).toBe(
      "1 GLC on Solana = 0.29 GLC on Goldcoin",
    );
  });

  it("is null when the rate is unreadable", () => {
    expect(formatBridgeRateSentence("1.0e2", "Goldcoin", "Solana", "GLC")).toBeNull();
  });
});
