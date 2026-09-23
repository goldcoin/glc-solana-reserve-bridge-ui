import { describe, expect, it } from "vitest";
import {
  executableRouteStatus,
  executableRouteStatuses,
  AVAILABILITY_NOT_PUBLISHED_NOTE,
} from "@/lib/bridge/route-status";
import type { RouteStatusInput } from "@/lib/bridge/route-status";
import * as fixtures from "@/lib/api/mock/fixtures";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import type { RobinhoodReserveDto } from "@/lib/api/schemas/robinhood";
import type { SettlementRoute } from "@/lib/api/schemas/common";

/**
 * Where each route's numbers come from.
 *
 * This is the file that guards the defect the status page actually had:
 * four executable routes settling onto three independent reserve pools, in
 * three different units, described by code shaped around two directions.
 * A wrong answer here is not a crash or a blank — it is a confident,
 * plausible figure attributed to the wrong route, which is the one failure
 * mode a status page cannot afford.
 *
 * So every case below pins a route to the API FIELD its figure came from,
 * not merely to a rendered number: two routes legitimately share the
 * Goldcoin reserve, and a test that only compared displayed values could
 * not tell that sharing apart from an accidental fallback.
 */

const now = () => new Date();

/**
 * Deliberately distinct values in every slot, none of them equal to any
 * other and none of them equal to a fixture default. A figure that leaked
 * from one route to another therefore shows up as the wrong NUMBER, not
 * just as the wrong provenance string.
 */
const GOLDCOIN_CAPACITY = "111100000000"; // 8dp -> 1,111.00
const SOLANA_CAPACITY = "222200000"; // 6dp -> 222.20
const ROBINHOOD_CAPACITY = "333300000000"; // 8dp -> 3,333.00
const GLC_TO_SOL_WINDOW = "444400000"; // 6dp -> 444.40
const SOL_TO_GLC_WINDOW = "555500000"; // 6dp -> 555.50
const OUTBOUND_WINDOW = "666600000000000000000"; // 18dp -> 666.60
const INBOUND_WINDOW = "777700000000000000000"; // 18dp -> 777.70

function robinhoodReserve(): RobinhoodReserveDto {
  const base = fixtures.robinhoodReserveFixture(now, { open: true });
  const outbound = base.onchain.outbound_window!;
  const inbound = base.onchain.inbound_window!;
  return {
    ...base,
    available_capacity_atomic: ROBINHOOD_CAPACITY,
    onchain: {
      ...base.onchain,
      outbound_window: { ...outbound, remaining_atomic: OUTBOUND_WINDOW },
      inbound_window: { ...inbound, remaining_atomic: INBOUND_WINDOW },
    },
  };
}

function input(overrides: Partial<RouteStatusInput> = {}): RouteStatusInput {
  return {
    chains: fixtures.chainsFixture(now, { robinhoodOpen: true }),
    status: {
      ...fixtures.statusFixture(now),
      glc_to_sol_rolling_volume_remaining: GLC_TO_SOL_WINDOW,
      sol_to_glc_rolling_volume_remaining: SOL_TO_GLC_WINDOW,
    },
    reserve: {
      goldcoin_available_capacity: GOLDCOIN_CAPACITY,
      solana_available_capacity: SOLANA_CAPACITY,
    },
    robinhood: robinhoodReserve(),
    limits: fixtures.limitsFixture(),
    stats: fixtures.statsFixture(),
    ...overrides,
  };
}

function statusOf(route: SettlementRoute, overrides: Partial<RouteStatusInput> = {}) {
  return executableRouteStatus(route, input(overrides));
}

describe("each route reads its capacity from its own destination reserve", () => {
  it("pays GlcToSol out of the Solana reserve, at the mint's 6 decimals", () => {
    const card = statusOf("GlcToSol");
    expect(card.capacity).toEqual({
      atomic: SOLANA_CAPACITY,
      decimals: 6,
      source: "GET /reserve · solana_available_capacity",
    });
  });

  it("pays SolToGlc out of the Goldcoin reserve, at Goldcoin's 8", () => {
    const card = statusOf("SolToGlc");
    expect(card.capacity).toEqual({
      atomic: GOLDCOIN_CAPACITY,
      decimals: 8,
      source: "GET /reserve · goldcoin_available_capacity",
    });
  });

  it("pays GlcToRhn out of the Robinhood ledger, at CANONICAL 8 decimals", () => {
    // Not Robinhood's native 18: the ledger column is an INTEGER and the
    // backend keeps this reserve's books in canonical units. Reading it at
    // 18 would understate the reserve by ten orders of magnitude.
    const card = statusOf("GlcToRhn");
    expect(card.capacity).toEqual({
      atomic: ROBINHOOD_CAPACITY,
      decimals: 8,
      source: "GET /robinhood/reserve · available_capacity_atomic",
    });
  });

  it("pays RhnToGlc out of the GOLDCOIN reserve, not the Robinhood one", () => {
    // `Direction::destination_reserve()` names `GoldcoinReserve` for this
    // route: the deposit lands on Robinhood, the payout comes out of
    // Goldcoin. Answering it with the Robinhood ledger's capacity would be
    // the wrong pool entirely.
    const card = statusOf("RhnToGlc");
    expect(card.capacity).toEqual({
      atomic: GOLDCOIN_CAPACITY,
      decimals: 8,
      source: "GET /reserve · goldcoin_available_capacity",
    });
  });
});

describe("no route is answered with another route's figures", () => {
  it("keeps GlcToSol and SolToGlc on different reserves", () => {
    const glcToSol = statusOf("GlcToSol");
    const solToGlc = statusOf("SolToGlc");

    expect(glcToSol.capacity?.atomic).not.toBe(solToGlc.capacity?.atomic);
    expect(glcToSol.capacity?.source).not.toBe(solToGlc.capacity?.source);
    // And in different units — 6 for the Solana mint, 8 for Goldcoin.
    expect(glcToSol.capacity?.decimals).toBe(6);
    expect(solToGlc.capacity?.decimals).toBe(8);
  });

  it("keeps GlcToRhn and RhnToGlc on different reserves", () => {
    const glcToRhn = statusOf("GlcToRhn");
    const rhnToGlc = statusOf("RhnToGlc");

    expect(glcToRhn.capacity?.atomic).toBe(ROBINHOOD_CAPACITY);
    expect(rhnToGlc.capacity?.atomic).toBe(GOLDCOIN_CAPACITY);
    expect(glcToRhn.capacity?.source).not.toBe(rhnToGlc.capacity?.source);
  });

  it("charges each Robinhood route against its own contract LEG's window", () => {
    // A route PAID OUT onto Robinhood is charged against the outbound
    // bucket; one taking a DEPOSIT on Robinhood against the inbound one.
    // Crossing them reports a limit the contract does not apply to that
    // route. Both routes on a leg read the same bucket because the contract
    // holds one accumulator per leg and charges both against it.
    for (const route of ["GlcToRhn", "SolToRhn"] as const) {
      expect(statusOf(route).window).toEqual({
        atomic: OUTBOUND_WINDOW,
        decimals: 18,
        source: "GET /robinhood/reserve · onchain.outbound_window.remaining_atomic",
      });
    }
    for (const route of ["RhnToGlc", "RhnToSol"] as const) {
      expect(statusOf(route).window).toEqual({
        atomic: INBOUND_WINDOW,
        decimals: 18,
        source: "GET /robinhood/reserve · onchain.inbound_window.remaining_atomic",
      });
    }
  });

  it("never gives a Robinhood route the Solana rolling window", () => {
    for (const route of ["GlcToRhn", "RhnToGlc", "SolToRhn", "RhnToSol"] as const) {
      const card = statusOf(route);
      expect(card.window?.atomic).not.toBe(GLC_TO_SOL_WINDOW);
      expect(card.window?.atomic).not.toBe(SOL_TO_GLC_WINDOW);
      expect(card.window?.source).toContain("robinhood");
    }
  });

  it("never gives a Solana route a Robinhood contract window", () => {
    expect(statusOf("GlcToSol").window).toEqual({
      atomic: GLC_TO_SOL_WINDOW,
      decimals: 6,
      source: "GET /status · glc_to_sol_rolling_volume_remaining",
    });
    expect(statusOf("SolToGlc").window).toEqual({
      atomic: SOL_TO_GLC_WINDOW,
      decimals: 6,
      source: "GET /status · sol_to_glc_rolling_volume_remaining",
    });
  });

  it("uses exactly four distinct window figures across the six routes", () => {
    // Four sources, six routes. The two Solana-governed routes each read
    // their own `/status` field; the four Robinhood-legged ones read the
    // contract's two buckets, two routes per bucket. Sharing a bucket is
    // what the contract does, so it is the right answer — and the COUNT is
    // what distinguishes that from a figure leaking across legs.
    const windows = executableRouteStatuses(input()).map((card) => card.window?.atomic);
    expect(windows).toHaveLength(6);
    expect(new Set(windows).size).toBe(4);
  });

  it("uses exactly three distinct capacity sources across the six routes", () => {
    // Three reserve pools, six routes: each pool pays exactly two of them,
    // so each pair shares one figure by design. That is a shared source,
    // not a reused one — and the count is what tells the two apart.
    const sources = executableRouteStatuses(input()).map((card) => card.capacity?.source);
    expect(new Set(sources).size).toBe(3);
  });
});

describe("units are never crossed between networks", () => {
  it("reads the Robinhood ledger at 8 and its contract windows at 18, on one route", () => {
    const card = statusOf("GlcToRhn");
    expect(card.capacity?.decimals).toBe(8);
    expect(card.window?.decimals).toBe(18);
  });

  it("clamps a negative capacity for display without inventing a figure", () => {
    // A capacity below zero is a real diagnostic state the backend reports
    // rather than hides, but "-2 GLC of headroom" is not a sentence a user
    // can act on: it means none.
    const card = statusOf("SolToGlc", {
      reserve: {
        goldcoin_available_capacity: "-500",
        solana_available_capacity: SOLANA_CAPACITY,
      },
    });
    expect(card.capacity?.atomic).toBe("0");
  });
});

describe("availability comes from GET /chains and nothing else", () => {
  it("reports available only when the backend answered available: true", () => {
    for (const route of ["GlcToSol", "SolToGlc", "GlcToRhn", "RhnToGlc"] as const) {
      const card = statusOf(route);
      expect(card.available).toBe(true);
      expect(card.kind).toBe("available");
    }
  });

  it("closes a route the backend reports available: false", () => {
    const card = statusOf("RhnToGlc", {
      chains: fixtures.chainsFixture(now, {
        robinhoodOpen: true,
        robinhoodAvailable: false,
      }),
    });
    expect(card.enabled).toBe(true);
    expect(card.available).toBe(false);
    expect(card.kind).toBe("unavailable");
    expect(card.reason).toBe(fixtures.DIRECTION_UNAVAILABLE_MESSAGE);
  });

  it("never reports an enabled-but-unanswered route as available", () => {
    // A deployment predating backend PR #76 publishes no `available` at
    // all. `enabled: true` is the route gate's verdict over config and
    // adapter capability and reads NO reserve state — treating it as
    // permission is exactly how `RhnToGlc` deposits reached a Goldcoin
    // reserve whose admission was closed.
    const open = fixtures.chainsFixture(now, { robinhoodOpen: true });
    const legacy: ChainsViewDto = {
      ...open,
      routes: open.routes.map((route) => {
        const { available: _a, unavailable_reason: _r, ...rest } = route;
        return rest;
      }),
    };
    const card = statusOf("RhnToGlc", { chains: legacy });

    expect(card.enabled).toBe(true);
    expect(card.available).toBeUndefined();
    expect(card.kind).toBe("unknown");
    expect(card.note).toBe(AVAILABILITY_NOT_PUBLISHED_NOTE);
  });

  it("fails closed when /chains has not answered at all", () => {
    const card = statusOf("GlcToSol", { chains: undefined });
    expect(card.kind).toBe("unknown");
    expect(card.enabled).toBe(false);
    expect(card.available).toBeUndefined();
  });

  it("reports a switched-off route as closed, with the backend's own copy", () => {
    const card = statusOf("GlcToRhn", { chains: fixtures.chainsFixture(now) });
    expect(card.enabled).toBe(false);
    expect(card.kind).toBe("closed");
    expect(card.reason).toBe(fixtures.ROUTE_UNAVAILABLE_MESSAGE);
  });

  it("still refuses when /status contradicts an available route", () => {
    // The two endpoints can disagree for a moment. `/chains` is the
    // authority on whether a transfer may start; `/status` may only make
    // the refusal MORE specific, never turn one into a yes.
    const card = statusOf("GlcToSol", {
      chains: fixtures.chainsFixture(now, { robinhoodOpen: true }),
      status: fixtures.pausedStatusFixture(),
    });
    expect(card.available).toBe(true);
    expect(card.kind).toBe("paused");
  });

  it("downgrades an available Robinhood route whose reserve is paused", () => {
    const reserve = fixtures.robinhoodReserveFixture(now, { open: true, paused: true });
    const card = statusOf("GlcToRhn", { robinhood: reserve });
    expect(card.available).toBe(true);
    expect(card.kind).toBe("paused");
  });

  it("cannot promote a route the registry refused, whatever the reserve says", () => {
    // A healthy, funded, unpaused Robinhood reserve beside a `/chains` that
    // says no. The reserve is not a second opinion.
    const card = statusOf("GlcToRhn", {
      chains: fixtures.chainsFixture(now, {
        robinhoodOpen: true,
        robinhoodAvailable: false,
      }),
      robinhood: robinhoodReserve(),
    });
    expect(card.kind).toBe("unavailable");
  });
});

describe("the route list itself", () => {
  it("covers all six executable routes", () => {
    const routes = executableRouteStatuses(input()).map((card) => card.route);
    expect(routes).toEqual([
      "GlcToSol",
      "SolToGlc",
      "GlcToRhn",
      "RhnToGlc",
      "SolToRhn",
      "RhnToSol",
    ]);
  });

  it("gives the cross routes a card with real figures, not a bare row", () => {
    // They used to be excluded here, because `implemented: false` meant no
    // reserve paid them and no window bounded them — so the Routes list,
    // which states availability and stops, was the only honest place for
    // them. Both now settle, so both get a full card, and every figure on
    // it has to come from the endpoint that owns it.
    for (const route of ["SolToRhn", "RhnToSol"] as const) {
      const card = statusOf(route);
      expect(card.capacity).not.toBeNull();
      expect(card.window).not.toBeNull();
      expect(card.fee).not.toBeNull();
      expect(card.minimum).not.toBeNull();
      expect(card.maximum).not.toBeNull();
    }
  });

  it("drops a route the backend still reports as NOT implemented", () => {
    // Read off the registry, not from this build's list of descriptors.
    const base = fixtures.chainsFixture(now, { robinhoodOpen: true });
    const inert = {
      ...base,
      routes: base.routes.map((route) =>
        route.id === "RhnToSol" ? { ...route, implemented: false } : route,
      ),
    };
    const routes = executableRouteStatuses(input({ chains: inert })).map(
      (card) => card.route,
    );
    expect(routes).not.toContain("RhnToSol");
    expect(routes).toContain("SolToRhn");
  });

  it("still lists this build's routes when /chains is unreachable", () => {
    // Rendering nothing would be worse than rendering six rows that all
    // say "unknown" — and every one of them does say exactly that.
    const cards = executableRouteStatuses(input({ chains: undefined }));
    expect(cards).toHaveLength(6);
    for (const card of cards) expect(card.kind).toBe("unknown");
  });
});

describe("published limits and fees", () => {
  /*
   * The MAXIMUM is the backend's own per-route source limit, and nothing
   * else. It used to be reconstructed from whichever chain ceiling was
   * nearest — the Solana program's `per_transfer_limit` for a
   * Solana-sourced route, the custody contract's `inbound`/`outboundMax`
   * for a Robinhood one, the DESTINATION's ceiling for a Goldcoin-sourced
   * one — and in production that printed 2,000,000 on `GlcToRhn` against a
   * real 20,000, and 20,000 on `SolToGlc` and `SolToRhn` against a real
   * 50,000.
   */
  const EXPECTED_MAXIMUM_ATOMIC: Readonly<Record<SettlementRoute, string>> = {
    GlcToSol: "2000000000000", // 20,000
    SolToGlc: "5000000000000", // 50,000
    GlcToRhn: "2000000000000", // 20,000
    RhnToGlc: "5000000000000", // 50,000
    SolToRhn: "5000000000000", // 50,000
    RhnToSol: "5000000000000", // 50,000
  };

  it("takes each route's MAXIMUM from that route's own /chains entry", () => {
    for (const route of Object.keys(EXPECTED_MAXIMUM_ATOMIC) as SettlementRoute[]) {
      const card = statusOf(route);
      expect(card.maximum?.source).toBe("GET /chains · max_transfer_display");
      // Canonical 8dp, the unit the published figure is denominated in —
      // never the Solana mint's 6 or the custody contract's 18, which is
      // what reading a chain ceiling used to produce.
      expect(card.maximum?.decimals).toBe(8);
      expect(card.maximum?.atomic).toBe(EXPECTED_MAXIMUM_ATOMIC[route]);
    }
  });

  it("gives two routes leaving the SAME chain their own different limits", () => {
    // The property no chain-level ceiling can express, and the exact pair
    // that was wrong in production.
    expect(statusOf("SolToGlc").maximum?.atomic).not.toBe(
      statusOf("GlcToSol").maximum?.atomic,
    );
    expect(statusOf("SolToRhn").maximum?.atomic).toBe(
      statusOf("SolToGlc").maximum?.atomic,
    );
    expect(statusOf("GlcToRhn").maximum?.atomic).not.toBe(
      statusOf("RhnToGlc").maximum?.atomic,
    );
  });

  it("tracks the registry when it republishes a route's limit", () => {
    const base = fixtures.chainsFixture(now, { robinhoodOpen: true });
    const raised = {
      ...base,
      routes: base.routes.map((route) =>
        route.id === "GlcToRhn"
          ? { ...route, max_transfer_display: "12345.50000000" }
          : route,
      ),
    };
    expect(statusOf("GlcToRhn", { chains: raised }).maximum?.atomic).toBe(
      "1234550000000",
    );
    // And only that route moved.
    expect(statusOf("RhnToGlc", { chains: raised }).maximum?.atomic).toBe(
      EXPECTED_MAXIMUM_ATOMIC.RhnToGlc,
    );
  });

  it("does not move when the Solana program's per-transfer limit changes", () => {
    // `GET /limits` is the on-chain `BridgeConfig`, not the limit a user is
    // admitted against. It bounded three cards before this change.
    const limits = { ...fixtures.limitsFixture(), per_transfer_limit: "999000000" };
    for (const route of Object.keys(EXPECTED_MAXIMUM_ATOMIC) as SettlementRoute[]) {
      expect(statusOf(route, { limits }).maximum?.atomic).toBe(
        EXPECTED_MAXIMUM_ATOMIC[route],
      );
    }
  });

  it("gives every route the SAME published minimum, from GET /chains", () => {
    // One policy floor, not a per-chain figure. `GET /limits`'
    // `min_transfer_amount` is deliberately NOT it: that is a NET-side
    // on-chain check, and printing it as a per-transfer floor is the
    // reading that produced "Min 99 GLC".
    const seen = new Set<string>();
    for (const route of ["GlcToSol", "SolToGlc", "GlcToRhn", "RhnToGlc"] as const) {
      const card = statusOf(route);
      expect(card.minimum?.source).toBe("GET /chains · min_transfer_atomic");
      expect(card.minimum?.decimals).toBe(8);
      expect(card.minimum?.atomic).toBe(fixtures.SOURCE_MINIMUM_ATOMIC);
      seen.add(card.minimum?.atomic ?? "missing");
    }
    expect(seen.size).toBe(1);
    // And it is not the Solana program's floor, which the fixture holds
    // as a different number.
    expect(fixtures.SOURCE_MINIMUM_ATOMIC).not.toBe(
      fixtures.limitsFixture().min_transfer_amount,
    );
  });

  it("publishes no maximum for a route the registry states none for", () => {
    // A backend predating `max_transfer_display` omits it. Absent must read
    // as absent — never as zero, and above all never as a chain ceiling
    // reconstructed locally, which is the behaviour this replaced.
    const base = fixtures.chainsFixture(now, { robinhoodOpen: true });
    const silent = {
      ...base,
      routes: base.routes.map(({ max_transfer_display: _omit, ...rest }) => rest),
    };
    for (const card of executableRouteStatuses(input({ chains: silent }))) {
      expect(card.maximum).toBeNull();
      // The published floor is unaffected: it comes from its own field.
      expect(card.minimum?.atomic).toBe(fixtures.SOURCE_MINIMUM_ATOMIC);
    }
  });

  it("publishes no maximum for a figure it cannot parse, rather than a repaired one", () => {
    const base = fixtures.chainsFixture(now, { robinhoodOpen: true });
    const malformed = {
      ...base,
      routes: base.routes.map((route) =>
        route.id === "SolToGlc"
          ? { ...route, max_transfer_display: "not-a-number" }
          : route,
      ),
    };
    expect(statusOf("SolToGlc", { chains: malformed }).maximum).toBeNull();
    expect(statusOf("GlcToSol", { chains: malformed }).maximum?.atomic).toBe(
      EXPECTED_MAXIMUM_ATOMIC.GlcToSol,
    );
  });

  it("prices each route from GET /stats' own per-route table", () => {
    // `route_fees` is the only field that answers per route. The fixture
    // gives the Robinhood pair a DIFFERENT rate from the Solana pair, so a
    // card filled from `bridge_fee_bps` fails here on the number itself
    // rather than only on its provenance.
    const byRoute = Object.fromEntries(
      executableRouteStatuses(input()).map((card) => [card.route, card.fee]),
    );
    expect(byRoute.GlcToSol?.bps).toBe(fixtures.BRIDGE_FEE_BPS);
    expect(byRoute.SolToGlc?.bps).toBe(fixtures.BRIDGE_FEE_BPS);
    expect(byRoute.GlcToRhn?.bps).toBe(fixtures.ROBINHOOD_FEE_BPS);
    expect(byRoute.RhnToGlc?.bps).toBe(fixtures.ROBINHOOD_FEE_BPS);
    for (const route of ["GlcToSol", "GlcToRhn"] as const) {
      expect(byRoute[route]?.source).toBe(`GET /stats · route_fees[${route}].fee_bps`);
    }
  });

  it("shows the backend's own percentage rather than re-deriving one", () => {
    // `fee_percent_display` is formatted by the same helper the operator
    // CLI uses. Re-deriving it here is how the two come to disagree on a
    // rate that does not divide evenly.
    const card = statusOf("GlcToRhn");
    expect(card.fee?.display).toBe("2.50%");
  });

  it("never answers a Robinhood route with the Solana program's fee", () => {
    // `/limits`' `bridge_fee_bps` is documented backend-side as
    // `GlcToSol`'s rate and "must never be displayed as" a Robinhood one.
    // With no per-route table published, three of the four routes have no
    // answer — and report none.
    const cards = executableRouteStatuses(input({ stats: undefined }));
    const byRoute = Object.fromEntries(cards.map((card) => [card.route, card.fee]));
    expect(byRoute.GlcToRhn).toBeNull();
    expect(byRoute.RhnToGlc).toBeNull();
    expect(byRoute.SolToGlc).toBeNull();
    // `GlcToSol` alone may read it, because that is whose rate it is.
    expect(byRoute.GlcToSol?.bps).toBe(fixtures.BRIDGE_FEE_BPS);
    expect(byRoute.GlcToSol?.source).toBe("GET /limits · bridge_fee_bps");
  });

  it("publishes no fee at all when neither endpoint answered", () => {
    for (const card of executableRouteStatuses(
      input({ limits: undefined, stats: undefined }),
    )) {
      expect(card.fee).toBeNull();
    }
  });
});

describe("absent is never zero", () => {
  it("publishes no Robinhood figure on a deployment with no Robinhood reserve", () => {
    const card = statusOf("GlcToRhn", {
      robinhood: fixtures.robinhoodReserveFixture(now, { open: false }),
    });
    expect(card.capacity).toBeNull();
    expect(card.window).toBeNull();
    expect(card.kind).toBe("unknown");
  });

  it("publishes no figure at all when /reserve has not answered", () => {
    const cards = executableRouteStatuses(input({ reserve: undefined }));
    const solToGlc = cards.find((card) => card.route === "SolToGlc");
    expect(solToGlc?.capacity).toBeNull();
  });
});
