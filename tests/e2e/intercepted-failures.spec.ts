import { test, expect } from "@playwright/test";
import { INTERCEPTED_API_ORIGIN } from "../../playwright.config";
import { mockHappyBackend, respondJson } from "./intercepted-helpers";
import * as fixtures from "../../src/lib/api/mock/fixtures";
import { primaryCta, selectNetwork } from "./network-selection.helpers";

/**
 * Every scenario here runs against a real NEXT_PUBLIC_BRIDGE_API_MODE=http
 * build — the browser's actual `fetch` calls are intercepted, so this
 * exercises the real HttpBridgeClient error-mapping path end to end, not a
 * simulation of it.
 */

test.describe("backend failure and unhappy-path scenarios (real HTTP client)", () => {
  test("states the backend is unavailable rather than assuming operational", async ({
    page,
  }) => {
    await page.route(`${INTERCEPTED_API_ORIGIN}/**`, (route) =>
      route.abort("connectionrefused"),
    );

    await page.goto("/bridge");
    await expect(page.getByText(/Bridge status is unavailable/i)).toBeVisible();
  });

  test("treats a malformed JSON response as an error, never as data", async ({
    page,
  }) => {
    await mockHappyBackend(page);
    await page.route(`${INTERCEPTED_API_ORIGIN}/status`, (route) => {
      if (route.request().method() === "OPTIONS") return respondJson(route, null);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: '{"not":"a real status"',
      });
    });

    await page.goto("/bridge");
    await expect(page.getByText(/Bridge status is unavailable/i)).toBeVisible();
  });

  test("blocks submission with a stated reason when the destination direction is paused", async ({
    page,
  }) => {
    await mockHappyBackend(page);
    await page.route(`${INTERCEPTED_API_ORIGIN}/status`, (route) =>
      respondJson(route, fixtures.pausedStatusFixture()),
    );

    await page.goto("/bridge");
    await expect(page.getByText(/is currently paused\./i).first()).toBeVisible();
    await expect(primaryCta(page)).toBeDisabled();
  });

  test("quota exhausted: exact approved message, submit disabled, opposite direction usable", async ({
    page,
  }) => {
    await mockHappyBackend(page);
    await page.route(`${INTERCEPTED_API_ORIGIN}/status`, (route) =>
      respondJson(route, fixtures.quotaExhaustedStatusFixture()),
    );

    await page.goto("/bridge");
    await expect(
      page.getByText("24-hour bridge capacity reached for this direction.").first(),
    ).toBeVisible();
    await expect(
      page.getByText(/New transfers are temporarily unavailable\./).first(),
    ).toBeVisible();
    await expect(primaryCta(page)).toBeDisabled();

    // No automatic-reset promises anywhere on the page.
    const body = (await page.textContent("body")) ?? "";
    expect(body).not.toMatch(/midnight/i);
    expect(body).not.toMatch(/automatic/i);
    expect(body).not.toMatch(/resets?\s+(at|in)/i);

    // The opposite (healthy) direction stays usable.
    await selectNetwork(page, "Source network", /Solana/);
    await expect(
      page.getByText("24-hour bridge capacity reached for this direction.").first(),
    ).not.toBeVisible();
    await page.getByLabel(/Amount in GLC/i).fill("500");
    await expect(page.getByLabel(/Amount in GLC/i)).toHaveValue("500");
  });

  test("quota exhausted + operator paused: the approved refill message with the Telegram line", async ({
    page,
  }) => {
    await mockHappyBackend(page);
    await page.route(`${INTERCEPTED_API_ORIGIN}/status`, (route) =>
      respondJson(route, fixtures.quotaPausedStatusFixture()),
    );

    await page.goto("/bridge");
    await expect(
      page.getByText("Bridge capacity reached for this direction.").first(),
    ).toBeVisible();
    await expect(
      page
        .getByText(/Transfers are temporarily paused while reserves are replenished\./)
        .first(),
    ).toBeVisible();
    await expect(
      page
        .getByText(/Please check the official Telegram for reopening updates\./)
        .first(),
    ).toBeVisible();
  });

  test("shows the remaining 24h capacity from /status on the bridge form", async ({
    page,
  }) => {
    await mockHappyBackend(page);
    await page.goto("/bridge");
    await expect(page.getByText(/17,500 GLC\s+remaining today/)).toBeVisible();
  });

  test("a paused-reserve 409 on submit is shown as an error, not a fabricated success", async ({
    page,
  }) => {
    await mockHappyBackend(page);
    await page.route(`${INTERCEPTED_API_ORIGIN}/transfers`, (route) => {
      if (route.request().method() === "OPTIONS") return respondJson(route, null);
      if (route.request().method() !== "POST") return route.continue();
      return respondJson(route, { error: "the destination reserve is paused" }, 409);
    });

    await page.goto("/bridge");
    await page.getByLabel(/Amount in GLC/i).fill("1000");
    await page
      .getByLabel("Solana recipient address")
      .fill("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    await primaryCta(page).click();

    await expect(
      page.getByRole("alert").filter({ hasText: "temporarily" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Send your deposit/i }),
    ).not.toBeVisible();
  });

  test("every 409 cause maps to the single approved direction-unavailable message", async ({
    page,
  }) => {
    // The backend returns the same cause-agnostic text for paused,
    // insufficient-liquidity, and quota-exhausted — the UI must render
    // the approved message, not parse the string for a cause.
    await mockHappyBackend(page);
    await page.route(`${INTERCEPTED_API_ORIGIN}/transfers`, (route) => {
      if (route.request().method() === "OPTIONS") return respondJson(route, null);
      if (route.request().method() !== "POST") return route.continue();
      return respondJson(
        route,
        {
          error:
            "Bridge capacity reached for this direction.\nTransfers are temporarily paused while reserves are replenished.\nPlease check the official Telegram for reopening updates.",
        },
        409,
      );
    });

    await page.goto("/bridge");
    await page.getByLabel(/Amount in GLC/i).fill("1000");
    await page
      .getByLabel("Solana recipient address")
      .fill("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    await primaryCta(page).click();

    await expect(
      page.getByRole("alert").filter({ hasText: "Bridge capacity reached" }),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: "official Telegram" }),
    ).toBeVisible();
  });

  test("a quote failure disables submission rather than showing a stale or guessed quote", async ({
    page,
  }) => {
    await mockHappyBackend(page);
    await page.route(`${INTERCEPTED_API_ORIGIN}/quote`, (route) => {
      if (route.request().method() === "OPTIONS") return respondJson(route, null);
      return respondJson(route, { error: "internal" }, 500);
    });

    await page.goto("/bridge");
    await page.getByLabel(/Amount in GLC/i).fill("1000");

    // The summary keeps its rows — a layout that collapses on failure is
    // its own kind of confusing — but every figure reads as absent. What
    // must never appear is a number: no stale quote, and nothing this app
    // derived on its own.
    await expect(page.getByText(/could not complete that request/i)).toBeVisible();
    await expect(page.getByText("You receive")).toBeVisible();
    await expect(page.getByText(/3%/)).toHaveCount(0);
    await expect(page.getByText(/970\.00/)).toHaveCount(0);
    await expect(primaryCta(page)).toBeDisabled();
  });

  test("a transfer lookup for an unknown id shows not-found, never a fabricated status", async ({
    page,
  }) => {
    await mockHappyBackend(page);
    await page.route(`${INTERCEPTED_API_ORIGIN}/transfers/424242`, (route) => {
      if (route.request().method() === "OPTIONS") return respondJson(route, null);
      return respondJson(route, { error: "no transfer with id 424242" }, 404);
    });

    await page.goto("/bridge/424242");
    await expect(page.getByText(/could not find that transfer/i)).toBeVisible();
  });
});
