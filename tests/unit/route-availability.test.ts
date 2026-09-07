import { describe, expect, it } from "vitest";
import {
  isRouteOpen,
  routeAvailability,
  ROUTE_PRESENTATION_ORDER,
} from "@/lib/bridge/route-availability";
import { chainsViewSchema } from "@/lib/api/schemas/chains";
import * as fixtures from "@/lib/api/mock/fixtures";

/**
 * `GET /chains` is the ONLY thing in this app that answers "can a user
 * start a transfer this way right now". These tests pin the two properties
 * that make that safe: unknown availability fails CLOSED, and an
 * unimplemented route is distinguishable from a merely closed one without
 * parsing the backend's message.
 */

const chains = () => chainsViewSchema.parse(fixtures.chainsFixture(() => new Date()));
const openChains = () =>
  chainsViewSchema.parse(
    fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true }),
  );

describe("routeAvailability", () => {
  it("reports the two legacy routes as open in the default shipping state", () => {
    expect(routeAvailability(chains(), "GlcToSol").kind).toBe("open");
    expect(routeAvailability(chains(), "SolToGlc").kind).toBe("open");
  });

  it("reports both Robinhood settlement routes as closed, carrying the backend's own reason", () => {
    for (const route of ["GlcToRhn", "RhnToGlc"] as const) {
      const state = routeAvailability(chains(), route);
      expect(state.kind).toBe("closed");
      if (state.kind !== "closed") continue;
      // The copy is the backend's `RouteGateError::UNAVAILABLE_MESSAGE`,
      // passed through rather than re-authored here.
      expect(state.reason).toBe(fixtures.ROUTE_UNAVAILABLE_MESSAGE);
    }
  });

  it("distinguishes structurally non-executable routes from closed ones", () => {
    // `SolToRhn`/`RhnToSol` have no settlement machinery at all — no
    // operator action opens them — which is why "Coming soon" and
    // "temporarily unavailable" must not read the same.
    for (const route of ["SolToRhn", "RhnToSol"] as const) {
      expect(routeAvailability(chains(), route).kind).toBe("unimplemented");
    }
  });

  it("fails closed when /chains has not loaded", () => {
    const state = routeAvailability(undefined, "GlcToSol");
    expect(state.kind).toBe("unknown");
    expect(state.view).toBeNull();
  });

  it("fails closed for a route the response does not list at all", () => {
    const partial = { ...chains(), routes: [] };
    expect(routeAvailability(partial, "GlcToSol").kind).toBe("unknown");
  });

  it("follows the backend when a route opens, with no frontend change", () => {
    expect(routeAvailability(openChains(), "GlcToRhn").kind).toBe("open");
    expect(routeAvailability(openChains(), "RhnToGlc").kind).toBe("open");
    // Opening the two implemented routes does NOT open the inert pair.
    expect(routeAvailability(openChains(), "SolToRhn").kind).toBe("unimplemented");
  });
});

describe("isRouteOpen", () => {
  it("is true only for a positively-reported open route", () => {
    expect(isRouteOpen(chains(), "GlcToSol")).toBe(true);
    expect(isRouteOpen(chains(), "GlcToRhn")).toBe(false);
    expect(isRouteOpen(undefined, "GlcToSol")).toBe(false);
  });
});

describe("ROUTE_PRESENTATION_ORDER", () => {
  it("covers every route the backend can name, so none is silently missing from the UI", () => {
    expect([...ROUTE_PRESENTATION_ORDER].sort()).toEqual(
      chains()
        .routes.map((route) => route.id)
        .sort(),
    );
  });
});
