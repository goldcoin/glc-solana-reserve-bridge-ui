import type { ChainsViewDto, RouteViewDto } from "@/lib/api/schemas/chains";
import type { Route } from "@/lib/api/schemas/common";

/**
 * Route availability, read straight off `GET /chains`.
 *
 * Every function here is a lookup, never a derivation. The backend's
 * `RouteGate` is the single source of truth for whether a route is open
 * (`service/src/routes.rs`), and re-deriving that client-side — from env
 * config, from a hardcoded list, from the presence of a contract address
 * — is precisely the drift this module exists to prevent. If `/chains`
 * has not loaded, the answer is "unknown", never "probably fine".
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
  route: Route,
): RouteAvailability {
  const view = chains?.routes.find((entry) => entry.id === route);
  if (!view) return { kind: "unknown", reason: UNKNOWN_REASON, view: null };
  if (!view.implemented) {
    return { kind: "unimplemented", reason: reasonOf(view), view };
  }
  if (!view.enabled) return { kind: "closed", reason: reasonOf(view), view };
  return { kind: "open", view };
}

/** True only for a route `/chains` positively reports as open. */
export function isRouteOpen(chains: ChainsViewDto | undefined, route: Route): boolean {
  return routeAvailability(chains, route).kind === "open";
}

/**
 * The routes to offer in the selector, in a stable presentation order.
 *
 * Unimplemented routes are INCLUDED so the two Solana<->Robinhood pairs
 * render visibly disabled rather than silently vanishing — a user who
 * expects them should see that they exist and are not usable, which is
 * also what the backend's `implemented` flag is for.
 */
export const ROUTE_PRESENTATION_ORDER: readonly Route[] = [
  "GlcToSol",
  "SolToGlc",
  "GlcToRhn",
  "RhnToGlc",
  "SolToRhn",
  "RhnToSol",
];
