import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { primaryCta } from "./network-selection.helpers";

/**
 * The theme control, in a real browser.
 *
 * The unit tests own the resolution rules; what can only be proved here is
 * that the theme is on the document before the first paint, that it survives
 * a real reload, and that the whole UI — not just the toggle — holds up in
 * dark mode.
 */

const STORAGE_KEY = "glc-bridge-theme";

const sun = (page: Page) => page.getByRole("button", { name: "Light theme" });
const moon = (page: Page) => page.getByRole("button", { name: "Dark theme" });

const theme = (page: Page) =>
  page.evaluate(() => ({
    dark: document.documentElement.classList.contains("dark"),
    data: document.documentElement.dataset["theme"],
    colorScheme: document.documentElement.style.colorScheme,
    background: getComputedStyle(document.body).backgroundColor,
  }));

const storedPreference = (page: Page) =>
  page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);

test.describe("theme control", () => {
  test("a first visit follows the operating system, before the page is painted", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });

    const response = await page.goto("/");

    // The correction is a synchronous inline script in <head>, so it is in
    // the document the server sent rather than something React does later.
    // That is the whole mechanism behind "no flash of the wrong theme".
    const html = (await response?.text()) ?? "";
    const head = html.slice(0, html.indexOf("<body"));
    expect(head).toContain(STORAGE_KEY);
    expect(head).toContain("prefers-color-scheme: dark");

    const applied = await theme(page);
    expect(applied.dark).toBe(true);
    expect(applied.data).toBe("dark");
    expect(applied.colorScheme).toBe("dark");
    await expect(moon(page)).toHaveAttribute("aria-pressed", "true");

    // Following the system is not a choice, so nothing is written down.
    expect(await storedPreference(page)).toBeNull();
  });

  test("a first visit with a light system preference stays light", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");

    const applied = await theme(page);
    expect(applied.dark).toBe(false);
    expect(applied.data).toBe("light");
    await expect(sun(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("choosing dark applies immediately, without reloading the page", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");

    const lightBackground = (await theme(page)).background;

    // A value that only survives if the document is never torn down.
    await page.evaluate(() => {
      (window as unknown as { __themeProbe?: number }).__themeProbe = 1;
    });

    await moon(page).click();

    const applied = await theme(page);
    expect(applied.dark).toBe(true);
    expect(applied.background).not.toBe(lightBackground);
    expect(await storedPreference(page)).toBe("dark");
    expect(
      await page.evaluate(
        () => (window as unknown as { __themeProbe?: number }).__themeProbe,
      ),
    ).toBe(1);
  });

  test("an explicit dark choice survives a reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await moon(page).click();

    await page.reload();

    expect((await theme(page)).dark).toBe(true);
    await expect(moon(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("an explicit light choice survives a reload and outranks a dark system preference", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    expect((await theme(page)).dark).toBe(true);

    await sun(page).click();
    expect((await theme(page)).dark).toBe(false);

    await page.reload();

    const applied = await theme(page);
    expect(applied.dark).toBe(false);
    expect(applied.data).toBe("light");
    expect(await storedPreference(page)).toBe("light");
  });

  test("the choice carries across a navigation to another route", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await moon(page).click();

    await page.goto("/bridge");
    expect((await theme(page)).dark).toBe(true);

    await page.goto("/explorer");
    expect((await theme(page)).dark).toBe(true);
  });

  test("it is operable from the keyboard and shows a visible focus ring", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");

    // Establishes keyboard as the interaction modality, which is what
    // :focus-visible keys off.
    await page.keyboard.press("Tab");
    await moon(page).focus();

    const focus = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('[aria-label="Dark theme"]');
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        focusVisible: element.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });

    expect(focus?.focusVisible).toBe(true);
    expect(focus?.outlineStyle).not.toBe("none");
    expect(focus?.outlineWidth).not.toBe("0px");

    await page.keyboard.press("Enter");
    expect((await theme(page)).dark).toBe(true);
  });

  test("it sits clear of the viewport edges and of the header chrome", async ({
    page,
  }) => {
    await page.goto("/");

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (!viewport) return;

    const control = page.getByRole("group", { name: "Colour theme" });
    await expect(control).toBeVisible();

    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Inside the viewport, with real breathing room on both edges.
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(viewport.width - (box.x + box.width)).toBeGreaterThanOrEqual(12);
    expect(viewport.height - (box.y + box.height)).toBeGreaterThanOrEqual(12);

    // Anchored to the bottom half, so it never reaches the sticky header —
    // which is the only other fixed chrome on the page, and carries the
    // wallet control.
    expect(box.y).toBeGreaterThan(viewport.height / 2);
    const header = page.locator("header").first();
    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();
    if (headerBox) expect(box.y).toBeGreaterThan(headerBox.y + headerBox.height);
  });
});

/**
 * The dark-mode audit.
 *
 * Every route the design spec calls a primary surface, rendered dark and put
 * through axe. Contrast is the failure mode a themed retrofit actually has —
 * a pale tint that stayed pale, a border that vanished, text that inverted
 * while its background did not — and it is exactly what this catches.
 */
const AUDITED_ROUTES = [
  "/",
  "/bridge",
  "/explorer",
  "/reserves",
  "/status",
  "/activity",
  "/fees",
  "/wallets",
  /*
   * Transfer detail, by mock fixture id. These are not decoration: 1009 is
   * the refunded lifecycle whose amount presentation PR #20 rewrote, and
   * 1007 is the manual-review state that the same #2477-shaped mismatch
   * produces. Both render markup the route list above never reaches, so
   * without them the newest surfaces in the app would go un-audited.
   */
  "/bridge/1000",
  "/bridge/1007",
  "/bridge/1009",
] as const;

test.describe("dark mode across the application", () => {
  for (const route of AUDITED_ROUTES) {
    test(`${route} has no accessibility violations in dark mode`, async ({ page }) => {
      await page.addInitScript((key) => {
        try {
          window.localStorage.setItem(key, "dark");
        } catch {
          /* storage unavailable */
        }
      }, STORAGE_KEY);
      await page.emulateMedia({ colorScheme: "dark" });

      await page.goto(route);
      expect((await theme(page)).dark).toBe(true);

      /*
       * Transfer detail fetches on the client, so an immediate scan sees the
       * loading skeleton — which has no <h1> yet and fails `page-has-heading-one`
       * in BOTH themes. Waiting for the heading audits the rendered page rather
       * than the placeholder. Every audited route has one, so this is a
       * uniform "the page has finished arriving" gate, not a special case.
       */
      await page.getByRole("heading", { level: 1 }).first().waitFor();

      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations,
        `${route}\n${JSON.stringify(results.violations, null, 2)}`,
      ).toEqual([]);
    });
  }

  test("the deposit QR stays scannable — light modules on white — in dark mode", async ({
    page,
  }) => {
    await page.addInitScript((key) => {
      try {
        window.localStorage.setItem(key, "dark");
      } catch {
        /* storage unavailable */
      }
    }, STORAGE_KEY);

    // The deposit screen is only reachable by creating a request, so the one
    // surface the route sweep above cannot see is driven for real here.
    await page.goto("/bridge");
    await page.getByLabel(/Amount in GLC/i).fill("1000");
    await page
      .getByLabel("Solana recipient address")
      .fill("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    await primaryCta(page).click();
    await expect(page.getByRole("heading", { name: /Send your deposit/i })).toBeVisible();

    expect((await theme(page)).dark).toBe(true);

    /*
     * A QR whose modules inverted with the theme is a QR that will not scan,
     * and the failure would be silent — the symbol still looks like a QR. So
     * both ends of its contrast are asserted, not just the background.
     */
    // Below `md` the symbol is collapsed behind a disclosure on purpose: the
    // user's Goldcoin wallet is on the same phone and nobody scans their own
    // screen. It still has to be right once opened.
    const disclosure = page.getByRole("button", { name: /show qr code/i });
    if (await disclosure.isVisible()) await disclosure.click();

    const symbol = page.getByRole("img", { name: /deposit address/i });
    await expect(symbol).toBeVisible();

    const contrast = await symbol.evaluate((node) => {
      const modules = node.querySelector("path");
      return {
        background: getComputedStyle(node).backgroundColor,
        modules: modules ? getComputedStyle(modules).fill : null,
      };
    });

    expect(contrast.background).toBe("rgb(255, 255, 255)");
    expect(contrast.modules).toBe("rgb(11, 13, 15)");

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test("no surface stays light when the rest of the page goes dark", async ({ page }) => {
    await page.addInitScript((key) => {
      try {
        window.localStorage.setItem(key, "dark");
      } catch {
        /* storage unavailable */
      }
    }, STORAGE_KEY);
    await page.goto("/bridge");

    /*
     * A themed retrofit fails by leaving one plane behind — a card that kept
     * `bg-white`, a header that did not move — and literal white is the
     * fingerprint of exactly that: no token in this system resolves to
     * #ffffff in the dark theme, so any element still painting it is one the
     * audit missed. Offenders are reported by selector rather than as a
     * count, so a failure names the component.
     *
     * Deliberately bright TOKENS are not caught by this and should not be:
     * the inverted primary fill (ink-950) and the gold nav underline are
     * meant to be light in dark mode. The QR symbol is the one literal-white
     * exception, and it is excluded by the SVG check — it stays white in both
     * themes because a deposit address that will not scan is a funds problem,
     * not a styling preference.
     */
    const stillWhite = await page.evaluate(() => {
      const offenders: string[] = [];
      for (const element of document.querySelectorAll<HTMLElement>("body *")) {
        if (element.closest("svg")) continue; // the QR symbol and inline icons
        const background = getComputedStyle(element).backgroundColor;
        if (/^rgba?\(255,\s*255,\s*255(,\s*(1|0?\.\d+))?\)$/.test(background)) {
          offenders.push(
            `${element.tagName.toLowerCase()}.${element.className.toString().slice(0, 80)}`,
          );
        }
      }
      return offenders;
    });

    expect(stillWhite, stillWhite.join("\n")).toEqual([]);
  });
});
