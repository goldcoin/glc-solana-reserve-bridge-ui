import { env } from "./env";

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

/**
 * Where a Solana signature is verifiable when this deployment has configured
 * no `NEXT_PUBLIC_SOLANA_EXPLORER_TX_URL` template.
 *
 * # Why this one chain gets a default at all
 *
 * The rule above — return `null` rather than a guessed URL — exists because
 * a guessed HOST is a link to nowhere, or worse, to someone else's site.
 * That risk does not apply here: `explorer.solana.com` is the network's own
 * first-party explorer, its `/tx/{signature}` path is stable, and the
 * cluster is not guessed either — it is read from the same
 * `NEXT_PUBLIC_SOLANA_CLUSTER` the app already signs and submits against, so
 * the link can only ever point at the cluster this build is talking to.
 *
 * # Why a plain string is not good enough here
 *
 * A manual refund was paid outside the bridge's own machinery. The signature
 * is therefore the ONLY public evidence that the user's money came back, and
 * a page that states "your 50,000 GLC was returned" while making that
 * evidence an uncopyable-looking wall of base58 is asking to be taken on
 * faith. It is used for that one figure, not for source/destination
 * transactions, which stay template-driven exactly as before.
 */
const SOLANA_EXPLORER_TX_BASE = "https://explorer.solana.com/tx";

/**
 * `explorer.solana.com` addresses mainnet with no query at all, names devnet
 * and testnet explicitly, and reaches anything else through `cluster=custom`
 * plus the RPC it should talk to.
 */
function solanaExplorerClusterQuery(): string {
  switch (env.solanaCluster) {
    case "mainnet-beta":
      return "";
    case "devnet":
      return "?cluster=devnet";
    case "testnet":
      return "?cluster=testnet";
    case "localnet":
      // `customUrl` is what makes `cluster=custom` resolve to anything at
      // all, but the RPC is optional configuration — omitted, the explorer
      // falls back to its own localhost default, which is the right guess
      // for a localnet and still not one this code invented.
      return env.solanaRpcUrl
        ? `?cluster=custom&customUrl=${encodeURIComponent(env.solanaRpcUrl)}`
        : "?cluster=custom";
  }
}

/**
 * A Solana transaction link that is always present: this deployment's
 * configured template when it has one, and the network's own explorer at the
 * configured cluster otherwise. See {@link SOLANA_EXPLORER_TX_BASE}.
 */
export function solanaTxUrlOrDefault(signature: string): string {
  return (
    solanaTxUrl(signature) ??
    `${SOLANA_EXPLORER_TX_BASE}/${encodeURIComponent(signature)}${solanaExplorerClusterQuery()}`
  );
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
export function chainTxUrl(chainId: string, id: string): string | null {
  switch (chainId) {
    case "goldcoin":
      return goldcoinTxUrl(id);
    case "solana":
      return solanaTxUrl(id);
    case "robinhood":
      return robinhoodTxUrl(id);
    default:
      // A network this build has no explorer template for. Plain text is
      // honest; a link to a guessed host is not.
      return null;
  }
}

/**
 * The ADDRESS-explorer link for an address that exists ON a particular
 * chain — the twin of {@link chainTxUrl}, and separate from it for the
 * reason the two template families are separate in configuration: an
 * explorer's transaction path and its address path are different URLs, and
 * feeding an address to a `/tx/{value}` template produces a link that
 * loads and shows nothing.
 *
 * Resolved by chain id for the same reason as `chainTxUrl`: a `RhnToGlc`
 * source wallet is a 20-byte EVM address and its Goldcoin destination is a
 * base58check address, so any branch on "which direction is this" would
 * eventually send one of them to the other's explorer. Returns `null` when
 * no template is configured for that chain, which is the existing "render
 * the address as plain text" path.
 */
export function chainAddressUrl(chainId: string, address: string): string | null {
  switch (chainId) {
    case "goldcoin":
      return goldcoinAddressUrl(address);
    case "solana":
      return solanaAddressUrl(address);
    case "robinhood":
      return robinhoodAddressUrl(address);
    default:
      // A network this build has no explorer template for. Plain text is
      // honest; a link to a guessed host is not.
      return null;
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
