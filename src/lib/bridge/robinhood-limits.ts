import type { RobinhoodLimitsDto } from "@/lib/api/schemas/robinhood";
import { isRobinhoodAvailable } from "@/lib/api/schemas/robinhood";
import { ROBINHOOD_DECIMALS } from "./robinhood-amount";
import { atomicRescaleFloor } from "./canonical";

/**
 * Which side of the Robinhood custody contract a transfer touches.
 *
 * The contract bounds LEGS, not routes. `deposit` enters it and is capped
 * by `inboundMax`; `payout` leaves it and is capped by `outboundMax`. A
 * route is a backend concept and the contract has never heard of one.
 */
export type RobinhoodContractLeg = "deposit" | "payout";

/**
 * There is deliberately no `robinhoodPerTransferMinimum` here.
 *
 * One used to exist, deriving an entry floor from the contract's
 * `inboundMin`/`outboundMin` and grossing the payout leg up through the
 * fee, because `outboundMin` bounds the NET payout. The arithmetic was
 * right; the rule was not. A chain's floor is not a statement about what
 * a user may type, and deriving one from it produced entry minimums that
 * moved with the fee — "102.061856 GLC", "102.56410256 GLC".
 *
 * The minimum is now one published policy figure, identical on every
 * route: `GET /chains`' `min_transfer_atomic`, read by
 * `routeSourceMinimum` in `./route-resolution` and rendered without
 * adjustment. If you find yourself about to add a fee-aware minimum
 * helper back to this file, that is the bug.
 */

const MAX_FIELD: Record<
  RobinhoodContractLeg,
  "inbound_max_atomic" | "outbound_max_atomic"
> = {
  deposit: "inbound_max_atomic",
  payout: "outbound_max_atomic",
};

/**
 * The rolling accumulator each leg is charged against, keyed by the ROUTE
 * the backend names it after.
 *
 * `deposit` is charged by `deposit()` against `inboundRollingLimit`;
 * `payout` is charged by `executePayout` against `outboundRollingLimit`.
 * The backend publishes these under route names — `rhn_to_glc_…`,
 * `glc_to_rhn_…` — so this table is the only place the two vocabularies
 * meet.
 *
 * The NAMES are route-shaped; the buckets are not. The contract holds one
 * inbound accumulator and one outbound accumulator, and every route
 * entering the contract shares the first while every route leaving it
 * shares the second. So `RhnToSol` reads the same inbound figure as
 * `RhnToGlc`, and `SolToRhn` the same outbound figure as `GlcToRhn` —
 * which is exactly what the contract charges them, not an approximation.
 */
const WINDOW_FIELD: Record<
  RobinhoodContractLeg,
  "rhn_to_glc_rolling_window" | "glc_to_rhn_rolling_window"
> = {
  deposit: "rhn_to_glc_rolling_window",
  payout: "glc_to_rhn_rolling_window",
};

/**
 * The contract leg a pair uses, or `null` for a pair that touches the
 * custody contract on neither side.
 *
 * Keyed on WHICH SIDE is Robinhood rather than on a list of pairs, which is
 * what makes it total over the four Robinhood-legged routes instead of the
 * two Goldcoin ones it used to cover:
 *
 * - Robinhood as DESTINATION (`GlcToRhn`, `SolToRhn`) is paid out of the
 *   contract, so it is bounded by `outboundMax` and charged against the
 *   outbound window.
 * - Robinhood as SOURCE (`RhnToGlc`, `RhnToSol`) deposits into it, so it is
 *   bounded by `inboundMax` and charged against the inbound window.
 *
 * A pair with Robinhood on neither side returns `null`, and so does a
 * same-network pair — there is no self-route to bound.
 *
 * # Why this reads chain ids rather than a resolved route
 *
 * `BridgeForm` resolves the route exactly once and everything else reads
 * that result — this is the one exception, and it is a compiler
 * constraint rather than a design preference. A value the form has handed
 * to an imported function can no longer be a `useMemo` dependency there
 * (the React Compiler cannot prove it is not mutated afterwards, and
 * declines to optimize the whole component), and the resolved route has
 * been handed to several by the time limits are computed. Deriving the
 * leg from the two chain ids sidesteps that.
 *
 * The cost is a second statement of which pairs are which, so
 * `robinhood-per-transfer-max.test.ts` pins this function against
 * `resolveRoute` for every pair the form can reach. They cannot drift
 * apart without that test failing.
 */
export function robinhoodContractLeg(
  sourceChainId: string,
  destinationChainId: string,
): RobinhoodContractLeg | null {
  if (sourceChainId === destinationChainId) return null;
  if (sourceChainId === "robinhood") return "deposit";
  if (destinationChainId === "robinhood") return "payout";
  return null;
}

/**
 * The authoritative per-transaction maximum for one Robinhood leg, in the
 * SOURCE token's own base units — ready to be handed to `validateAmount`
 * and `display` beside an amount the user typed.
 *
 * # Where the number comes from
 *
 * `GET /robinhood/limits`, which the backend fills from a live `limits()`
 * read of the deployed `GlcRobinhoodBridge` and from nowhere else. There
 * is no constant here and no fallback to `GET /limits`: that endpoint
 * describes the Solana program, whose ceilings Robinhood does not
 * enforce, and substituting it would publish a maximum no chain applies.
 *
 * The two fields are required to hold the same number — the backend
 * configures a single `[robinhood.policy].per_transfer_limit` and
 * `glc-admin robinhood-preflight` reports any divergence between it and
 * either field as a mismatch. They are still read separately rather than
 * collapsed, because the contract is the enforcement layer: a deployment
 * whose fields have drifted must show each leg the ceiling that actually
 * bounds it, not one picked from whichever side was read first.
 *
 * # `undefined` means "not read", never "no maximum"
 *
 * Every field is null unless `availability` is exactly `"available"`, and
 * an unknown availability spelling fails closed through
 * {@link isRobinhoodAvailable}. Returning `undefined` leaves
 * `AmountBounds.maximum` absent, which is the state the form was in
 * before this existed: no client-side ceiling shown and none enforced,
 * with the contract still refusing anything above its own. A zero would
 * instead read as "this route takes nothing", and a remembered figure
 * would state a limit nobody confirmed.
 *
 * # Units
 *
 * The endpoint reports Robinhood's native 18 decimals. A `deposit` leg
 * sources from Robinhood and needs no conversion; a `payout` leg sources
 * from something coarser — Goldcoin's canonical 8, or the Solana mint's 6 —
 * so the figure narrows to whatever `sourceDecimals` says. FLOORED, never
 * rounded — the same "never more permissive than the chain" convention
 * `atomicRescaleFloor` exists for.
 *
 * # NOT the maximum a user is shown
 *
 * This is the CONTRACT's bound on its own leg: what `deposit()` reverts
 * above, and what a payout may not exceed. It is not the limit the bridge
 * admits a transfer against, and it must never be rendered as one — the
 * form and the status cards both read `max_transfer_display` from that
 * route's own `GET /chains` entry through `routeSourceMaximum`. Reading
 * this field for the user-facing maximum is exactly what offered
 * `GlcToRhn` the contract's 2,000,000 `outboundMax` against a real limit
 * of 20,000.
 */
export function robinhoodPerTransferMaximum(
  leg: RobinhoodContractLeg | null,
  limits: RobinhoodLimitsDto | undefined,
  sourceDecimals: number,
): string | undefined {
  if (leg === null) return undefined;
  if (!limits || !isRobinhoodAvailable(limits.availability)) return undefined;
  const raw = limits[MAX_FIELD[leg]];
  if (raw === null) return undefined;
  return atomicRescaleFloor(raw, ROBINHOOD_DECIMALS, sourceDecimals);
}

/**
 * What is left of this leg's rolling 24-hour window right now, in the
 * SOURCE token's own base units — the figure behind "… GLC remaining
 * today".
 *
 * # Authoritative, not derived
 *
 * This is `remaining_atomic` from the accumulator the CONTRACT charges:
 * `inboundWindow()` for a deposit leg, `outboundWindow()` for a payout one,
 * each against its own `…RollingLimit`, projected for now by the same
 * backend helper `GET /robinhood/reserve` uses. Nothing is subtracted
 * here, and nothing is inferred from this UI's own view of recent
 * activity: a figure assembled client-side would be a second opinion about
 * a number only the chain holds, and it would be wrong the moment any
 * other participant transacted.
 *
 * The backend has already applied the contract's own rollover rule, so an
 * expired bucket arrives as the FULL limit rather than a stale total —
 * which is what `_consumeWindow` would really leave on its next write.
 *
 * # What the number is denominated in
 *
 * `deposit` (`RhnToGlc`, `RhnToSol`): the window is charged the deposited
 * amount, so this is directly comparable with what the user types.
 *
 * `payout` (`GlcToRhn`, `SolToRhn`): the window is charged the NET payout,
 * so this slightly understates the gross a user could still spend. Left
 * understated deliberately — grossing it up would advertise headroom the
 * contract would refuse, and the safe direction for a remaining figure is
 * down. FLOORED on narrowing for the same reason.
 */
export function robinhoodRollingRemaining(
  leg: RobinhoodContractLeg | null,
  limits: RobinhoodLimitsDto | undefined,
  sourceDecimals: number,
): string | undefined {
  if (leg === null) return undefined;
  if (!limits || !isRobinhoodAvailable(limits.availability)) return undefined;
  // `nullish`: a backend too old to publish these omits the key entirely,
  // which must read as "not known" and blank the figure — never as zero,
  // which would claim an exhausted window.
  const window = limits[WINDOW_FIELD[leg]];
  if (window === null || window === undefined) return undefined;
  return atomicRescaleFloor(window.remaining_atomic, ROBINHOOD_DECIMALS, sourceDecimals);
}
