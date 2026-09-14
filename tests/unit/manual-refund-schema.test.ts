import { describe, expect, it } from "vitest";
import { manualRefundViewSchema, transferViewSchema } from "@/lib/api/schemas/transfer";

/**
 * `GET /transfers/4361` — the production response, byte-for-byte, as the
 * public explorer received it while rendering "The bridge returned data this
 * page could not read".
 *
 * Copied rather than paraphrased, and kept in one place, because the defect
 * was a contract gap and not a rendering bug: the page failed at the schema
 * boundary before any component ran. A hand-written approximation of this
 * payload could have been made to pass while the real one still failed.
 *
 * The one Zod issue it produced was `invalid_value` on `state`: the backend
 * had added the `Closed` terminal state and `requestStateSchema` did not list
 * it. `manual_refund` was not a second failure — `z.object` strips unknown
 * keys — which is exactly why fixing only the enum would have produced a page
 * that loads and says nothing about the 50,000 GLC that went back.
 */
const LIVE_4361 = {
  id: 4361,
  direction: "SolToGlc",
  state: "Closed",
  gross_amount_atomic: "5000000000000",
  fee_bps: 600,
  fee_amount_atomic: "300000000000",
  net_amount_atomic: "4700000000000",
  created_at: 1_789_368_584,
  source_txid: null,
  source_confirmations: 1,
  required_source_confirmations: null,
  destination_txid: null,
  failure_reason: null,
  manual_refund: {
    status: "MANUALLY_REFUNDED",
    network: "solana",
    refund_amount_atomic: "5000000000000",
    refund_amount_native_atomic: "50000000000",
    mint: "Hn6Kdxs6cJrXDLvArAief8ueTgdZLkRacLPPUZo2pump",
    tx_signature:
      "3NzHem3knwoaPef5WJuWTD442tLHP1SfuaevUXHezQoiWCxvXiCwNWX3aMeExJ3AWpon9crTBR8a3Mek6SXbrcbZ",
    slot: 447_038_412,
    refunded_at: 1_789_408_436,
    imported_at: 1_789_409_379,
  },
  refund: null,
} as const;

describe("the manual-refund payload production actually serves", () => {
  it("parses request 4361 exactly as the bridge returns it", () => {
    const parsed = transferViewSchema.safeParse(LIVE_4361);
    expect(parsed.success).toBe(true);
  });

  it("keeps every manual-refund fact the page renders", () => {
    const transfer = transferViewSchema.parse(LIVE_4361);
    // Not one assertion on `success`: the fields have to survive the parse,
    // and an unknown key is STRIPPED rather than rejected, so a schema that
    // parses but drops `manual_refund` would look identical to a green test.
    expect(transfer.manual_refund).not.toBeNull();
    expect(transfer.manual_refund?.status).toBe("MANUALLY_REFUNDED");
    expect(transfer.manual_refund?.network).toBe("solana");
    // 50,000 GLC at the ledger's canonical 8 decimals — the amount the
    // depositor got back, not the 47,000 GLC net the quote describes.
    expect(transfer.manual_refund?.refund_amount_atomic).toBe("5000000000000");
    expect(transfer.manual_refund?.tx_signature).toBe(
      LIVE_4361.manual_refund.tx_signature,
    );
    expect(transfer.manual_refund?.refunded_at).toBe(1_789_408_436);
  });

  it("tolerates the disposition being absent, as this backend serves it", () => {
    // Production conveys `refunded_out_of_band` through the explorer event's
    // `reason` today, not as a field on the transfer. Requiring it here would
    // fail the very payload this change exists to read.
    expect(transferViewSchema.parse(LIVE_4361).disposition).toBeNull();
    expect(
      transferViewSchema.parse({ ...LIVE_4361, disposition: "refunded_out_of_band" })
        .disposition,
    ).toBe("refunded_out_of_band");
  });

  it("reads a closed transfer that carries no manual refund at all", () => {
    const { manual_refund: _ignored, ...withoutRefund } = LIVE_4361;
    const parsed = transferViewSchema.safeParse(withoutRefund);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.manual_refund).toBeNull();
  });

  it("accepts a record whose optional detail the import never recorded", () => {
    const sparse = {
      status: "MANUALLY_REFUNDED",
      network: "solana",
      refund_amount_atomic: "5000000000000",
      tx_signature: LIVE_4361.manual_refund.tx_signature,
    };
    const parsed = manualRefundViewSchema.parse(sparse);
    expect(parsed.refunded_at).toBeNull();
    expect(parsed.mint).toBeNull();
    expect(parsed.slot).toBeNull();
    expect(parsed.refund_amount_native_atomic).toBeNull();
  });
});

/**
 * The manual-refund record is strict once present, unlike the open-string
 * `disposition` beside it. These are the figures the page states as fact — an
 * amount, a network, a signature a user clicks through to — so a record this
 * build cannot read must fail at the boundary and surface as an error, never
 * be rendered with a number that had to be guessed at.
 */
describe("a malformed manual refund fails safely", () => {
  const cases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ["a missing transaction signature", { tx_signature: undefined }],
    ["an empty transaction signature", { tx_signature: "" }],
    ["a missing network", { network: undefined }],
    ["a negative refund amount", { refund_amount_atomic: "-5000000000000" }],
    ["a non-integer refund amount", { refund_amount_atomic: "50000.5" }],
    [
      // Above Number.MAX_SAFE_INTEGER: `JSON.parse` already corrupted the
      // digits, so coercing it would display an amount the chain disagrees
      // with. Refusing is the only honest answer.
      "an unsafe numeric refund amount",
      { refund_amount_atomic: 9_007_199_254_740_993 },
    ],
    ["a timestamp that is not unix seconds", { refunded_at: "2026-09-14T00:00:00Z" }],
    ["a negative timestamp", { refunded_at: -1 }],
  ];

  for (const [name, override] of cases) {
    it(`rejects the whole transfer for ${name}`, () => {
      const malformed = {
        ...LIVE_4361,
        manual_refund: { ...LIVE_4361.manual_refund, ...override },
      };
      expect(transferViewSchema.safeParse(malformed).success).toBe(false);
    });
  }

  it("rejects a manual refund that is not an object at all", () => {
    for (const value of ["MANUALLY_REFUNDED", 1, [], true]) {
      expect(
        transferViewSchema.safeParse({ ...LIVE_4361, manual_refund: value }).success,
      ).toBe(false);
    }
  });

  it("still rejects a state name this build has never heard of", () => {
    // Widening the enum by one value must not have widened it structurally:
    // an unknown state on a SINGLE transfer is a contract break worth
    // surfacing, which is the rule `Closed` was added under.
    expect(
      transferViewSchema.safeParse({ ...LIVE_4361, state: "ClosedOut" }).success,
    ).toBe(false);
  });
});
