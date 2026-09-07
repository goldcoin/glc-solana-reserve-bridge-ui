"use client";

import Link from "next/link";
import { toneStyles, systemStatus, type SystemStatus } from "@/lib/status";
import { useBridgeStatus, useChains } from "@/lib/query/hooks";
import { routes } from "@/lib/config/links";
import { StatusDot } from "@/components/ui/StatusDot";
import { cn } from "@/lib/utils/cn";
import { directions, routeAvailabilitySummary } from "@/lib/bridge";
import type { BridgeStatusDto } from "@/lib/api/schemas/status";

/**
 * The global trust strip.
 *
 * Present on every page so a user learns a direction is paused BEFORE they
 * commit funds, not after. Renders on the server with a hydrated snapshot so
 * the strip is correct on first paint. While a refresh is in flight the
 * previous values stay on screen — this bar never blanks to a skeleton.
 */
export function BridgeStatusBar({ initialStatus }: { initialStatus?: BridgeStatusDto }) {
  const { data, isPending, isError } = useBridgeStatus(initialStatus);
  // Route availability is a separate endpoint from the status snapshot and
  // is NOT fetched server-side, so it can legitimately be absent for the
  // first moment of a visit — see the operational copy below.
  const chains = useChains();

  if (isPending) {
    return <div className="border-ink-200 bg-ink-50 h-10 border-b" aria-hidden="true" />;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (isError || !data) {
    return (
      <div className="border-ink-200 bg-ink-50 border-b">
        <div className="max-w-page mx-auto flex h-10 items-center gap-2 px-4 md:px-6">
          <StatusDot status={systemStatus.maintenance} />
          <p className="text-body-sm text-ink-700">
            Bridge status unavailable — we could not reach the bridge. Your funds are
            unaffected.
          </p>
          <Link
            href={routes.status}
            className="text-body-sm text-ink-700 ml-auto shrink-0 underline underline-offset-2"
          >
            View status
          </Link>
        </div>
      </div>
    );
  }

  const bothPaused = data.goldcoin_paused && data.solana_paused;
  const bothAvailable = data.glc_to_sol_available && data.sol_to_glc_available;
  const status: SystemStatus = bothPaused
    ? "paused"
    : bothAvailable
      ? "operational"
      : "degraded";
  const descriptor = systemStatus[status];
  const tone = toneStyles[descriptor.tone];

  /*
   * The operational sentence counts routes instead of naming two of them.
   * It used to read "Both directions are available.", which stopped being
   * true the moment `GET /chains` began listing six routes with four of
   * them closed — and no count is hardcoded here, so a route the backend
   * opens later is reflected without a frontend deploy.
   *
   * The tone above still comes from `GET /status` alone, deliberately: the
   * four closed Robinhood routes are the expected shipping state, not a
   * degradation, and colouring the whole strip amber for them would cry
   * outage over a bridge that is working exactly as intended.
   */
  // Not named `routes`: that identifier is the link table imported above.
  const routeSummary = routeAvailabilitySummary(chains.data);
  const routesAvailable = routeSummary
    ? `${routeSummary.open} of ${routeSummary.total} ${routeSummary.total === 1 ? "route" : "routes"} available.`
    : // Fail closed: until /chains answers, this bar does not know how many
      // routes are open and must not imply an answer.
      "Checking route availability…";

  return (
    <div className={cn("border-b", tone.bar)}>
      <div className="max-w-page mx-auto flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 md:px-6 md:py-0">
        <StatusDot status={descriptor} showLabel live={status === "operational"} />

        <p className="text-body-sm text-ink-700">
          {status === "operational" && routesAvailable}
          {status === "degraded" &&
            (!data.glc_to_sol_available
              ? `${directions.GlcToSol.label} is currently unavailable.`
              : `${directions.SolToGlc.label} is currently unavailable.`)}
          {status === "paused" && "The bridge is paused on both sides."}
        </p>

        <Link
          href={routes.status}
          className="text-body-sm text-ink-700 hover:text-ink-950 ml-auto shrink-0 underline underline-offset-2"
        >
          View status
        </Link>
      </div>
    </div>
  );
}
