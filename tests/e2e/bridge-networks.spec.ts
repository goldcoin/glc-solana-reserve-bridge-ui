import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  primaryCta,
  selectNetwork,
  waitForRouteVerdict,
} from "./network-selection.helpers";

/**
 * The network-first bridge form, against the mock backend's default
 * scenario — which mirrors the real shipping state: both legacy routes
 * open, both Robinhood settlement routes implemented but DISABLED, and the
 * two Solana↔Robinhood routes structurally non-executable.
 *
 * The properties under test are the ones the redesign is for: two
 * selectors instead of a route grid, a route derived from the pair, and an
 * unusable pair explained in place rather than hidden.
 */

test.describe("bridge form — network selection", () => {
  test("presents two network selectors and no route grid", async ({ page }) => {
    await page.goto("/bridge");

    await expect(page.getByRole("button", { name: "Source network" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Destination network" })).toBeVisible();
    // The six route cards are gone, not hidden.
    await expect(page.getByRole("radio")).toHaveCount(0);
  });

  test("defaults to Goldcoin → Solana and states the route", async ({ page }) => {
    await page.goto("/bridge");
    await waitForRouteVerdict(page);

    await expect(page.getByRole("button", { name: "Source network" })).toContainText(
      "Goldcoin",
    );
    await expect(page.getByRole("button", { name: "Destination network" })).toContainText(
      "Solana",
    );
    await expect(page.getByText("Goldcoin → Solana")).toBeVisible();
  });

  test("lists every network with its family, including unavailable ones", async ({
    page,
  }) => {
    await page.goto("/bridge");
    await waitForRouteVerdict(page);

    await page.getByRole("button", { name: "Source network" }).click();
    const listbox = page.getByRole("listbox", { name: "Source network" });
    await expect(listbox.getByRole("option")).toHaveCount(3);
    await expect(listbox.getByRole("option", { name: /Goldcoin/ })).toContainText(
      "Native Network",
    );
    await expect(listbox.getByRole("option", { name: /Robinhood Chain/ })).toContainText(
      "EVM",
    );
  });

  test("reverses direction and clears the previous network's address", async ({
    page,
  }) => {
    await page.goto("/bridge");
    await waitForRouteVerdict(page);

    await page
      .getByLabel("Solana recipient address")
      .fill("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    await page.getByRole("button", { name: /Reverse transfer direction/i }).click();

    await expect(page.getByText("Solana → Goldcoin")).toBeVisible();
    // A Solana address must never be left sitting in a field that now
    // wants a Goldcoin one.
    await expect(page.getByLabel("Goldcoin destination address")).toHaveValue("");
  });
});

test.describe("bridge form — unavailable pairs", () => {
  test("explains a closed route in place and disables the CTA", async ({ page }) => {
    await page.goto("/bridge");
    await waitForRouteVerdict(page);

    await selectNetwork(page, "Destination network", /Robinhood Chain/);

    await expect(page.getByText("Goldcoin → Robinhood Chain")).toBeVisible();
    await expect(page.getByText("Coming soon").first()).toBeVisible();
    await expect(primaryCta(page)).toBeDisabled();
    await expect(primaryCta(page)).toHaveText("Route unavailable");
  });

  test("distinguishes a non-executable pair from a merely closed one", async ({
    page,
  }) => {
    await page.goto("/bridge");
    await waitForRouteVerdict(page);

    await selectNetwork(page, "Source network", /Solana/);
    await selectNetwork(page, "Destination network", /Robinhood Chain/);

    // `implemented: false` — no operator action opens this, so it must not
    // read as a temporary state.
    await expect(page.getByText("Not available", { exact: true }).first()).toBeVisible();
    await expect(primaryCta(page)).toBeDisabled();
  });

  test("keeps the form visible and usable after an unavailable pair", async ({
    page,
  }) => {
    await page.goto("/bridge");
    await waitForRouteVerdict(page);

    await selectNetwork(page, "Destination network", /Robinhood Chain/);
    await expect(page.getByLabel(/Amount in GLC/i)).toBeVisible();

    // And back to a usable pair, with no reload.
    await selectNetwork(page, "Destination network", /Solana/);
    await expect(page.getByText("Goldcoin → Solana")).toBeVisible();
  });

  test("has no accessibility violations with an unavailable pair selected", async ({
    page,
  }) => {
    await page.goto("/bridge");
    await waitForRouteVerdict(page);
    await selectNetwork(page, "Destination network", /Robinhood Chain/);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("has no accessibility violations with a selector open", async ({ page }) => {
    await page.goto("/bridge");
    await waitForRouteVerdict(page);
    await page.getByRole("button", { name: "Destination network" }).click();
    await expect(
      page.getByRole("listbox", { name: "Destination network" }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("bridge form — mobile layout", () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) > 480,
    "the mobile-360 project covers this",
  );

  test("stacks both panels full width with nothing overlapping the CTA", async ({
    page,
  }) => {
    await page.goto("/bridge");
    await waitForRouteVerdict(page);

    const from = page.getByRole("region", { name: "From" });
    const to = page.getByRole("region", { name: "To" });
    const fromBox = await from.boundingBox();
    const toBox = await to.boundingBox();
    expect(fromBox).not.toBeNull();
    expect(toBox).not.toBeNull();
    // Stacked, not side by side.
    expect(toBox!.y).toBeGreaterThan(fromBox!.y + fromBox!.height - 1);

    // The CTA is full width and reachable — the floating help controls sit
    // in a corner and must not cover it. Compared against the panel above
    // it rather than a pixel constant, so the assertion survives a padding
    // change.
    const cta = primaryCta(page);
    await expect(cta).toBeVisible();
    const ctaBox = await cta.boundingBox();
    expect(ctaBox!.width).toBeGreaterThanOrEqual(fromBox!.width - 1);

    // Nothing horizontally scrolls out of the viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("the network selector opens and is usable at 360px", async ({ page }) => {
    await page.goto("/bridge");
    await waitForRouteVerdict(page);

    await selectNetwork(page, "Destination network", /Robinhood Chain/);
    await expect(page.getByText("Goldcoin → Robinhood Chain")).toBeVisible();
  });
});

test.describe("routes on the status page", () => {
  test("lists every route's availability without inventing a reserve figure", async ({
    page,
  }) => {
    await page.goto("/status");

    await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
    await expect(page.getByText("Robinhood Chain → Goldcoin")).toBeVisible();
    // Only the two reserves the backend actually publishes carry a figure.
    await expect(page.getByText("Destination reserve capacity")).toHaveCount(2);
  });
});
