import { z } from "zod";
import { nonNegativeAtomicAmountSchema, unixSecondsSchema } from "./common";

/**
 * `GET /chains` — the chain/route registry, and the ONLY authoritative
 * answer to "can a user start a transfer this way right now".
 *
 * # Two fields, two different questions
 *
 * `enabled` is the server's own `RouteGate` verdict — the same gate
 * `POST /quote` and `POST /transfers` enforce, evaluated per request and
 * never cached (`service/src/routes.rs`). It is the AND of three
 * independent gates: the service config, the ledger's `bridge_routes`
 * table, and the chain adapter's capability. For anything touching the
 * Robinhood custody contract there is a fourth gate this service does
 * not control at all — the contract's own `routeEnabled`, read live
 * before every broadcast. It reads NO reserve state whatsoever.
 *
 * `available` (backend PR #76) is `enabled` AND every runtime gate on the
 * route's DESTINATION reserve. It exists because `enabled` alone was read
 * as permission in production while `GoldcoinReserve`'s admission was
 * closed, and `RhnToGlc` deposits — which reach the custody contract with
 * no `POST /transfers` preflight — folded straight into `ManualReview`
 * with users' funds already committed.
 *
 * **A "start a transfer" affordance is gated on `available`.**
 * `enabled`/`implemented` choose only the WORDING: "Coming soon" for a
 * route this build cannot serve, "temporarily unavailable" for one that
 * is switched on and currently closed.
 *
 * A UI must render availability from these fields and must never re-derive
 * it from its own configuration. That is what makes enabling a route
 * later a backend-only change: no frontend deploy, no env var, no
 * hardcoded list of "routes we support" to go stale.
 *
 * # Why this endpoint's ids are open strings, unlike every other schema
 *
 * `/chains` is the DISCOVERY endpoint: its entire job is to tell a client
 * about networks and routes, including ones the client may not know. So a
 * chain or route id here is an open string, and a backend that adds a
 * fourth network ships it to an unchanged frontend without breaking the
 * page — the new network simply lists as one this build cannot use yet.
 *
 * That is the opposite of the rule for settlement records. A
 * `TransferView.direction` outside the known `Route` enum is a contract
 * break worth surfacing loudly, and stays strictly validated. Discovery is
 * open; anything describing money that has already moved is closed.
 */

/** One chain. Names only — the backend exposes no RPC URL, contract address or explorer host here. */
export const chainViewSchema = z.object({
  /** Stable identifier — `goldcoin`/`solana`/`robinhood` today, open by design. */
  id: z.string().min(1),
  /** Human-readable. Never parse this. */
  display_name: z.string().min(1),
});

export type ChainViewDto = z.infer<typeof chainViewSchema>;

export const routeViewSchema = z.object({
  id: z.string().min(1),
  source_chain: z.string().min(1),
  destination_chain: z.string().min(1),
  /**
   * The server's `RouteGate` verdict: is this route SWITCHED ON in this
   * deployment? Config + `bridge_routes` + adapter capability, and no
   * reserve state at all — read `available` below before offering a
   * transfer.
   */
  enabled: z.boolean(),
  /**
   * Cause-agnostic end-user copy when `enabled` is false; null when
   * enabled. It deliberately never names which gate refused, and this UI
   * must not try to infer one — it renders the sentence as given.
   */
  disabled_reason: z.string().nullable(),
  /**
   * Whether the route has settlement machinery at all
   * (`Route::as_direction().is_some()`). `false` means structurally inert
   * in this build, not merely switched off — which is exactly the
   * distinction between "Coming soon" and "temporarily unavailable", and
   * it is available WITHOUT parsing `disabled_reason`.
   */
  implemented: z.boolean(),
  /**
   * **The field a "start a transfer" affordance must be gated on**
   * (backend PR #76, `RouteView::available`): `enabled` AND every runtime
   * gate on this route's DESTINATION reserve — paused, admission closed,
   * the confirmed-liquidity gate and its safety buffer, the mature-UTXO
   * pool floor, and capacity.
   *
   * `enabled` alone is not that answer and never was. It is the
   * `RouteGate` verdict over config, `bridge_routes` and adapter
   * capability, and it reads NO reserve state — which is exactly how
   * `RhnToGlc` came to report `enabled: true` while `GoldcoinReserve`
   * admission was closed, folding every newly observed Robinhood deposit
   * straight into `ManualReview`. An `RhnToGlc` deposit reaches the
   * custody contract with no `POST /transfers` preflight in front of it,
   * so this published signal is the only thing standing between a user
   * and an irreversible on-chain deposit the bridge will not settle
   * normally.
   *
   * OPTIONAL on the wire, and deliberately not defaulted to `true`: a
   * deployment predating PR #76 omits it, and `undefined` therefore means
   * "this backend does not publish effective availability", which
   * `routeAvailability` treats as unknown rather than as a yes. It is
   * amount-independent by construction (it is asked before an amount
   * exists) and says nothing about the per-recipient/per-source-wallet
   * rolling-24h windows — `GET /recipients/{sol,rhn}-to-glc/eligibility`
   * owns those.
   */
  available: z.boolean().optional(),
  /**
   * Cause-agnostic end-user copy when `available` is `false`; `null` when
   * available. Rendered verbatim, exactly like `disabled_reason` — the
   * backend deliberately never names which gate refused, and this UI must
   * not try to infer one.
   */
  unavailable_reason: z.string().nullable().optional(),
  /**
   * **The authoritative source-side minimum for this route** — canonical
   * 8-decimal units, the figure to render as "Min … GLC".
   *
   * # Render it; do not compute with it
   *
   * This is the backend's `min_transfer::SOURCE_MINIMUM_CANONICAL`: the
   * smallest GROSS the bridge accepts, and the same value `POST
   * /transfers` and `POST /quote` admit against. The bridge fee is
   * deducted AFTER that check, so a minimum transfer legitimately
   * delivers less than this — adjusting the displayed figure for the fee
   * would state a floor the backend does not apply.
   *
   * That adjustment is exactly what this field replaces. Before it,
   * a client had to reconstruct a minimum from whichever CHAIN floor
   * governed the route, grossing it up when that floor bounded the net —
   * which produced entry minimums like "102.061856 GLC": correct
   * arithmetic against the wrong rule, silently different every time a
   * fee moved.
   *
   * # Optional, so the two repos can deploy in either order
   *
   * A backend that predates this field omits it, which must read as "not
   * published" and leave the minimum absent — never as `0`, which would
   * claim the route has no floor at all.
   */
  min_transfer_atomic: nonNegativeAtomicAmountSchema.optional(),
  /**
   * **The authoritative source-side maximum for this route** — the figure
   * to render as "Max per transfer", as a canonical decimal string
   * (`"20000.00000000"`).
   *
   * # Per ROUTE, which is the whole point
   *
   * The bridge's per-transfer ceiling is not a property of a chain. Two
   * routes leaving the same chain can carry different source limits —
   * `SolToGlc` at 50,000 and `GlcToSol` at 20,000 — and no chain-level
   * figure can express that.
   *
   * Before this field a client had to pick a published ceiling per route
   * itself: the Solana program's `per_transfer_limit` for a Solana-sourced
   * route, the custody contract's `inbound`/`outboundMax` for a Robinhood
   * one, and for a Goldcoin-sourced route — which has no source ceiling at
   * all — whatever bounded its DESTINATION payout. Each of those is a real
   * on-chain limit, and none of them is the limit the backend admits a
   * user's transfer against. That reconstruction put a Robinhood
   * contract's 2,000,000 outbound ceiling on the `GlcToRhn` card while the
   * backend was admitting 20,000, and showed `SolToGlc` and `SolToRhn` the
   * same 20,000 when one of them is 50,000.
   *
   * So: render THIS route's value, and derive nothing. Not from the
   * destination reserve's capacity, not from a settlement per-transfer
   * limit, not from a custody contract's outbound maximum, not from the
   * Solana program's `per_transfer_limit`, not from the destination chain,
   * and not from any static chain-level mapping. The backend has already
   * done that work per route.
   *
   * It is the SOURCE-side user limit, and it bounds the gross a user may
   * submit. It is not the destination reserve's capacity, which is a
   * different quantity that can legitimately be far larger and is reported
   * in its own right.
   *
   * # Optional, so the two repos can deploy in either order
   *
   * A backend predating this field omits it, which must read as "not
   * published" and leave the maximum absent — never as `0`, and never as a
   * chain ceiling reconstructed locally, which is exactly what this field
   * replaces.
   */
  max_transfer_display: z
    .string()
    .regex(/^\d+(\.\d+)?$/, {
      error: 'must be a non-negative decimal string, e.g. "20000.00000000"',
    })
    .optional(),
});

export type RouteViewDto = z.infer<typeof routeViewSchema>;

export const chainsViewSchema = z.object({
  chains: z.array(chainViewSchema),
  routes: z.array(routeViewSchema),
  as_of: unixSecondsSchema,
});

export type ChainsViewDto = z.infer<typeof chainsViewSchema>;
