import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import PrivacyPage, {
  EFFECTIVE_DATE,
  LAST_UPDATED,
  metadata,
} from "../../app/legal/privacy/page";
import { routes } from "@/lib/config/links";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { slugify } from "@/lib/content/toc";

/**
 * A privacy policy is the one document where boilerplate is actively
 * dangerous. "We set no cookies" is not a sentiment — it is a claim about
 * this codebase, and if an analytics snippet lands next quarter the claim
 * becomes a false statement about what happens to someone's wallet
 * address.
 *
 * So this file does two things. The first half is the ordinary structural
 * contract every long-form page gets: sections present, anchors resolve,
 * dates rendered, metadata correct. The second half scans `app/` and
 * `src/` and fails if the code stops matching what the page promises.
 * Those tests are aimed at a FUTURE commit, not this one.
 */

const SECTIONS = [
  "What this policy covers",
  "No account, and no identity documents",
  "What the interface stores on your device",
  "What you send when you use the Bridge",
  "What a blockchain makes public",
  "The public explorer",
  "Network requests, and who answers them",
  "Wallets and browser extensions",
  "No analytics, advertising, or third-party tracking",
  "Addresses in URLs",
  "Support and correspondence",
  "How long information is kept",
  "Your choices",
  "Children",
  "Changes to this policy",
  "Contact",
] as const;

describe("the route the footer links at", () => {
  it("is the path this page is served from", () => {
    // app/legal/privacy/page.tsx. The footer has rendered this href since
    // the navigation model was written; it 404'd until this page existed.
    expect(routes.privacy).toBe("/legal/privacy");
  });
});

describe("document structure", () => {
  it("has exactly one h1, naming the document", () => {
    render(<PrivacyPage />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Goldcoin Bridge — Privacy Policy");
  });

  it("renders every section as an h2, in order, with none dropped", () => {
    render(<PrivacyPage />);
    const rendered = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);

    expect(rendered).toEqual([...SECTIONS]);
  });

  it("gives every contents link a section that actually exists", () => {
    const { container } = render(<PrivacyPage />);
    const nav = screen.getByRole("navigation", { name: "On this page" });
    const targets = new Set(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")?.slice(1)),
    );

    for (const id of targets) {
      expect(container.querySelector(`section[id="${id}"]`), id).not.toBeNull();
    }
    expect(targets.size).toBe(SECTIONS.length);
    for (const section of SECTIONS) {
      expect(targets.has(slugify(section)), section).toBe(true);
    }
  });

  it("carries the effective date and last-updated date, both visible", () => {
    render(<PrivacyPage />);
    expect(EFFECTIVE_DATE).toBe("September 12, 2026");
    expect(LAST_UPDATED).toBe("September 12, 2026");
    expect(screen.getByText("Effective date:")).toBeInTheDocument();
    expect(screen.getByText("Last updated:")).toBeInTheDocument();
    expect(screen.getAllByText("September 12, 2026")).toHaveLength(2);
  });

  it("renders no image in place of a section", () => {
    // The whole document has to be selectable, copyable and searchable.
    const { container } = render(<PrivacyPage />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });
});

describe("metadata", () => {
  it("names the page and describes it for a search result", () => {
    expect(metadata.title).toBe("Privacy Policy");
    expect(metadata.description).toMatch(/Goldcoin Bridge/);
  });

  it("declares /legal/privacy as its canonical URL, relative to the configured origin", () => {
    expect(metadata.alternates?.canonical).toBe(routes.privacy);
    expect(String(metadata.alternates?.canonical).startsWith("http")).toBe(false);
  });
});

describe("links", () => {
  it("points contact at the configured origin and in-app routes only", () => {
    // No invented email address, no hardcoded domain.
    render(<PrivacyPage />);
    const clause = screen.getByRole("heading", { name: "Contact" }).parentElement!;

    const hrefs = within(clause)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toContain(routes.home);
    expect(hrefs).toContain(routes.support);
    expect(hrefs.every((href) => href?.startsWith("/"))).toBe(true);
    expect(clause.textContent).not.toMatch(/@/);
  });

  it("links no external origin anywhere on the page", () => {
    const { container } = render(<PrivacyPage />);
    const external = [...container.querySelectorAll("a[href]")]
      .map((link) => link.getAttribute("href")!)
      .filter((href) => !href.startsWith("/") && !href.startsWith("#"));

    expect(external).toEqual([]);
  });
});

describe("the claims, checked against the code that has to back them", () => {
  /*
   * Scanned rather than asserted in prose, because these are the
   * statements that go stale silently. Each failure below means the page
   * now says something untrue — fix the page, or reconsider the change
   * that made it untrue.
   */
  const ROOTS = ["app", "src"];
  const SKIP_DIRS = new Set(["node_modules", ".next", "coverage"]);
  const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
  const repoRoot = join(__dirname, "..", "..");

  function collectSourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        files.push(...collectSourceFiles(full));
      } else if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) {
        files.push(full);
      }
    }
    return files;
  }

  /** Block comments and whole comment lines, so prose about a term is not a use of it. */
  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trimStart();
        return !trimmed.startsWith("//") && !trimmed.startsWith("*");
      })
      .join("\n");
  }

  const sourceFiles = ROOTS.flatMap((root) => collectSourceFiles(join(repoRoot, root)));
  const code = sourceFiles.map((file) => stripComments(readFileSync(file, "utf8")));

  it("scanned at least the expected number of source files", () => {
    // A guard against the scan silently finding nothing and every case
    // below passing vacuously.
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  it('"this site sets no cookies" — nothing writes one', () => {
    const offenders = sourceFiles.filter((_, i) =>
      /document\s*\.\s*cookie/.test(code[i]!),
    );
    expect(offenders).toEqual([]);
  });

  it('"no analytics, tracking pixel, advertising network or session replay"', () => {
    const TRACKERS =
      /\b(gtag|googletagmanager|google-analytics|mixpanel|posthog|amplitude|segment\.com|fullstory|hotjar|logrocket|plausible|fathom|matomo|clarity\.ms)\b/i;
    const offenders = sourceFiles.filter((_, i) => TRACKERS.test(code[i]!));
    expect(offenders).toEqual([]);
  });

  it("names the browser-storage keys that exist, and no others exist", () => {
    // The page lists exactly two: the theme preference (imported from its
    // own module, so it cannot be retyped wrong) and the per-announcement
    // dismissal. A third would make the list incomplete.
    render(<PrivacyPage />);
    expect(screen.getByText(new RegExp(THEME_STORAGE_KEY))).toBeInTheDocument();

    const storageUsers = sourceFiles.filter((_, i) =>
      /window\s*\.\s*(localStorage|sessionStorage)\s*\.\s*(set|get|remove)Item/.test(
        code[i]!,
      ),
    );
    expect(storageUsers.map((file) => file.slice(repoRoot.length + 1)).sort()).toEqual([
      "src/components/layout/NetworkAnnouncement.tsx",
      "src/lib/theme/theme.ts",
    ]);
  });

  it('"fonts are served from this site itself" — never from a CDN', () => {
    const csp = readFileSync(join(repoRoot, "src/lib/security/csp.ts"), "utf8");
    expect(csp).toContain("\"font-src 'self'\"");
    expect(csp).toContain("\"default-src 'self'\"");
  });
});
