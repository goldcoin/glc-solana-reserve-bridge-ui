import { env } from "./env";
import type { Chain } from "@/lib/api/schemas/common";

/**
 * Every outbound URL the UI can render, derived from configuration.
 *
 * Builders return `null` rather than a broken or guessed URL when the
 * template is not configured. Callers render plain text in that case: a
 * chain reference with no working link is honest, a link to nowhere is not.
 */

function build(template: string | undefined, value: string): string | null {
  if (!template) return null;
  return template.replace("{value}", encodeURIComponent(value));
}

export function goldcoinTxUrl(txid: string): string | null {
  return build(env.glcExplorerTxUrl, txid);
}

export function goldcoinAddressUrl(address: string): string | null {
  return build(env.glcExplorerAddressUrl, address);
}

export function solanaTxUrl(signature: string): string | null {
  return build(env.solanaExplorerTxUrl, signature);
}

export function solanaAddressUrl(address: string): string | null {
  return build(env.solanaExplorerAddressUrl, address);
}

export function robinhoodTxUrl(hash: string): string | null {
  return build(env.robinhoodExplorerTxUrl, hash);
}

export function robinhoodAddressUrl(address: string): string | null {
  return build(env.robinhoodExplorerAddressUrl, address);
}

/**
 * The transaction-explorer link for a transaction that happened ON a
 * particular chain.
 *
 * Resolving by chain rather than by "is this GlcToSol" is what keeps a
 * four-route world correct: a `GlcToRhn` source transaction is a Goldcoin
 * txid and its destination transaction is an EVM hash, and a binary
 * direction check would have silently linked one of them to the wrong
 * explorer. Returns `null` when no template is configured for that chain,
 * which is the existing "render the id as plain text" path.
 */
export function chainTxUrl(chain: Chain, id: string): string | null {
  switch (chain) {
    case "goldcoin":
      return goldcoinTxUrl(id);
    case "solana":
      return solanaTxUrl(id);
    case "robinhood":
      return robinhoodTxUrl(id);
  }
}

/** The host this deployment is served from, for the anti-phishing notice. */
export function primaryDomain(): string {
  try {
    return new URL(env.appUrl).host;
  } catch {
    return env.appUrl;
  }
}

export const officialDomains: readonly string[] = env.officialDomains;

export const externalLinks = {
  protocolRepo: env.protocolRepoUrl,
  docs: env.docsUrl,
  audits: env.auditsUrl,
  bugBounty: env.bugBountyUrl,
  support: env.supportUrl,
} as const;

/** Internal routes, centralised so the router and nav model cannot drift apart. */
export const routes = {
  home: "/",
  bridge: "/bridge",
  transfer: (id: number | string) => `/bridge/${id}`,
  activity: "/activity",
  explorer: "/explorer",
  explorerTx: (id: number | string) => `/explorer/tx/${id}`,
  reserves: "/reserves",
  status: "/status",
  fees: "/fees",
  security: "/security",
  verify: "/verify",
  wallets: "/wallets",
  faq: "/faq",
  glossary: "/glossary",
  support: "/support",
  paused: "/paused",
  terms: "/legal/terms",
  privacy: "/legal/privacy",
} as const;
