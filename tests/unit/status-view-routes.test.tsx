import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQueryClient } from "./test-utils";
import { StatusView } from "@/features/status/StatusView";
import { AVAILABILITY_NOT_PUBLISHED_NOTE } from "@/lib/bridge";
import * as fixtures from "@/lib/api/mock/fixtures";
import type { ChainsViewDto, RouteViewDto } from "@/lib/api/schemas/chains";
import type { RobinhoodReserveDto } from "@/lib/api/schemas/robinhood";

/**
 * /status, rendered for all six executable routes at once.
 *
 * `route-status.test.ts` pins each figure to the API field it came from.
 * This file is the other half: that the page actually SHOWS six routes,
 * that the numbers on screen are the right ones per card, and that the
 * badge on each card tracks `available` rather than `enabled`.
 *
 * The fixture below gives every slot a distinct value on purpose. A figure
 * that leaked from one route to another would otherwise be invisible here
 * — two cards showing the same plausible number look exactly like two
 * cards showing the right ones.
 */

const getStatus = vi.fn();
const getChains = vi.fn();
const getHealth = vi.fn();
const getReserve = vi.fn();
const getRobinhoodReserve = vi.fn();
const getRobinhoodLimits = vi.fn();
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
    getRobinhoodLimits: (...args: unknown[]) => getRobinhoodLimits(...args),
    getLimits: (...args: unknown[]) => getLimits(...args),
    getStats: (...args: unknown[]) => getStats(...args),
  },
}));

const now = () => new Date();

/* Eight distinct figures, one per slot. */
const GOLDCOIN_CAPACITY = { atomic: "111100000000", display: "1,111.00" }; // 8dp
const SOLANA_CAPACITY = { atomic: "222200000", display: "222.20" }; // 6dp
const ROBINHOOD_CAPACITY = { atomic: "333300000000", display: "3,333.00" }; // 8dp
const GLC_TO_SOL_WINDOW = { atomic: "444400000", display: "444.40" }; // 6dp
const SOL_TO_GLC_WINDOW = { atomic: "555500000", display: "555.50" }; // 6dp
const OUTBOUND_WINDOW = { atomic: "666600000000000000000", display: "666.60" }; // 18dp
const INBOUND_WINDOW = { atomic: "777700000000000000000", display: "777.70" }; // 18dp

const CARDS = {
  GlcToSol: "GLC L1 → GLC on Solana",
  SolToGlc: "GLC on Solana → GLC L1",
  GlcToRhn: "GLC L1 → GLC on Robinhood",
  RhnToGlc: "GLC on Robinhood → GLC L1",
  SolToRhn: "GLC on Solana → GLC on Robinhood",
  RhnToSol: "GLC on Robinhood → GLC on Solana",
} as const;

function robinhoodReserve(): RobinhoodReserveDto {
  const base = fixtures.robinhoodReserveFixture(now, { open: true });
  return {
    ...base,
    available_capacity_atomic: ROBINHOOD_CAPACITY.atomic,
    onchain: {
      ...base.onchain,
      outbound_window: {
        ...base.onchain.outbound_window!,
        remaining_atomic: OUTBOUND_WINDOW.atomic,
      },
      inbound_window: {
        ...base.onchain.inbound_window!,
        remaining_atomic: INBOUND_WINDOW.atomic,
      },
    },
  };
}

/** `/chains` with each executable route's `available` set as given. */
function chainsWith(available: Record<string, boolean>): ChainsViewDto {
  const base = fixtures.chainsFixture(now, { robinhoodOpen: true });
  return {
    ...base,
    routes: base.routes.map((route): RouteViewDto => {
      const value = available[route.id];
      if (value === undefined) return route;
      return {
        ...route,
        enabled: true,
        disabled_reason: null,
        available: value,
        unavailable_reason: value ? null : fixtures.DIRECTION_UNAVAILABLE_MESSAGE,
      };
    }),
  };
}

/**
 * `/chains` from a backend that publishes no per-route maximum — a
 * deployment predating the field. The row must disappear rather than fall
 * back to a chain ceiling.
 */
function withoutPublishedMaxima(): ChainsViewDto {
  const base = chainsWith(ALL);
  return {
    ...base,
    routes: base.routes.map(
      ({ max_transfer_display: _omit, ...rest }): RouteViewDto => rest,
    ),
  };
}

const ALL = {
  GlcToSol: true,
  SolToGlc: true,
  GlcToRhn: true,
  RhnToGlc: true,
  SolToRhn: true,
  RhnToSol: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  getStatus.mockResolvedValue({
    ...fixtures.statusFixture(now),
    glc_to_sol_rolling_volume_remaining: GLC_TO_SOL_WINDOW.atomic,
    sol_to_glc_rolling_volume_remaining: SOL_TO_GLC_WINDOW.atomic,
  });
  getHealth.mockResolvedValue(fixtures.healthFixture());
  getReserve.mockResolvedValue({
    goldcoin_available_capacity: GOLDCOIN_CAPACITY.atomic,
    solana_available_capacity: SOLANA_CAPACITY.atomic,
  });
  getChains.mockResolvedValue(chainsWith(ALL));
  getRobinhoodReserve.mockResolvedValue(robinhoodReserve());
  getRobinhoodLimits.mockResolvedValue(
    fixtures.robinhoodLimitsFixture(now, { open: true }),
  );
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  // `route_fees` — the per-route price table. The fixture prices the
  // Robinhood pair differently from the Solana pair on purpose.
  getStats.mockResolvedValue(fixtures.statsFixture());
});

async function card(route: keyof typeof CARDS) {
  return within(await screen.findByRole("group", { name: CARDS[route] }));
}

describe("all six executable routes get a card", () => {
  it("renders one card per executable route", async () => {
    renderWithQueryClient(<StatusView />);
    for (const title of Object.values(CARDS)) {
      expect(await screen.findByRole("group", { name: title })).toBeInTheDocument();
    }
    expect(screen.getAllByText("Destination reserve capacity")).toHaveLength(6);
  });

  it("gives the two cross routes full cards, not list rows", async () => {
    // They used to get no card at all, correctly: `implemented: false` meant
    // no reserve paid them and no window bounded them, so the Routes list —
    // which states availability and stops — was the only honest place for
    // them. Both settle now, so both are first-class cards with their own
    // figures, and anything less would describe a live route as an absent
    // one.
    renderWithQueryClient(<StatusView />);
    for (const route of ["SolToRhn", "RhnToSol"] as const) {
      const scope = await card(route);
      // `findBy`, not `getBy`: the capacity and window figures arrive with
      // `GET /robinhood/reserve`, which lands after the card itself.
      expect(await scope.findByText("Destination reserve capacity")).toBeInTheDocument();
      expect(
        scope.getByText("Remaining 24-hour capacity for this direction"),
      ).toBeInTheDocument();
      expect(scope.getByText("Route fee")).toBeInTheDocument();
      expect(scope.getByText("Source minimum")).toBeInTheDocument();
      expect(scope.getByText("Max per transfer")).toBeInTheDocument();
    }
  });

  it("never describes a cross route as unbuilt or coming soon", async () => {
    renderWithQueryClient(<StatusView />);
    await screen.findByRole("heading", { name: "Routes" });
    const list = within(screen.getByRole("list"));

    // "Not implemented" is a verdict no operator action clears. Applying it
    // to a route that is built and settling told a reader to wait for
    // something that had already shipped.
    expect(list.queryByText("Not implemented")).toBeNull();
    expect(list.queryByText("Not available on this deployment.")).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.queryByText(/in development/i)).toBeNull();
    // And both are still LISTED: a route the deployment knows about never
    // silently disappears from this card.
    for (const id of ["SolToRhn", "RhnToSol"]) {
      expect(list.getByText(id)).toBeInTheDocument();
    }
  });

  it("drops a card for a route the backend reports as NOT implemented", async () => {
    // The card list is read off `implemented`, not off this build's table.
    const base = chainsWith(ALL);
    getChains.mockResolvedValue({
      ...base,
      routes: base.routes.map((route) =>
        route.id === "RhnToSol" ? { ...route, implemented: false } : route,
      ),
    });
    renderWithQueryClient(<StatusView />);
    await screen.findByRole("group", { name: CARDS.SolToRhn });
    expect(screen.queryByRole("group", { name: CARDS.RhnToSol })).toBeNull();
  });
});

describe("the six cards show the right figures each", () => {
  it("gives each route its own destination capacity", async () => {
    renderWithQueryClient(<StatusView />);

    expect(
      (await card("GlcToSol")).getByText(new RegExp(SOLANA_CAPACITY.display)),
    ).toBeInTheDocument();
    expect(
      (await card("SolToGlc")).getByText(new RegExp(GOLDCOIN_CAPACITY.display)),
    ).toBeInTheDocument();
    expect(
      await (await card("GlcToRhn")).findByText(new RegExp(ROBINHOOD_CAPACITY.display)),
    ).toBeInTheDocument();
    // RhnToGlc settles onto the GOLDCOIN reserve — the same pool SolToGlc
    // pays out of, so the same figure. That sharing is the backend's, not
    // a fallback: the Robinhood ledger's own capacity is a different number
    // and is absent from this card entirely.
    const rhnToGlc = await card("RhnToGlc");
    expect(rhnToGlc.getByText(new RegExp(GOLDCOIN_CAPACITY.display))).toBeInTheDocument();
    expect(rhnToGlc.queryByText(new RegExp(ROBINHOOD_CAPACITY.display))).toBeNull();

    // The cross routes settle in the direction their NAMES' second half
    // points: `SolToRhn` onto the Robinhood reserve, `RhnToSol` onto the
    // Solana one. Reading either by its source chain — the intuitive
    // mistake — would put the wrong pool's figure on both.
    const solToRhn = await card("SolToRhn");
    expect(
      await solToRhn.findByText(new RegExp(ROBINHOOD_CAPACITY.display)),
    ).toBeInTheDocument();
    expect(solToRhn.queryByText(new RegExp(SOLANA_CAPACITY.display))).toBeNull();

    const rhnToSol = await card("RhnToSol");
    expect(rhnToSol.getByText(new RegExp(SOLANA_CAPACITY.display))).toBeInTheDocument();
    expect(rhnToSol.queryByText(new RegExp(ROBINHOOD_CAPACITY.display))).toBeNull();
  });

  it("gives each route its own 24-hour window, in its own unit", async () => {
    renderWithQueryClient(<StatusView />);

    expect(
      (await card("GlcToSol")).getByText(new RegExp(GLC_TO_SOL_WINDOW.display)),
    ).toBeInTheDocument();
    expect(
      (await card("SolToGlc")).getByText(new RegExp(SOL_TO_GLC_WINDOW.display)),
    ).toBeInTheDocument();
    expect(
      await (await card("GlcToRhn")).findByText(new RegExp(OUTBOUND_WINDOW.display)),
    ).toBeInTheDocument();
    expect(
      (await card("RhnToGlc")).getByText(new RegExp(INBOUND_WINDOW.display)),
    ).toBeInTheDocument();
    // Each cross route is charged against the contract LEG it uses, which
    // is the same bucket as its Goldcoin-paired sibling on that leg: the
    // contract holds one accumulator per leg and charges every route on it
    // against that one.
    expect(
      await (await card("SolToRhn")).findByText(new RegExp(OUTBOUND_WINDOW.display)),
    ).toBeInTheDocument();
    expect(
      (await card("RhnToSol")).getByText(new RegExp(INBOUND_WINDOW.display)),
    ).toBeInTheDocument();
  });

  it("never shows one route's window on another route's card", async () => {
    renderWithQueryClient(<StatusView />);
    const glcToRhn = await card("GlcToRhn");
    await glcToRhn.findByText(new RegExp(OUTBOUND_WINDOW.display));

    for (const [route, forbidden] of [
      ["GlcToSol", [SOL_TO_GLC_WINDOW, OUTBOUND_WINDOW, INBOUND_WINDOW]],
      ["SolToGlc", [GLC_TO_SOL_WINDOW, OUTBOUND_WINDOW, INBOUND_WINDOW]],
      ["GlcToRhn", [GLC_TO_SOL_WINDOW, SOL_TO_GLC_WINDOW, INBOUND_WINDOW]],
      ["RhnToGlc", [GLC_TO_SOL_WINDOW, SOL_TO_GLC_WINDOW, OUTBOUND_WINDOW]],
      ["SolToRhn", [GLC_TO_SOL_WINDOW, SOL_TO_GLC_WINDOW, INBOUND_WINDOW]],
      ["RhnToSol", [GLC_TO_SOL_WINDOW, SOL_TO_GLC_WINDOW, OUTBOUND_WINDOW]],
    ] as const) {
      const scope = await card(route);
      for (const figure of forbidden) {
        expect(
          scope.queryByText(new RegExp(figure.display)),
          `${route} is showing ${figure.display}, which is another route's figure`,
        ).toBeNull();
      }
    }
  });

  it("reports the fee and the limits each route actually has", async () => {
    renderWithQueryClient(<StatusView />);
    const glcToSol = await card("GlcToSol");
    expect(glcToSol.getByText("3%")).toBeInTheDocument();
    // The MAXIMUM is the Solana program's `per_transfer_limit`,
    // 20000000000 at the mint's 6 decimals. The MINIMUM is the published
    // policy floor — deliberately NOT the program's 99 GLC
    // `min_transfer_amount`, which is a net-side check and was what this
    // row used to show.
    expect(glcToSol.getByText(/100\.00/)).toBeInTheDocument();
    expect(glcToSol.getByText(/20,000\.00/)).toBeInTheDocument();
    expect(glcToSol.queryByText(/99\.00/)).toBeNull();

    // Its OWN rate from `route_fees`, not the Solana pair's — the
    // fixtures price the two families differently precisely so this
    // distinguishes a correct card from one reading `bridge_fee_bps`.
    const glcToRhn = await card("GlcToRhn");
    expect(glcToRhn.getByText("2.50%")).toBeInTheDocument();
    expect(glcToRhn.queryByText("3%")).toBeNull();
  });

  it("shows a Robinhood route's per-transfer bounds, from its own registry entry", async () => {
    // This row used to be filled from the custody contract's
    // `outboundMax`, which is a ceiling on the PAYOUT leg and not the
    // limit a user's deposit is admitted against — in production it read
    // 2,000,000 here while the backend was admitting 20,000. Both figures
    // now come from the route's own `GET /chains` entry.
    renderWithQueryClient(<StatusView />);
    const glcToRhn = await card("GlcToRhn");
    await glcToRhn.findByText("Source minimum");
    expect(glcToRhn.getByText(/100\.00/)).toBeInTheDocument();
    expect(glcToRhn.getByText("Max per transfer")).toBeInTheDocument();
    expect(glcToRhn.getByText(/20,000\.00/)).toBeInTheDocument();
    expect(glcToRhn.queryByText(/2,000,000/)).toBeNull();
    expect(glcToRhn.queryByText("Not published")).toBeNull();
  });

  it("shows every one of the six cards the maximum published for THAT route", async () => {
    /*
     * The figures the backend publishes per route, and the whole point of
     * the field: they are not all equal, and no chain-level ceiling can
     * express that. Before this, three of the six were wrong on the live
     * page — `SolToGlc` and `SolToRhn` showed the Solana program's 20,000
     * against a real 50,000, and `GlcToRhn` showed the custody contract's
     * 2,000,000 against a real 20,000.
     */
    const EXPECTED = {
      GlcToSol: "20,000.00",
      SolToGlc: "50,000.00",
      GlcToRhn: "20,000.00",
      RhnToGlc: "50,000.00",
      SolToRhn: "50,000.00",
      RhnToSol: "50,000.00",
    } as const;

    renderWithQueryClient(<StatusView />);
    for (const [route, expected] of Object.entries(EXPECTED)) {
      const scope = await card(route as keyof typeof CARDS);
      expect(await scope.findByText("Max per transfer")).toBeInTheDocument();
      expect(
        scope.getByText(new RegExp(expected.replace(/[.,]/g, "\\$&"))),
      ).toBeInTheDocument();
      // The destination reserve's capacity is a different quantity and may
      // legitimately be far larger; it is never this row.
      expect(scope.queryByText(/2,000,000/)).toBeNull();
    }
  });

  it("keeps Max per transfer and Destination reserve capacity separate", async () => {
    // A card carries both, they answer different questions, and the
    // capacity figure is the fixture's own distinct number.
    renderWithQueryClient(<StatusView />);
    const glcToSol = await card("GlcToSol");
    await glcToSol.findByText("Max per transfer");
    expect(glcToSol.getByText("Destination reserve capacity")).toBeInTheDocument();
    expect(glcToSol.getByText(new RegExp(SOLANA_CAPACITY.display))).toBeInTheDocument();
    expect(glcToSol.getByText(/20,000\.00/)).toBeInTheDocument();
  });

  it("shows the 100 GLC source minimum on every one of the six cards", async () => {
    // One published policy floor, identical on every route, rendered
    // unadjusted — the fee is deducted AFTER the minimum is checked, so
    // grossing it up would state a floor the backend does not apply.
    renderWithQueryClient(<StatusView />);
    for (const route of Object.keys(CARDS) as (keyof typeof CARDS)[]) {
      const scope = await card(route);
      expect(await scope.findByText("Source minimum")).toBeInTheDocument();
      expect(scope.getByText(/100\.00/)).toBeInTheDocument();
      // Never the fee-grossed figures this row used to be derived from.
      expect(scope.queryByText(/102\.06/)).toBeNull();
      expect(scope.queryByText(/103\.09/)).toBeNull();
    }
  });

  it("keeps the minimum when the registry publishes no maximum", async () => {
    // The two used to be one "Per-transfer limits" range rendered only when
    // BOTH existed, so an unread ceiling blanked the one figure every route
    // publishes and a user needs before typing an amount.
    getChains.mockResolvedValue(withoutPublishedMaxima());
    renderWithQueryClient(<StatusView />);
    const glcToRhn = await card("GlcToRhn");
    expect(await glcToRhn.findByText("Source minimum")).toBeInTheDocument();
    expect(glcToRhn.getByText(/100\.00/)).toBeInTheDocument();
    expect(glcToRhn.queryByText("Max per transfer")).toBeNull();
  });

  it("prices the cross routes at their own rate, not a neighbour's", async () => {
    renderWithQueryClient(<StatusView />);
    for (const route of ["SolToRhn", "RhnToSol"] as const) {
      const scope = await card(route);
      expect(await scope.findByText("3%")).toBeInTheDocument();
      // `GlcToRhn`'s 2.50% is the nearest wrong answer — same contract,
      // different price — so its absence is what this asserts.
      expect(scope.queryByText("2.50%")).toBeNull();
    }
  });

  it("omits the maximum row entirely when the registry publishes none", async () => {
    // Absent rather than a placeholder, which is what made the card read
    // as unfinished — absent rather than zero, which would say the route
    // takes nothing, and absent rather than a chain ceiling stood in for
    // it, which is what this row used to do.
    getChains.mockResolvedValue(withoutPublishedMaxima());
    renderWithQueryClient(<StatusView />);
    const glcToRhn = await card("GlcToRhn");
    await glcToRhn.findByText("Route fee");
    expect(glcToRhn.queryByText("Max per transfer")).toBeNull();
    expect(glcToRhn.queryByText(/20,000\.00/)).toBeNull();
  });
});

describe("route.available controls the badge", () => {
  it("shows Available only where the backend answered available: true", async () => {
    renderWithQueryClient(<StatusView />);
    for (const route of Object.keys(CARDS) as (keyof typeof CARDS)[]) {
      const scope = await card(route);
      expect(await scope.findByText("Available")).toBeInTheDocument();
      expect(scope.getByText("Available (effective)").parentElement).toHaveTextContent(
        "Yes",
      );
    }
  });

  it("turns one card unavailable without touching the other five", async () => {
    getChains.mockResolvedValue(chainsWith({ ...ALL, RhnToGlc: false }));
    renderWithQueryClient(<StatusView />);

    const rhnToGlc = await card("RhnToGlc");
    expect(await rhnToGlc.findByText("Temporarily unavailable")).toBeInTheDocument();
    // Switched on and still refused: both facts, side by side, because
    // reading the first as permission is what this distinction exists for.
    expect(rhnToGlc.getByText("Enabled (route gate)").parentElement).toHaveTextContent(
      "Yes",
    );
    expect(rhnToGlc.getByText("Available (effective)").parentElement).toHaveTextContent(
      "No",
    );
    expect(
      rhnToGlc.getByText(fixtures.DIRECTION_UNAVAILABLE_MESSAGE),
    ).toBeInTheDocument();

    expect((await card("GlcToRhn")).getByText("Available")).toBeInTheDocument();
  });

  it("never calls an enabled-but-unanswered route available", async () => {
    // A deployment predating backend PR #76 publishes no `available`.
    const open = chainsWith(ALL);
    getChains.mockResolvedValue({
      ...open,
      routes: open.routes.map((route) => {
        const { available: _a, unavailable_reason: _r, ...rest } = route;
        return rest;
      }),
    });
    renderWithQueryClient(<StatusView />);

    const glcToSol = await card("GlcToSol");
    expect(await glcToSol.findByText("Unknown")).toBeInTheDocument();
    expect(glcToSol.getByText("Enabled (route gate)").parentElement).toHaveTextContent(
      "Yes",
    );
    // The question was never answered, so no verdict is shown. Rendering
    // "No" would be a claim the backend did not make, and rendering "Not
    // published" put placeholder text where a reader expects a value —
    // the badge above already reads Unknown, and the note says why.
    expect(glcToSol.queryByText("Available (effective)")).toBeNull();
    expect(glcToSol.queryByText("Not published")).toBeNull();
    expect(
      glcToSol.getByText(AVAILABILITY_NOT_PUBLISHED_NOTE, { exact: false }),
    ).toBeInTheDocument();
  });

  it("keeps the figures visible on a route the backend has closed", async () => {
    // A closed route still has a destination reserve with a real capacity.
    // Hiding the number would be a second, quieter claim about the route.
    getChains.mockResolvedValue(chainsWith({ ...ALL, SolToGlc: false }));
    renderWithQueryClient(<StatusView />);

    const solToGlc = await card("SolToGlc");
    expect(await solToGlc.findByText("Temporarily unavailable")).toBeInTheDocument();
    expect(solToGlc.getByText(new RegExp(GOLDCOIN_CAPACITY.display))).toBeInTheDocument();
  });
});
