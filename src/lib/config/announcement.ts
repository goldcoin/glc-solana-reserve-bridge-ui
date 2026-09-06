/**
 * The network announcement strip.
 *
 * A forward-looking product notice and nothing more. It is deliberately a
 * plain constant rather than a feature flag, a remote config or an API
 * response: this banner describes an integration that does not exist yet, so
 * there is no live state it could be derived from and nothing it could
 * legitimately ask the backend about.
 *
 * That separation is the whole point. The global trust strip above it
 * (`BridgeStatusBar`) reports the bridge as it is right now, from the status
 * endpoint; this reports a plan. Wiring the two together would let a future
 * marketing line be affected by — or worse, be mistaken for — the operational
 * state of real money movement.
 *
 * Turning it off is a one-line edit to `enabled` below, and every string it
 * renders lives here rather than in the component.
 *
 * The strip carries one line of copy and no call to action. It deliberately
 * has no `learnMoreHref`: this deployment serves no Robinhood page and no
 * external URL is configured for one, and a disabled control that explains it
 * cannot be used is still a dead control taking up the row. Nothing to open
 * is better said by showing nothing than by showing a button that refuses.
 */
export interface NetworkAnnouncement {
  readonly enabled: boolean;
  readonly network: string;
  readonly status: "coming-soon";
  readonly title: string;
  readonly description: string;
  /**
   * Namespaced, matching `THEME_STORAGE_KEY`: this origin also carries the
   * Solana wallet adapter's own storage keys, and a bare `dismissed` would be
   * a collision waiting to happen.
   */
  readonly storageKey: string;
}

export const NETWORK_ANNOUNCEMENT: NetworkAnnouncement = {
  enabled: true,
  network: "Robinhood",
  status: "coming-soon",
  title: "Robinhood Network Integration",
  description: "GLC bridging with Robinhood Chain launches next week.",
  storageKey: "glc-bridge-announcement-robinhood",
};

/** The badge label, in one place so the component and its tests agree. */
export const COMING_SOON_LABEL = "Coming soon";
