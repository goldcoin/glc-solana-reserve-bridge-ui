import { describe, expect, it } from "vitest";
import {
  directionSchema,
  isSettlementRoute,
  routeSchema,
  settlementRouteSchema,
} from "@/lib/api/schemas/common";
import { transferViewSchema } from "@/lib/api/schemas/transfer";
import { explorerEventSchema } from "@/lib/api/schemas/explorer";
import { chainsViewSchema } from "@/lib/api/schemas/chains";
import { happyPathFor, routeDisplay } from "@/lib/bridge";
import * as fixtures from "@/lib/api/mock/fixtures";

/**
 * The route vocabulary, and the defect that made widening it necessary.
 *
 * Before this, the wire enum was exactly `GlcToSol | SolToGlc`. A single
 * `GlcToRhn` row anywhere in `GET /transfers` or `GET /explorer/events`
 * would have failed Zod and taken down the WHOLE page rather than one row
 * — so the UI would have broken the moment a Robinhood route was enabled
 * backend-side, with no frontend deploy involved.
 *
 * Parsing a route is now total over the backend's own enum. It remains
 * completely separate from whether a route may be used, which only
 * `GET /chains` answers.
 */

const ALL_ROUTES = [
  "GlcToSol",
  "SolToGlc",
  "GlcToRhn",
  "RhnToGlc",
  "SolToRhn",
  "RhnToSol",
] as const;

function transfer(direction: string) {
  return {
    id: 42,
    direction,
    state: "Settled",
    gross_amount_atomic: "100000000",
    fee_bps: 300,
    fee_amount_atomic: "3000000",
    net_amount_atomic: "97000000",
    created_at: 1_700_000_000,
    source_txid: null,
    source_confirmations: 0,
    required_source_confirmations: null,
    destination_txid: null,
    failure_reason: null,
    refund: null,
  };
}

describe("routeSchema", () => {
  it("accepts every route the backend can name", () => {
    for (const route of ALL_ROUTES) {
      expect(routeSchema.safeParse(route).success).toBe(true);
    }
  });

  it("still rejects a route outside that enum", () => {
    // Permissive over the backend's vocabulary, not permissive in general:
    // an unknown direction is a contract break worth surfacing.
    expect(routeSchema.safeParse("GlcToXyz").success).toBe(false);
    expect(routeSchema.safeParse("glctosol").success).toBe(false);
  });

  it("is the same vocabulary the response `direction` field uses", () => {
    expect(directionSchema.safeParse("RhnToGlc").success).toBe(true);
  });
});

describe("settlementRouteSchema", () => {
  it("covers exactly the four routes with backend settlement machinery", () => {
    for (const route of ["GlcToSol", "SolToGlc", "GlcToRhn", "RhnToGlc"] as const) {
      expect(settlementRouteSchema.safeParse(route).success).toBe(true);
      expect(isSettlementRoute(route)).toBe(true);
    }
  });

  it("excludes the two structurally non-executable routes", () => {
    // Excluded at the TYPE level so no code path can hand either to an
    // action — mirroring the backend, where neither has a `Direction`
    // value to call a settlement function with.
    for (const route of ["SolToRhn", "RhnToSol"] as const) {
      expect(settlementRouteSchema.safeParse(route).success).toBe(false);
      expect(isSettlementRoute(route)).toBe(false);
    }
  });
});

describe("transferViewSchema", () => {
  it("parses a Robinhood transfer instead of failing the whole response", () => {
    // The defect this fixes: one such row used to reject the entire page.
    expect(transferViewSchema.safeParse(transfer("GlcToRhn")).success).toBe(true);
    expect(transferViewSchema.safeParse(transfer("RhnToGlc")).success).toBe(true);
  });

  it("still rejects a direction the backend could never send", () => {
    expect(transferViewSchema.safeParse(transfer("GlcToXyz")).success).toBe(false);
  });
});

describe("explorerEventSchema", () => {
  it("parses a Robinhood event", () => {
    expect(
      explorerEventSchema.safeParse({
        id: 1,
        request_id: 42,
        direction: "RhnToGlc",
        from_state: "AwaitingDeposit",
        to_state: "Settled",
        at: 1_700_000_000,
        reason: null,
      }).success,
    ).toBe(true);
  });
});

describe("routeDisplay", () => {
  it("names every route, including the two the UI cannot drive", () => {
    // A route with no flow still has to be nameable — that is what lets
    // the UI say clearly that it does not work, instead of omitting it.
    for (const route of ALL_ROUTES) {
      const display = routeDisplay(route);
      expect(display.label.length).toBeGreaterThan(0);
      expect(display.from.chain.id).not.toBe(display.to.chain.id);
    }
  });

  it("gives the Robinhood token its real 18 decimals", () => {
    expect(routeDisplay("RhnToGlc").from.token.decimals).toBe(18);
    expect(routeDisplay("GlcToRhn").to.token.decimals).toBe(18);
  });
});

describe("happyPathFor", () => {
  it("includes a confirmation step only for Goldcoin-sourced routes", () => {
    // A Goldcoin deposit is confirmation-tracked block by block; a
    // contract-sourced one folds straight to SourceFinalized, which is why
    // `required_source_confirmations` is null for those.
    expect(happyPathFor("GlcToSol")).toContain("Confirming");
    expect(happyPathFor("GlcToRhn")).toContain("Confirming");
    expect(happyPathFor("SolToGlc")).not.toContain("Confirming");
    expect(happyPathFor("RhnToGlc")).not.toContain("Confirming");
  });
});

describe("chainsViewSchema", () => {
  it("parses the registry the backend actually serves", () => {
    const parsed = chainsViewSchema.parse(fixtures.chainsFixture(() => new Date()));
    expect(parsed.chains.map((chain) => chain.id)).toEqual([
      "goldcoin",
      "solana",
      "robinhood",
    ]);
    expect(parsed.routes).toHaveLength(6);
  });

  it("carries `implemented` separately from `enabled`", () => {
    const parsed = chainsViewSchema.parse(fixtures.chainsFixture(() => new Date()));
    const byId = new Map(parsed.routes.map((route) => [route.id, route]));
    // Implemented but closed — the machinery exists, the route does not open.
    expect(byId.get("GlcToRhn")).toMatchObject({ implemented: true, enabled: false });
    // Neither implemented nor enabled, and no operator action changes that.
    expect(byId.get("SolToRhn")).toMatchObject({ implemented: false, enabled: false });
  });
});
