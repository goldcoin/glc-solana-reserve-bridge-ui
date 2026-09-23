"use client";

import { useId } from "react";
import type { ReactNode } from "react";
import { Activity, HeartPulse } from "lucide-react";
import { Card, ErrorState, Skeleton, StatusBadge, TokenAmount } from "@/components/ui";
import {
  useBridgeStatus,
  useChains,
  useHealth,
  useLimits,
  useReserve,
  useRobinhoodReserve,
  useStats,
} from "@/lib/query/hooks";
import {
  executableRouteStatusBadge,
  routeAvailabilityStatus,
  systemStatus,
} from "@/lib/status";
import {
  displayDescriptorFor,
  executableRouteStatuses,
  isRouteEnabled,
  routeAvailability,
  routesTouchingChain,
} from "@/lib/bridge";
import type { ExecutableRouteStatus, RouteFigure } from "@/lib/bridge";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";

/**
 * /status, modelled on the route registry rather than on two directions.
 *
 * Every figure on this page is resolved by `@/lib/bridge/route-status`,
 * which keys each one to the route it belongs to through a total map with
 * no default branch. This component fetches and renders; it decides
 * nothing about where a number came from, which is what stops a Robinhood
 * card from being filled with Solana's reserve or a Goldcoin-settled route
 * from borrowing the Robinhood ledger's.
 */
export function StatusView() {
  const status = useBridgeStatus();
  const chains = useChains();
  const health = useHealth();
  const reserve = useReserve();
  const limits = useLimits();
  // Carried for `route_fees` alone — the per-route price table. `/stats`
  // is polled by the overview cards anyway, so this shares a cache entry
  // rather than adding a request.
  const stats = useStats();
  // Fetched only once `/chains` reports this DEPLOYMENT has a Robinhood
  // route at all. `isRouteEnabled`, not `isRouteOpen`: a route that is
  // switched on and momentarily gated shut by its destination reserve
  // still has the endpoint, and is exactly the state a status page exists
  // to report. A deployment without the route answers 404 per poll tick,
  // which is what this avoids.
  //
  // Every route touching Robinhood counts, read off the route table rather
  // than the two that used to be the whole integration — a deployment with
  // only the cross routes open has the endpoint too, and asking about the
  // Goldcoin pair alone would leave those two cards blank on a backend that
  // was answering perfectly well.
  const robinhoodLive = routesTouchingChain("robinhood").some((route) =>
    isRouteEnabled(chains.data, route),
  );
  const robinhood = useRobinhoodReserve(robinhoodLive);

  if (status.isPending || health.isPending || reserve.isPending) {
    return (
      // As many placeholders as there are route cards, in the grid they
      // will land in — so the page does not reflow from two boxes to six
      // the moment the first response arrives.
      <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-36 w-full" />
        ))}
      </div>
    );
  }

  if (status.isError) return <ErrorState error={status.error} />;
  if (health.isError) return <ErrorState error={health.error} />;
  if (reserve.isError) return <ErrorState error={reserve.error} />;

  const h = health.data;

  const cards = executableRouteStatuses({
    chains: chains.data,
    status: status.data,
    reserve: reserve.data,
    robinhood: robinhood.data,
    limits: limits.data,
    stats: stats.data,
  });

  return (
    <div className="flex flex-col gap-6">
      {/*
        Three columns from `xl`, two from `sm`, one below. At two columns a
        six-route page is three tall rows of cards whose content is four
        short rows each — mostly whitespace, and a lot of scrolling to
        compare two routes. The third column is what keeps the set readable
        without making any single card bigger: the cards themselves are
        unchanged, and `auto-rows-fr` only stops a short card from
        stretching to its row's height.
      */}
      <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <RouteCard key={card.route} card={card} />
        ))}
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

/**
 * One published figure.
 *
 * Only ever rendered for a figure that exists. A metric the backend does
 * not publish is not drawn at all — see {@link RouteCard} for why the row
 * goes with it rather than being filled with a placeholder.
 */
function Figure({ figure, className }: { figure: RouteFigure; className?: string }) {
  return (
    <TokenAmount
      raw={figure.atomic}
      decimals={figure.decimals}
      symbol="GLC"
      {...(className ? { className } : {})}
    />
  );
}

/**
 * One executable route's card: what it is, whether it can be used right
 * now, and the figures that bound it.
 *
 * # Every row on this card is a published fact
 *
 * A figure or a verdict the backend does not publish for this route is not
 * rendered at all — no placeholder, no dash, no zero, and above all no
 * neighbouring route's value standing in for it. Most routes have a genuine
 * gap somewhere (a deployment with no Robinhood reserve publishes neither a
 * capacity nor a window for the four routes that touch it), and a card that
 * prints "Not published" in each of those slots reads as unfinished while
 * saying nothing a reader can act on. The badge and `card.note` already
 * carry the state; the row goes.
 *
 * The corollary is that cards differ in height, and deliberately so — the
 * alternative is a uniform grid of placeholders.
 *
 * # Compactness is a constraint, not a preference
 *
 * Six of these sit on one page. Nothing here grows to fill a column: the
 * figures stay at their existing sizes, the two bound rows sit in the same
 * two-column `dl` as everything else, and the only layout change the sixth
 * route forced was a third grid column around the cards rather than a
 * taller card.
 */
function RouteCard({ card }: { card: ExecutableRouteStatus }) {
  const headingId = useId();
  const rows: { term: string; value: ReactNode; tabular?: boolean }[] = [];

  // `Enabled` and `Available` answer different questions — the first is
  // the route gate over config, the `bridge_routes` table and adapter
  // capability; the second is that AND every runtime gate on the
  // DESTINATION reserve — and reading the first as permission is exactly
  // what let `RhnToGlc` deposits reach a Goldcoin reserve whose admission
  // was closed. Both are shown, and only when the registry actually
  // answered: with `/chains` unreachable these fields hold this build's
  // fail-closed defaults, and printing those as the backend's verdict
  // would be inventing one.
  if (card.registered) {
    // Qualified rather than bare "Enabled" / "Available": the badge above
    // already carries the word "Available", and two things on one card
    // reading "Available" with different meanings is exactly the
    // confusion these rows exist to remove.
    rows.push({ term: "Enabled (route gate)", value: card.enabled ? "Yes" : "No" });
    // An absent `available` is a backend that never answered the
    // question, which is not the same as answering no — and the two have
    // different remedies. The badge already reports the route unknown and
    // `card.note` says why, so the row is omitted rather than filled in.
    if (card.available !== undefined) {
      rows.push({ term: "Available (effective)", value: card.available ? "Yes" : "No" });
    }
  }

  // `GET /stats`' `route_fees` states a price per route. Its absence is
  // reported by leaving the row out — never by showing another route's
  // rate, which for a Robinhood route would mean the Solana program's.
  if (card.fee) {
    rows.push({ term: "Route fee", value: card.fee.display, tabular: true });
  }

  // The floor and the ceiling are SEPARATE rows, because they come from
  // different endpoints and are independently absent.
  //
  // They used to be one "Per-transfer limits" range, rendered only when
  // BOTH existed — so a route whose maximum had not been read showed no
  // minimum either, even though the minimum is the one figure every route
  // publishes and the one a user needs before typing an amount. Two rows
  // means each appears exactly when its own endpoint answered.
  if (card.minimum) {
    rows.push({
      term: "Source minimum",
      value: <Figure figure={card.minimum} />,
      tabular: true,
    });
  }
  // `GET /limits` publishes the SOLANA program's `BridgeConfig`, and
  // `GET /robinhood/limits` the custody contract's; a deployment missing
  // either leaves this row out rather than borrowing the other's number,
  // which would state a ceiling the route's own chain does not enforce.
  if (card.maximum) {
    rows.push({
      term: "Max per transfer",
      value: <Figure figure={card.maximum} />,
      tabular: true,
    });
  }

  return (
    /*
      A labelled group, not a bare div. Every card repeats the same terms —
      "Destination reserve capacity", "Remaining 24-hour capacity" — so
      with six routes on the page a reader navigating by anything other
      than sight would meet each phrase six times with nothing tying it to
      a route. The route's own heading is that tie.
    */
    <Card role="group" aria-labelledby={headingId}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity aria-hidden="true" className="text-ink-400 size-4 shrink-0" />
          <h2 id={headingId} className="text-heading-3">
            {card.label}
          </h2>
        </div>
        <StatusBadge status={executableRouteStatusBadge[card.kind]} />
      </div>

      {/* The backend's own sentence, verbatim. This UI never authors a
          second explanation of a backend decision and never infers which
          gate refused — the response deliberately does not say. */}
      {card.reason && (
        <p className="text-body-sm text-ink-500 mt-2 whitespace-pre-line">
          {card.reason}
        </p>
      )}
      {card.note && <p className="text-body-sm text-ink-500 mt-2">{card.note}</p>}

      {card.capacity && (
        <div className="mt-3">
          <Figure figure={card.capacity} className="text-heading-2" />
          <p className="text-body-sm text-ink-500 mt-1">Destination reserve capacity</p>
        </div>
      )}

      {card.window && (
        <div className="mt-2">
          <Figure figure={card.window} />
          <p className="text-body-sm text-ink-500 mt-1">
            Remaining 24-hour capacity for this direction
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <dl className="border-ink-100 mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3">
          {rows.map((row) => (
            <div key={row.term}>
              <dt className="text-body-sm text-ink-500">{row.term}</dt>
              <dd className={`text-body-sm text-ink-900 ${row.tabular ? "tabular" : ""}`}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

/**
 * Every route the backend knows about, and whether it is open — read
 * straight from `GET /chains`.
 *
 * # Iterated from the response, not from a local list
 *
 * The rows are whatever `/chains` returned. A route — or a whole network —
 * the backend adds later appears here with no frontend deploy, which is
 * the same property that lets the bridge form scale. Networks this build
 * cannot describe still render, by their backend id, rather than being
 * dropped from a list a user is using to check what is supported.
 *
 * # Why this carries no numbers
 *
 * The cards above pair a route with its destination reserve's capacity and
 * its rolling window. This list is the complete registry, and it can include
 * routes for which no such figures exist: a network the backend adds later
 * arrives here before this build can describe it at all, and a route a
 * deployment reports `implemented: false` has no reserve paying it and no
 * window bounding it.
 *
 * So this card states availability and stops. It does not estimate a
 * capacity, borrow another route's figure, or render an empty placeholder
 * that reads as "zero" — an absent number is shown as absent.
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
      {isPending || !chains ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <ul className="flex flex-col gap-3">
          {chains.routes.map((view) => {
            const source = displayDescriptorFor(view.source_chain);
            const destination = displayDescriptorFor(view.destination_chain);
            const state = routeAvailability(chains, view.id);
            return (
              <li
                key={view.id}
                className="border-ink-100 flex flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="text-body-sm text-ink-900 font-medium">
                    {source.name} → {destination.name}
                  </p>
                  <p className="text-body-sm text-ink-500">{view.id}</p>
                </div>
                <div className="sm:max-w-[60%] sm:text-right">
                  {/* Every availability kind has its own status
                      descriptor: "Not implemented" is neutral rather than
                      danger, because nothing is wrong and nothing is
                      waiting to be switched back on, and "Temporarily
                      unavailable" is warn rather than danger because the
                      route is switched on and its reserve will reopen. */}
                  <StatusBadge status={routeAvailabilityStatus[state.kind]} size="sm" />
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
