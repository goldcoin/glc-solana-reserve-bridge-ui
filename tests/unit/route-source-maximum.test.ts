import { describe, expect, it } from "vitest";
import { ROBINHOOD_DECIMALS, routeSourceMaximum } from "@/lib/bridge";
import { chainsViewSchema } from "@/lib/api/schemas/chains";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import * as fixtures from "@/lib/api/mock/fixtures";
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";

/**
 * The source-side maximum, as the UI resolves it.
 *
 * # The rule this file pins
 *
 * ONE figure per route, published by the backend as `GET /chains`'
 * `max_transfer_display` and rendered without adjustment — the limit a
 * transfer is ADMITTED against, which is a different quantity from any
 * chain's on-chain ceiling.
 *
 * # What it is guarding against
 *
 * The UI used to choose a ceiling per route from a static chain-pair
 * table: the Solana program's `per_transfer_limit` where it said the
 * program bound the route, `GlcRobinhoodBridge`'s `inboundMax` /
 * `outboundMax` where it said the contract did, and — for a
 * Goldcoin-sourced route, which has no source ceiling at all — whichever
 * ceiling bounded the DESTINATION payout.
 *
 * Every one of those is a real on-chain limit and none of them is the
 * limit a user is held to, so three of the six routes were wrong in
 * production at once: `SolToGlc` and `SolToRhn` shown 20,000 against a
 * real 50,000, and `GlcToRhn` shown the contract's 2,000,000 against a
 * real 20,000. It could not have been right in general either — a
 * per-transfer maximum is not a property of a chain, and two routes
 * leaving the same chain carry different limits.
 *
 * This is the same correction `routeSourceMinimum` already had, and these
 * tests are deliberately its mirror: the rounding is the one place the two
 * differ, and they differ in opposite directions.
 *
 * Nothing here writes a limit as a literal — every expectation derives
 * from the fixture, so a policy change reaches the screen with no UI
 * release.
 */

const OPEN = () =>
  chainsViewSchema.parse(
    fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true }),
  );

/** Canonical 8dp units for a whole number of GLC. */
function glc8(whole: bigint): string {
  return (whole * 10n ** BigInt(GOLDCOIN_DECIMALS)).toString();
}

/** 18dp Robinhood units for a whole number of GLC. */
function glc18(whole: bigint): string {
  return (whole * 10n ** BigInt(ROBINHOOD_DECIMALS)).toString();
}

/** Every route, as the (source, destination) chain pair it joins. */
const EVERY_ROUTE = [
  ["GlcToSol", "goldcoin", "solana"],
  ["SolToGlc", "solana", "goldcoin"],
  ["GlcToRhn", "goldcoin", "robinhood"],
  ["RhnToGlc", "robinhood", "goldcoin"],
  ["SolToRhn", "solana", "robinhood"],
  ["RhnToSol", "robinhood", "solana"],
] as const;

type RouteId = (typeof EVERY_ROUTE)[number][0];

/** `routeSourceMaximum` for one named route, looked up by its pair. */
function maximumFor(
  chains: ChainsViewDto | undefined,
  route: RouteId,
  decimals: number,
): string | undefined {
  const pair = EVERY_ROUTE.find(([id]) => id === route);
  if (!pair) throw new Error(`unknown route ${route}`);
  return routeSourceMaximum(chains, pair[1], pair[2], decimals);
}

/** The whole GLC the fixture publishes for one route. */
function publishedWhole(route: RouteId): bigint {
  const [whole = "0"] = fixtures.ROUTE_MAX_TRANSFER_DISPLAY[route].split(".");
  return BigInt(whole);
}

describe("routeSourceMaximum — one figure per route", () => {
  it("gives every route the maximum published for THAT route", () => {
    const chains = OPEN();
    for (const [route] of EVERY_ROUTE) {
      expect(maximumFor(chains, route, GOLDCOIN_DECIMALS)).toBe(
        glc8(publishedWhole(route)),
      );
    }
  });

  it("gives two routes leaving the SAME chain their own different limits", () => {
    // The property no chain-level ceiling can express, and the exact pair
    // that was wrong in production.
    const chains = OPEN();
    expect(maximumFor(chains, "SolToGlc", GOLDCOIN_DECIMALS)).not.toBe(
      maximumFor(chains, "GlcToSol", GOLDCOIN_DECIMALS),
    );
    expect(maximumFor(chains, "GlcToRhn", GOLDCOIN_DECIMALS)).not.toBe(
      maximumFor(chains, "RhnToGlc", GOLDCOIN_DECIMALS),
    );
  });

  it("is the backend's figure, not one derived from any chain ceiling", () => {
    // The Solana program's `per_transfer_limit` and the custody contract's
    // inbound/outbound maxima are both in the fixtures. Neither may leak
    // into this answer, on any route.
    const chains = OPEN();
    const solanaCeiling = fixtures.limitsFixture().per_transfer_limit;
    const contract = fixtures.robinhoodLimitsFixture(() => new Date(), { open: true });
    for (const [route] of EVERY_ROUTE) {
      const resolved = maximumFor(chains, route, GOLDCOIN_DECIMALS);
      expect(resolved).not.toBe(solanaCeiling);
      expect(resolved).not.toBe(contract.inbound_max_atomic);
      expect(resolved).not.toBe(contract.outbound_max_atomic);
    }
  });

  it("does not move when a chain's own ceiling moves", () => {
    // The chain ceilings live in different responses entirely, so this is
    // structural rather than incidental: nothing this function reads can
    // carry them.
    const chains = OPEN();
    const before = EVERY_ROUTE.map(([route]) =>
      maximumFor(chains, route, GOLDCOIN_DECIMALS),
    );
    const after = EVERY_ROUTE.map(([route]) =>
      maximumFor(OPEN(), route, GOLDCOIN_DECIMALS),
    );
    expect(after).toEqual(before);
  });
});

describe("routeSourceMaximum — units", () => {
  it("widens exactly to Robinhood's 18 decimals", () => {
    expect(maximumFor(OPEN(), "RhnToGlc", ROBINHOOD_DECIMALS)).toBe(
      glc18(publishedWhole("RhnToGlc")),
    );
  });

  it("passes canonical through unchanged for a Goldcoin source", () => {
    expect(maximumFor(OPEN(), "GlcToSol", GOLDCOIN_DECIMALS)).toBe(
      glc8(publishedWhole("GlcToSol")),
    );
  });

  it("FLOORS when narrowing, so a rounded ceiling is never above the backend's", () => {
    // The mirror of the minimum's ceil. A ceiling that is not
    // representable at the source chain's coarser precision must round
    // DOWN — rounding up would offer an amount the backend refuses, which
    // is the one direction a maximum may never move.
    const chains = OPEN();
    const withRemainder: ChainsViewDto = {
      ...chains,
      routes: chains.routes.map((r) =>
        r.id === "SolToGlc" ? { ...r, max_transfer_display: "50000.00000009" } : r,
      ),
    };
    // 6-decimal mint precision: 50000.00000009 -> 50000.000000, not
    // 50000.000001.
    expect(maximumFor(withRemainder, "SolToGlc", 6)).toBe("50000000000");
  });
});

describe("routeSourceMaximum — unknown stays unknown", () => {
  it("is undefined while GET /chains is still in flight", () => {
    expect(maximumFor(undefined, "GlcToSol", GOLDCOIN_DECIMALS)).toBeUndefined();
  });

  it("is undefined for a route the response does not carry", () => {
    const chains = OPEN();
    const without: ChainsViewDto = {
      ...chains,
      routes: chains.routes.filter((r) => r.id !== "GlcToRhn"),
    };
    expect(maximumFor(without, "GlcToRhn", GOLDCOIN_DECIMALS)).toBeUndefined();
    // The other routes are unaffected.
    expect(maximumFor(without, "GlcToSol", GOLDCOIN_DECIMALS)).toBe(
      glc8(publishedWhole("GlcToSol")),
    );
  });

  it("is undefined for a pair no route joins", () => {
    expect(
      routeSourceMaximum(OPEN(), "solana", "solana", GOLDCOIN_DECIMALS),
    ).toBeUndefined();
  });

  /**
   * A backend predating the field omits it. That must read as "not
   * published" and leave the maximum absent — never as `0`, which would
   * say the route takes nothing, and above all never as a chain ceiling
   * reconstructed locally, which is exactly what this replaced. It is also
   * what lets the two repos deploy in either order.
   */
  it("is undefined on a backend that does not publish the field", () => {
    const chains = OPEN();
    const older = chainsViewSchema.parse({
      ...chains,
      routes: chains.routes.map((r) => {
        const { max_transfer_display, ...rest } = r;
        void max_transfer_display;
        return rest;
      }),
    });
    for (const [route] of EVERY_ROUTE) {
      expect(maximumFor(older, route, GOLDCOIN_DECIMALS)).toBeUndefined();
    }
  });

  it("is undefined for a figure that does not parse, rather than a repaired one", () => {
    const chains = OPEN();
    const malformed: ChainsViewDto = {
      ...chains,
      routes: chains.routes.map((r) =>
        r.id === "SolToGlc" ? { ...r, max_transfer_display: "fifty thousand" } : r,
      ),
    };
    expect(maximumFor(malformed, "SolToGlc", GOLDCOIN_DECIMALS)).toBeUndefined();
    expect(maximumFor(malformed, "GlcToSol", GOLDCOIN_DECIMALS)).toBe(
      glc8(publishedWhole("GlcToSol")),
    );
  });
});
