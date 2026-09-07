import { describe, expect, it } from "vitest";
import {
  bridgeStatusSchema,
  publicHealthSchema,
  reserveAvailabilitySchema,
  transferLimitsSchema,
} from "@/lib/api/schemas/status";
import { bridgeStatsSchema } from "@/lib/api/schemas/stats";
import {
  transferViewSchema,
  createTransferOutputSchema,
} from "@/lib/api/schemas/transfer";
import { quoteOutputSchema } from "@/lib/api/schemas/quote";
import { explorerEventListSchema, explorerEventSchema } from "@/lib/api/schemas/explorer";
import { reserveHistoryEntrySchema } from "@/lib/api/schemas/reserves";
import * as fixtures from "@/lib/api/mock/fixtures";

/**
 * Every fixture must parse through the exact schema a live response would
 * — this is what keeps the mock backend from silently drifting away from
 * the real one's shape. Every schema must also REJECT a plausible-looking
 * malformed payload, since an unvalidated response reaching a component is
 * the failure mode the whole API boundary exists to prevent.
 */
describe("fixtures conform to their live-response schemas", () => {
  it("status", () => {
    expect(
      bridgeStatusSchema.safeParse(fixtures.statusFixture(() => new Date())).success,
    ).toBe(true);
    expect(bridgeStatusSchema.safeParse(fixtures.pausedStatusFixture()).success).toBe(
      true,
    );
  });
  it("limits", () => {
    expect(transferLimitsSchema.safeParse(fixtures.limitsFixture()).success).toBe(true);
  });
  it("reserve", () => {
    expect(reserveAvailabilitySchema.safeParse(fixtures.reserveFixture()).success).toBe(
      true,
    );
    expect(
      reserveAvailabilitySchema.safeParse(fixtures.insufficientReserveFixture()).success,
    ).toBe(true);
  });
  it("health", () => {
    expect(publicHealthSchema.safeParse(fixtures.healthFixture()).success).toBe(true);
  });
  it("stats", () => {
    expect(bridgeStatsSchema.safeParse(fixtures.statsFixture()).success).toBe(true);
  });
  it("transfers", () => {
    for (const transfer of fixtures.transfersFixture()) {
      expect(transferViewSchema.safeParse(transfer).success).toBe(true);
    }
  });
  it("explorer events", () => {
    for (const event of fixtures.explorerEventsFixture()) {
      expect(explorerEventSchema.safeParse(event).success).toBe(true);
    }
  });
  it("reserve history", () => {
    for (const entry of fixtures.reserveHistoryFixture()) {
      expect(reserveHistoryEntrySchema.safeParse(entry).success).toBe(true);
    }
  });
});

describe("schemas reject malformed backend responses", () => {
  it("rejects an unknown RequestState value", () => {
    const malformed = { ...fixtures.transfersFixture()[0], state: "TotallyMadeUp" };
    expect(transferViewSchema.safeParse(malformed).success).toBe(false);
  });

  it("rejects an unknown RequestState on a transfer even though the explorer tolerates one", () => {
    // The explorer relaxes this deliberately; the transfer contract does not.
    const state = "SomeFutureLifecycleState";
    const malformed = { ...fixtures.transfersFixture()[0], state };
    expect(transferViewSchema.safeParse(malformed).success).toBe(false);
    const event = { ...fixtures.explorerEventsFixture()[0], to_state: state };
    expect(explorerEventSchema.safeParse(event).success).toBe(true);
  });

  it("rejects a float amount where an integer atomic amount is required", () => {
    const malformed = { ...fixtures.transfersFixture()[0], gross_amount_atomic: 12.5 };
    expect(transferViewSchema.safeParse(malformed).success).toBe(false);
  });

  it("rejects a create-transfer output missing deposit_address", () => {
    const malformed = { request_id: 1 };
    expect(createTransferOutputSchema.safeParse(malformed).success).toBe(false);
  });

  it("rejects a quote missing display-amount strings", () => {
    const malformed = {
      direction: "GlcToSol",
      gross_amount: "100",
      fee_bps: 100,
      fee_amount: "1",
      net_amount: "99",
      source_decimals: 8,
      destination_decimals: 6,
      source_asset: "GLC (Goldcoin)",
      destination_asset: "GLC (Solana)",
    };
    expect(quoteOutputSchema.safeParse(malformed).success).toBe(false);
  });

  it("rejects completely empty JSON", () => {
    expect(bridgeStatusSchema.safeParse({}).success).toBe(false);
    expect(bridgeStatsSchema.safeParse(null).success).toBe(false);
  });
});

/**
 * The explorer renders every request's history at once, so a lifecycle state
 * added to the backend after this build shipped must cost one row, not the
 * whole page. That tolerance is deliberately narrow: it accepts a
 * `RequestState`-shaped identifier and nothing else, so a genuinely
 * malformed payload still fails at the boundary exactly as before.
 */
describe("explorer events tolerate a future state without weakening validation", () => {
  const event = () => ({ ...fixtures.explorerEventsFixture()[0]! });

  it("parses the real refund lifecycle transitions, with their backend reasons", () => {
    const refunds = fixtures
      .explorerEventsFixture()
      .filter((e) => e.to_state.startsWith("Refund"));
    expect(refunds.map((e) => `${e.from_state}->${e.to_state}`).sort()).toEqual([
      "ManualReview->RefundPending",
      "RefundBroadcast->Refunded",
      "RefundPending->RefundBroadcast",
    ]);
    expect(refunds.map((e) => e.reason)).toContain("glc_refund_started");
    expect(refunds.map((e) => e.reason)).toContain("glc_refund_broadcast");
  });

  it("accepts a structurally-valid state this build has never heard of", () => {
    for (const state of ["SomeFutureLifecycleState", "RefundReversed", "X"]) {
      expect(explorerEventSchema.safeParse({ ...event(), to_state: state }).success).toBe(
        true,
      );
      expect(
        explorerEventSchema.safeParse({ ...event(), from_state: state }).success,
      ).toBe(true);
    }
  });

  it("still rejects a state that is not a state name at all", () => {
    const malformed = [
      "",
      " ",
      "Refund Pending",
      "refund-pending",
      "<script>alert(1)</script>",
      "https://example.com",
      "A".repeat(65),
      42,
      true,
      {},
      [],
    ];
    for (const to_state of malformed) {
      expect(explorerEventSchema.safeParse({ ...event(), to_state }).success).toBe(false);
    }
    // from_state is nullable, but null is the ONLY non-string it accepts.
    expect(explorerEventSchema.safeParse({ ...event(), from_state: null }).success).toBe(
      true,
    );
    expect(explorerEventSchema.safeParse({ ...event(), from_state: 42 }).success).toBe(
      false,
    );
  });

  it("still rejects a malformed event wholesale — a bad direction is not a future state", () => {
    // `GlcToRhn` used to be the example of an unacceptable direction here.
    // It is now a real backend route and MUST parse: the direction
    // vocabulary is the backend's whole `Route` enum, so a Robinhood row
    // appearing in the feed renders instead of failing the entire page.
    // Parsing it still says nothing about whether the route is usable —
    // that answer comes only from `GET /chains`.
    expect(
      explorerEventSchema.safeParse({ ...event(), direction: "GlcToRhn" }).success,
    ).toBe(true);
    // A direction outside that enum is still a contract break, not a
    // future state to tolerate.
    expect(
      explorerEventSchema.safeParse({ ...event(), direction: "GlcToXyz" }).success,
    ).toBe(false);
    expect(explorerEventSchema.safeParse({ ...event(), id: "1" }).success).toBe(false);
    const { at: _at, ...missingTimestamp } = event();
    expect(explorerEventSchema.safeParse(missingTimestamp).success).toBe(false);
  });

  it("keeps a whole page parseable when one event carries a future state", () => {
    const items = fixtures.explorerEventsFixture();
    items[1] = { ...items[1]!, to_state: "SomeFutureLifecycleState" };
    const parsed = explorerEventListSchema.safeParse({
      items,
      next_cursor: null,
      as_of: 0,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.items).toHaveLength(items.length);
  });
});
