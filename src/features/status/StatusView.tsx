"use client";

import { Activity, HeartPulse } from "lucide-react";
import { Card, ErrorState, Skeleton, StatusBadge, TokenAmount } from "@/components/ui";
import { useBridgeStatus, useChains, useHealth, useReserve } from "@/lib/query/hooks";
import { directionAvailabilityStatus, systemStatus } from "@/lib/status";
import type { DirectionAvailability } from "@/lib/status";
import {
  directionGateState,
  directions,
  routeAvailability,
  routeDisplay,
  GOLDCOIN_GLC,
  ROUTE_PRESENTATION_ORDER,
  SOLANA_GLC,
} from "@/lib/bridge";
import type { DirectionGateState, SolanaGovernedRoute } from "@/lib/bridge";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import type { BridgeStatusDto } from "@/lib/api/schemas/status";
import type { Route } from "@/lib/api/schemas/common";
import { clampAtomicAtZero } from "@/lib/api/schemas/common";

export function StatusView() {
  const status = useBridgeStatus();
  const chains = useChains();
  const health = useHealth();
  const reserve = useReserve();

  if (status.isPending || health.isPending || reserve.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    );
  }

  if (status.isError) return <ErrorState error={status.error} />;
  if (health.isError) return <ErrorState error={health.error} />;
  if (reserve.isError) return <ErrorState error={reserve.error} />;

  const data = status.data;
  const h = health.data;

  // Per-direction state from the same derivation the bridge form uses —
  // quota states are distinguished from an operator pause and from
  // reserve-capacity constraints, matching the backend's own composition.
  const GATE_TO_BADGE: Record<DirectionGateState, DirectionAvailability> = {
    active: "available",
    "operator-paused": "paused",
    "capacity-constrained": "insufficient-liquidity",
    "quota-exhausted": "quota-exhausted",
    "quota-paused": "quota-paused",
  };
  const availability = (direction: SolanaGovernedRoute) =>
    directionAvailabilityStatus[GATE_TO_BADGE[directionGateState(data, direction)]];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <DirectionStatusCard
          title={directions.GlcToSol.label}
          status={availability("GlcToSol")}
          capacityRaw={clampAtomicAtZero(reserve.data.solana_available_capacity)}
          token={SOLANA_GLC}
          statusData={data}
          direction="GlcToSol"
        />
        <DirectionStatusCard
          title={directions.SolToGlc.label}
          status={availability("SolToGlc")}
          capacityRaw={clampAtomicAtZero(reserve.data.goldcoin_available_capacity)}
          token={GOLDCOIN_GLC}
          statusData={data}
          direction="SolToGlc"
        />
      </div>

      <RouteAvailabilityCard chains={chains.data} isPending={chains.isPending} />

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <HeartPulse aria-hidden="true" className="text-ink-500 size-4" />
          <h2 className="text-heading-3">System health</h2>
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-body-sm text-ink-500">Overall</dt>
            <dd className="mt-1">
              <StatusBadge
                status={h.healthy ? systemStatus.operational : systemStatus.degraded}
                size="sm"
              />
            </dd>
          </div>
          <div>
            <dt className="text-body-sm text-ink-500">Goldcoin indexer</dt>
            <dd className="mt-1">
              <StatusBadge
                status={
                  h.goldcoin_indexer_halted
                    ? systemStatus.paused
                    : systemStatus.operational
                }
                size="sm"
              />
            </dd>
          </div>
          <div>
            <dt className="text-body-sm text-ink-500">Manual review backlog</dt>
            <dd className="tabular text-heading-3 mt-1">{h.manual_review_backlog}</dd>
          </div>
          <div>
            <dt className="text-body-sm text-ink-500">Reorg events</dt>
            <dd className="tabular text-heading-3 mt-1">
              {h.post_finality_reorg_events}
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}

function DirectionStatusCard({
  title,
  status,
  capacityRaw,
  token,
  statusData,
  direction,
}: {
  title: string;
  status: (typeof directionAvailabilityStatus)[keyof typeof directionAvailabilityStatus];
  capacityRaw: string;
  token: { decimals: number; symbol: string };
  statusData: BridgeStatusDto;
  direction: SolanaGovernedRoute;
}) {
  // Quota fields are mint-atomic (6 decimals) — see schemas/status.ts.
  const remaining =
    direction === "GlcToSol"
      ? statusData.glc_to_sol_rolling_volume_remaining
      : statusData.sol_to_glc_rolling_volume_remaining;
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity aria-hidden="true" className="text-ink-400 size-4 shrink-0" />
          <h2 className="text-heading-3">{title}</h2>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="mt-3">
        <TokenAmount
          raw={capacityRaw}
          decimals={token.decimals}
          symbol={token.symbol}
          className="text-heading-2"
        />
        <p className="text-body-sm text-ink-500 mt-1">Destination reserve capacity</p>
      </div>
      <div className="mt-2">
        <TokenAmount
          raw={String(remaining)}
          decimals={SOLANA_GLC.decimals}
          symbol="GLC"
        />
        <p className="text-body-sm text-ink-500 mt-1">
          Remaining 24-hour capacity for this direction
        </p>
      </div>
    </Card>
  );
}

/**
 * Every route the backend knows about, and whether it is open — read
 * straight from `GET /chains`.
 *
 * # Why this carries no numbers
 *
 * The two cards above pair a direction with its destination reserve's
 * capacity, because `GET /reserve` publishes that figure for the Goldcoin
 * and Solana reserves. It publishes NOTHING for the Robinhood reserve: the
 * ledger has a `RobinhoodReserve` row, but no public endpoint exposes its
 * capacity, its pause flag, or a per-route availability boolean for
 * either Robinhood route.
 *
 * So this card states availability and stops. It does not estimate a
 * capacity, borrow the Solana figure, or render an empty placeholder that
 * reads as "zero" — an absent number is shown as absent, and the missing
 * backend surface is recorded rather than papered over.
 */
function RouteAvailabilityCard({
  chains,
  isPending,
}: {
  chains: ChainsViewDto | undefined;
  isPending: boolean;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Activity aria-hidden="true" className="text-ink-500 size-4" />
        <h2 className="text-heading-3">Routes</h2>
      </div>
      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <ul className="flex flex-col gap-3">
          {ROUTE_PRESENTATION_ORDER.map((route: Route) => {
            const display = routeDisplay(route);
            const state = routeAvailability(chains, route);
            return (
              <li
                key={route}
                className="border-ink-100 flex flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="text-body-sm text-ink-900 font-medium">{display.label}</p>
                  <p className="text-body-sm text-ink-500">
                    {display.from.chain.name} → {display.to.chain.name}
                  </p>
                </div>
                <div className="sm:max-w-[60%] sm:text-right">
                  <StatusBadge
                    status={
                      state.kind === "open"
                        ? directionAvailabilityStatus.available
                        : directionAvailabilityStatus.paused
                    }
                    size="sm"
                  />
                  {state.kind !== "open" && (
                    <p className="text-body-sm text-ink-500 mt-1 whitespace-pre-line">
                      {state.kind === "unimplemented"
                        ? "Not available on this deployment."
                        : state.kind === "unknown"
                          ? "Availability could not be read."
                          : state.reason}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
