import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The browser never prices GLC.
 *
 * The bridge rate is struck server-side and only server-side: the daemon
 * reads three verified feeds (NonKYC for Goldcoin L1, Jupiter for Solana, a
 * Uniswap v4 pool for Robinhood Chain), smooths them over a time-weighted
 * window, gates them on staleness, warm-up and a movement band, and serves
 * the single resulting figure as `bridge_quote.bridge_rate`
 * (glc-solana-reserve-bridge `docs/38-elastic-bridge-rate.md`, Phase 2B).
 *
 * A price this application fetched itself would be none of that. It would be
 * one unsmoothed read of one venue, taken at a different instant, passing
 * through none of the gates — and it would be shown next to the words "you
 * receive", where a user would reasonably read it as what the bridge is
 * about to do. Any deposit struck against it would settle at the server's
 * number instead, and the difference is the user's money.
 *
 * So this scan fails the build on the market-data vocabulary reaching a
 * source file at all. It is a blunt instrument on purpose: the failure mode
 * it guards is not a bug someone introduces knowingly, it is a well-meant
 * "let's show a USD value here" that nobody notices is authoritative-looking.
 *
 * What is NOT forbidden: rendering `bridge_quote`'s own fields, which are the
 * server's figures arriving through `POST /quote` like every other amount.
 * The `*_price_e12` names are the wire contract for exactly those, so they
 * are carved out below.
 */

/** Hosts and API surfaces that serve a market price to whoever asks. */
const FORBIDDEN_SOURCES: readonly RegExp[] = [
  /coingecko/i,
  /coinmarketcap/i,
  /cryptocompare/i,
  /binance\.com/i,
  /coinbase\.com\/v2/i,
  /\bnonkyc\b/i,
  /price\.jup\.ag/i,
  /\bjup\.ag\b/i,
  /lite-api\.jup\.ag/i,
  /dexscreener/i,
  /\bpyth\b/i,
  /\bchainlink\b/i,
  /\bcoinpaprika\b/i,
];

/**
 * Client-side price arithmetic. These read on their own as "this file works
 * out what something is worth", which is the server's job in this system.
 */
const FORBIDDEN_CONCEPTS: readonly RegExp[] = [
  /\busdPrice\b/,
  /\bpriceUsd\b/,
  /\bfetchPrice\b/,
  /\bspotPrice\b/,
  /\bmarketPrice\b/,
  /\bcomputeBridgeRate\b/,
  /\bderiveBridgeRate\b/,
];

/**
 * The wire field names this UI legitimately carries, which would otherwise
 * trip a bare `price` match. Checked as whole identifiers so a new
 * `somethingPrice` helper is not silently waved through.
 */
const ALLOWED_IDENTIFIERS = new Set([
  "source_price_e12",
  "destination_price_e12",
  "reference_price_e12",
  "smoothed_price_e12",
]);

const ROOTS = ["app", "src"];
const SKIP_DIRS = new Set(["node_modules", ".next", "coverage"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) {
      files.push(full);
    }
  }
  return files;
}

const repoRoot = join(__dirname, "..", "..");
const sourceFiles = ROOTS.flatMap((root) => collectSourceFiles(join(repoRoot, root)));

/**
 * `price`-suffixed identifiers that are not one of the wire fields above.
 * Matches `foo_price`, `fooPrice`, `price_bar` and `priceBar` alike.
 */
const PRICE_IDENTIFIER = /\b[A-Za-z_$][\w$]*price[\w$]*\b/gi;

function offendingPriceIdentifier(content: string): string | null {
  let match: RegExpExecArray | null;
  PRICE_IDENTIFIER.lastIndex = 0;
  while ((match = PRICE_IDENTIFIER.exec(content))) {
    const identifier = match[0];
    if (ALLOWED_IDENTIFIERS.has(identifier)) continue;
    // Prose in a comment or a doc block is not a code path. Only an
    // identifier that could actually be a price VALUE is a finding, and
    // the concept list above is what decides that.
    if (FORBIDDEN_CONCEPTS.some((pattern) => pattern.test(identifier))) return identifier;
  }
  return null;
}

describe("the browser never fetches a market price", () => {
  it("scanned at least the expected number of source files", () => {
    // A guard against the scan silently finding nothing — a moved directory
    // would otherwise make every assertion below pass vacuously.
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  for (const file of sourceFiles) {
    const relative = file.slice(repoRoot.length + 1);

    it(`${relative} names no market-price source`, () => {
      const content = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN_SOURCES) {
        expect(
          pattern.test(content),
          `${relative} references a market-price source matching ${pattern}. The bridge rate is the backend's (\`bridge_quote.bridge_rate\`) and may not be assembled in the browser — see docs/38-elastic-bridge-rate.md.`,
        ).toBe(false);
      }
    });

    it(`${relative} computes no price of its own`, () => {
      const content = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN_CONCEPTS) {
        expect(
          pattern.test(content),
          `${relative} defines or uses ${pattern}, which prices GLC client-side. Render \`bridge_quote.bridge_rate\` instead.`,
        ).toBe(false);
      }
      expect(offendingPriceIdentifier(content)).toBeNull();
    });
  }
});
