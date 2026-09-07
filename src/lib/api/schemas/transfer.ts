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
