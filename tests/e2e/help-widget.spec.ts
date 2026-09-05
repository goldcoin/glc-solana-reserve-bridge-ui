import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The floating help widget, in a real browser, at both viewports the
 * projects in playwright.config.ts define (1280px and 360px).
 *
 * The unit tests own search and link integrity. What can only be proved here
 * is the part that is geometry and browser behaviour: that the control sits
 * where it is meant to and covers nothing that matters, that a dialog closes
 * by all three routes a dialog must close by, that the theme reaches it, and
 * that it is operable and clean from the keyboard.
 */

const launcher = (page: Page) => page.getByRole("button", { name: "Help" });
const panel = (page: Page) => page.getByRole("dialog", { name: "Goldcoin Help" });
const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Search the FAQ" });

async function openHelp(page: Page) {
  await launcher(page).click();
  await expect(panel(page)).toBeVisible();
}

/** A box, or a failed expectation — never null slipping through as a pass. */
async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("no bounding box");
  return box;
}

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

test.describe("opening and closing", () => {
  test("the launcher is present on every route and opens a compact panel", async ({
    page,
  }) => {
    for (const path of ["/", "/bridge", "/status", "/faq"]) {
      await page.goto(path);
      await expect(launcher(page), path).toBeVisible();
    }

    await openHelp(page);
    await expect(page.getByRole("heading", { name: "Goldcoin Help" })).toBeVisible();
    await expect(searchBox(page)).toBeVisible();
  });

  test("closes with the X button", async ({ page }) => {
    await page.goto("/");
    await openHelp(page);

    await page.getByRole("button", { name: "Close help" }).click();

    await expect(panel(page)).toBeHidden();
    await expect(launcher(page)).toBeFocused();
  });

  test("closes with Escape", async ({ page }) => {
    await page.goto("/");
    await openHelp(page);

    await page.keyboard.press("Escape");

    await expect(panel(page)).toBeHidden();
  });

  test("closes on a click outside the panel", async ({ page }) => {
    await page.goto("/");
    await openHelp(page);

    // The top-left corner: outside the panel at both viewports, and outside
    // the dock the panel is anchored into.
    await page.mouse.click(8, 120);

    await expect(panel(page)).toBeHidden();
  });
});

test.describe("FAQ search and links", () => {
  test("filters the FAQ down to matching questions as you type", async ({ page }) => {
    await page.goto("/");
    await openHelp(page);

    await expect(
      panel(page).getByRole("link", { name: "Where are my funds?" }),
    ).toBeVisible();

    await searchBox(page).fill("refunded");

    await expect(
      panel(page).getByRole("link", { name: "Why was my transfer refunded?" }),
    ).toBeVisible();
    await expect(
      panel(page).getByRole("link", { name: "Where are my funds?" }),
    ).toBeHidden();

    await searchBox(page).fill("zzzznotaquestion");
    await expect(panel(page).getByText(/nothing in the faq matches that/i)).toBeVisible();
  });

  test("a question shortcut lands on that section of the full FAQ", async ({ page }) => {
    await page.goto("/");
    await openHelp(page);

    await panel(page).getByRole("link", { name: "Why is my transfer pending?" }).click();

    await expect(page).toHaveURL(/\/faq#why-is-my-transfer-pending$/);
    await expect(
      page.getByRole("heading", { name: "Why is my transfer pending?" }),
    ).toBeVisible();
    await expect(panel(page)).toBeHidden();
  });

  test("every route shortcut reaches the page it names", async ({ page }) => {
    for (const [label, url, heading] of [
      ["Check transfer status", /\/activity$/, /^Activity$/],
      ["View bridge status", /\/status$/, /^Bridge status$/],
      ["Open full FAQ", /\/faq$/, /^Frequently asked questions$/],
      ["Support", /\/support$/, /^Support$/],
    ] as const) {
      await page.goto("/");
      await openHelp(page);

      await panel(page).getByRole("link", { name: label }).click();

      await expect(page, label).toHaveURL(url);
      await expect(page.getByRole("heading", { name: heading }), label).toBeVisible();
    }
  });

  test("offers no live chat channel it cannot honour", async ({ page }) => {
    await page.goto("/");
    await openHelp(page);

    await expect(panel(page).getByText(/chat/i)).toHaveCount(0);
  });
});

test.describe("layout", () => {
  test("the launcher clears the viewport edges and the header", async ({ page }) => {
    await page.goto("/");

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (!viewport) return;

    const box = await boxOf(launcher(page));

    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(viewport.width - (box.x + box.width)).toBeGreaterThanOrEqual(12);
    expect(viewport.height - (box.y + box.height)).toBeGreaterThanOrEqual(12);

    const header = await boxOf(page.locator("header").first());
    expect(box.y).toBeGreaterThan(header.y + header.height);
  });

  test("the launcher and the theme control share the corner without overlapping", async ({
    page,
  }) => {
    await page.goto("/");

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (!viewport) return;

    const help = await boxOf(launcher(page));
    const theme = await boxOf(page.getByRole("group", { name: "Colour theme" }));

    expect(overlaps(help, theme)).toBe(false);

    if (viewport.width >= 768) {
      // Room beside the content column: stacked, help above, and the theme
      // control keeps the corner it already had.
      expect(help.y + help.height).toBeLessThanOrEqual(theme.y);
    } else {
      // No room: one row along the bottom edge, help to the left of the
      // theme control and sharing its baseline, so the widget occludes no
      // band of the page that this chrome did not already occlude.
      expect(help.x + help.width).toBeLessThanOrEqual(theme.x);
      expect(
        Math.abs(help.y + help.height - (theme.y + theme.height)),
      ).toBeLessThanOrEqual(2);
    }
  });

  test("the closed launcher covers none of the bridge form's controls", async ({
    page,
  }) => {
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (!viewport) return;

    // At 360px the content column is the whole screen, so no fixed corner
    // control — this one or the theme toggle that shipped before it — can be
    // geometrically clear of a full-width control at every scroll position.
    // What must hold there is that the primary action stays operable, and
    // that is asserted on its own below, at both viewports.
    test.skip(viewport.width < 768, "desktop layout only");

    await page.goto("/bridge");

    const help = await boxOf(launcher(page));

    for (const control of [
      page.getByLabel(/Amount in GLC/i),
      page.getByLabel("Solana recipient address"),
      page.getByRole("button", { name: /Create deposit request/i }),
    ]) {
      expect(overlaps(help, await boxOf(control))).toBe(false);
    }
  });

  test("the open panel covers none of the bridge form's controls", async ({ page }) => {
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (!viewport) return;

    // Below `sm` the panel spans the width — it is a sheet, not a column
    // beside the page — so this is the desktop guarantee: the panel opens
    // beside the bridge card, never over it.
    test.skip(viewport.width < 768, "desktop layout only");

    await page.goto("/bridge");

    // Measured before opening: a modal dialog hides the rest of the page
    // from the accessibility tree, which is correct, and which is also why
    // the controls cannot be located by role once it is open. The assertion
    // below proves the page does not move underneath it, so these boxes are
    // still where the controls are.
    const controls = [];
    for (const control of [
      page.getByLabel(/Amount in GLC/i),
      page.getByLabel("Solana recipient address"),
      page.getByRole("button", { name: /Create deposit request/i }),
    ]) {
      controls.push(await boxOf(control));
    }
    const mainBefore = await boxOf(page.locator("main"));

    await openHelp(page);

    const mainAfter = await boxOf(page.locator("main"));
    expect(Math.abs(mainAfter.x - mainBefore.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(mainAfter.width - mainBefore.width)).toBeLessThanOrEqual(1);

    const box = await boxOf(panel(page));
    for (const control of controls) {
      expect(overlaps(box, control)).toBe(false);
    }
  });

  test("the bridge form's primary action stays operable with the widget on screen", async ({
    page,
  }) => {
    await page.goto("/bridge");

    await page.getByLabel(/Amount in GLC/i).fill("1000");
    await page
      .getByLabel("Solana recipient address")
      .fill("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

    const cta = page.getByRole("button", { name: /Create deposit request/i });
    await expect(cta).toBeEnabled();

    // A trial click runs every actionability check — including "is something
    // else on top of this at the point a tap would land" — and stops short of
    // creating a transfer. This is the assertion that matters at 360px.
    await cta.click({ trial: true });
  });

  test("the open panel stays inside the viewport", async ({ page }) => {
    await page.goto("/bridge");
    await openHelp(page);

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (!viewport) return;

    const box = await boxOf(panel(page));

    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    // Anchored to the bottom of the screen, so the header, the wallet control
    // and the top of whatever page is open stay visible behind it.
    expect(box.y).toBeGreaterThan(viewport.height * 0.25);
  });
});

test.describe("appearance", () => {
  test("the panel follows the dark theme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await openHelp(page);
    const light = await panel(page).evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );

    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await openHelp(page);
    const dark = await panel(page).evaluate((el) => getComputedStyle(el).backgroundColor);

    expect(light).toBe("rgb(255, 255, 255)");
    expect(dark).not.toBe(light);
  });
});

test.describe("keyboard and accessibility", () => {
  test("opens from the keyboard, traps focus, and gives it back on Escape", async ({
    page,
  }) => {
    await page.goto("/");

    // Establishes keyboard as the interaction modality, which is what
    // :focus-visible keys off.
    await page.keyboard.press("Tab");
    await launcher(page).focus();

    const focus = await launcher(page).evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        focusVisible: el.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
    expect(focus.focusVisible).toBe(true);
    expect(focus.outlineStyle).not.toBe("none");
    expect(focus.outlineWidth).not.toBe("0px");

    await page.keyboard.press("Enter");
    await expect(panel(page)).toBeVisible();

    // Tab cycles inside the dialog rather than escaping to the page behind it.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() => {
          const active = document.activeElement;
          const dialog = document.querySelector('[role="dialog"]');
          return Boolean(active && dialog?.contains(active));
        }),
      ).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(launcher(page)).toBeFocused();
  });

  test("has no detectable accessibility violations, open, in both themes", async ({
    page,
  }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto("/bridge");
      await openHelp(page);

      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations,
        `${colorScheme}: ${JSON.stringify(results.violations, null, 2)}`,
      ).toEqual([]);
    }
  });
});
