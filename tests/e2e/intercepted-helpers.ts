import type { Page, Route } from "@playwright/test";
import { INTERCEPTED_API_ORIGIN } from "../../playwright.config";
import * as fixtures from "../../src/lib/api/mock/fixtures";

/**
 * Routes every real endpoint this app calls to a JSON body, matching the
 * exact backend response shapes documented in
 * src/lib/api/schemas/*.ts — these tests run against a real
 * NEXT_PUBLIC_BRIDGE_API_MODE=http build, so the browser's own `fetch`
 * calls are intercepted here rather than anything being simulated
 * client-side.
 *
 * `INTERCEPTED_API_ORIGIN` is a distinct origin from the app itself, so
 * every response needs CORS headers, and every route must also answer the
 * browser's OPTIONS preflight — a real backend behind a reverse proxy would
 * need the same, so this is exercising a real constraint, not test
 * plumbing to work around.
 */

export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
};

/** Exported so individual specs can answer a route override with the same CORS/preflight handling. */
export function respondJson(route: Route, body: unknown, status = 200) {
  if (route.request().method() === "OPTIONS") {
    return route.fulfill({ status: 204, headers: CORS_HEADERS });
  }
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  });
}

const json = respondJson;

export async function mockHappyBackend(page: Page): Promise<void> {
  await page.route(`${INTERCEPTED_API_ORIGIN}/status`, (route) =>
    json(
      route,
      fixtures.statusFixture(() => new Date()),
    ),
  );
  // The route registry. Every availability decision in the app reads from
  // here, so an intercepted backend that omitted it would leave every
  // route unselectable — correctly, since unknown availability fails
  // closed, but for a reason unrelated to what these specs are testing.
  await page.route(`${INTERCEPTED_API_ORIGIN}/chains`, (route) =>
    json(
      route,
      fixtures.chainsFixture(() => new Date()),
    ),
  );
  await page.route(`${INTERCEPTED_API_ORIGIN}/limits`, (route) =>
    json(route, fixtures.limitsFixture()),
  );
  await page.route(`${INTERCEPTED_API_ORIGIN}/reserve`, (route) =>
    json(route, fixtures.reserveFixture()),
  );
  await page.route(`${INTERCEPTED_API_ORIGIN}/health`, (route) =>
    json(route, fixtures.healthFixture()),
  );
  await page.route(`${INTERCEPTED_API_ORIGIN}/stats`, (route) =>
    json(route, fixtures.statsFixture()),
  );
  await page.route(`${INTERCEPTED_API_ORIGIN}/quote`, async (route) => {
    if (route.request().method() === "OPTIONS") return json(route, null);
    const body = route.request().postDataJSON() as {
      direction: "GlcToSol" | "SolToGlc";
      gross_amount: number;
    };
    const fee = Math.floor((body.gross_amount * 100) / 10_000);
    await json(route, {
      direction: body.direction,
      gross_amount: body.gross_amount,
      gross_display_amount: (body.gross_amount / 1e8).toFixed(8),
      fee_bps: 100,
      fee_amount: fee,
      fee_display_amount: (fee / 1e8).toFixed(8),
      net_amount: body.gross_amount - fee,
      net_display_amount: ((body.gross_amount - fee) / 1e8).toFixed(8),
      source_decimals: body.direction === "GlcToSol" ? 8 : 6,
      destination_decimals: body.direction === "GlcToSol" ? 6 : 8,
      source_asset: body.direction === "GlcToSol" ? "GLC (Goldcoin)" : "GLC (Solana)",
      destination_asset:
        body.direction === "GlcToSol" ? "GLC (Solana)" : "GLC (Goldcoin)",
    });
  });
  await page.route(`${INTERCEPTED_API_ORIGIN}/transfers/**`, (route) =>
    json(route, fixtures.transfersFixture()[0]),
  );
  await page.route(`${INTERCEPTED_API_ORIGIN}/transfers`, (route) => {
    if (route.request().method() === "OPTIONS") return json(route, null);
    if (route.request().method() === "POST") {
      return json(
        route,
        {
          request_id: 4242,
          deposit_address: "GLCVau1t111111111111111111111111111111111",
        },
        201,
      );
    }
    return json(route, {
      items: fixtures.transfersFixture(),
      next_cursor: null,
      as_of: 0,
    });
  });
  await page.route(`${INTERCEPTED_API_ORIGIN}/explorer/events`, (route) =>
    json(route, { items: fixtures.explorerEventsFixture(), next_cursor: null, as_of: 0 }),
  );
  await page.route(`${INTERCEPTED_API_ORIGIN}/reserves/history`, (route) =>
    json(route, { items: fixtures.reserveHistoryFixture(), next_cursor: null, as_of: 0 }),
  );
}
