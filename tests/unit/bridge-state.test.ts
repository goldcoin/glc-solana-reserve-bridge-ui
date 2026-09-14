import { describe, expect, it } from "vitest";
import { requestStateSchema } from "@/lib/api/schemas/transfer";
import {
  happyPathFor,
  isClosedState,
  isFailureState,
  isKnownRequestState,
  isManuallyRefunded,
  isManualReview,
  isRefundState,
  isSuccessState,
  isTerminalState,
  isInFlightState,
  manualRefundOf,
  MANUAL_REFUND_DISPOSITION,
  MANUAL_REFUND_STATUS,
  REQUEST_STATE_LABELS,
  transitionLabel,
} from "@/lib/bridge/state";

/**
 * These classifications are read against the real, ground-truth
 * `RequestState` wire enum (service/src/ledger/types.rs in
 * glc-solana-reserve-bridge) — every value the schema accepts must be
 * classified as exactly one of terminal/failure/manual-review/in-flight,
 * and every value must have a display label, so the UI never encounters an
 * unrenderable state.
 */
describe("RequestState classification", () => {
  const allStates = requestStateSchema.options;

  it("labels every possible wire state", () => {
    for (const state of allStates) {
      expect(REQUEST_STATE_LABELS[state]).toBeTruthy();
    }
  });

  it("classifies exactly the documented terminal states", () => {
    const terminal = allStates.filter(isTerminalState);
    expect(terminal.sort()).toEqual(
      [
        "Settled",
        "Expired",
        "Cancelled",
        "Reorged",
        "InsufficientReserveAtSettlement",
        "DestinationSubmissionFailed",
        "Refunded",
        "Failed",
        // The operator-driven close. Terminal because nothing further will
        // happen to the request, and deliberately absent from the failure
        // list below — #4361 was closed because its deposit had already gone
        // back.
        "Closed",
      ].sort(),
    );
  });

  it("Settled is the only success state", () => {
    expect(allStates.filter(isSuccessState)).toEqual(["Settled"]);
  });

  it("ManualReview is not a failure and vice versa", () => {
    expect(isFailureState("ManualReview")).toBe(false);
    expect(isManualReview("Failed")).toBe(false);
    expect(isManualReview("ManualReview")).toBe(true);
  });

  it("models the whole refund lifecycle the backend actually emits", () => {
    for (const state of ["RefundPending", "RefundBroadcast", "Refunded"] as const) {
      expect(allStates).toContain(state);
      expect(isRefundState(state)).toBe(true);
    }
    expect(REQUEST_STATE_LABELS.RefundPending).toBe("Refund pending");
    expect(REQUEST_STATE_LABELS.RefundBroadcast).toBe("Refund broadcast");
    expect(REQUEST_STATE_LABELS.Refunded).toBe("Refunded");
  });

  it("never treats a refund as a failure — the deposit came back", () => {
    expect(isFailureState("RefundPending")).toBe(false);
    expect(isFailureState("RefundBroadcast")).toBe(false);
    expect(isFailureState("Refunded")).toBe(false);
  });

  it("treats Refunded as terminal but not as a settlement success", () => {
    expect(isTerminalState("Refunded")).toBe(true);
    expect(isSuccessState("Refunded")).toBe(false);
    expect(isTerminalState("RefundPending")).toBe(false);
    expect(isTerminalState("RefundBroadcast")).toBe(false);
  });

  it("classifies a refund as neither manual review nor an in-flight transfer", () => {
    for (const state of ["RefundPending", "RefundBroadcast", "Refunded"] as const) {
      expect(isManualReview(state)).toBe(false);
      expect(isInFlightState(state)).toBe(false);
    }
  });

  it("parses Closed, the state production #4361 is actually in", () => {
    // The whole defect: `GET /transfers/4361` answers `state: "Closed"`, the
    // enum did not list it, and one invalid_value issue took the entire
    // public explorer page down with "data this page could not read".
    expect(requestStateSchema.safeParse("Closed").success).toBe(true);
    expect(allStates).toContain("Closed");
    expect(isKnownRequestState("Closed")).toBe(true);
    expect(REQUEST_STATE_LABELS.Closed).toBeTruthy();
  });

  it("treats Closed as terminal, and as neither a failure nor a success", () => {
    expect(isClosedState("Closed")).toBe(true);
    expect(isTerminalState("Closed")).toBe(true);
    // Both directions matter. Danger copy on a closed transfer tells a user
    // whose money is already back that their funds may be lost; a success
    // badge claims a settlement that never happened.
    expect(isFailureState("Closed")).toBe(false);
    expect(isSuccessState("Closed")).toBe(false);
    expect(isManualReview("Closed")).toBe(false);
    expect(isRefundState("Closed")).toBe(false);
    expect(isInFlightState("Closed")).toBe(false);
  });

  it("names the out-of-band close as what happened, not as two state names", () => {
    expect(transitionLabel("ManualReview", "Closed")).toBe("Refunded by hand and closed");
  });
});

/**
 * The manual-refund record, and when this UI may speak in its own voice about
 * it. `manual_refund` carries an amount, a network and a signature the page
 * states as fact, so "is this a manual refund" is a real predicate over the
 * payload rather than a state-name check.
 */
describe("manual refund recognition", () => {
  const record = {
    status: MANUAL_REFUND_STATUS,
    network: "solana",
    refund_amount_atomic: "5000000000000",
    refund_amount_native_atomic: "50000000000",
    mint: "Hn6Kdxs6cJrXDLvArAief8ueTgdZLkRacLPPUZo2pump",
    tx_signature:
      "3NzHem3knwoaPef5WJuWTD442tLHP1SfuaevUXHezQoiWCxvXiCwNWX3aMeExJ3AWpon9crTBR8a3Mek6SXbrcbZ",
    slot: 447_038_412,
    refunded_at: 1_789_408_436,
    imported_at: 1_789_409_379,
  };

  it("recognises #4361's own shape", () => {
    const transfer = { manual_refund: record, disposition: null };
    expect(manualRefundOf(transfer)).toBe(record);
    expect(isManuallyRefunded(transfer)).toBe(true);
  });

  it("accepts the disposition as corroboration when the status is unfamiliar", () => {
    const transfer = {
      manual_refund: { ...record, status: "RETURNED_BY_OPERATOR" },
      disposition: MANUAL_REFUND_DISPOSITION,
    };
    expect(isManuallyRefunded(transfer)).toBe(true);
  });

  it("will not claim a refund from a disposition with no record behind it", () => {
    // A disposition names no amount, no network and no transaction. A
    // headline with nothing under it is not worth the claim.
    const transfer = { manual_refund: null, disposition: MANUAL_REFUND_DISPOSITION };
    expect(manualRefundOf(transfer)).toBeNull();
    expect(isManuallyRefunded(transfer)).toBe(false);
  });

  it("still surfaces a record it cannot vouch for, without claiming it", () => {
    const transfer = {
      manual_refund: { ...record, status: "SOMETHING_NEW" },
      disposition: null,
    };
    // The figures are the backend's own and are still rendered; what is
    // withheld is this UI asserting "manually refunded" in its own words.
    expect(manualRefundOf(transfer)).not.toBeNull();
    expect(isManuallyRefunded(transfer)).toBe(false);
  });
});

describe("isInFlightState", () => {
  /**
   * This replaced `isUnexercisedState`, which drove a warning saying the
   * settlement pipeline was "still being rolled out on this deployment".
   * Settlement automation is live, so the warning was stale — and it fired
   * on `Settled`, telling a user whose transfer had completely finished
   * that progress was "not yet guaranteed".
   */
  it("is true for every state the pipeline moves through on its own", () => {
    for (const state of [
      "LiquidityReserved",
      "AwaitingDeposit",
      "DepositObserved",
      "Confirming",
      "SourceFinalized",
      "SettlementAuthorized",
      "DestinationSubmitted",
      "DestinationConfirmed",
    ] as const) {
      expect(isInFlightState(state)).toBe(true);
    }
  });

  it("is false once the transfer has finished, however it finished", () => {
    expect(isInFlightState("Settled")).toBe(false);
    expect(isInFlightState("Refunded")).toBe(false);
    expect(isInFlightState("Expired")).toBe(false);
    expect(isInFlightState("Failed")).toBe(false);
  });

  it("is false whenever something needs attention, so the neutral line never competes with an alert", () => {
    expect(isInFlightState("ManualReview")).toBe(false);
    expect(isInFlightState("RefundPending")).toBe(false);
    expect(isInFlightState("DestinationSubmissionFailed")).toBe(false);
    expect(isInFlightState("InsufficientReserveAtSettlement")).toBe(false);
  });
});

describe("happyPathFor", () => {
  it("includes Confirming for GlcToSol", () => {
    expect(happyPathFor("GlcToSol")).toContain("Confirming");
  });

  it("skips Confirming for SolToGlc (no confirmation ramp on that side)", () => {
    expect(happyPathFor("SolToGlc")).not.toContain("Confirming");
  });

  it("both sequences start awaiting deposit and end settled", () => {
    for (const direction of ["GlcToSol", "SolToGlc"] as const) {
      const sequence = happyPathFor(direction);
      expect(sequence[0]).toBe("AwaitingDeposit");
      expect(sequence[sequence.length - 1]).toBe("Settled");
    }
  });
});

describe("isKnownRequestState", () => {
  it("accepts every state on the wire enum", () => {
    for (const state of requestStateSchema.options) {
      expect(isKnownRequestState(state)).toBe(true);
    }
  });

  it("rejects a state this build does not model, so it can never index a state record", () => {
    expect(isKnownRequestState("SomeFutureLifecycleState")).toBe(false);
    expect(isKnownRequestState("")).toBe(false);
    // Not a state, but a real own-property of Object.prototype — a plain
    // object lookup would resolve it and hand back a function.
    expect(isKnownRequestState("toString")).toBe(false);
    expect(isKnownRequestState("constructor")).toBe(false);
  });
});

describe("transitionLabel", () => {
  it("names each refund transition the way the product describes it", () => {
    expect(transitionLabel("ManualReview", "RefundPending")).toBe("Refund started");
    expect(transitionLabel("RefundPending", "RefundBroadcast")).toBe("Refund broadcast");
    expect(transitionLabel("RefundBroadcast", "Refunded")).toBe("Refund confirmed");
  });

  it("invents nothing for a transition it has no wording for", () => {
    expect(transitionLabel(null, "AwaitingDeposit")).toBeNull();
    expect(transitionLabel("AwaitingDeposit", "Confirming")).toBeNull();
    // Same states, wrong direction — a reversed pair is not the same event.
    expect(transitionLabel("RefundPending", "ManualReview")).toBeNull();
    expect(transitionLabel("ManualReview", "SomeFutureLifecycleState")).toBeNull();
  });
});
