import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQueryClient } from "./test-utils";
import { StatusView } from "@/features/status/StatusView";
import { BridgeOverviewStats } from "@/features/explorer/BridgeOverviewStats";
import { executableRouteStatus } from "@/lib/bridge/route-status";
import type { RouteStatusInput } from "@/lib/bridge/route-status";
import { bridgeStatsSchema } from "@/lib/api/schemas/stats";
import { robinhoodReserveSchema } from "@/lib/api/schemas/robinhood";
import * as fixtures from "@/lib/api/mock/fixtures";

/**
 * The rule this file exists to hold: a metric the backend does not publish
 * gets NO CARD AND NO ROW — never a placeholder, never a zero, and never a
 * neighbouring route's or reserve's figure.
 *
 * The status page used to announce absences in words ("Not published"),
 * once per unpublished slot. That put permanently unfinished-looking cells
 * in a grid whose whole premise is that every figure on it is one the
 * bridge has asserted, and it invited the obvious "just fill it in from
 * somewhere" fix — which for the Robinhood settled-volume card would have
 * meant a Solana counter, a reserve balance, or a rolling-window figure
 * that measures headroom REMAINING rather than volume settled.
 *
 * Two halves, and both matter:
 *
 * - the CONTRACT assertions below pin why each metric is absent, straight
 *   off the schemas, so a backend that starts publishing one fails here
 *   and gets wired rather than silently staying hidden;
 * - the RENDER assertions pin that absence shows up as nothing at all.
 */

const getStatus = vi.fn();
const getChains = vi.fn();
const getHealth = vi.fn();
const getReserve = vi.fn();
const getRobinhoodReserve = vi.fn();
const getLimits = vi.fn();
const getStats = vi.fn();

vi.mock("@/lib/api", async () => ({
  // The real error factories: BridgeForm imports them by name, and a
  // partial mock of this module would leave them undefined.
  ...(await import("@/lib/api/errors")),
  bridgeApi: {
    getStatus: (...args: unknown[]) => getStatus(...args),
    getChains: (...args: unknown[]) => getChains(...args),
    getHealth: (...args: unknown[]) => getHealth(...args),
    getReserve: (...args: unknown[]) => getReserve(...args),
    getRobinhoodReserve: (...args: unknown[]) => getRobinhoodReserve(...args),
    getLimits: (...args: unknown[]) => getLimits(...args),
    getStats: (...args: unknown[]) => getStats(...args),
  },
}));

const now = () => new Date();

/** Every placeholder spelling this page must never render. */
const PLACEHOLDERS = [/Not published/i, /Not exposed/i, /Not reported/i, /N\/A/i];

function expectNoPlaceholders(scope: HTMLElement) {
  for (const pattern of PLACEHOLDERS) {
    expect(
      within(scope).queryByText(pattern),
      `rendered the placeholder ${pattern}`,
    ).toBeNull();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  getStatus.mockResolvedValue(fixtures.statusFixture(now));
  getHealth.mockResolvedValue(fixtures.healthFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getChains.mockResolvedValue(fixtures.chainsFixture(now, { robinhoodOpen: true }));
  getRobinhoodReserve.mockResolvedValue(
    fixtures.robinhoodReserveFixture(now, { open: true }),
  );
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getStats.mockResolvedValue(fixtures.statsFixture());
});

describe("what the backend does and does not publish", () => {
  it("publishes a settled-volume counter for all three reserves", () => {
    // `BridgeStats` carried exactly two `ReserveStats` members until
    // backend PR #79 added `robinhood_reserve`. Three counters now, and if
    // a fourth reserve is ever added, this is the test that says so.
    const members = Object.keys(bridgeStatsSchema.shape).filter((key) =>
      key.endsWith("_reserve"),
    );
    expect(members.sort()).toEqual([
      "goldcoin_reserve",
      "robinhood_reserve",
      "solana_reserve",
    ]);
  });

  it("keeps the Robinhood reserve's /stats figures nullable, so absent is never zero", () => {
    // The whole difference between this member and the other two. A
    // deployment with no `[reserve.robinhood]` section sends nulls, and a
    // schema that defaulted them would publish a balance the bridge
    // explicitly declined to claim.
    const parsed = bridgeStatsSchema.parse({
      ...fixtures.statsFixture(),
      robinhood_reserve: {
        ledger_availability: "not_configured",
        paused: null,
        available_capacity: null,
        settled_volume_atomic: null,
        accrued_fees_atomic: null,
      },
    });
    expect(parsed.robinhood_reserve).toEqual({
      ledger_availability: "not_configured",
      paused: null,
      available_capacity: null,
      settled_volume_atomic: null,
      accrued_fees_atomic: null,
    });
  });

  it("publishes no cumulative volume figure on GET /robinhood/reserve", () => {
    // What `GET /robinhood/reserve` does carry is a balance, a protected
    // minimum, reserved liquidity, pending obligations, capacity and
    // accrued FEES. None of those is settled volume: capacity and balance
    // are point-in-time positions, and accrued fees are revenue.
    //
    // `GET /stats`' `robinhood_reserve` is where the cumulative counter
    // does live, as of backend PR #79 — a different endpoint, asserted
    // above. This one is unchanged, so nothing may read a settled volume
    // out of it.
    const fields = Object.keys(robinhoodReserveSchema.shape);
    expect(fields.some((field) => /settled|volume|completed/i.test(field))).toBe(false);
    expect(fields).toContain("balance_atomic");
  });

  it("measures the Robinhood rolling window as headroom, not as volume settled", () => {
    // The one field that might be mistaken for a settled-volume source.
    // `remaining_atomic` is what is LEFT in the bucket and `used_atomic`
    // resets when it rolls over, so neither is cumulative — which is why
    // no card is derived from either.
    const reserve = fixtures.robinhoodReserveFixture(now, { open: true });
    const outbound = reserve.onchain.outbound_window!;
    expect(outbound.remaining_atomic).toBeDefined();
    expect(outbound.is_current).toBeDefined();
    expect(Object.keys(outbound)).not.toContain("settled_atomic");
  });

  it("publishes a fee per route, and marks the legacy field as one route's", () => {
    // `route_fees` is the authoritative table; `bridge_fee_bps` survives
    // for wire compatibility and is `GlcToSol`'s rate alone.
    const stats = bridgeStatsSchema.parse(fixtures.statsFixture());
    expect(stats.route_fees?.map((fee) => fee.route)).toEqual([
      "GlcToSol",
      "SolToGlc",
      "GlcToRhn",
      "RhnToGlc",
      "SolToRhn",
      "RhnToSol",
    ]);
    expect(stats.bridge_fee_bps).toBe(fixtures.BRIDGE_FEE_BPS);
  });

  it("prices the two cross routes at their own 300 bps, not a neighbour's rate", () => {
    // The table exists because routes are priced independently. The cross
    // routes happen to match `GlcToSol`'s rate and NOT the Goldcoin<->
    // Robinhood pair's, so showing either neighbour's number would be
    // visibly wrong for one of them — which is the point of asserting the
    // figure rather than a relationship.
    const stats = bridgeStatsSchema.parse(fixtures.statsFixture());
    const byRoute = new Map(stats.route_fees?.map((fee) => [fee.route, fee]));
    for (const route of ["SolToRhn", "RhnToSol"] as const) {
      expect(byRoute.get(route)).toMatchObject({
        fee_bps: 300,
        fee_percent_display: "3%",
      });
    }
    // And the Goldcoin<->Robinhood pair keeps its own, different rate.
    expect(byRoute.get("GlcToRhn")).toMatchObject({
      fee_bps: fixtures.ROBINHOOD_FEE_BPS,
      fee_percent_display: "2.50%",
    });
  });

  it("parses a deployment that publishes no per-route fee table at all", () => {
    // Optional on the wire and deliberately not defaulted: a backend
    // predating the table must not be read as charging zero.
    const { route_fees: _dropped, ...withoutFees } = fixtures.statsFixture();
    const stats = bridgeStatsSchema.parse(withoutFees);
    expect(stats.route_fees).toBeUndefined();
  });
});

describe("the status page renders no placeholder in place of a metric", () => {
  it("shows no placeholder on any card when Robinhood is fully live", async () => {
    renderWithQueryClient(<StatusView />);
    await screen.findByRole("heading", { name: "GLC L1 → GLC on Robinhood" });
    expectNoPlaceholders(document.body);
  });

  it("shows no placeholder when the deployment has no Robinhood reserve", async () => {
    // Capacity, window and per-transfer limits are all absent at once —
    // the state that produced three placeholder rows on one card.
    getRobinhoodReserve.mockResolvedValue(
      fixtures.robinhoodReserveFixture(now, { open: false }),
    );
    renderWithQueryClient(<StatusView />);
    const card = await screen.findByRole("group", {
      name: "GLC L1 → GLC on Robinhood",
    });
    await vi.waitFor(() => expect(getRobinhoodReserve).toHaveBeenCalled());

    expectNoPlaceholders(document.body);
    // The state is still reported; only the empty figures are gone.
    expect(within(card).getByText("Unknown")).toBeInTheDocument();
  });

  it("shows no placeholder when neither /limits nor /stats answers", async () => {
    getLimits.mockRejectedValue(new Error("503"));
    getStats.mockRejectedValue(new Error("503"));
    renderWithQueryClient(<StatusView />);
    await screen.findByRole("heading", { name: "GLC L1 → GLC on Solana" });

    expectNoPlaceholders(document.body);
    // No fee row anywhere, rather than a zero or a guess.
    expect(screen.queryByText("Route fee")).toBeNull();
  });
});

describe("a route the registry never described", () => {
  it("states no route-gate verdict of its own when /chains is unreachable", () => {
    // `enabled` and `implemented` fall back to `false` so the app fails
    // closed, but those are THIS BUILD's defaults and not the backend's
    // answers. `registered` is what keeps them off the card.
    const input: RouteStatusInput = {
      chains: undefined,
      status: fixtures.statusFixture(now),
      reserve: fixtures.reserveFixture(),
      robinhood: undefined,
      limits: fixtures.limitsFixture(),
      stats: fixtures.statsFixture(),
    };
    const card = executableRouteStatus("GlcToSol", input);

    expect(card.registered).toBe(false);
    expect(card.kind).toBe("unknown");
    // The fail-closed default is still there for anything gating on it.
    expect(card.enabled).toBe(false);
  });

  it("renders neither an Enabled nor an Available row for it", async () => {
    getChains.mockRejectedValue(new Error("503"));
    renderWithQueryClient(<StatusView />);
    await screen.findByRole("heading", { name: "GLC L1 → GLC on Solana" });

    // Printing "Enabled (route gate): No" here would attribute this
    // build's fallback to the backend as a published verdict.
    expect(screen.queryByText("Enabled (route gate)")).toBeNull();
    expect(screen.queryByText("Available (effective)")).toBeNull();
    expectNoPlaceholders(document.body);
  });
});

describe("the overview grid drops an unpublished figure entirely", () => {
  it("renders no card for the reserve with no settled-volume counter", async () => {
    renderWithQueryClient(<BridgeOverviewStats />);
    await screen.findByText(/Settled into Solana/);

    expect(screen.queryByText(/Settled into Robinhood/)).toBeNull();
    expectNoPlaceholders(document.body);
  });

  it("still shows the Robinhood-sourced family on the Goldcoin card", async () => {
    // Dropping the card must not drop the ROUTE from the page: `RhnToGlc`
    // settles onto the Goldcoin reserve, whose counter is published and
    // genuinely includes its volume.
    renderWithQueryClient(<BridgeOverviewStats />);
    const goldcoin = await screen.findByText(/Settled into Goldcoin/);

    expect(goldcoin.parentElement).toHaveTextContent("GLC on Robinhood → GLC L1");
  });
});
