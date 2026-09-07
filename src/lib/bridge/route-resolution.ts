import type { Route } from "@/lib/api/schemas/common";
import { routeSchema } from "@/lib/api/schemas/common";

/**
 * The ONE place a (source, destination) network pair becomes a backend
 * route.
 *
 * # Why this is a single function and a single table
 *
 * The UI is network-first: a user picks two networks, never a route name.
 * That mapping is the seam where a presentation choice turns into a claim
 * about what the backend will do with someone's money, so it exists
 * exactly once. Every consumer — the form, the CTA, the summary, the
 * availability lookup — calls this and nothing else. There is no second
 * derivation to drift from it.
 *
 * # Failing closed is the whole design
 *
 * Three outcomes, and only one of them names a route:
 *
 * - a defined pair resolves to its route;
 * - a same-chain pair is refused (this bridge moves GLC BETWEEN networks;
 *   there is no self-route, and silently treating one as a no-op would be
 *   a transfer that takes a fee for nothing);
 * - anything else — including a pair involving a network this build has
 *   never heard of — is `undefined-pair`.
 *
 * `undefined-pair` NEVER falls back to a working route. That is the one
 * mistake in this file that could send funds to the wrong network: a pair
 * defaulting to, say, `GlcToSol` would take a Robinhood-bound deposit and
 * pay it out on Solana. So there is no default arm, no `??`, and no
 * "closest match" — an unrecognised pair yields no route, and every caller
 * treats the absence of a route as unusable.
 *
 * # Adding a network
 *
 * Add its rows to `ROUTE_TABLE`. Nothing else in the UI changes: the
 * selector already iterates the chain registry, the form already renders
 * one shape, and availability already comes from `GET /chains`. Resolving
 * a route here still says NOTHING about whether it may be used — both
 * Robinhood routes resolve today and both are closed.
 */

/** `sourceChainId -> destinationChainId -> route`. */
type RouteTable = Readonly<Record<string, Readonly<Record<string, Route>>>>;

/**
 * The complete pair→route mapping, mirroring the backend's `Route` enum
 * (`service/src/routes.rs`) exactly — every route it defines appears here,
 * including the two with no settlement machinery, because the UI must be
 * able to NAME an unusable route in order to explain it.
 */
const ROUTE_TABLE: RouteTable = {
  goldcoin: { solana: "GlcToSol", robinhood: "GlcToRhn" },
  solana: { goldcoin: "SolToGlc", robinhood: "SolToRhn" },
  robinhood: { goldcoin: "RhnToGlc", solana: "RhnToSol" },
};

export type RouteResolution =
  /** This pair is a route the backend defines. Not a claim that it is open. */
  | { readonly kind: "route"; readonly route: Route }
  /** Source and destination are the same network. */
  | { readonly kind: "same-chain" }
  /** No route exists for this pair, or a network in it is unknown here. */
  | { readonly kind: "undefined-pair" };

export function resolveRoute(
  sourceChainId: string,
  destinationChainId: string,
): RouteResolution {
  if (sourceChainId === destinationChainId) return { kind: "same-chain" };
  const route = ROUTE_TABLE[sourceChainId]?.[destinationChainId];
  if (route === undefined) return { kind: "undefined-pair" };
  // Belt and braces: the table is typed to `Route`, and this re-parses it
  // against the wire enum so a typo here cannot produce a route name the
  // backend has never heard of.
  const parsed = routeSchema.safeParse(route);
  return parsed.success
    ? { kind: "route", route: parsed.data }
    : { kind: "undefined-pair" };
}

/** The route for a pair, or `null`. The narrow form, for callers that only need that. */
export function routeForPair(
  sourceChainId: string,
  destinationChainId: string,
): Route | null {
  const resolution = resolveRoute(sourceChainId, destinationChainId);
  return resolution.kind === "route" ? resolution.route : null;
}

/**
 * Whether a pair is STRUCTURALLY defined — i.e. the reverse of a route
 * exists at all.
 *
 * Used by the direction switch, which must not offer to flip into a pair
 * that no route describes. Structurally defined is not available: the
 * reverse of an open route is very often a closed one.
 */
export function isDefinedPair(
  sourceChainId: string,
  destinationChainId: string,
): boolean {
  return resolveRoute(sourceChainId, destinationChainId).kind === "route";
}

/**
 * The destination networks that form a defined route from `sourceChainId`.
 * Drives which options the destination selector can offer.
 */
export function destinationsFor(sourceChainId: string): readonly string[] {
  return Object.keys(ROUTE_TABLE[sourceChainId] ?? {});
}

/** Every source network with at least one defined outbound route. */
export function sourceChainIds(): readonly string[] {
  return Object.keys(ROUTE_TABLE);
}
