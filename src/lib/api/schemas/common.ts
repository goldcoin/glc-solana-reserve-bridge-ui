import { z } from "zod";

/**
 * Primitives shared by every bridge API schema.
 *
 * Every response is validated against these before it becomes a domain
 * object. A response that does not parse is an error, not a
 * partially-trusted object handed to a component.
 *
 * The backend (`service/src/api.rs` in glc-solana-reserve-bridge) serializes
 * atomic monetary amounts as DECIMAL STRINGS — see
 * `docs/31-atomic-amount-json-encoding.md` there, and `atomicAmountSchema`
 * below for why the numeric form could never have worked.
 */

export const isoTimestampSchema = z.iso.datetime({ offset: true });

/** Unix seconds, as the bridge API reports every timestamp. */
export const unixSecondsSchema = z.number().int().nonnegative();

/**
 * An atomic monetary amount, normalised to an exact integer string.
 *
 * # Why not a number
 *
 * JSON has one numeric type and JavaScript parses it into an IEEE-754
 * double, exact only up to `Number.MAX_SAFE_INTEGER` (2^53 - 1 =
 * 9007199254740991). Production `/stats` served
 * `settled_volume_atomic: 9408405829927559`; `JSON.parse` returned
 * `9408405829927560`. The digits were already gone by the time any schema
 * ran, and the Reserves page failed rather than render a wrong balance.
 *
 * The backend now sends these as strings, which survive `JSON.parse`
 * byte-for-byte. This schema keeps them as strings all the way to
 * `formatBaseUnits`, which has always done its arithmetic on digit strings
 * and `BigInt` — so an amount is never a `number` anywhere in this app.
 *
 * # Why a legacy number is still accepted, but only when provably safe
 *
 * During rollout this UI may talk to a backend that still sends numbers.
 * A number is accepted only if it is a safe integer, i.e. only when the
 * value provably survived the parse; anything above the safe range is
 * REJECTED rather than coerced. Accepting it would mean displaying a
 * corrupted balance, which is strictly worse than the error it replaces —
 * and unlike the error, silent.
 *
 * The output type is `string` in both cases, so nothing downstream has to
 * know which form arrived.
 */
export const atomicAmountSchema = z
  .union([z.string(), z.number()])
  .superRefine((value, ctx) => {
    if (typeof value === "number") {
      if (!Number.isInteger(value)) {
        ctx.addIssue({ code: "custom", message: "atomic amount must be an integer" });
        return;
      }
      if (!Number.isSafeInteger(value)) {
        ctx.addIssue({
          code: "custom",
          message:
            "atomic amount exceeds Number.MAX_SAFE_INTEGER and was already corrupted by " +
            "JSON.parse; the backend must send this field as a decimal string",
        });
      }
      return;
    }
    if (!/^-?\d+$/.test(value)) {
      ctx.addIssue({
        code: "custom",
        message: "atomic amount must be a decimal integer string",
      });
    }
  })
  .transform((value) =>
    typeof value === "number" ? String(value) : normaliseIntegerString(value),
  );

/** As above, but rejects negatives — for amounts that cannot be below zero. */
export const nonNegativeAtomicAmountSchema = atomicAmountSchema.refine(
  (value) => !value.startsWith("-"),
  { error: "atomic amount must not be negative" },
);

/**
 * Canonicalises `"-0"` to `"0"` and strips redundant leading zeros, so two
 * equal amounts always compare equal as strings. Input is already known to
 * match `/^-?\d+$/`.
 */
function normaliseIntegerString(value: string): string {
  const negative = value.startsWith("-");
  const digits = (negative ? value.slice(1) : value).replace(/^0+(?=\d)/, "");
  return negative && /[1-9]/.test(digits) ? `-${digits}` : digits;
}

/**
 * An atomic amount as a `bigint`, for the few places that need to COMPARE
 * or clamp rather than format. Exact by construction: the string never
 * passes through a `number`.
 */
export function toBigInt(atomic: string): bigint {
  return BigInt(atomic);
}

/** `max(atomic, 0)` without leaving the exact domain. */
export function clampAtomicAtZero(atomic: string): string {
  return atomic.startsWith("-") ? "0" : atomic;
}

/** Whether an exact atomic amount is negative. */
export function isNegativeAtomic(atomic: string): boolean {
  return atomic.startsWith("-") && /[1-9]/.test(atomic);
}

/**
 * A URL the UI will render as a link.
 *
 * `z.url()` alone is not enough: it delegates to the URL constructor, which
 * happily accepts `javascript:` and `data:`. Any such value reaching an
 * `href` is a script-execution vector, so the scheme is checked here, at the
 * boundary.
 */
export const httpUrlSchema = z.url().refine((value) => /^https?:\/\//i.test(value), {
  error: "must be an http or https URL",
});

/**
 * Every chain this bridge knows the NAME of — `Chain` in
 * `service/src/routes.rs`. Knowing a chain's name says nothing about
 * whether any route to it is usable; that is `GET /chains`' job alone.
 */
export const chainSchema = z.enum(["goldcoin", "solana", "robinhood"]);
export type Chain = z.infer<typeof chainSchema>;

/**
 * The complete route vocabulary — `Route` in `service/src/routes.rs`,
 * all six spellings.
 *
 * # Parsing a route is not the same as being able to use one
 *
 * This schema exists so a response naming ANY route the backend can
 * produce parses cleanly. It is deliberately permissive, and it is
 * deliberately not an availability signal: `SolToRhn`/`RhnToGlc` and
 * every other value here parse identically whether the route is open,
 * closed, or structurally non-executable.
 *
 * Availability comes from ONE place, `GET /chains`' per-route `enabled`
 * flag (see `./chains`), which is the same `RouteGate` verdict
 * `POST /quote` and `POST /transfers` enforce. This UI must never
 * re-derive it from its own configuration or from the shape of this
 * enum — that is what keeps opening a route a backend-only change.
 *
 * # Why it must accept routes this UI cannot start
 *
 * Before this widened, `directionSchema` accepted exactly `GlcToSol` and
 * `SolToGlc`. A single `GlcToRhn` row anywhere in `GET /transfers` or
 * `GET /explorer/events` would then fail Zod and take down the entire
 * page rather than one row — so the UI would break the moment a
 * Robinhood route was enabled backend-side, with no frontend deploy
 * involved. Parsing is now total over the backend's own enum.
 */
export const routeSchema = z.enum([
  "GlcToSol",
  "SolToGlc",
  "GlcToRhn",
  "RhnToGlc",
  "SolToRhn",
  "RhnToSol",
]);
export type Route = z.infer<typeof routeSchema>;

/**
 * The wire spelling of a transfer's route, as it appears in RESPONSES
 * (`TransferView::direction`, `ExplorerEvent::direction`, `QuoteOutput::
 * direction`). Identical to {@link routeSchema} — the backend's
 * `QuoteInput::direction` field "keeps its name for wire compatibility
 * but is now parsed as a `Route`" (`service/src/api.rs`), so the two
 * vocabularies are one and the same on the wire.
 *
 * Kept as its own name because that is what the wire field is called.
 */
export const directionSchema = routeSchema;
export type Direction = Route;

/**
 * The four routes that have backend SETTLEMENT MACHINERY — exactly the
 * routes for which `Route::as_direction()` returns `Some`, mirrored by
 * `GET /chains`' `implemented: true`.
 *
 * This is the narrow vocabulary for anything the UI can INITIATE: a
 * quote request, a create-transfer, a direction descriptor. `SolToRhn`
 * and `RhnToSol` are excluded at the type level, so no code path can
 * hand either to an action — matching the backend, where those two
 * routes have no `Direction` value to call a settlement function with.
 *
 * Still not an availability check. An implemented route is very often a
 * closed one: both Robinhood routes ship disabled.
 */
export const settlementRouteSchema = z.enum([
  "GlcToSol",
  "SolToGlc",
  "GlcToRhn",
  "RhnToGlc",
]);
export type SettlementRoute = z.infer<typeof settlementRouteSchema>;

/** Whether a wire route is one the UI could ever initiate. */
export function isSettlementRoute(route: Route): route is SettlementRoute {
  return settlementRouteSchema.safeParse(route).success;
}

/**
 * `/reserves/history` uses a different spelling for the same two reserves —
 * a real, documented backend inconsistency (service/src/api.rs), not a typo
 * here.
 */
export const reserveDirectionSchema = z.enum(["goldcoin", "solana"]);
export type ReserveDirectionParam = z.infer<typeof reserveDirectionSchema>;

/** Cursor pagination envelope — `Page<T>` in service/src/api.rs. */
export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    next_cursor: z.string().nullable(),
    as_of: unixSecondsSchema,
  });
}

/** The bridge API's only error shape: `{ "error": string }`, no error code. */
export const apiErrorBodySchema = z.object({
  error: z.string().min(1),
});

export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
