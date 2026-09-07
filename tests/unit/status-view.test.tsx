import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQueryClient } from "./test-utils";
import { StatusView } from "@/features/status/StatusView";
import * as fixtures from "@/lib/api/mock/fixtures";

/**
 * The Routes card on /status.
 *
 * Its whole job is to say which of the backend's routes can be used, and
 * the failure mode this file guards is a specific one: every non-open
 * route used to render the same "Paused" badge. That claimed an operator
 * action for `SolToRhn`/`RhnToSol`, which have no settlement machinery on
 * either side — no operator can unpause something that was never built —
 * and it also asserted a CAUSE that `GET /chains` deliberately never
 * publishes, since `enabled` is the AND of three independent gates and the
 * response names none of them.
 */

const getStatus = vi.fn();
const getChains = vi.fn();
const getHealth = vi.fn();
const getReserve = vi.fn();

vi.mock("@/lib/api", () => ({
  bridgeApi: {
    getStatus: (...args: unknown[]) => getStatus(...args),
    getChains: (...args: unknown[]) => getChains(...args),
    getHealth: (...args: unknown[]) => getHealth(...args),
    getReserve: (...args: unknown[]) => getReserve(...args),
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getHealth.mockResolvedValue(fixtures.healthFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getChains.mockResolvedValue(fixtures.chainsFixture(() => new Date()));
});

/**
 * The Routes list, isolated from the two direction cards above it — those
 * carry their own badges from a different vocabulary, and counting badges
 * across the whole view would conflate the two.
 */
async function routesCard() {
  await screen.findByRole("heading", { name: "Routes" });
  return within(screen.getByRole("list"));
}

describe("StatusView route availability", () => {
  it("marks the open routes available", async () => {
    renderWithQueryClient(<StatusView />);
    const card = await routesCard();
    expect(card.getAllByText("Available")).toHaveLength(2);
  });

  it("does not call any route paused", async () => {
    renderWithQueryClient(<StatusView />);
    const card = await routesCard();
    // "Paused" is a cause. `/chains` publishes none, so this card may not
    // name one — that vocabulary belongs to the two direction cards above,
    // where `GET /status` does say which gate closed.
    expect(card.queryByText("Paused")).toBeNull();
  });

  it("separates an implemented-but-closed route from a non-executable one", async () => {
    renderWithQueryClient(<StatusView />);
    const card = await routesCard();

    // GlcToRhn / RhnToGlc — built, and refused by the gate.
    expect(card.getAllByText("Unavailable")).toHaveLength(2);
    // SolToRhn / RhnToSol — `implemented: false`, nothing to reopen.
    expect(card.getAllByText("Not implemented")).toHaveLength(2);
  });

  it("renders the backend's own reason rather than re-authoring one", async () => {
    renderWithQueryClient(<StatusView />);
    const card = await routesCard();
    // Substring, because the constant is two lines and the DOM matcher
    // normalises whitespace — the point is that this copy is the backend's,
    // not that it survives a byte-for-byte comparison.
    expect(fixtures.ROUTE_UNAVAILABLE_MESSAGE).toContain(
      "Robinhood Network support is in development",
    );
    expect(
      card.getAllByText(/Robinhood Network support is in development/).length,
    ).toBeGreaterThan(0);
  });

  it("follows the backend when a route opens", async () => {
    getChains.mockResolvedValue(
      fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true }),
    );
    renderWithQueryClient(<StatusView />);
    const card = await routesCard();

    expect(card.getAllByText("Available")).toHaveLength(4);
    expect(card.queryByText("Unavailable")).toBeNull();
    // Still unimplemented: opening a settlement route says nothing about
    // the two routes that have no settlement path at all.
    expect(card.getAllByText("Not implemented")).toHaveLength(2);
  });
});
