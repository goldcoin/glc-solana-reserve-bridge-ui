import { describe, expect, it } from "vitest";
import { buildToc, slugify } from "@/lib/content/toc";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Bridge Fee")).toBe("bridge-fee");
  });

  it("strips punctuation", () => {
    expect(slugify("What is the fee?")).toBe("what-is-the-fee");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  --Hello--  ")).toBe("hello");
  });

  it("prefixes a slug that would start with a digit", () => {
    // Legal HTML, illegal CSS: `querySelector("#8-...")` and any `:target`
    // rule written against it throw a SyntaxError, while fragment
    // navigation keeps working — so the breakage surfaces long after the
    // numbered heading was added.
    expect(slugify("8. $25 abuse and administrative service fee")).toBe(
      "section-8-25-abuse-and-administrative-service-fee",
    );
    expect(slugify("72-hour review")).toBe("section-72-hour-review");
  });

  it("leaves a slug that already starts with a letter alone", () => {
    // The existing long-form pages' published anchors must not move.
    expect(slugify("Bridge fee")).toBe("bridge-fee");
    expect(slugify("Reserve capacity")).toBe("reserve-capacity");
  });
});

describe("buildToc", () => {
  it("builds one entry per title with a derived id", () => {
    expect(buildToc(["Bridge fee", "Transfer limits"])).toEqual([
      { title: "Bridge fee", id: "bridge-fee" },
      { title: "Transfer limits", id: "transfer-limits" },
    ]);
  });

  it("disambiguates a slug collision rather than dropping it", () => {
    const toc = buildToc(["Fee", "Fee"]);
    expect(toc[0]!.id).toBe("fee");
    expect(toc[1]!.id).toBe("fee-2");
    expect(toc[0]!.id).not.toBe(toc[1]!.id);
  });

  it("returns an empty list for no titles", () => {
    expect(buildToc([])).toEqual([]);
  });
});
