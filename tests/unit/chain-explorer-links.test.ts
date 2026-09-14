import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every explorer link this app can build, resolved by the CHAIN the thing
 * happened on.
 *
 * Two failure modes are guarded, and both are silent rather than loud:
 *
 *  - the WRONG CHAIN — a Robinhood hash sent to the Solana explorer, or a
 *    Solana signature to the Robinhood one. Both produce a link that
 *    resolves, looks right, and shows the wrong chain (or nothing).
 *  - the WRONG KIND — an address fed to a `/tx/{value}` template. Same
 *    host, same shape, a page that will never load the thing the user
 *    clicked.
 *
 * The templates are read once at module load, so each case stubs the
 * environment and re-imports rather than mutating a loaded config.
 */

const TX = {
  goldcoin: "https://explorer.goldcoin.test/tx/{value}",
  solana: "https://explorer.solana.test/tx/{value}",
  robinhood: "https://explorer.robinhood.test/tx/{value}",
} as const;

const ADDRESS = {
  goldcoin: "https://explorer.goldcoin.test/address/{value}",
  solana: "https://explorer.solana.test/account/{value}",
  robinhood: "https://explorer.robinhood.test/address/{value}",
} as const;

/** One realistic identifier per chain, in that chain's own encoding. */
const GOLDCOIN_TXID = "f".repeat(64);
const GOLDCOIN_ADDRESS = "GLCVau1t111111111111111111111111111111111";
const SOLANA_SIGNATURE = "5".repeat(87);
const SOLANA_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const ROBINHOOD_HASH = `0x${"e".repeat(64)}`;
const ROBINHOOD_ADDRESS = `0x${"a".repeat(40)}`;

async function links(configured = true) {
  vi.resetModules();
  if (configured) {
    vi.stubEnv("NEXT_PUBLIC_GLC_EXPLORER_TX_URL", TX.goldcoin);
    vi.stubEnv("NEXT_PUBLIC_GLC_EXPLORER_ADDRESS_URL", ADDRESS.goldcoin);
    vi.stubEnv("NEXT_PUBLIC_SOLANA_EXPLORER_TX_URL", TX.solana);
    vi.stubEnv("NEXT_PUBLIC_SOLANA_EXPLORER_ADDRESS_URL", ADDRESS.solana);
    vi.stubEnv("NEXT_PUBLIC_ROBINHOOD_EXPLORER_TX_URL", TX.robinhood);
    vi.stubEnv("NEXT_PUBLIC_ROBINHOOD_EXPLORER_ADDRESS_URL", ADDRESS.robinhood);
  }
  return import("@/lib/config/links");
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("transaction links go to the right chain's explorer", () => {
  it("sends a Goldcoin txid to the Goldcoin explorer", async () => {
    const { chainTxUrl } = await links();
    expect(chainTxUrl("goldcoin", GOLDCOIN_TXID)).toBe(
      `https://explorer.goldcoin.test/tx/${GOLDCOIN_TXID}`,
    );
  });

  it("sends a Solana signature to the Solana explorer", async () => {
    const { chainTxUrl } = await links();
    expect(chainTxUrl("solana", SOLANA_SIGNATURE)).toBe(
      `https://explorer.solana.test/tx/${SOLANA_SIGNATURE}`,
    );
  });

  it("sends a Robinhood hash to the Robinhood explorer", async () => {
    const { chainTxUrl } = await links();
    expect(chainTxUrl("robinhood", ROBINHOOD_HASH)).toBe(
      `https://explorer.robinhood.test/tx/${encodeURIComponent(ROBINHOOD_HASH)}`,
    );
  });

  it("never crosses a Robinhood hash onto the Solana explorer", async () => {
    const { chainTxUrl } = await links();
    expect(chainTxUrl("robinhood", ROBINHOOD_HASH)).not.toContain("solana");
  });

  it("never crosses a Solana signature onto the Robinhood explorer", async () => {
    const { chainTxUrl } = await links();
    expect(chainTxUrl("solana", SOLANA_SIGNATURE)).not.toContain("robinhood");
  });

  it("gives the three chains three distinct hosts", async () => {
    const { chainTxUrl } = await links();
    const hosts = ["goldcoin", "solana", "robinhood"].map(
      (chain) => new URL(chainTxUrl(chain, "abc")!).host,
    );
    expect(new Set(hosts).size).toBe(3);
  });
});

describe("address links go to the right chain's ADDRESS explorer", () => {
  it("sends a Goldcoin address to the Goldcoin address template", async () => {
    const { chainAddressUrl } = await links();
    expect(chainAddressUrl("goldcoin", GOLDCOIN_ADDRESS)).toBe(
      `https://explorer.goldcoin.test/address/${GOLDCOIN_ADDRESS}`,
    );
  });

  it("sends a Solana address to the Solana account template", async () => {
    const { chainAddressUrl } = await links();
    expect(chainAddressUrl("solana", SOLANA_ADDRESS)).toBe(
      `https://explorer.solana.test/account/${SOLANA_ADDRESS}`,
    );
  });

  it("sends a Robinhood address to the Robinhood address template", async () => {
    const { chainAddressUrl } = await links();
    expect(chainAddressUrl("robinhood", ROBINHOOD_ADDRESS)).toBe(
      `https://explorer.robinhood.test/address/${ROBINHOOD_ADDRESS}`,
    );
  });

  it("never routes an address through a transaction template", async () => {
    const { chainAddressUrl } = await links();
    for (const chain of ["goldcoin", "solana", "robinhood"] as const) {
      expect(chainAddressUrl(chain, "abc")).not.toContain("/tx/");
    }
  });

  it("never crosses an address between chains", async () => {
    const { chainAddressUrl } = await links();
    expect(chainAddressUrl("robinhood", ROBINHOOD_ADDRESS)).not.toContain("solana");
    expect(chainAddressUrl("solana", SOLANA_ADDRESS)).not.toContain("robinhood");
    expect(chainAddressUrl("goldcoin", GOLDCOIN_ADDRESS)).not.toContain("solana");
  });
});

describe("`{value}` substitution", () => {
  it("percent-encodes the value rather than splicing it raw", async () => {
    const { chainTxUrl, chainAddressUrl } = await links();
    // A crafted id must not be able to leave the path it was substituted
    // into, or add a query of its own.
    const hostile = "../evil?x=1#y";
    const tx = chainTxUrl("solana", hostile)!;
    expect(tx).toBe(`https://explorer.solana.test/tx/${encodeURIComponent(hostile)}`);
    expect(new URL(tx).host).toBe("explorer.solana.test");
    expect(new URL(tx).search).toBe("");
    expect(new URL(chainAddressUrl("solana", hostile)!).host).toBe(
      "explorer.solana.test",
    );
  });

  it("leaves no placeholder behind in any built link", async () => {
    const { chainTxUrl, chainAddressUrl } = await links();
    for (const chain of ["goldcoin", "solana", "robinhood"] as const) {
      expect(chainTxUrl(chain, "abc")).not.toContain("{value}");
      expect(chainAddressUrl(chain, "abc")).not.toContain("{value}");
    }
  });
});

describe("nothing is guessed", () => {
  it("returns null for a network this build has no template for", async () => {
    const { chainTxUrl, chainAddressUrl } = await links();
    expect(chainTxUrl("some-future-chain", "abc")).toBeNull();
    expect(chainAddressUrl("some-future-chain", "abc")).toBeNull();
  });

  it("returns null rather than a broken link when nothing is configured", async () => {
    const { chainTxUrl, chainAddressUrl } = await links(false);
    for (const chain of ["goldcoin", "solana", "robinhood"] as const) {
      expect(chainTxUrl(chain, "abc")).toBeNull();
      expect(chainAddressUrl(chain, "abc")).toBeNull();
    }
  });

  it("exposes no RPC endpoint or secret through a link builder", async () => {
    // Explorer templates are public by definition; an RPC URL is not one,
    // and nothing here may reach for it as a fallback host.
    vi.stubEnv("NEXT_PUBLIC_SOLANA_RPC_URL", "https://rpc.private.test");
    vi.stubEnv("NEXT_PUBLIC_ROBINHOOD_RPC_URL", "https://rpc.robinhood.private.test");
    const { chainTxUrl, chainAddressUrl } = await links();
    for (const chain of ["goldcoin", "solana", "robinhood"] as const) {
      expect(chainTxUrl(chain, "abc")).not.toContain("private");
      expect(chainAddressUrl(chain, "abc")).not.toContain("private");
    }
  });
});

/**
 * The one link that must exist whether or not this deployment configured a
 * template.
 *
 * A manual refund was paid outside the bridge's own machinery, so its
 * signature is the only public evidence the user's money came back. No
 * deployment on record sets `NEXT_PUBLIC_SOLANA_EXPLORER_TX_URL`, which is
 * why the template-or-nothing rule that is right everywhere else would have
 * left exactly that figure as unclickable base58.
 *
 * The default is not a guess: `explorer.solana.com` is the network's own
 * explorer and the cluster comes from the same `NEXT_PUBLIC_SOLANA_CLUSTER`
 * this build signs and submits against.
 */
describe("solanaTxUrlOrDefault", () => {
  async function withCluster(cluster: string, configured = false) {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SOLANA_CLUSTER", cluster);
    if (configured) vi.stubEnv("NEXT_PUBLIC_SOLANA_EXPLORER_TX_URL", TX.solana);
    return import("@/lib/config/links");
  }

  it("prefers this deployment's own template when one is configured", async () => {
    const { solanaTxUrlOrDefault } = await withCluster("mainnet-beta", true);
    expect(solanaTxUrlOrDefault(SOLANA_SIGNATURE)).toBe(
      `https://explorer.solana.test/tx/${SOLANA_SIGNATURE}`,
    );
  });

  it("falls back to the network's own explorer, on mainnet, with no cluster query", async () => {
    const { solanaTxUrlOrDefault } = await withCluster("mainnet-beta");
    expect(solanaTxUrlOrDefault(SOLANA_SIGNATURE)).toBe(
      `https://explorer.solana.com/tx/${SOLANA_SIGNATURE}`,
    );
  });

  it("names a non-mainnet cluster rather than silently linking to mainnet", async () => {
    // A devnet signature opened on mainnet shows "transaction not found",
    // which reads as "this refund never happened".
    for (const cluster of ["devnet", "testnet"] as const) {
      const { solanaTxUrlOrDefault } = await withCluster(cluster);
      expect(solanaTxUrlOrDefault(SOLANA_SIGNATURE)).toBe(
        `https://explorer.solana.com/tx/${SOLANA_SIGNATURE}?cluster=${cluster}`,
      );
    }
  });

  it("reaches a localnet through cluster=custom and this build's own RPC", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SOLANA_CLUSTER", "localnet");
    vi.stubEnv("NEXT_PUBLIC_SOLANA_RPC_URL", "http://127.0.0.1:8899");
    const { solanaTxUrlOrDefault } = await import("@/lib/config/links");
    const url = new URL(solanaTxUrlOrDefault(SOLANA_SIGNATURE));
    expect(url.searchParams.get("cluster")).toBe("custom");
    expect(url.searchParams.get("customUrl")).toBe("http://127.0.0.1:8899");
  });

  it("never returns null, and never returns a URL missing the signature", async () => {
    for (const cluster of ["mainnet-beta", "devnet", "testnet", "localnet"] as const) {
      const { solanaTxUrlOrDefault } = await withCluster(cluster);
      const url = solanaTxUrlOrDefault(SOLANA_SIGNATURE);
      expect(url).toBeTruthy();
      expect(url).toContain(SOLANA_SIGNATURE);
      expect(new URL(url).protocol).toBe("https:");
    }
  });

  it("leaves the template-driven builders returning null when unconfigured", async () => {
    // The default is scoped to this one call site. Source and destination
    // transactions keep the plain-text-when-unconfigured behaviour.
    const { solanaTxUrl, chainTxUrl } = await withCluster("mainnet-beta");
    expect(solanaTxUrl(SOLANA_SIGNATURE)).toBeNull();
    expect(chainTxUrl("solana", SOLANA_SIGNATURE)).toBeNull();
  });
});
