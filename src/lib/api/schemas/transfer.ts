import { z } from "zod";
import {
  directionSchema,
  nonNegativeAtomicAmountSchema,
  paginatedSchema,
  settlementRouteSchema,
  unixSecondsSchema,
} from "./common";

/**
 * `RequestState` — the real, currently-implemented wire enum from
 * `service/src/ledger/types.rs`. Every one of these values can appear on the
 * wire; the UI must render all of them without crashing.
 *
 * States after `SourceFinalized` are defined by the backend but not yet
 * driven by an implemented settlement pipeline (see
 * `docs/MIGRATION_ASSESSMENT.md`) — the UI must not assume every transfer
 * reaches `Settled`, only that it could, and must render whatever state the
 * backend actually reports.
 *
 * The three `Refund*` values are the refund lifecycle production actually
 * emits: a request that cannot settle is routed to `ManualReview` and the
 * operator returns the deposit, which walks
 * `ManualReview -> RefundPending -> RefundBroadcast -> Refunded`
 * (`reason` = `glc_refund_started`, then `glc_refund_broadcast`). A refund
 * is a completed, non-failure outcome — the user's funds came back — so it
 * is deliberately neither a failure state nor a settlement success.
 *
 * `Closed` is the operator-driven terminal state. It means the bridge has
 * stopped working this request WITHOUT settling it, and what actually
 * happened to the deposit is carried by the accompanying disposition rather
 * than by the state name — the explorer event reads
 * `closed:refunded_out_of_band reference=<signature>`. It is neither a
 * failure nor a settlement: production request #4361 was closed after its
 * 50,000 GLC deposit was returned by hand on Solana, so calling it a failure
 * would tell the user their funds were lost when they had already been sent
 * back. See {@link manualRefundViewSchema} for the facts that ride with it.
 *
 * This list is what a TRANSFER may be in, and it stays strict: an unknown
 * value on `GET /transfers/:id` is a contract break for that one transfer
 * and must be surfaced, not guessed at. The explorer, which renders every
 * request's history at once, relaxes this per row — see
 * `eventRequestStateSchema` in `./explorer`.
 */
export const requestStateSchema = z.enum([
  "LiquidityReserved",
  "AwaitingDeposit",
  "DepositObserved",
  "Confirming",
  "SourceFinalized",
  "SettlementAuthorized",
  "DestinationSubmitted",
  "DestinationConfirmed",
  "Settled",
  "Expired",
  "Cancelled",
  "Reorged",
  "InsufficientReserveAtSettlement",
  "DestinationSubmissionFailed",
  "ManualReview",
  "RefundPending",
  "RefundBroadcast",
  "Refunded",
  "Failed",
  "Closed",
]);

export type RequestState = z.infer<typeof requestStateSchema>;

/**
 * `RefundView` — the authoritative refund facts for a transfer whose deposit
 * is being, or has been, returned. The backend attaches it exactly when the
 * transfer is in one of the three refund-lifecycle states.
 *
 * # Why the settlement trio is not enough
 *
 * A refunded request never settled, so `gross_amount_atomic` /
 * `fee_amount_atomic` / `net_amount_atomic` describe only the settlement that
 * did not happen — they are the QUOTE the request was created under, not an
 * outcome. Production request #2477 (`GlcToSol`; 29,100 GLC requested,
 * 29,050 GLC actually deposited, parked on `deposit_amount_mismatch`, then
 * refunded in full with no fee charged and no Solana payout) rendered as
 * "You bridge 29,100 GLC / Bridge fee (3%) 873 GLC / You receive 28,227 GLC".
 * All three figures were false.
 *
 * Everything here comes from the backend's own refund row (`goldcoin_refunds`
 * / `solana_refunds` in glc-solana-reserve-bridge), written from
 * independently chain-verified evidence. This UI must never reconstruct a
 * refund amount from the expected gross, from the net, from `failure_reason`,
 * or by arithmetic of its own.
 *
 * There is deliberately no refund DESTINATION address: `TransferView` is
 * served unauthenticated on the public explorer route and has never carried
 * any party's address.
 */
export const refundViewSchema = z.object({
  /**
   * The refund ROW's lifecycle state, which is finer-grained than the
   * transfer's own: `Built`/`Signed`/`Broadcast`/`Refunded` for `GlcToSol`,
   * `Pending`/`Broadcast`/`Confirmed` for `SolToGlc`. Deliberately an open
   * string rather than an enum: it is supplementary detail, and a value added
   * backend-side later must not fail the whole transfer the way an unknown
   * `state` legitimately does.
   */
  state: z.string().min(1),
  /** What actually arrived on the source chain — canonical units. */
  observed_amount_atomic: nonNegativeAtomicAmountSchema,
  /** The principal actually returned to the depositor — canonical units. */
  refund_amount_atomic: nonNegativeAtomicAmountSchema,
  /**
   * The bridge fee actually charged. The backend sends `0` for every refund —
   * the fee accrues at settlement only — but it is read rather than assumed,
   * so the "no bridge fee was charged" statement this UI makes is the
   * backend's own, never the UI's invention.
   */
  fee_charged_atomic: nonNegativeAtomicAmountSchema,
  /** Goldcoin txid or Solana signature; null until the refund is broadcast. */
  refund_txid: z.string().nullable(),
  broadcast_at: unixSecondsSchema.nullable(),
  refunded_at: unixSecondsSchema.nullable(),
});

export type RefundViewDto = z.infer<typeof refundViewSchema>;

/**
 * The disposition the backend publishes for a `Closed` request: what was
 * actually done with the deposit when the bridge stopped working it.
 *
 * Deliberately an OPEN string rather than an enum. The state itself already
 * stays strict (see {@link requestStateSchema}), and that is the check worth
 * failing a transfer over; a disposition this build has not heard of is
 * supplementary detail on a state it can already render, so rejecting the
 * whole transfer for it would trade a slightly thinner page for no page at
 * all. The one value this build recognises is `refunded_out_of_band`
 * (`MANUAL_REFUND_DISPOSITION` in `src/lib/bridge/state`).
 *
 * Also accepted as absent: the deployment serving production today conveys
 * the same fact through `manual_refund.status` and through the explorer
 * event's `closed:refunded_out_of_band` reason, and this UI must parse that
 * payload as it stands rather than requiring a field the backend does not
 * send yet.
 */
export const dispositionSchema = z.string().min(1);

/**
 * `ManualRefundView` — the facts for a deposit returned BY HAND, outside the
 * automated refund pipeline, after which the request was `Closed`.
 *
 * # Why this is not {@link refundViewSchema}
 *
 * A `RefundView` describes a row the bridge's own refund machinery wrote and
 * walked through `RefundPending -> RefundBroadcast -> Refunded`. A manual
 * refund never entered that machinery: an operator sent the funds back
 * directly on the destination network and the resulting transaction was
 * imported against the request afterwards. The two carry different fields,
 * arrive on different transfers, and mean different things, so they are two
 * schemas rather than one with everything optional.
 *
 * # Why the settlement trio must not be shown beside it
 *
 * For exactly the reason spelled out on `refundViewSchema`: a closed request
 * settled nothing, so `gross_amount_atomic`/`fee_amount_atomic`/
 * `net_amount_atomic` are the quote it was created under and not an outcome.
 * Production request #4361 (`SolToGlc`, 50,000 GLC) carries a 6% fee and a
 * 47,000 GLC net in those fields; neither was ever charged or delivered, and
 * the 50,000 GLC below is what the depositor actually received back.
 *
 * Every figure here comes from the backend's own imported refund record. This
 * UI must never reconstruct a manual-refund amount from the quote, from
 * `failure_reason`, or by arithmetic of its own.
 */
export const manualRefundViewSchema = z.object({
  /**
   * The imported record's own marker — `MANUALLY_REFUNDED` today. An open
   * string for the same reason `refundViewSchema.state` is one: a marker
   * added backend-side later is supplementary detail and must not fail the
   * transfer the way an unknown `state` legitimately does. The UI only
   * claims "manually refunded" for the value it recognises
   * (`MANUAL_REFUND_STATUS` in `src/lib/bridge/state`); anything else is
   * rendered as the backend's own word for it.
   */
  status: z.string().min(1),
  /**
   * The network the refund was actually paid on, as a backend chain id
   * (`solana` for #4361). Not derivable from the transfer's direction: a
   * manual refund is an operator decision, and #4361 is a `SolToGlc`
   * request whose deposit went back out on Solana — the SOURCE side — so
   * any inference from the route would eventually name the wrong chain and
   * link the signature to the wrong explorer.
   */
  network: z.string().min(1),
  /**
   * The principal actually returned, in the ledger's canonical unit
   * (Goldcoin's 8 decimals), matching every other amount on `TransferView`.
   */
  refund_amount_atomic: nonNegativeAtomicAmountSchema,
  /**
   * The same amount in the PAYING network's own atomic unit — 6 decimals for
   * the Solana SPL token. Read but not rendered: the page shows one figure,
   * in the one unit the rest of the page is already in, so the two can never
   * disagree on screen. Present so a future surface that needs the native
   * figure takes the backend's own number rather than rescaling.
   */
  refund_amount_native_atomic: nonNegativeAtomicAmountSchema
    .nullish()
    .transform((value) => value ?? null),
  /** The SPL mint the refund was paid in, when the network has one. */
  mint: z
    .string()
    .min(1)
    .nullish()
    .transform((value) => value ?? null),
  /** The refund transaction on `network` — a Solana signature for #4361. */
  tx_signature: z.string().min(1),
  /** Confirmation slot/height on `network`, when the import recorded one. */
  slot: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((value) => value ?? null),
  /** When the refund landed on chain. */
  refunded_at: unixSecondsSchema.nullish().transform((value) => value ?? null),
  /** When the bridge imported the refund against this request. */
  imported_at: unixSecondsSchema.nullish().transform((value) => value ?? null),
});

export type ManualRefundViewDto = z.infer<typeof manualRefundViewSchema>;

/** `TransferView` — used by GET /transfers/:id and as list items in GET /transfers. */
export const transferViewSchema = z.object({
  id: z.number().int(),
  direction: directionSchema,
  state: requestStateSchema,
  gross_amount_atomic: nonNegativeAtomicAmountSchema,
  /** Basis points — bounded, stays a number. */
  fee_bps: z.number().int().nonnegative(),
  fee_amount_atomic: nonNegativeAtomicAmountSchema,
  net_amount_atomic: nonNegativeAtomicAmountSchema,
  created_at: unixSecondsSchema,
  source_txid: z.string().nullable(),
  source_confirmations: z.number().int().nonnegative(),
  required_source_confirmations: z.number().int().nonnegative().nullable(),
  destination_txid: z.string().nullable(),
  failure_reason: z.string().nullable(),
  /**
   * Present only for the refund lifecycle — see {@link refundViewSchema}.
   *
   * Accepted as absent as well as null, because this UI can be deployed ahead
   * of a backend that serves the field. A refund-state transfer without it
   * still must NOT fall back to the settlement trio: the component renders
   * what it knows and says the rest is unavailable, rather than presenting
   * quote figures as an outcome.
   */
  refund: refundViewSchema.nullish().transform((value) => value ?? null),
  /**
   * Present only when the deposit was returned by hand — see
   * {@link manualRefundViewSchema}. Absent, null, or absent-because-this-
   * backend-predates-the-field all mean the same thing here: there is no
   * manual refund to describe.
   *
   * Strict once present, unlike {@link dispositionSchema}. These are the
   * figures the page states as fact — an amount, a network, a signature a
   * user will click through to — so a `manual_refund` the UI cannot read is
   * a contract break worth surfacing, exactly as an unknown `state` is.
   * Rendering "manually refunded" with a number this build had to guess at
   * is the one outcome worse than an error.
   */
  manual_refund: manualRefundViewSchema.nullish().transform((value) => value ?? null),
  /**
   * What the bridge did with the deposit before closing the request — see
   * {@link dispositionSchema}. Corroborates `manual_refund` rather than
   * replacing it: the amount, network and signature come from that object
   * alone, and a disposition on its own is never enough to claim a refund
   * happened.
   */
  disposition: dispositionSchema.nullish().transform((value) => value ?? null),
});

export type TransferViewDto = z.infer<typeof transferViewSchema>;

export const transferListSchema = paginatedSchema(transferViewSchema);
export type TransferListDto = z.infer<typeof transferListSchema>;

/**
 * Request body for `POST /transfers` — `CreateTransferInput`.
 *
 * Goldcoin-SOURCED routes only (`GlcToSol`, `GlcToRhn`). The two
 * contract-sourced routes have no create endpoint by design: the
 * depositor calls the chain directly and the backend's indexer folds the
 * resulting obligation.
 */
export const createTransferRequestSchema = z.object({
  /**
   * Sent as an exact decimal string. The backend accepts a string or a
   * number, and a string is the only form that can carry an amount above
   * `Number.MAX_SAFE_INTEGER` without corrupting it.
   */
  amount_atomic: z.string().regex(/^\d+$/, "must be a decimal integer string"),
  /**
   * Spelled in the DESTINATION chain's own notation and parsed as that
   * chain's address type: a base58 Solana pubkey for `GlcToSol`, a
   * `0x`-prefixed 20-byte EVM address for `GlcToRhn`. Which one is
   * expected follows from `route`, so the two are never interchangeable
   * and a mismatch is a parse failure backend-side, not a silently stored
   * blob.
   */
  recipient: z.string().min(1),
  /**
   * The route to create. OPTIONAL on the wire: an absent field means
   * `GlcToSol`, which is what this endpoint has always created.
   *
   * A route that is PRESENT and refused is an error, never a fallback —
   * the backend has no input naming `GlcToRhn` that produces a `GlcToSol`
   * request. It is gated before any fee computation, chain read, capacity
   * reservation, ledger write or deposit-address derivation, so a refused
   * route leaves no trace: no row, no reserved liquidity, no address.
   *
   * Sent explicitly by this UI even for `GlcToSol`, so what a request
   * creates is stated rather than inherited from a default.
   */
  route: settlementRouteSchema.optional(),
});

export type CreateTransferRequest = z.infer<typeof createTransferRequestSchema>;

/**
 * `201` body for `POST /transfers` — `CreateTransferOutput`.
 *
 * `deposit_address` is unique to this one request (`goldcoin::derivation`
 * in glc-solana-reserve-bridge) — the user sends the exact amount they
 * requested to it directly. No OP_RETURN or other binding value is
 * needed or returned.
 */
export const createTransferOutputSchema = z.object({
  request_id: z.number().int(),
  deposit_address: z.string().min(1),
});

export type CreateTransferOutputDto = z.infer<typeof createTransferOutputSchema>;
