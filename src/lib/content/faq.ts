import { routes } from "@/lib/config/links";

/**
 * The FAQ catalogue.
 *
 * One list of questions, shared by the /faq page and the floating help
 * widget. The page owns the ANSWERS — they are prose, and prose belongs in
 * the page — while this module owns the questions, their anchors and the
 * words a reader might search for.
 *
 * Splitting it this way is what keeps the widget honest: it can list and
 * filter questions, but it has no answer text of its own to drift out of
 * date, and every shortcut it offers resolves to a section that provably
 * exists (`tests/unit/faq-catalogue.test.ts`).
 *
 * Ids are written out rather than derived so they are literal types, which
 * is what lets the FAQ page's answer map be checked for completeness at
 * compile time. They must equal `slugify(question)` — the same slug
 * `ContentPage` will generate for the heading — and a unit test enforces it.
 */

export interface FaqEntry {
  readonly id: string;
  readonly question: string;
  /**
   * Extra search terms. The words a worried reader actually types ("stuck",
   * "missing", "sent too little") are rarely the words a heading uses, and a
   * search that finds nothing reads as "this product has no answer for me".
   */
  readonly keywords: readonly string[];
}

export const FAQ_ENTRIES = [
  {
    id: "does-the-bridge-create-new-glc",
    question: "Does the bridge create new GLC?",
    keywords: ["supply", "reserve", "backed", "inflation", "new coins"],
  },
  {
    id: "what-is-the-fee",
    question: "What is the fee?",
    keywords: ["fees", "cost", "3%", "charge", "network fee", "limits"],
  },
  {
    id: "where-are-my-funds",
    question: "Where are my funds?",
    keywords: ["missing", "lost", "money", "did not arrive", "not received"],
  },
  {
    id: "why-is-my-transfer-pending",
    question: "Why is my transfer pending?",
    keywords: ["stuck", "slow", "waiting", "delayed", "still processing"],
  },
  {
    id: "how-many-confirmations-are-required",
    question: "How many confirmations are required?",
    keywords: ["confirmations", "blocks", "how long", "finality"],
  },
  {
    id: "what-happens-if-i-send-the-wrong-amount",
    question: "What happens if I send the wrong amount?",
    keywords: ["mismatch", "too little", "too much", "underpaid", "overpaid"],
  },
  {
    id: "why-was-my-transfer-refunded",
    question: "Why was my transfer refunded?",
    keywords: ["refund", "returned", "money back", "reversed"],
  },
  {
    id: "why-was-my-transfer-refused",
    question: "Why was my transfer refused?",
    keywords: ["rejected", "declined", "paused", "capacity", "minimum", "maximum"],
  },
  {
    id: "can-i-send-directly-to-an-exchange",
    question: "Can I send directly to an exchange?",
    keywords: ["exchange", "deposit address", "custodial", "cex"],
  },
] as const satisfies readonly FaqEntry[];

export type FaqId = (typeof FAQ_ENTRIES)[number]["id"];

/**
 * The questions the help widget offers before anything is typed, in the
 * order it offers them.
 *
 * Deliberately not "the first six entries": the page is ordered to be read
 * top to bottom, and the widget is ordered by what a reader who opened it
 * mid-problem is most likely to be here for.
 */
export const FAQ_SHORTCUT_IDS: readonly FaqId[] = [
  "where-are-my-funds",
  "why-is-my-transfer-pending",
  "why-was-my-transfer-refunded",
  "what-happens-if-i-send-the-wrong-amount",
  "how-many-confirmations-are-required",
  "can-i-send-directly-to-an-exchange",
];

export const FAQ_SHORTCUTS: readonly FaqEntry[] = FAQ_SHORTCUT_IDS.map((id) => {
  const entry = FAQ_ENTRIES.find((candidate) => candidate.id === id);
  // Unreachable while FaqId is derived from FAQ_ENTRIES; kept so a future
  // edit that widens the type fails loudly here rather than rendering a gap.
  if (!entry) throw new Error(`Unknown FAQ shortcut id: ${id}`);
  return entry;
});

/** Where a question lives on the full FAQ page. */
export function faqHref(id: string): string {
  return `${routes.faq}#${id}`;
}

/**
 * Comparison form for search: lower-cased, diacritics folded, punctuation
 * collapsed to spaces. "What's the fee?" and "whats fee" must reach the same
 * entry.
 */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Local FAQ search. Every term must appear somewhere in the entry, so adding
 * words narrows the list rather than widening it — the behaviour a reader
 * expects from a search box, and the reason no external search service is
 * needed for nine questions.
 *
 * An empty query matches everything; the widget decides whether that means
 * "show all" or "show the curated shortcuts".
 */
export function searchFaq(query: string): readonly FaqEntry[] {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (terms.length === 0) return FAQ_ENTRIES;

  return FAQ_ENTRIES.filter((entry) => {
    const haystack = normalize(`${entry.question} ${entry.keywords.join(" ")}`);
    return terms.every((term) => haystack.includes(term));
  });
}
