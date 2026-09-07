"use client";

import { Alert, ButtonLink } from "@/components/ui";
import {
  QUOTA_EXHAUSTED_BODY,
  QUOTA_EXHAUSTED_TITLE,
  QUOTA_PAUSED_BODY,
  QUOTA_PAUSED_NEXT,
  QUOTA_PAUSED_TITLE,
  RECIPIENT_RATE_LIMIT_TITLE,
  SOURCE_WALLET_RATE_LIMIT_TITLE,
} from "@/lib/bridge";
import { routes } from "@/lib/config/links";

/**
 * Bridge-wide, backend-driven blockers.
 *
 * These get their own callout rather than disappearing into the submit
 * button's disabled-reason text: they are conditions the amount and
 * address fields cannot fix, so a reader should see them before filling
 * anything in, not discover them after clicking a dead-looking button.
 */
export type Blocker =
  | "unavailable"
  | "route-closed"
  | "paused"
  | "insufficient-liquidity"
  | "quota-exhausted"
  | "quota-paused"
  | "recipient-rate-limited"
  | "source-wallet-rate-limited";

export function BlockerAlert({
  blocker,
  directionLabel,
  reason,
}: {
  blocker: Blocker;
  directionLabel: string;
  /**
   * The backend's own sentence, used verbatim for `route-closed`. This UI
   * never authors a second explanation of a closed route and never infers
   * which gate refused.
   */
  reason: string;
}) {
  const copy: Record<Blocker, { title: string; funds: string }> = {
    "route-closed": {
      title: reason || `${directionLabel} is not available.`,
      funds:
        "Nothing you enter below will submit while this route is closed — no funds move.",
    },
    unavailable: {
      title: "We could not reach the bridge status service.",
      funds:
        "No funds have moved. This is a problem loading information, not a problem with a transfer.",
    },
    paused: {
      title: `${directionLabel} is currently paused.`,
      funds:
        "Nothing you enter below will submit while this route is paused — no funds move.",
    },
    "insufficient-liquidity": {
      title: "This route has no reserve capacity available right now.",
      funds:
        "Nothing you enter below will submit until capacity is available — no funds move.",
    },
    // The two quota states carry the approved copy verbatim. Neither may
    // promise a reset time or an automatic reopening: the backend's pause
    // after exhaustion clears only by manual operator action.
    "quota-exhausted": {
      title: QUOTA_EXHAUSTED_TITLE,
      funds: `${QUOTA_EXHAUSTED_BODY} Nothing you enter below will submit — no funds move.`,
    },
    "quota-paused": {
      title: QUOTA_PAUSED_TITLE,
      funds: `${QUOTA_PAUSED_BODY} Nothing you enter below will submit — no funds move.`,
    },
    // Unlike every blocker above, these two are specific to the ADDRESS
    // typed or the WALLET connected, not to the bridge or the route. Each
    // shows exactly one sentence: empty `funds`/`next` render nothing, and
    // the status-page link (which would show a perfectly healthy bridge)
    // is omitted. The retry-after time the backend returns is deliberately
    // not displayed.
    "recipient-rate-limited": { title: RECIPIENT_RATE_LIMIT_TITLE, funds: "" },
    "source-wallet-rate-limited": { title: SOURCE_WALLET_RATE_LIMIT_TITLE, funds: "" },
  };

  const isRateLimited =
    blocker === "recipient-rate-limited" || blocker === "source-wallet-rate-limited";
  const next =
    blocker === "quota-paused"
      ? QUOTA_PAUSED_NEXT
      : blocker === "quota-exhausted"
        ? "See the current status page for live capacity."
        : isRateLimited
          ? ""
          : blocker === "route-closed"
            ? "You can still select another network pair."
            : "Check your connection and try again, or see the current status.";

  return (
    <Alert
      level="warn"
      title={copy[blocker].title}
      funds={copy[blocker].funds}
      next={next}
      actions={
        isRateLimited ? undefined : (
          <ButtonLink href={routes.status} variant="secondary" size="sm">
            View status
          </ButtonLink>
        )
      }
    />
  );
}
