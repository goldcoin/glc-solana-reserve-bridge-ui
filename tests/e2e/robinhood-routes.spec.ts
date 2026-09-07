import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Robinhood Network in the route selector and on the status page, against
 * the mock backend's default scenario — which mirrors the real shipping
 * state exactly: both legacy routes open, both Robinhood settlement routes
 * implemented but DISABLED, and the two Solana<->Robinhood routes
 * structurally non-executable.
 *
 * The point of these tests is that the closed state is a real, legible
 * state — visible, explained, and impossible to click past — rather than
 * an absence a user has to interpret.
 */

test.describe("Robinhood routes in the bridge form", () => {
  test("offers all six routes, with the Robinhood ones visibly unavailable", async ({
    page,
  }) => {
    await page.goto("/bridge");

    const radios = page.getByRole("radio");
    await expect(radios).toHaveCount(6);

    // The two that predate the route registry are usable.
    await expect(
      page.getByRole("radio", { name: /GLC L1.*GLC on Solana/i }),
    ).toBeEnabled();
    await expect(
      page.getByRole("radio", { name: /GLC on Solana.*GLC L1/i }),
    ).toBeEnabled();

    // The four Robinhood ones are not.
    await expect(
      page.getByRole("radio", { name: /GLC L1.*GLC on Robinhood/i }),
    ).toBeDisabled();
    await expect(
      page.getByRole("radio", { name: /GLC on Robinhood.*GLC L1/i }),
    ).toBeDisabled();
    await expect(
      page.getByRole("radio", { name: /GLC on Solana.*GLC on Robinhood/i }),
    ).toBeDisabled();
    await expect(
      page.getByRole("radio", { name: /GLC on Robinhood.*GLC on Solana/i }),
    ).toBeDisabled();
  });

  test("states the backend's own reason for the two closed settlement routes", async ({
    page,
  }) => {
    await page.goto("/bridge");
    // Copy sourced from `RouteGateError::UNAVAILABLE_MESSAGE`, not written
    // here — the UI never authors its own explanation of a closed route.
    await expect(
      page.getByText(/Robinhood Network support is in development/i).first(),
    ).toBeVisible();
  });

  test("distinguishes a non-executable route from a merely closed one", async ({
    page,
  }) => {
    await page.goto("/bridge");
    // `implemented: false` — no operator action opens these, so the wording
    // must not imply one is coming.
    // Exact: the closed-route copy also contains the words "not
    // available", and the two states must not be conflated.
    await expect(page.getByText("Not available", { exact: true })).toHaveCount(2);
  });

  test("cannot be switched to a closed route by clicking it", async ({ page }) => {
    await page.goto("/bridge");
    await page
      .getByRole("radio", { name: /GLC L1.*GLC on Robinhood/i })
      .click({ force: true });
    // Still on the default route: the form still asks for a Solana address.
    await expect(page.getByLabel("Solana recipient address")).toBeVisible();
  });

  test("has no accessibility violations with the closed routes rendered", async ({
    page,
  }) => {
    await page.goto("/bridge");
    await expect(page.getByRole("radio").first()).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("Robinhood routes on the status page", () => {
  test("lists every route's availability without inventing a reserve figure", async ({
    page,
  }) => {
    await page.goto("/status");

    const routes = page.getByRole("heading", { name: "Routes" });
    await expect(routes).toBeVisible();

    // Availability is stated for all six.
    await expect(page.getByText("GLC on Robinhood → GLC L1")).toBeVisible();

    // The Robinhood reserve has no published capacity — the backend
    // exposes none — so no capacity figure may appear for it. The two
    // reserves that DO publish one still show theirs.
    await expect(page.getByText("Destination reserve capacity")).toHaveCount(2);
  });
});
