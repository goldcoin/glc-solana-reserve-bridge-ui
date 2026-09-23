import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import { routeAvailability } from "@/lib/bridge/route-availability";
import { routesTouchingChain } from "@/lib/bridge/route-resolution";
import { env } from "@/lib/config/env";

/**
 * The network integration strip.
 *
 * # What changed, and why
 *
 * This used to be a pure constant announcing a FUTURE integration:
 * "COMING SOON — Robinhood Network Integration — GLC bridging with
 * Robinhood Chain launches next week." Every word of that is now stale.
 * The routes are implemented and shipped; the strip was still promising
 * them for "next week", which had already passed, and the badge said
 * "Coming soon" about machinery that exists.
 *
 * Deriving it from a constant was the right call while the thing being
 * announced did not exist — there was no live state it could read. That is
 * no longer true, and a hand-edited marketing line about a live route is
 * exactly the thing that goes stale silently. So the strip now reports
 * what `GET /chains` says about the Robinhood routes, and nothing else.
 *
 * # It still is not the operational strip
 *
 * `BridgeStatusBar` speaks for the bridge as a whole and sits above this.
 * This one is scoped to a single network's integration and says only
 * whether its routes can be used right now. It states no reason and makes
 * no promise about when a closed route opens: the backend publishes a
 * cause-agnostic sentence per route, and /status renders each one beside
 * the route it belongs to.
 *
 * # The route list is derived, not written
 *
 * It used to be the literal pair `["GlcToRhn", "RhnToGlc"]`, which was the
 * whole Robinhood integration at the time. It is now every route with
 * Robinhood on either side, read off the one pair→route table — so the
 * strip could not keep reporting on half the integration once the two
 * cross routes shipped.
 *
 * # Turning it off, and turning the next one on
 *
 * Whether the strip renders at all is deployment configuration
 * (`NEXT_PUBLIC_ANNOUNCEMENT_ENABLED`), not a code edit, and it is
 * fail-closed: unset or anything other than "true" means hidden. That is
 * what retires the Robinhood announcement without deleting the feature.
 *
 * Nothing below names Robinhood outside the one config object. The chain
 * whose routes are reported, the network's own name, the title, the
 * dismissal key and the brand mark are all fields of
 * `NETWORK_ANNOUNCEMENT`, and the per-status copy is a template taking the
 * network name. Announcing the next token or chain launch is therefore an
 * edit to that object plus flipping the flag on — the component, the
 * status derivation and the tests are all reusable as they stand.
 */

/**
 * What the strip is reporting, derived from route availability.
 *
 * No `"coming-soon"` member: the routes are implemented, so nothing here
 * may describe them as unbuilt. `"unknown"` is the fail-closed state and
 * is never rendered as availability.
 */
export type NetworkAnnouncementStatus =
  /** Every route on this network is available right now. */
  | "available"
  /** At least one available, at least one not. */
  | "partial"
  /** None of this network's routes can be used right now. */
  | "unavailable"
  /** `/chains` has not answered. Says so; claims nothing. */
  | "unknown";

/**
 * A network's brand mark, shown decoratively at the end of the strip. The
 * intrinsic dimensions travel with it because `next/image` needs them and
 * because a mark that has been stretched is worse than one that is absent.
 * `null` is a supported state: the heading already names the network.
 */
export interface AnnouncementMark {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

export interface NetworkAnnouncement {
  /**
   * From `NEXT_PUBLIC_ANNOUNCEMENT_ENABLED`, fail-closed. Not a code
   * constant: retiring an announcement is a deployment decision, and an
   * unset flag must hide the strip rather than ship a stale one.
   */
  readonly enabled: boolean;
  /**
   * The chain whose routes this strip reports on, as the route table keys
   * it (`routesTouchingChain`). Announcing a different network means
   * changing this, not the status derivation below.
   */
  readonly chain: string;
  readonly network: string;
  readonly title: string;
  /**
   * Namespaced, matching `THEME_STORAGE_KEY`: this origin also carries the
   * Solana wallet adapter's own storage keys, and a bare `dismissed` would be
   * a collision waiting to happen.
   *
   * Announcement-specific on purpose. A new announcement wants a new key,
   * so that a reader who dismissed the previous one still sees it.
   */
  readonly storageKey: string;
  readonly mark: AnnouncementMark | null;
}

export const NETWORK_ANNOUNCEMENT: NetworkAnnouncement = {
  enabled: env.announcementEnabled,
  chain: "robinhood",
  network: "Robinhood Network",
  title: "Robinhood Network GLC bridge integration",
  storageKey: "glc-bridge-announcement-robinhood",
  mark: { src: "/brands/robinhood-mark.png", width: 1374, height: 1145 },
};

/**
 * The badge label per status, in one place so the component and its tests
 * agree — and so that adding a status cannot leave the component with a
 * label it has no case for.
 */
export const ANNOUNCEMENT_STATUS_LABEL: Record<NetworkAnnouncementStatus, string> = {
  available: "Available",
  partial: "Partially available",
  unavailable: "Unavailable",
  unknown: "Checking",
};

/**
 * The one line of copy per status, as a function of the announced network's
 * name rather than as four sentences with "Robinhood Network" typed into
 * them. Announcing a different network reuses these verbatim.
 *
 * Deliberately neutral and free of launch language: no date, no "coming
 * soon", no "launches". It describes the integration as deployed and then
 * reports what the backend says about its routes, which is the only claim
 * this strip is entitled to make.
 */
export const ANNOUNCEMENT_STATUS_DESCRIPTION: Record<
  NetworkAnnouncementStatus,
  (network: string) => string
> = {
  available: (network) =>
    `Every GLC bridge route to and from ${network} is available right now.`,
  partial: (network) => `Some ${network} bridge routes are temporarily unavailable.`,
  unavailable: (network) => `${network} bridge routes are not available right now.`,
  unknown: (network) => `Checking ${network} route availability…`,
};

/**
 * The strip's status, from `GET /chains` alone.
 *
 * A route counts as available only when the backend positively answered
 * `available: true` — the same fail-closed rule every other consumer of
 * this endpoint applies. The route-level `enabled` flag is not consulted:
 * a route that is switched on and held shut by its destination reserve is
 * not one a user can use, which is the only thing this strip reports.
 *
 * The routes are derived from the announced chain, in the route table's own
 * order — four for Robinhood today — so the strip cannot end up reporting
 * on half an integration once more routes ship, and announcing a different
 * network needs no edit here at all.
 */
export function networkAnnouncementStatus(
  chains: ChainsViewDto | undefined,
  announcement: NetworkAnnouncement = NETWORK_ANNOUNCEMENT,
): NetworkAnnouncementStatus {
  if (!chains) return "unknown";
  const routes = routesTouchingChain(announcement.chain);
  if (routes.length === 0) return "unknown";
  const available = routes.filter((route) => {
    const state = routeAvailability(chains, route);
    return state.kind === "open" && state.availabilityKnown;
  }).length;
  if (available === routes.length) return "available";
  if (available === 0) return "unavailable";
  return "partial";
}
