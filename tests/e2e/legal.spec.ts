import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The legal pages, proved in a browser rather than in jsdom.
 *
 * Three of the four properties below are ones jsdom cannot answer
 * honestly: whether the footer's link actually resolves to a served route,
 * whether a clause anchor scrolls its heading into view rather than under
 * the sticky header, and whether the document is readable at 360px without
 * the page scrolling sideways.
 */

test.describe("terms of service", () => {
  test("the footer's Terms link reaches a real page", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("contentinfo").getByRole("link", { name: "Terms" });
    await expect(link).toHaveAttribute("href", "/legal/terms");

    const response = await page.goto("/legal/terms");
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: /Terms of Service/ }),
    ).toBeVisible();
  });

  test("declares itself canonical at /legal/terms", async ({ page }) => {
    await page.goto("/legal/terms");
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute("href", /\/legal\/terms$/);
  });

  test("a clause anchor lands on its heading, clear of the sticky header", async ({
    page,
  }) => {
    await page.goto("/legal/terms");
    const target = "#section-8-25-abuse-and-administrative-service-fee";
    await page.goto(`/legal/terms${target}`);

    const heading = page.locator(target).getByRole("heading", { level: 2 });
    await expect(heading).toBeInViewport();
  });

  test("reads without sideways scrolling at 360px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/legal/terms");

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test("has no detectable accessibility violations", async ({ page }) => {
    await page.goto("/legal/terms");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
