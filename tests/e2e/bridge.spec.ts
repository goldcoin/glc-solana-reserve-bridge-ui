import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { primaryCta, selectNetwork } from "./network-selection.helpers";

/**
 * The bridge form, end to end, against the mock backend's default
 * "operational" scenario (both directions available, positive reserve
 * capacity). Paused / insufficient-liquidity / API-failure scenarios are
 * covered in tests/e2e/intercepted-*.spec.ts against a real HTTP client.
 */

test.describe("bridge form", () => {
  test("the Bridge nav link reaches a real page", async ({ page }) => {
    const response = await page.goto("/bridge");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /bridge glc/i })).toBeVisible();
  });

  test("defaults to Goldcoin -> Solana and can switch direction", async ({ page }) => {
    await page.goto("/bridge");

    await expect(page.getByLabel(/Amount in GLC/i)).toBeVisible();
    await expect(page.getByLabel("Solana recipient address")).toBeVisible();

    await selectNetwork(page, "Source network", /Solana/);
    await expect(page.getByLabel("Goldcoin destination address")).toBeVisible();
  });

  test("requests a live quote and shows the exact 3% gross/fee/net breakdown", async ({
    page,
  }) => {
    await page.goto("/bridge");
    await page.getByLabel(/Amount in GLC/i).fill("1000");

    // The route summary carries the rate and the fee amount; the TO panel
    // carries what arrives. Both are the backend's own figures.
    await expect(page.getByText("Bridge fee")).toBeVisible();
    await expect(page.getByText(/3% · 30\.00/)).toBeVisible();
    await expect(page.getByText("You receive")).toBeVisible();
    await expect(page.getByText(/970\.00/).first()).toBeVisible();
    // The typed amount is never reformatted under the cursor.
    await expect(page.getByLabel(/Amount in GLC/i)).toHaveValue("1000");
  });

  test("publishes min/max limits from the backend rather than hardcoding them", async ({
    page,
  }) => {
    await page.goto("/bridge");
    await expect(page.getByText(/Min .* · Max .*/i)).toBeVisible();
  });

  test("the primary action is never dead without a stated reason", async ({ page }) => {
    await page.goto("/bridge");
    const cta = primaryCta(page);
    await expect(cta).toBeVisible();
    await expect(cta).toBeDisabled();
    await expect(cta).toHaveAccessibleDescription(/.+/);
  });

  test("creates a GlcToSol transfer and shows the unique deposit address and exact amount, with no OP_RETURN", async ({
    page,
  }) => {
    await page.goto("/bridge");
    await page.getByLabel(/Amount in GLC/i).fill("1000");
    await page
      .getByLabel("Solana recipient address")
      .fill("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

    const cta = primaryCta(page);
    await expect(cta).toBeEnabled();
    await cta.click();

    await expect(page.getByRole("heading", { name: /Send your deposit/i })).toBeVisible();
    await expect(page.getByText(/Send exactly/i)).toBeVisible();
    await expect(page.getByText(/1,000\.00/)).toBeVisible();
    await expect(page.getByText(/OP_RETURN/i)).toHaveCount(0);

    await page.getByRole("button", { name: /track this transfer/i }).click();
    await expect(page).toHaveURL(/\/bridge\/\d+/);
  });

  test("has no detectable accessibility violations", async ({ page }) => {
    await page.goto("/bridge");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test("has no horizontal overflow at the active viewport", async ({ page }) => {
    await page.goto("/bridge");
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});
