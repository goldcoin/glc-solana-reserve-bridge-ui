import { describe, expect, it, vi } from "vitest";
import {
  customErrorNumber,
  describeRejection,
  parseAnchorError,
  simulateDeposit,
} from "@/lib/solana/simulate";
import type { Connection, Transaction } from "@solana/web3.js";

/**
 * The 2026-09-09 incident, pinned.
 *
 * The backend's `GET /status` reported `sol_to_glc_available: true` while the
 * on-chain `bridge_config` had the deposit direction paused. The form stayed
 * enabled, built a transaction the program would always reject, and handed it
 * to the wallet — which simulated it, failed, and warned the user that the
 * dApp might be malicious.
 *
 * These are the logs the live program actually emitted, captured from
 * `simulateTransaction` against mainnet on 2026-09-12.
 */
const PAUSED_LOGS = [
  "Program H8SoqRyBFQaT1o33vPGj7KCftFXs3SnLYtE81h1RRJgb invoke [1]",
  "Program 11111111111111111111111111111111 invoke [2]",
  "Program 11111111111111111111111111111111 success",
  "Program log: AnchorError thrown in programs/glc-reserve-bridge/src/instructions/deposit_to_reserve.rs:104. Error Code: DepositDirectionPaused. Error Number: 6020. Error Message: Solana -> Goldcoin deposit direction is paused.",
  "Program H8SoqRyBFQaT1o33vPGj7KCftFXs3SnLYtE81h1RRJgb consumed 29891 of 200000 compute units",
  "Program H8SoqRyBFQaT1o33vPGj7KCftFXs3SnLYtE81h1RRJgb failed: custom program error: 0x1784",
];
const PAUSED_ERR = { InstructionError: [0, { Custom: 6020 }] };

function connectionReturning(value: unknown): Connection {
  return {
    simulateTransaction: vi.fn().mockResolvedValue({ value }),
  } as unknown as Connection;
}

const TX = {} as Transaction;

describe("parseAnchorError", () => {
  it("reads the program's own error name, number and message", () => {
    expect(parseAnchorError(PAUSED_LOGS)).toEqual({
      name: "DepositDirectionPaused",
      number: 6020,
      message: "Solana -> Goldcoin deposit direction is paused",
    });
  });

  it("reads an unrelated program error just as well, with no error table of our own", () => {
    // Nothing here knows what 6043 means ahead of time; the program says so.
    expect(
      parseAnchorError([
        "Program log: AnchorError thrown in programs/glc-reserve-bridge/src/instructions/complete_goldcoin_payout.rs:100. Error Code: ObligationAlreadyCompleted. Error Number: 6043. Error Message: Withdrawal obligation is already completed; completion is terminal and irreversible.",
      ]),
    ).toEqual({
      name: "ObligationAlreadyCompleted",
      number: 6043,
      message:
        "Withdrawal obligation is already completed; completion is terminal and irreversible",
    });
  });

  it("returns nulls rather than inventing a reason when no Anchor line is present", () => {
    expect(parseAnchorError(["Program X invoke [1]", "Program X success"])).toEqual({
      name: null,
      number: null,
      message: null,
    });
  });
});

describe("customErrorNumber", () => {
  it("extracts the custom error number from a TransactionError", () => {
    expect(customErrorNumber(PAUSED_ERR)).toBe(6020);
  });

  it("returns null for shapes it does not recognise", () => {
    expect(customErrorNumber(null)).toBeNull();
    expect(customErrorNumber("BlockhashNotFound")).toBeNull();
    expect(
      customErrorNumber({ InstructionError: [0, "PrivilegeEscalation"] }),
    ).toBeNull();
  });
});

describe("simulateDeposit", () => {
  it("reports the paused direction as a deterministic rejection", async () => {
    const outcome = await simulateDeposit(
      connectionReturning({ err: PAUSED_ERR, logs: PAUSED_LOGS, unitsConsumed: 29891 }),
      TX,
    );

    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") return;
    expect(outcome.errorName).toBe("DepositDirectionPaused");
    expect(outcome.errorNumber).toBe(6020);
    expect(outcome.errorMessage).toBe("Solana -> Goldcoin deposit direction is paused");
  });

  it("falls back to the raw custom error number when the logs carry no Anchor line", async () => {
    const outcome = await simulateDeposit(
      connectionReturning({ err: PAUSED_ERR, logs: [], unitsConsumed: 0 }),
      TX,
    );

    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") return;
    expect(outcome.errorNumber).toBe(6020);
    expect(outcome.errorName).toBeNull();
  });

  it("reports a clean simulation as ok, with the units it consumed", async () => {
    const outcome = await simulateDeposit(
      connectionReturning({ err: null, logs: [], unitsConsumed: 46264 }),
      TX,
    );

    expect(outcome).toEqual({ kind: "ok", unitsConsumed: 46264 });
  });

  it("treats an unreachable RPC as inconclusive, never as a rejection", async () => {
    // Refusing here would turn an RPC blip into an outage of the whole
    // direction, and would protect nothing: no funds move either way and the
    // wallet still shows the user the transaction before anything is signed.
    const connection = {
      simulateTransaction: vi.fn().mockRejectedValue(new Error("fetch failed")),
    } as unknown as Connection;

    const outcome = await simulateDeposit(connection, TX);
    expect(outcome.kind).toBe("inconclusive");
  });

  it("treats a missing simulation result as inconclusive", async () => {
    const connection = {
      simulateTransaction: vi.fn().mockResolvedValue({}),
    } as unknown as Connection;

    expect((await simulateDeposit(connection, TX)).kind).toBe("inconclusive");
  });
});

describe("describeRejection", () => {
  it("uses the program's own words, and never claims funds moved", () => {
    const described = describeRejection({
      kind: "rejected",
      errorName: "DepositDirectionPaused",
      errorMessage: "Solana -> Goldcoin deposit direction is paused",
      errorNumber: 6020,
      logs: PAUSED_LOGS,
    });

    expect(described.what).toContain("Solana -> Goldcoin deposit direction is paused");
    expect(described.what).toContain("was not sent");
    expect(described.next).toContain("Nothing was signed");
  });

  it("states the bare error number when the program gave no message", () => {
    const described = describeRejection({
      kind: "rejected",
      errorName: null,
      errorMessage: null,
      errorNumber: 6020,
      logs: [],
    });

    expect(described.what).toContain("6020");
  });
});
