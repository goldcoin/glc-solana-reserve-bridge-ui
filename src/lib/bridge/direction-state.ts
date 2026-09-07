import type { BridgeStatusDto } from "@/lib/api/schemas/status";
/**
 * The two routes `GET /status`'s availability fields actually describe.
 *
 * Every field this module reads is named for one of them
 * (`glc_to_sol_available`, `sol_to_glc_quota_exhausted`,
 * `glc_to_sol_rolling_volume_remaining`, …) and the rolling-volume figures
 * come from a Solana PDA that bounds the Solana reserve's releases. There
 * is no Robinhood counterpart on this endpoint, and the backend
 * deliberately does not apply the Solana window to a Robinhood payout —
 * doing so "would be a limit that neither chain enforces".
 *
 * Typed narrowly rather than widened to `Route` so a Robinhood route
 * cannot reach these functions at all: the alternative is a silent
 * else-branch answering every non-`GlcToSol` route with `SolToGlc`'s
 * numbers, which is exactly the kind of wrong-but-plausible figure this
 * codebase refuses to display.
 */
export type SolanaGovernedRoute = "GlcToSol" | "SolToGlc";

/**
 * Per-direction operational state, derived from `GET /status` exactly the
 * way the backend's own availability derivation composes it
 * (`service/src/api.rs`): a direction is available iff its DESTINATION
 * reserve is unpaused AND its rolling-24h-volume quota has headroom AND
 * reserve capacity is above zero. The backend deliberately returns one
 * cause-agnostic message on submit for every unavailable cause; the
 * specific cause is only knowable from these status fields, which is why
 * this derivation exists client-side.
 *
 * The quota workflow never auto-unpauses (backend docs/09-runbook.md,
 * 2026-08-22): once the operator pause engages after exhaustion, reopening
 * is a manual operator action after reserves are replenished. Copy in this
 * module therefore never promises a reset time, a midnight rollover, or an
 * automatic reopening.
 */
export type DirectionGateState =
  | "active"
  | "quota-exhausted"
  | "quota-paused"
  | "operator-paused"
  | "capacity-constrained";

/** The destination reserve's operator-pause flag for a direction. */
export function destinationPaused(
  status: BridgeStatusDto,
  direction: SolanaGovernedRoute,
) {
  return direction === "GlcToSol" ? status.solana_paused : status.goldcoin_paused;
}

export function quotaExhausted(status: BridgeStatusDto, direction: SolanaGovernedRoute) {
  return direction === "GlcToSol"
    ? status.glc_to_sol_quota_exhausted
    : status.sol_to_glc_quota_exhausted;
}

/** Mint-atomic (6-decimal) headroom left in this direction's 24h window. */
export function rollingVolumeRemaining(
  status: BridgeStatusDto,
  direction: SolanaGovernedRoute,
) {
  return direction === "GlcToSol"
    ? status.glc_to_sol_rolling_volume_remaining
    : status.sol_to_glc_rolling_volume_remaining;
}

export function directionAvailable(
  status: BridgeStatusDto,
  direction: SolanaGovernedRoute,
) {
  return direction === "GlcToSol"
    ? status.glc_to_sol_available
    : status.sol_to_glc_available;
}

export function directionGateState(
  status: BridgeStatusDto,
  direction: SolanaGovernedRoute,
): DirectionGateState {
  const paused = destinationPaused(status, direction);
  const quota = quotaExhausted(status, direction);
  if (quota && paused) return "quota-paused";
  if (quota) return "quota-exhausted";
  if (paused) return "operator-paused";
  if (directionAvailable(status, direction)) return "active";
  // Unpaused with quota headroom, yet not available: the remaining cause in
  // the backend's derivation is zero reserve capacity (protected-minimum
  // constrained).
  return "capacity-constrained";
}

/**
 * Approved end-user copy. The second message matches the backend's
 * `DIRECTION_UNAVAILABLE_MESSAGE` (api.rs) line for line. Neither message
 * may claim an automatic reset or reopening — there is none.
 */
export const QUOTA_EXHAUSTED_TITLE =
  "24-hour bridge capacity reached for this direction.";
export const QUOTA_EXHAUSTED_BODY = "New transfers are temporarily unavailable.";

export const QUOTA_PAUSED_TITLE = "Bridge capacity reached for this direction.";
export const QUOTA_PAUSED_BODY =
  "Transfers are temporarily paused while reserves are replenished.";
export const QUOTA_PAUSED_NEXT =
  "Please check the official Telegram for reopening updates.";
