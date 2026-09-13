import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import TermsPage, {
  EFFECTIVE_DATE,
  LAST_UPDATED,
  metadata,
} from "../../app/legal/terms/page";
import { routes } from "@/lib/config/links";
import { slugify } from "@/lib/content/toc";

/**
 * The Terms page has one property that matters more than its appearance:
 * every clause it claims to contain is actually on the page, as text, and
 * reachable by the anchor the contents list advertises. A legal page that
 * silently drops a clause, or whose "§8" link scrolls nowhere, is worse
 * than no page — so these tests assert the whole document rather than a
 * sample of it.
 *
 * `/legal/terms` is also the href the footer has rendered since the
 * navigation model was written. It 404'd until this page existed, which is
 * why the route itself is pinned here.
 */

/** The clauses, in the order the document numbers them. */
const CLAUSES = [
  "1. The Goldcoin Bridge",
  "2. Blockchain transactions",
  "3. No guarantee of processing time",
  "4. Bridge fees",
  "5. Anti-abuse and automation policy",
  "6. Rapid-succession and automated activity",
  "7. Minimum 72-hour abuse review period",
  "8. $25 abuse and administrative service fee",
  "9. Manual Review",
  "10. Operator holds",
  "11. Refunds",
  "12. No double payment",
  "13. Transaction and wallet limits",
  "14. Reserve liquidity",
  "15. Route availability",
  "16. Emergency pauses",
  "17. User responsibilities",
  "18. Prohibited conduct",
  "19. Wallet security",
  "20. Smart contract and blockchain risk",
  "21. Third-party networks and services",
  "22. Maintenance and updates",
  "23. Experimental technology",
  "24. No investment advice",
  "25. Taxes",
  "26. Availability of the Service",
  "27. Disclaimer of warranties",
  "28. Limitation of liability",
  "29. Suspension or restriction",
  "30. Changes to these Terms",
  "31. Severability",
  "32. No waiver",
  "33. Entire agreement",
  "34. Governing law and disputes",
  "35. Contact",
  "36. Important notice",
] as const;

const ABUSE_NOTICE =
  "Rapid-succession, automated, limit-evading, or other abusive bridge activity may result in Manual Review. A minimum 72-hour review period may apply, and a USD $25 service and administrative fee may be charged per affected abusive order and deducted from any otherwise eligible refund.";

describe("the route the footer links at", () => {
  it("is the path this page is served from", () => {
    // app/legal/terms/page.tsx. If the route constant moves, the page has
    // to move with it or the footer link 404s again.
    expect(routes.terms).toBe("/legal/terms");
  });
});

describe("document structure", () => {
  it("has exactly one h1, naming the document", () => {
    render(<TermsPage />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Goldcoin Bridge — Terms of Service");
  });

  it("renders every clause as an h2, in order, with none dropped", () => {
    render(<TermsPage />);
    const rendered = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);

    expect(rendered).toEqual([...CLAUSES]);
  });

  it("numbers the clauses contiguously from 1", () => {
    // A renumbering mistake is how a clause goes missing without the count
    // changing — "§12" cited in a dispute has to be the twelfth clause.
    const numbers = CLAUSES.map((clause) => Number(clause.split(".")[0]));
    expect(numbers).toEqual(Array.from({ length: CLAUSES.length }, (_, i) => i + 1));
  });
});

describe("contents and anchors", () => {
  it("lists every clause in the table of contents", () => {
    render(<TermsPage />);
    // Two copies are rendered — the mobile disclosure and the desktop
    // column — so each clause appears twice by design.
    const nav = screen.getByRole("navigation", { name: "On this page" });
    for (const clause of CLAUSES) {
      const links = within(nav).getAllByRole("link", { name: clause });
      expect(links.length, clause).toBeGreaterThan(0);
      expect(links[0]).toHaveAttribute("href", `#${slugify(clause)}`);
    }
  });

  it("gives every contents link a section that actually exists", () => {
    const { container } = render(<TermsPage />);
    const nav = screen.getByRole("navigation", { name: "On this page" });
    const targets = new Set(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")?.slice(1)),
    );

    for (const id of targets) {
      expect(container.querySelector(`section[id="${id}"]`), id).not.toBeNull();
    }
    expect(targets.size).toBe(CLAUSES.length);
  });
});

describe("the notice the page must carry", () => {
  it("states the abuse, review-period and fee consequence up top, as an alert", () => {
    render(<TermsPage />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Important");
    expect(alert).toHaveTextContent(ABUSE_NOTICE);
  });

  it("repeats it in the closing clause, so a reader meets it either way", () => {
    render(<TermsPage />);
    const closing = screen.getByRole("heading", {
      name: "36. Important notice",
    }).parentElement;
    expect(closing).toHaveTextContent(/minimum 72-hour review period may apply/i);
    expect(closing).toHaveTextContent(/USD \$25 service and administrative fee/i);
  });
});

describe("dates", () => {
  it("carries the effective date and last-updated date, both visible", () => {
    render(<TermsPage />);
    expect(EFFECTIVE_DATE).toBe("September 13, 2026");
    expect(LAST_UPDATED).toBe("September 13, 2026");
    expect(screen.getByText("Effective date:")).toBeInTheDocument();
    expect(screen.getByText("Last updated:")).toBeInTheDocument();
    expect(screen.getAllByText("September 13, 2026")).toHaveLength(2);
  });
});

describe("metadata", () => {
  it("names the page and describes it for a search result", () => {
    expect(metadata.title).toBe("Terms of Service");
    expect(metadata.description).toMatch(/Goldcoin Bridge/);
  });

  it("declares /legal/terms as its canonical URL, relative to the configured origin", () => {
    // Relative on purpose: the layout's `metadataBase` resolves it against
    // NEXT_PUBLIC_APP_URL, so the canonical can never name whichever host
    // happened to serve the response.
    expect(metadata.alternates?.canonical).toBe(routes.terms);
    expect(String(metadata.alternates?.canonical).startsWith("http")).toBe(false);
  });
});

describe("the text is text", () => {
  it("renders no image in place of a clause", () => {
    // The whole document has to be selectable, copyable and searchable —
    // a screenshot of terms is not a presentation of terms.
    const { container } = render(<TermsPage />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("leaves the jurisdiction placeholder visible rather than guessing one", () => {
    // §34 is unresolved in the source document. Rendering a guessed
    // jurisdiction would be worse than rendering the gap.
    render(<TermsPage />);
    expect(screen.getByText("[INSERT APPROPRIATE JURISDICTION]")).toBeInTheDocument();
    expect(
      screen.getByText("This section should be completed after legal review."),
    ).toBeInTheDocument();
  });
});
