import { describe, expect, it } from "vitest";
import {
  FAQ_ENTRIES,
  FAQ_SHORTCUTS,
  FAQ_SHORTCUT_IDS,
  faqHref,
  searchFaq,
} from "@/lib/content/faq";
import { buildToc, slugify } from "@/lib/content/toc";
import { routes } from "@/lib/config/links";

/**
 * The catalogue's contract with the two things that consume it: the /faq
 * page, whose anchors are generated from the question text, and the help
 * widget, which links into those anchors from somewhere else entirely.
 *
 * A drifted id is silent in both — the widget's link scrolls nowhere and the
 * reader concludes the answer does not exist — so it is pinned here.
 */
describe("FAQ catalogue ids", () => {
  it("uses the same slug the content page will generate for the heading", () => {
    for (const entry of FAQ_ENTRIES) {
      expect(entry.id, entry.question).toBe(slugify(entry.question));
    }
  });

  it("matches the table of contents built from the questions", () => {
    const toc = buildToc(FAQ_ENTRIES.map((entry) => entry.question));
    expect(toc.map((section) => section.id)).toEqual(FAQ_ENTRIES.map((e) => e.id));
  });

  it("is free of duplicate ids and duplicate questions", () => {
    expect(new Set(FAQ_ENTRIES.map((e) => e.id)).size).toBe(FAQ_ENTRIES.length);
    expect(new Set(FAQ_ENTRIES.map((e) => e.question)).size).toBe(FAQ_ENTRIES.length);
  });

  it("links into the FAQ route", () => {
    expect(faqHref("where-are-my-funds")).toBe(`${routes.faq}#where-are-my-funds`);
  });
});

describe("FAQ shortcuts", () => {
  it("offers the six high-value questions, in their curated order", () => {
    expect(FAQ_SHORTCUTS.map((entry) => entry.question)).toEqual([
      "Where are my funds?",
      "Why is my transfer pending?",
      "Why was my transfer refunded?",
      "What happens if I send the wrong amount?",
      "How many confirmations are required?",
      "Can I send directly to an exchange?",
    ]);
  });

  it("every shortcut id resolves to a real catalogue entry", () => {
    const known = new Set(FAQ_ENTRIES.map((entry) => entry.id));
    for (const id of FAQ_SHORTCUT_IDS) expect(known.has(id), id).toBe(true);
  });
});

describe("searchFaq", () => {
  it("returns everything for an empty or whitespace query", () => {
    expect(searchFaq("")).toEqual(FAQ_ENTRIES);
    expect(searchFaq("   ")).toEqual(FAQ_ENTRIES);
  });

  it("matches question text regardless of case or punctuation", () => {
    const found = searchFaq("WHAT'S the FEE?!");
    expect(found.map((entry) => entry.id)).toContain("what-is-the-fee");
  });

  it("matches the words a worried reader actually types", () => {
    // None of these appear in the heading they must reach.
    expect(searchFaq("stuck").map((e) => e.id)).toContain("why-is-my-transfer-pending");
    expect(searchFaq("missing").map((e) => e.id)).toContain("where-are-my-funds");
    expect(searchFaq("too little").map((e) => e.id)).toContain(
      "what-happens-if-i-send-the-wrong-amount",
    );
  });

  it("narrows as terms are added rather than widening", () => {
    const one = searchFaq("transfer");
    const two = searchFaq("transfer refunded");
    expect(two.length).toBeLessThan(one.length);
    expect(two.every((entry) => one.includes(entry))).toBe(true);
  });

  it("returns nothing rather than guessing when there is no match", () => {
    expect(searchFaq("zzzznotaquestion")).toEqual([]);
  });
});
