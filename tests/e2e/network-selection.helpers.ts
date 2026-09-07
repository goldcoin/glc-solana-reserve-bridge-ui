import { expect, type Page } from "@playwright/test";

/**
 * Driving the network-first bridge form from an end-to-end test.
 *
 * The form has two listbox selectors and one primary button whose label
 * states what pressing it would do. These helpers go through both exactly
 * as a person does, so an interaction that breaks for a user breaks here.
 */

/** Picks a network in one of the two selectors. */
export async function selectNetwork(
  page: Page,
  selector: "Source network" | "Destination network",
  networkName: RegExp,
) {
  const trigger = page.getByRole("button", { name: selector });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const listbox = page.getByRole("listbox", { name: selector });
  await listbox.getByRole("option", { name: networkName }).click();
  await expect(listbox).toBeHidden();
}

/**
 * The primary button, found by its finite label vocabulary. The label is
 * contextual by design — pinning the set here means a label outside it
 * fails the suite rather than silently passing.
 */
export function primaryCta(page: Page) {
  // Scoped to the form's own landmark: the header carries its own
  // "Connect wallet" control, and an unscoped lookup would match both.
  return page.getByRole("region", { name: "Bridge transfer" }).getByRole("button", {
    name: /^(Bridge GLC|Route unavailable|Connect wallet|Enter destination|Enter an amount|Choose networks)$/,
  });
}

/**
 * Waits for `GET /chains` to answer. Every route is unusable before that —
 * unknown availability fails closed — so asserting earlier would pass for
 * the wrong reason.
 */
export async function waitForRouteVerdict(page: Page) {
  await expect(page.getByText("Checking…")).toHaveCount(0);
}
