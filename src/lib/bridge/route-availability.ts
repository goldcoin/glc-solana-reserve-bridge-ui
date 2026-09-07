import type { ChainsViewDto, RouteViewDto } from "@/lib/api/schemas/chains";

/**
 * Route availability, read straight off `GET /chains`.
 *
 * Every function here is a lookup, never a derivation. The backend's
 * `RouteGate` is the single source of truth for whether a route is open
 * (`service/src/routes.rs`), and re-deriving that client-side — from env
 * config, from a hardcoded list, from the presence of a contract address
 * — is precisely the drift this module exists to prevent. If `/chains`
 * has not loaded, the answer is "unknown", never "probably fine".
 *
 * Routes are looked up by the backend's own id STRING rather than by this
 * build's `Route` enum. A route the backend adds later is therefore
 * answerable here — as `unknown`, which fails closed — instead of being a
 * type error at the lookup. `Route` values are strings, so every existing
 * caller is unaffected.
 */

export type RouteAvailability =
  /** `/chains` says this route is open. */
  | { readonly kind: "open"; readonly view: RouteViewDto }
  /** Implemented but closed. `reason` is the backend's own copy. */
  | { readonly kind: "closed"; readonly reason: string; readonly view: RouteViewDto }
  /**
   * Structurally non-executable in this build (`implemented: false`) —
   * `SolToRhn`/`RhnToSol`. Distinct from `closed` because no operator
   * action opens it: there is no settlement machinery behind it at all.
   */
  | {
      readonly kind: "unimplemented";
      readonly reason: string;
      readonly view: RouteViewDto;
    }
  /** `/chains` has not loaded, or does not list this route. Fail closed. */
  | { readonly kind: "unknown"; readonly reason: string; readonly view: null };

/**
 * Fallback copy for the `unknown` case only. Every other message shown to
 * a user comes from the backend's own `disabled_reason`, never from here
 * — a locally-authored "this route is closed" sentence would be a second
 * spelling of a backend decision, free to drift from it.
 */
const UNKNOWN_REASON = "Route availability is unavailable right now.";

/** The backend's copy, or a neutral fallback if it sent none. */
function reasonOf(view: RouteViewDto): string {
  return view.disabled_reason ?? "This route is not available right now.";
}

export function routeAvailability(
  chains: ChainsViewDto | undefined,
  routeId: string,
): RouteAvailability {
  const view = chains?.routes.find((entry) => entry.id === routeId);
  if (!view) return { kind: "unknown", reason: UNKNOWN_REASON, view: null };
  if (!view.implemented) {
    return { kind: "unimplemented", reason: reasonOf(view), view };
  }
  if (!view.enabled) return { kind: "closed", reason: reasonOf(view), view };
  return { kind: "open", view };
}

/** True only for a route `/chains` positively reports as open. */
export function isRouteOpen(chains: ChainsViewDto | undefined, routeId: string): boolean {
  return routeAvailability(chains, routeId).kind === "open";
}

export interface RouteAvailabilitySummary {
  /** Routes `/chains` reports as both implemented and enabled. */
  readonly open: number;
  /** Every route `/chains` listed, open or not. */
  readonly total: number;
}

/**
 * How many of the backend's routes are open right now, for one-line copy
 * like "2 of 6 routes available".
 *
 * Counted from the response itself rather than from any UI-side list, so a
 * route the backend adds later is included with no frontend deploy — the
 * same property `routeAvailability` exists to preserve. `null` when
 * `/chains` has not loaded: a caller must say it does not know yet, never
 * report `0 of 0`.
 */
export function routeAvailabilitySummary(
  chains: ChainsViewDto | undefined,
): RouteAvailabilitySummary | null {
  if (!chains) return null;
  const open = chains.routes.filter(
    (view) => routeAvailability(chains, view.id).kind === "open",
  ).length;
  return { open, total: chains.routes.length };
}
