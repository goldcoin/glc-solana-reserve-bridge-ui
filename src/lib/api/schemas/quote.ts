import { z } from "zod";
import {
  directionSchema,
  nonNegativeAtomicAmountSchema,
  unixSecondsSchema,
} from "./common";

/** Request body for `POST /quote` — `QuoteInput`. */
export const quoteRequestSchema = z.object({
  direction: directionSchema,
  /** Exact decimal string — see `createTransferRequestSchema`. */
  gross_amount: z.string().regex(/^\d+$/, "must be a decimal integer string"),
});

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

/**
 * `BridgeQuoteView` — the bridge quote a figure was struck from
 * (glc-solana-reserve-bridge `docs/38-elastic-bridge-rate.md`, schema v37).
 *
 * # What the rate is
 *
 * `bridge_rate` is `source_price / destination_price` as a decimal string
 * with TWELVE places — `"3.430000000000"`, never a JSON number. The backend
 * renders it from the two `*_price_e12` integers by integer arithmetic; this
 * UI formats it for display and never parses it back into a float, and never
 * recomputes it from the two prices.
 *
 * Phase 2A served a fixed `"1.000000000000"` on every route. Phase 2B strikes
 * it live: the daemon reads one verified feed per rail, smooths each over a
 * time-weighted window, and gates the result on staleness, warm-up and a
 * movement band. The rails are legitimately far from parity under it —
 * `GlcToSol` is around 3.43 and `RhnToGlc` around 0.223 at the time of
 * writing — and which venues they are read from is the backend's business,
 * documented there and deliberately not named here.
 *
 * **This is the only bridge rate this application may show.** It is the rate
 * the server will actually settle at, produced by the same `RateBook::quote`
 * every pricing site uses. A rate this browser assembled from a public market
 * endpoint would be a different number from the one the deposit settles at,
 * and showing it would be a promise the bridge never made — see
 * `tests/unit/no-browser-price-feeds.test.ts`, which holds that line.
 *
 * # Which side the amounts are in
 *
 * `gross_in_amount` is the SOURCE asset. `gross_out_amount`,
 * `bridge_fee_amount`, `net_out_amount` and `dust_amount` are all the
 * DESTINATION asset, in canonical 8-decimal units — the fee is charged and
 * accrued destination-denominated (decision J-5), which is why no figure
 * below may be labelled with the source network.
 */
export const bridgeQuoteViewSchema = z.object({
  /** `source / destination`, twelve decimal places, as a string. */
  bridge_rate: z.string().min(1),
  source_price_e12: nonNegativeAtomicAmountSchema,
  destination_price_e12: nonNegativeAtomicAmountSchema,
  /** Source asset, canonical units — what the depositor sends. */
  gross_in_amount: nonNegativeAtomicAmountSchema,
  /** Destination asset, canonical units — `gross_in` valued at the rate. */
  gross_out_amount: nonNegativeAtomicAmountSchema,
  fee_bps: z.number().int().nonnegative(),
  /** Destination asset, canonical units. */
  bridge_fee_amount: nonNegativeAtomicAmountSchema,
  /** Destination asset, canonical units — what the recipient is owed. */
  net_out_amount: nonNegativeAtomicAmountSchema,
  /**
   * The sub-destination-unit residual the bridge retains when the net is
   * floored to the destination chain's precision (decision J-7). `0` at a
   * unit rate. Canonical units; optional because Phase 2A omitted it.
   */
  dust_amount: nonNegativeAtomicAmountSchema.optional(),
  quoted_at: unixSecondsSchema,
  quote_expires_at: unixSecondsSchema,
  /**
   * Set once this quote is the SETTLEMENT quote rather than an indicative
   * one. Absent on a `/quote` preview, which is never locked.
   */
  locked_at: unixSecondsSchema.nullish(),
  /**
   * The route's rate movement against one smoothing window ago, in basis
   * points, and whether it breached the band the backend admits within.
   * Present on a live preview; absent on a persisted quote and at a fixed
   * rate.
   */
  movement_bps: z.number().int().nonnegative().nullish(),
  band_exceeded: z.boolean().nullish(),
});

export type BridgeQuoteViewDto = z.infer<typeof bridgeQuoteViewSchema>;

/**
 * `QuoteOutput` — the sole authoritative source for gross/fee/net AND for the
 * bridge rate. The UI must never compute any of these itself; it only formats
 * what this returns.
 *
 * # The pre-quote fields and the quote agree
 *
 * `fee_amount`/`fee_display_amount` and `net_amount`/`net_display_amount` are
 * the SAME figures as the quote's `bridge_fee_amount`/`net_out_amount` under
 * their older names (the backend fills both from one `BridgeQuote::breakdown`),
 * so they are destination-denominated too. `gross_amount` is the exception and
 * keeps its original meaning: what the user SENDS, in the source asset. The
 * destination-side gross is `bridge_quote.gross_out_amount`.
 *
 * `bridge_quote` is optional so a deployment still running a pre-v37 daemon
 * degrades to "no rate shown" rather than failing the whole quote and taking
 * the form down with it. Every amount the form needs is in the older fields.
 */
export const quoteOutputSchema = z.object({
  direction: directionSchema,
  gross_amount: nonNegativeAtomicAmountSchema,
  gross_display_amount: z.string().min(1),
  fee_bps: z.number().int().nonnegative(),
  fee_amount: nonNegativeAtomicAmountSchema,
  fee_display_amount: z.string().min(1),
  net_amount: nonNegativeAtomicAmountSchema,
  net_display_amount: z.string().min(1),
  bridge_quote: bridgeQuoteViewSchema.optional(),
  source_decimals: z.number().int().min(0).max(30),
  destination_decimals: z.number().int().min(0).max(30),
  source_asset: z.string().min(1),
  destination_asset: z.string().min(1),
});

export type QuoteOutputDto = z.infer<typeof quoteOutputSchema>;
