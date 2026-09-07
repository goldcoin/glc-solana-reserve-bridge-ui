import { ArrowLeftRight, Lock } from "lucide-react";
import { isSettlementRoute } from "@/lib/api/schemas/common";
import type { Route, SettlementRoute } from "@/lib/api/schemas/common";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import { routeAvailability, routeDisplay, ROUTE_PRESENTATION_ORDER } from "@/lib/bridge";
import { cn } from "@/lib/utils/cn";

/**
 * Route control: one radio per route the backend knows about, each naming
 * the token by where it already lives ("GLC L1", "GLC on Solana", "GLC on
 * Robinhood") rather than by chain alone, so the reserve-backed model
 * reads directly off the control — there is no wrapped/native pair to
 * explain.
 *
 * # Availability is the backend's answer, always
 *
 * Every route's selectable state comes from `GET /chains`, which is the
 * same `RouteGate` verdict `POST /quote` and `POST /transfers` enforce.
 * This component holds no list of "routes we support" and derives nothing
 * from configuration: a route opens when the backend says so, with no
 * frontend deploy. Until `/chains` loads, every route is unselectable —
 * unknown availability fails closed, never open.
 *
 * # Closed routes are shown, not hidden
 *
 * A user who expects Robinhood Network should see that it exists and is
 * not usable yet, rather than wondering whether they are on the wrong
 * site. The wording distinguishes the two real cases without parsing the
 * backend's message: `implemented: false` (`SolToRhn`/`RhnToSol` — no
 * settlement machinery exists at all) reads as "Not available", while an
 * implemented-but-closed route carries the backend's own `disabled_reason`
 * verbatim.
 */
export function DirectionSelector({
  value,
  onChange,
  chains,
}: {
  value: SettlementRoute;
  onChange: (direction: SettlementRoute) => void;
  chains: ChainsViewDto | undefined;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Bridge route"
      // Stacked below `sm`: two-across at 360px leaves each button so
      // little width that both token names truncate to fragments.
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
    >
      {ROUTE_PRESENTATION_ORDER.map((id: Route) => {
        const display = routeDisplay(id);
        const availability = routeAvailability(chains, id);
        const selectable = availability.kind === "open" && isSettlementRoute(id);
        const selected = id === value;
        const note =
          availability.kind === "open"
            ? null
            : availability.kind === "unimplemented"
              ? "Not available"
              : availability.kind === "unknown"
                ? "Checking availability…"
                : availability.reason;

        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={display.label}
            aria-disabled={!selectable}
            disabled={!selectable}
            // The reason travels with the control for assistive tech, not
            // only as the visible line below it.
            {...(note ? { title: note } : {})}
            onClick={() => {
              if (selectable && isSettlementRoute(id)) onChange(id);
            }}
            className={cn(
              "min-w-0 rounded-lg border px-4 py-3 text-left transition-colors",
              !selectable && "cursor-not-allowed opacity-60",
              selected
                ? "border-ink-950 bg-ink-950 text-on-inverse"
                : selectable
                  ? "border-ink-200 hover:bg-ink-50 text-ink-900"
                  : "border-ink-200 text-ink-600",
            )}
          >
            <span className="text-body-sm flex min-w-0 items-center gap-1.5 font-medium">
              <span className="min-w-0 truncate">{display.from.token.name}</span>
              <ArrowLeftRight aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{display.to.token.name}</span>
              {!selectable && <Lock aria-hidden="true" className="size-3.5 shrink-0" />}
            </span>
            <span
              className={cn(
                "text-body-sm mt-0.5 block truncate",
                selected ? "text-ink-300" : "text-ink-500",
              )}
            >
              {display.from.chain.name} → {display.to.chain.name}
            </span>
            {note && (
              <span className="text-body-sm text-ink-500 mt-1 block whitespace-pre-line">
                {note}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
