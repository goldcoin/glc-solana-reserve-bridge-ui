import {
  Ban,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CircleSlash,
  CircleX,
  Pause,
  RotateCcw,
  Settings,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { RequestState } from "@/lib/api/schemas/transfer";
import { isKnownRequestState } from "@/lib/bridge/state";

/**
 * The status vocabulary.
 *
 * One system, used identically in the global bar, cards, table rows, the
 * transfer detail page and the explorer. Two rules are enforced
 * structurally here rather than by review:
 *
 *   1. Every status carries colour AND icon AND text. Components take a
 *      status token, never a colour, so a bare coloured dot with no
 *      accessible label cannot be constructed.
 *   2. Brand gold is absent from every tone below. Gold marks brand, the
 *      active step, and focus — never state.
 */

export type StatusTone = "success" | "warn" | "danger" | "info" | "neutral";

export interface StatusDescriptor {
  readonly label: string;
  readonly tone: StatusTone;
  readonly icon: LucideIcon;
}

/* -------------------------------------------------------------------------- */
/* System                                                                      */
/* -------------------------------------------------------------------------- */

export type SystemStatus = "operational" | "degraded" | "paused" | "maintenance";

export const systemStatus: Record<SystemStatus, StatusDescriptor> = {
  operational: { label: "Operational", tone: "success", icon: CircleCheck },
  degraded: { label: "Degraded", tone: "warn", icon: CircleAlert },
  paused: { label: "Paused", tone: "danger", icon: Pause },
  maintenance: { label: "Maintenance", tone: "info", icon: Settings },
};

/* -------------------------------------------------------------------------- */
/* Transfer (RequestState)                                                     */
/* -------------------------------------------------------------------------- */

/** Every value the real backend `RequestState` enum can emit. */
export const requestStateStatus: Record<RequestState, StatusDescriptor> = {
  LiquidityReserved: { label: "Reserving capacity", tone: "neutral", icon: Circle },
  AwaitingDeposit: {
    label: "Awaiting your deposit",
    tone: "neutral",
    icon: CircleDashed,
  },
  DepositObserved: { label: "Deposit observed", tone: "info", icon: CircleDot },
  Confirming: { label: "Confirming", tone: "info", icon: CircleDot },
  SourceFinalized: { label: "Source confirmed", tone: "info", icon: CircleDot },
  SettlementAuthorized: { label: "Settlement authorized", tone: "info", icon: CircleDot },
  DestinationSubmitted: { label: "Sending your funds", tone: "info", icon: CircleDot },
  DestinationConfirmed: { label: "Destination confirmed", tone: "info", icon: CircleDot },
  Settled: { label: "Settled", tone: "success", icon: CircleCheck },
  Expired: { label: "Expired", tone: "neutral", icon: CircleSlash },
  Cancelled: { label: "Cancelled", tone: "neutral", icon: CircleSlash },
  Reorged: { label: "Reversed by a reorg", tone: "danger", icon: CircleX },
  InsufficientReserveAtSettlement: {
    label: "Reserve ran out before settlement",
    tone: "danger",
    icon: CircleX,
  },
  DestinationSubmissionFailed: {
    label: "Destination transaction failed",
    tone: "danger",
    icon: CircleX,
  },
  ManualReview: { label: "Under manual review", tone: "warn", icon: TriangleAlert },
  // The refund lifecycle is not a failure: the deposit is on its way back to
  // the user. It is not a settlement success either, so `Refunded` is
  // neutral rather than green — green is reserved for `Settled`, the outcome
  // the user actually asked for.
  RefundPending: { label: "Refund pending", tone: "info", icon: RotateCcw },
  RefundBroadcast: { label: "Refund broadcast", tone: "info", icon: RotateCcw },
  Refunded: { label: "Refunded", tone: "neutral", icon: CircleCheck },
  Failed: { label: "Failed", tone: "danger", icon: CircleX },
};

/**
 * A descriptor for any state name off the wire, known or not.
 *
 * `GET /explorer/events` deliberately accepts a structurally-valid state
 * name this build has never heard of, so that one event carrying a future
 * lifecycle state cannot fail the whole feed
 * (`eventRequestStateSchema` in `src/lib/api/schemas/explorer`). Such a
 * state gets a neutral badge carrying its own raw name: the row still says
 * which request it belongs to, when it happened, and what the backend
 * called it — honest about being unrecognised rather than dressed up as
 * something this build understands, and never guessed into a tone that
 * would imply success or failure.
 */
export function requestStateDescriptor(state: string): StatusDescriptor {
  return isKnownRequestState(state)
    ? requestStateStatus[state]
    : { label: state, tone: "neutral", icon: CircleHelp };
}

/* -------------------------------------------------------------------------- */
/* Reserve / direction availability                                            */
/* -------------------------------------------------------------------------- */

export type DirectionAvailability =
  "available" | "paused" | "insufficient-liquidity" | "quota-exhausted" | "quota-paused";

export const directionAvailabilityStatus: Record<
  DirectionAvailability,
  StatusDescriptor
> = {
  available: { label: "Available", tone: "success", icon: CircleCheck },
  paused: { label: "Paused", tone: "danger", icon: Pause },
  "insufficient-liquidity": {
    label: "Insufficient liquidity",
    tone: "warn",
    icon: TriangleAlert,
  },
  // Rolling-24h-volume quota states (backend 2026-08-22 workflow). Labels
  // deliberately promise no reset time and no automatic reopening.
  "quota-exhausted": {
    label: "24h capacity reached",
    tone: "warn",
    icon: TriangleAlert,
  },
  "quota-paused": {
    label: "Paused for refill",
    tone: "danger",
    icon: Pause,
  },
};

/* -------------------------------------------------------------------------- */
/* Route availability (GET /chains)                                            */
/* -------------------------------------------------------------------------- */

/**
 * The four verdicts `routeAvailability` can return, as badges.
 *
 * Deliberately NOT `directionAvailabilityStatus` above. That vocabulary
 * describes the two Solana-governed directions, whose cause IS knowable
 * from `GET /status` — an operator pause, an exhausted 24h quota, a
 * constrained reserve — so "Paused" there is a derived fact.
 *
 * `GET /chains` publishes no cause at all: `enabled` is the AND of three
 * independent gates and the route view deliberately never names which one
 * refused. Rendering a closed route as "Paused" would therefore assert an
 * operator action the backend never claimed, and — worse — would say the
 * same thing about `SolToRhn`/`RhnToSol`, which no operator action can
 * open because they have no settlement machinery on either side. The two
 * cases are the same colour on screen today and must not be.
 */
export type RouteAvailabilityStatus = "open" | "closed" | "unimplemented" | "unknown";

export const routeAvailabilityStatus: Record<RouteAvailabilityStatus, StatusDescriptor> =
  {
    open: { label: "Available", tone: "success", icon: CircleCheck },
    /** Implemented, and refused by the gate. Reopening it is a backend change. */
    closed: { label: "Unavailable", tone: "danger", icon: CircleSlash },
    /**
     * `implemented: false` — structurally inert in this build. Neutral, not
     * danger: nothing is wrong and nothing is waiting to be switched back on,
     * so it must not read as an incident or as a temporary state.
     */
    unimplemented: { label: "Not implemented", tone: "neutral", icon: Ban },
    /** `/chains` has not loaded. Fail closed, and say so rather than guessing. */
    unknown: { label: "Unknown", tone: "neutral", icon: CircleHelp },
  };

/* -------------------------------------------------------------------------- */
/* Wallet connection                                                           */
/* -------------------------------------------------------------------------- */

export type WalletConnectionStatus = "connected" | "connecting" | "disconnected";

export const walletStatus: Record<WalletConnectionStatus, StatusDescriptor> = {
  connected: { label: "Connected", tone: "success", icon: CircleCheck },
  connecting: { label: "Connecting", tone: "info", icon: CircleDot },
  disconnected: { label: "Not connected", tone: "neutral", icon: CircleDashed },
};

/* -------------------------------------------------------------------------- */
/* Step state (client-derived stepper rendering)                              */
/* -------------------------------------------------------------------------- */

export type StepState = "pending" | "active" | "done" | "failed";

export const stepState: Record<StepState, StatusDescriptor> = {
  pending: { label: "Waiting", tone: "neutral", icon: Circle },
  active: { label: "In progress", tone: "info", icon: CircleDot },
  done: { label: "Done", tone: "success", icon: CircleCheck },
  failed: { label: "Failed", tone: "danger", icon: CircleX },
};

/* -------------------------------------------------------------------------- */
/* Tone styling                                                                */
/* -------------------------------------------------------------------------- */

export const toneStyles: Record<
  StatusTone,
  {
    readonly dot: string;
    readonly text: string;
    readonly badge: string;
    readonly alert: string;
    readonly bar: string;
    readonly halo: string;
  }
> = {
  success: {
    dot: "bg-success-500",
    text: "text-success-700",
    badge: "bg-success-50 text-success-700",
    alert: "bg-success-50 border-l-success-500",
    bar: "bg-success-50 border-success-100",
    halo: "bg-success-100",
  },
  warn: {
    dot: "bg-warn-500",
    text: "text-warn-700",
    badge: "bg-warn-50 text-warn-700",
    alert: "bg-warn-50 border-l-warn-500",
    bar: "bg-warn-50 border-warn-100",
    halo: "bg-warn-100",
  },
  danger: {
    dot: "bg-danger-500",
    text: "text-danger-700",
    badge: "bg-danger-50 text-danger-700",
    alert: "bg-danger-50 border-l-danger-500",
    bar: "bg-danger-50 border-danger-100",
    halo: "bg-danger-100",
  },
  info: {
    dot: "bg-info-500",
    text: "text-info-700",
    badge: "bg-info-50 text-info-700",
    alert: "bg-info-50 border-l-info-500",
    bar: "bg-info-50 border-info-100",
    halo: "bg-info-100",
  },
  neutral: {
    dot: "bg-ink-400",
    text: "text-ink-600",
    badge: "bg-ink-100 text-ink-700",
    alert: "bg-ink-50 border-l-ink-300",
    bar: "bg-ink-50 border-ink-200",
    halo: "bg-ink-200",
  },
};
