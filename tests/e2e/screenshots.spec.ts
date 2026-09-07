import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { selectNetwork, waitForRouteVerdict } from "./network-selection.helpers";

/**
 * Screenshot capture for design review.
 *
 * Opt-in via `E2E_CAPTURE_SCREENSHOTS=1`: this writes files into the repo
 * and is a review aid, not an assertion about behaviour, so it must never
 * run as part of the ordinary suite.
 *
 * # Every capture is the REAL shipping state
 *
 * The Robinhood shots are taken against the default mock scenario, which
 * mirrors production exactly: both Robinhood routes implemented and
 * DISABLED, both Solana↔Robinhood routes structurally non-executable. The
 * mock's `robinhood-open` scenario is deliberately NOT used here. A
 * screenshot showing a Robinhood route as live would misrepresent a
 * network whose custody contract is not deployed, and screenshots outlive
 * the conversation that explains them.
 */

const OUT_DIR = join(process.cwd(), "artifacts", "robinhood-phase-h");

test.skip(
  !process.env.E2E_CAPTURE_SCREENSHOTS,
  "set E2E_CAPTURE_SCREENSHOTS=1 to regenerate design-review screenshots",
);

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

/** Settles the form so a capture never catches a skeleton or a spinner. */
async function settle(page: Page) {
  await waitForRouteVerdict(page);
  await expect(page.getByRole("region", { name: "Bridge transfer" })).toBeVisible();
  // Let the quote and reserve reads land before the shutter.
  await page.waitForTimeout(600);
}

/**
 * Captures the viewport, not `fullPage`.
 *
 * A full-page capture stitches several scroll positions together, and this
 * layout has a sticky header — which then appears a second time partway
 * down the image, looking like a rendering bug that is not there. A
 * viewport tall enough to hold the whole form avoids the stitch entirely.
 */
async function shoot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(OUT_DIR, name) });
}

async function setTheme(page: Page, mode: "light" | "dark") {
  await page
    .getByRole("button", { name: mode === "dark" ? "Dark theme" : "Light theme" })
    .click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset["theme"]))
    .toBe(mode);
}

test.describe("design-review screenshots", () => {
  test.describe.configure({ mode: "serial" });

  test("captures every network pair and both themes", async ({ page }) => {
    // Tall enough that the entire card fits in one viewport capture.
    await page.setViewportSize({ width: 1280, height: 1400 });

    // --- 1. Goldcoin -> Solana, the default, with a real amount entered.
    await page.goto("/bridge");
    await settle(page);
    await page.getByLabel(/Amount in GLC/i).fill("1000");
    await expect(page.getByText(/3% · 30\.00/)).toBeVisible();
    await shoot(page, "glc-to-sol.png");

    // --- 8. The same view is the canonical light-theme shot.
    await shoot(page, "bridge-light.png");

    // --- 7. Dark theme, same state, so the two are comparable.
    await setTheme(page, "dark");
    await shoot(page, "bridge-dark.png");
    await setTheme(page, "light");

    // --- 2. Solana -> Goldcoin.
    await page.goto("/bridge");
    await settle(page);
    await selectNetwork(page, "Source network", /Solana/);
    await page.getByLabel(/Amount in GLC/i).fill("1000");
    await expect(page.getByText("Solana → Goldcoin")).toBeVisible();
    await shoot(page, "sol-to-glc.png");

    // --- 3. Goldcoin -> Robinhood Chain: implemented, CLOSED. Not faked open.
    await page.goto("/bridge");
    await settle(page);
    await selectNetwork(page, "Destination network", /Robinhood Chain/);
    await expect(page.getByText("Goldcoin → Robinhood Chain")).toBeVisible();
    await expect(page.getByText("Coming soon").first()).toBeVisible();
    await shoot(page, "glc-to-robinhood.png");

    // --- 4. Robinhood Chain -> Goldcoin: implemented, CLOSED.
    await page.goto("/bridge");
    await settle(page);
    await selectNetwork(page, "Source network", /Robinhood Chain/);
    await selectNetwork(page, "Destination network", /Goldcoin/);
    await expect(page.getByText("Robinhood Chain → Goldcoin")).toBeVisible();
    await shoot(page, "robinhood-to-glc.png");

    // --- 5. Solana -> Robinhood Chain: structurally non-executable.
    await page.goto("/bridge");
    await settle(page);
    await selectNetwork(page, "Source network", /Solana/);
    await selectNetwork(page, "Destination network", /Robinhood Chain/);
    await expect(page.getByText("Not available", { exact: true }).first()).toBeVisible();
    await shoot(page, "solana-to-robinhood-disabled.png");

    // --- 6. Robinhood Chain -> Solana: the same, reversed.
    await page.goto("/bridge");
    await settle(page);
    await selectNetwork(page, "Source network", /Robinhood Chain/);
    await selectNetwork(page, "Destination network", /Solana/);
    await expect(page.getByText("Robinhood Chain → Solana")).toBeVisible();
    await shoot(page, "robinhood-to-solana-disabled.png");

    // --- 10. The destination selector open, showing availability per network.
    await page.goto("/bridge");
    await settle(page);
    await page.getByRole("button", { name: "Destination network" }).click();
    await expect(
      page.getByRole("listbox", { name: "Destination network" }),
    ).toBeVisible();
    await shoot(page, "network-selector-open.png");
  });

  test("captures the mobile layout", async ({ page }) => {
    // --- 9. A real phone viewport, stacked panels, full-width CTA.
    await page.setViewportSize({ width: 360, height: 1100 });
    await page.goto("/bridge");
    await settle(page);
    await page.getByLabel(/Amount in GLC/i).fill("1000");
    // Wait for the quote so the TO panel shows a figure, not its pending
    // ellipsis — a screenshot of a loading state reviews nothing.
    await expect(page.getByText(/3% · 30\.00/)).toBeVisible();
    await shoot(page, "bridge-mobile.png");
  });
});
