"use client";

import type { RouteAvailability } from "@/lib/bridge";
import type { ChainDescriptor } from "@/lib/bridge";
import type { QuoteOutputDto } from "@/lib/api/schemas/quote";
import { formatDisplayDecimalOrRaw as display } from "@/lib/format/amount";
import { formatBridgeRateSentence } from "@/lib/format/rate";

/**
 * GLC on every network this bridge touches. Named once here rather than read
 * off a descriptor per row, because it is the same three letters on all six
 * routes — what differs between them is the network, which is stated as a
 * network.
 */
const SYMBOL = "GLC";

/**
 * The metadata under the form: what this transfer is, whether it can
 * happen, what it costs, and what arrives.
 *
 * # Everything here is about the SELECTED pair
 *
 * There is deliberately no aggregate — no "2 of 6 routes available", no
 * "both directions are available". A user is doing one transfer, and a
 * summary that describes the bridge as a whole makes them work out which
 * part applies to them. Every row below is derived from the pair currently
 * selected, and nothing else.
 *
 * # Nothing here is computed locally
 *
 * The fee rate and the received amount come from `POST /quote`, the same
 * endpoint that runs the server's own `compute_fee`. The availability
 * sentence is the backend's `disabled_reason`, passed through untouched.
 * This component formats; it does not decide.
 *
 * That now includes the BRIDGE RATE. `quote.bridge_quote.bridge_rate` is the
 * rate the server struck this preview at and would settle a real deposit at
 * (glc-solana-reserve-bridge `docs/38-elastic-bridge-rate.md`); it is the
 * only rate this component may render. It does not derive one from the two
 * `*_price_e12` figures, does not derive one from gross and net, and above
 * all does not fetch a market price from the browser — a rate assembled here
 * would differ from the one the deposit actually settles at.
 */
export function RouteSummary({
  source,
  destination,
  availability,
  quote,
  quotePending,
  requiredConfirmations,
}: {
  source: ChainDescriptor;
  destination: ChainDescriptor;
  availability: RouteAvailability;
  quote: QuoteOutputDto | undefined;
  quotePending: boolean;
  /**
   * Source-chain confirmations a deposit must reach before settlement
   * begins, when the route has a confirmation ramp at all. Absent for
   * contract-funded sources, whose obligation is observed once and folds
   * straight through — there is no count to progress past.
   */
  requiredConfirmations?: number | undefined;
}) {
  const status = statusLabel(availability);
  // The backend's own rate string, formatted to two places and never
  // recomputed. `null` whenever there is no quote, or the quote carries a
  // rate this build cannot read exactly — in both cases the row is absent.
  const rateSentence =
    quote?.bridge_quote === undefined
      ? null
      : formatBridgeRateSentence(
          quote.bridge_quote.bridge_rate,
          source.name,
          destination.name,
          SYMBOL,
        );

  return (
    // A recessed block on the card's plane rather than a bordered card of
    // its own — the same `ink-50` step the FROM/TO panels sit on. The
    // outline it used to carry was the fourth nested rectangle in a 510px
    // card and the only one separating content that is already separated
    // by being the last thing in the form.
    <div className="bg-ink-50 rounded-lg px-3 py-2.5">
      {/* Two across at every width, never four. The compact card is ~510px
          wide, which leaves a four-column cell too narrow to hold
          "Goldcoin → Robinhood" or a fee's rate-and-amount on one line —
          each then ran onto a second line, costing more height than the
          second row of a two-column grid does. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <Row label="Route">
          {/* Wraps rather than truncates: a route name clipped to
              "Goldcoin → Robinho…" is worse than one on two lines. */}
          <span className="block">
            {source.name} → {destination.name}
          </span>
        </Row>

        <Row label="Status">
          <span>{status}</span>
        </Row>

        {/* The live bridge rate, spelled out as a sentence across both
            columns. It sits above the fee because it is what the fee and
            the received amount are both derived from: at a rate of 3.43 a
            user who reads "You receive" without it has no way to tell a
            good quote from a bad one.

            Withheld entirely when the backend did not send a quote — a
            pre-v37 daemon — rather than falling back to 1.0. "We are not
            showing you a rate" is recoverable; "the rate is 1.00" when it
            is 3.43 is not. */}
        {rateSentence !== null && (
          <Row label="Bridge rate" className="col-span-2">
            <span className="tabular">{rateSentence}</span>
          </Row>
        )}

        <Row label="Bridge fee">
          {/* The rate AND the amount. A percentage alone leaves the user to
              do arithmetic this app deliberately refuses to do for itself,
              and both figures are the backend's own — `POST /quote` runs
              the same `compute_fee` that a real settlement runs.

              No network suffix. This used to read "… GLC (Goldcoin)" on a
              `GlcToSol` quote, which was simply false: the bridge fee is
              charged and accrued in the DESTINATION asset (decision J-5,
              `BridgeQuote::fee_out`), so `fee_display_amount` was never a
              Goldcoin figure. At the Phase 2A fixed rate of 1.0 the wrong
              label at least named an equal amount; at a live rate of 3.43
              it names a figure that does not exist on either chain. The
              destination is stated one row down, on the only figure the
              user actually receives, so repeating it here would add a
              second network label to a four-row summary for nothing. */}
          <span className="tabular">
            {quote
              ? `${formatBps(quote.fee_bps)} · ${display(quote.fee_display_amount)} ${SYMBOL}`
              : quotePending
                ? "…"
                : "—"}
          </span>
        </Row>

        <Row label="You receive">
          {/* Named with the network, not with `destination_asset`. The
              backend's string is "GLC (Solana)", which parenthesises the
              one fact that matters most here; "93,331.52 GLC on Solana"
              states it. Both sides of every route are GLC, so the network
              IS the distinguishing fact, and a user who misreads which
              chain their funds land on has no way to recover them. */}
          <span className="tabular">
            {quote
              ? `${display(quote.net_display_amount)} ${SYMBOL} on ${destination.name}`
              : quotePending
                ? "…"
                : "—"}
          </span>
        </Row>

        {requiredConfirmations !== undefined && (
          <Row label="Confirmations" className="col-span-2">
            <span>
              {requiredConfirmations} on {source.name} before settlement begins
            </span>
          </Row>
        )}

        {availability.kind !== "open" && (
          <div className="col-span-2">
            <dt className="sr-only">Why this route is unavailable</dt>
            {/* The backend's own sentence. This UI never authors a second
                explanation of a closed route, and never infers which gate
                refused. */}
            <dd className="text-body-sm text-ink-500 whitespace-pre-line">
              {availability.reason}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function Row({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-body-sm text-ink-500 leading-4">{label}</dt>
      {/* Leading tightened, size untouched: a summary of four short
          figures does not need `body`'s reading leading, and two points a
          row is four off the card for nothing a reader can perceive. */}
      <dd className="text-body text-ink-900 min-w-0 leading-5">{children}</dd>
    </div>
  );
}

/**
 * The one-word state of the selected pair.
 *
 * `closed` used to read "Coming soon", because the backend's own copy for
 * the routes that were closed at the time said support was in development.
 * It is not a promise this UI may make any more: every route the backend
 * names is built and settling, so a closed one is switched off, not unbuilt,
 * and "Coming soon" told a user to wait for a launch that already happened.
 * "Currently unavailable" is what `closed` actually means, and it matches
 * the Routes list's badge for the same verdict.
 *
 * `unavailable` is the weaker statement: the route is switched on and a
 * runtime gate on its destination reserve is holding it shut, so it reopens
 * on its own without an operator. `unimplemented` is the stronger one: no
 * settlement machinery at all, which no operator action opens. The
 * backend's full sentence renders underneath in every case.
 */
function statusLabel(availability: RouteAvailability): string {
  switch (availability.kind) {
    case "open":
      return "Available";
    case "closed":
      // Switched off on this deployment. Distinct from `unavailable` only
      // in who reopens it, which the sentence below says and this label
      // does not try to.
      return "Currently unavailable";
    case "unavailable":
      // Switched on and currently refused. Worded as temporary because it
      // is: this route works and its destination reserve is simply not
      // admitting right now.
      return "Temporarily unavailable";
    case "unimplemented":
      return "Not available";
    case "unknown":
      return "Checking…";
  }
}

/** "300" -> "3%", "50" -> "0.5%". Integer arithmetic; never a float rate. */
function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  return fraction === 0 ? `${whole}%` : `${(bps / 100).toFixed(2)}%`;
}
