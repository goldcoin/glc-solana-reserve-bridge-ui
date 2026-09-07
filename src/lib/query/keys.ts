import type {
  ListExplorerEventsParams,
  ListReserveHistoryParams,
  ListTransfersParams,
} from "@/lib/api";

/** Query keys and polling policy, declared together so they cannot drift. */

export const queryKeys = {
  status: () => ["bridge", "status"] as const,
  chains: () => ["bridge", "chains"] as const,
  limits: () => ["bridge", "limits"] as const,
  reserve: () => ["bridge", "reserve"] as const,
  health: () => ["bridge", "health"] as const,
  stats: () => ["bridge", "stats"] as const,
  quote: (direction: string, grossAmount: string) =>
    ["bridge", "quote", direction, grossAmount] as const,
  recipientEligibility: (address: string, wallet: string | null) =>
    ["bridge", "recipient-eligibility", address, wallet] as const,
  transfer: (id: number) => ["bridge", "transfer", id] as const,
  transfers: (params: ListTransfersParams) => ["bridge", "transfers", params] as const,
  explorerEvents: (params: ListExplorerEventsParams) =>
    ["bridge", "explorer", "events", params] as const,
  reserveHistory: (params: ListReserveHistoryParams) =>
    ["bridge", "reserves", "history", params] as const,
} as const;

/**
 * Refetch intervals in milliseconds.
 *
 * A transfer in flight is polled often enough to feel live; a transfer in a
 * terminal state (`Settled`, `Expired`, `Cancelled`, `Reorged`,
 * `InsufficientReserveAtSettlement`, `DestinationSubmissionFailed`,
 * `Failed`) is not polled at all. Live values are always refreshed in place
 * with an "updated Ns ago" stamp — they never blank out to a skeleton.
 */
export const pollIntervals = {
  /** The global trust strip. Wrong status here is worse than stale status. */
  status: 30_000,
  /**
   * The route registry. Polled on the same cadence as status rather than
   * the slow `limits` cadence: this is what decides whether a route can
   * be used at all, and a route closing (or opening) mid-session must not
   * sit stale behind a five-minute window while the form still offers it.
   */
  chains: 30_000,
  /** Fee schedule and caps change rarely. */
  limits: 300_000,
  /** Reserve capacity. Polled on every page — the pause/liquidity banner is site-wide. */
  reserve: 30_000,
  health: 60_000,
  stats: 60_000,
  /**
   * The SolToGlc recipient rate-limit check for the address currently in
   * the form. Refetching while the form sits open both catches an address
   * that got paid from elsewhere in the meantime and lets a blocked
   * address unblock on its own once its 24-hour window passes — without
   * the user having to retype anything.
   */
  recipientEligibility: 30_000,
  /** A transfer the user is actively watching. */
  activeTransfer: 8_000,
  /** A transfer that has reached a terminal state. */
  terminalTransfer: false,
  transferList: 30_000,
  /** The public event feed. Live enough to show the bridge is alive. */
  explorerEvents: 30_000,
  reserveHistory: 120_000,
} as const;
