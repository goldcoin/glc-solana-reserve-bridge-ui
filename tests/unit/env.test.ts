import { describe, expect, it } from "vitest";
import { env, __envSchemaForTests as envSchema } from "@/lib/config/env";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_GLC_TOKEN_ADDRESS,
  ROBINHOOD_V1_BRIDGE_ADDRESS,
  ROBINHOOD_V2_BRIDGE_ADDRESS,
} from "@/lib/evm/robinhood-target";

/**
 * Configuration is a safety control: a misconfigured explorer template or a
 * missing API URL should fail loudly at startup rather than render a broken
 * link to a user about to send funds.
 */

const base = {
  appUrl: "https://example.test",
  officialDomains: "example.test",
  bridgeApiMode: "mock",
  solanaCluster: "devnet",
  reserveMintAddress: "GLCzUtuEUJJRBozMrwH3BN5TEy2T7XftGH8TR3yNX5HH",
};

describe("public environment schema", () => {
  it("accepts a minimal mock configuration", () => {
    expect(envSchema.safeParse(base).success).toBe(true);
  });

  it("requires the canonical reserve mint address", () => {
    const { reserveMintAddress: _omit, ...rest } = base;
    expect(envSchema.safeParse(rest).success).toBe(false);
  });

  it("leaves the reserve program id optional (Solana -> Goldcoin disables with a reason, not a guess)", () => {
    expect(envSchema.safeParse(base).success).toBe(true);
    expect(
      envSchema.safeParse({
        ...base,
        reserveProgramId: "BnCFcMaZtpXUzZhXZdQSeQWH4A2BMv5ZaebGe6Ysv2oY",
      }).success,
    ).toBe(true);
  });

  describe("retired program ids on mainnet-beta", () => {
    // Mirrors the backend's own permanently-retired denylist
    // (glc-solana-reserve-bridge: service/src/bin/glc-mainnet-bootstrap.rs):
    // the scaffold/dev id was never deployed to a public cluster, the first
    // mainnet deployment has been closed with its rent reclaimed, and the
    // second is bound to the pre-migration mint and reserve vault. A
    // mainnet config carrying any of them would build deposit instructions
    // against a dead program, so startup fails instead.
    const SCAFFOLD_DEV_ID = "BnCFcMaZtpXUzZhXZdQSeQWH4A2BMv5ZaebGe6Ysv2oY";
    const CLOSED_MAINNET_ID = "7h2zSJuqpmbSq4seeXDdaJChVoxhEWwA9b8qG6Ct1GNn";
    const SUPERSEDED_MAINNET_ID = "6tmLSP2j2thito2RpByqgfKHuVRSLcNd9c5FkrLJMjja";
    const PRODUCTION_ID = "H8SoqRyBFQaT1o33vPGj7KCftFXs3SnLYtE81h1RRJgb";

    it.each([SCAFFOLD_DEV_ID, CLOSED_MAINNET_ID, SUPERSEDED_MAINNET_ID])(
      "refuses retired id %s when the cluster is mainnet-beta",
      (retired) => {
        const result = envSchema.safeParse({
          ...base,
          solanaCluster: "mainnet-beta",
          reserveProgramId: retired,
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain("permanently retired");
        }
      },
    );

    it("accepts the current production id on mainnet-beta", () => {
      expect(
        envSchema.safeParse({
          ...base,
          solanaCluster: "mainnet-beta",
          reserveProgramId: PRODUCTION_ID,
        }).success,
      ).toBe(true);
    });

    it("still accepts the dev id on localnet, where local validators genuinely deploy at it", () => {
      expect(
        envSchema.safeParse({
          ...base,
          solanaCluster: "localnet",
          reserveProgramId: SCAFFOLD_DEV_ID,
        }).success,
      ).toBe(true);
    });
  });

  describe("the Token-2022 asset migration", () => {
    // Production moved mint, bridge program and reserve vault together. The
    // UI's job here is narrow but absolute: a deployment must not be able to
    // regress to the pre-migration asset and start deriving token accounts
    // for a mint the reserve does not hold.
    const CURRENT_MINT = "GLCzUtuEUJJRBozMrwH3BN5TEy2T7XftGH8TR3yNX5HH";
    const RETIRED_MINT = "Hn6Kdxs6cJrXDLvArAief8ueTgdZLkRacLPPUZo2pump";

    it("defaults to the current canonical mint when the variable is unset", () => {
      expect(env.reserveMintAddress).toBe(CURRENT_MINT);
    });

    it("accepts the current mint on mainnet-beta", () => {
      expect(
        envSchema.safeParse({
          ...base,
          solanaCluster: "mainnet-beta",
          reserveMintAddress: CURRENT_MINT,
        }).success,
      ).toBe(true);
    });

    it("refuses the retired mint when the cluster is mainnet-beta", () => {
      const result = envSchema.safeParse({
        ...base,
        solanaCluster: "mainnet-beta",
        reserveMintAddress: RETIRED_MINT,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("retired Solana GLC mint");
      }
    });

    it("leaves non-mainnet clusters free to point at any test mint", () => {
      expect(
        envSchema.safeParse({
          ...base,
          solanaCluster: "devnet",
          reserveMintAddress: RETIRED_MINT,
        }).success,
      ).toBe(true);
    });
  });

  describe("the announcement flag", () => {
    /*
     * Fail-closed, and the default matters more than the parse: an
     * announcement that outlives its launch is the failure this flag
     * exists to prevent, so anything that is not exactly "true" hides the
     * strip — and none of it may fail the build, because taking a
     * deployment down over a banner would be worse than the banner.
     */
    it("is off when the variable is unset", () => {
      const parsed = envSchema.safeParse(base);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.announcementEnabled).toBe(false);
    });

    it("is off for this build, which sets no announcement flag", () => {
      expect(env.announcementEnabled).toBe(false);
    });

    it.each([
      ["true", true],
      ["TRUE", true],
      ["  true  ", true],
      ["false", false],
      ["", false],
      ["1", false],
      ["yes", false],
      ["truthy", false],
    ])("reads %o as %s", (value, expected) => {
      const parsed = envSchema.safeParse({ ...base, announcementEnabled: value });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.announcementEnabled).toBe(expected);
    });
  });

  describe("public Solana RPC endpoint on mainnet-beta", () => {
    // The free, unauthenticated, shared endpoint — real-world root cause of
    // wallet transactions failing with a browser-console 403 in production.
    const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";

    it("refuses the public RPC endpoint when the cluster is mainnet-beta", () => {
      const result = envSchema.safeParse({
        ...base,
        solanaCluster: "mainnet-beta",
        solanaRpcUrl: PUBLIC_RPC,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("must not be used");
      }
    });

    it("refuses the public RPC endpoint with a trailing slash too", () => {
      expect(
        envSchema.safeParse({
          ...base,
          solanaCluster: "mainnet-beta",
          solanaRpcUrl: `${PUBLIC_RPC}/`,
        }).success,
      ).toBe(false);
    });

    it("accepts a dedicated RPC provider on mainnet-beta", () => {
      expect(
        envSchema.safeParse({
          ...base,
          solanaCluster: "mainnet-beta",
          solanaRpcUrl: "https://my-provider.example.com/rpc",
        }).success,
      ).toBe(true);
    });

    it("still accepts the public endpoint on devnet, where it is the normal choice", () => {
      expect(
        envSchema.safeParse({
          ...base,
          solanaCluster: "devnet",
          solanaRpcUrl: "https://api.devnet.solana.com",
        }).success,
      ).toBe(true);
    });
  });

  it("requires an API URL when the mode is http", () => {
    const result = envSchema.safeParse({ ...base, bridgeApiMode: "http" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        "NEXT_PUBLIC_BRIDGE_API_URL is required",
      );
    }
  });

  it("accepts http mode with an API URL", () => {
    expect(
      envSchema.safeParse({
        ...base,
        bridgeApiMode: "http",
        bridgeApiUrl: "https://api.example.test",
      }).success,
    ).toBe(true);
  });

  it("parses the official domain list", () => {
    const result = envSchema.safeParse({
      ...base,
      officialDomains: "example.test, bridge.example.test ,",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.officialDomains).toEqual([
        "example.test",
        "bridge.example.test",
      ]);
    }
  });

  it("rejects an empty official domain list", () => {
    expect(envSchema.safeParse({ ...base, officialDomains: " , " }).success).toBe(false);
  });

  it("rejects an explorer template without the {value} placeholder", () => {
    const result = envSchema.safeParse({
      ...base,
      glcExplorerTxUrl: "https://explorer.example.test/tx/",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed explorer template", () => {
    expect(
      envSchema.safeParse({
        ...base,
        glcExplorerTxUrl: "https://explorer.example.test/tx/{value}",
      }).success,
    ).toBe(true);
  });

  it("rejects a relative app URL", () => {
    expect(envSchema.safeParse({ ...base, appUrl: "/bridge" }).success).toBe(false);
  });

  it("rejects an unknown Solana cluster", () => {
    expect(envSchema.safeParse({ ...base, solanaCluster: "mainnet" }).success).toBe(
      false,
    );
  });

  it("parses Goldcoin address version bytes strictly", () => {
    const result = envSchema.safeParse({ ...base, glcAddressVersions: "32, 5" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.glcAddressVersions).toEqual([32, 5]);
  });

  it("rejects a non-numeric version byte entry rather than silently dropping it", () => {
    expect(envSchema.safeParse({ ...base, glcAddressVersions: "32, abc" }).success).toBe(
      false,
    );
  });
});

describe("Robinhood identity configuration must agree with the pins", () => {
  /**
   * The production incident this block exists for.
   *
   * `.env.production` carried `NEXT_PUBLIC_ROBINHOOD_BRIDGE_ADDRESS` set
   * to the RETIRED V1 custody contract. Everything built, everything
   * started, every page served — and every Robinhood route refused at
   * the form with a message about a contract the operator never saw,
   * because nothing checked the value until a user had already picked a
   * route and connected a wallet.
   *
   * The chain id, the custody contract and the token are pinned in code.
   * Configuration may only ever AGREE with a pin, so a disagreement is a
   * deployment fault and is refused here, where it is a build failure
   * rather than a silent outage. `checkRobinhoodTarget` still refuses the
   * same values at the form — that duplication is the guarantee, not
   * redundancy.
   */

  it("accepts silence — an absent variable means the pin", () => {
    const result = envSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.robinhoodBridgeAddress).toBeUndefined();
      expect(result.data.robinhoodChainId).toBeUndefined();
      expect(result.data.robinhoodTokenAddress).toBeUndefined();
    }
  });

  it("REFUSES the retired V1 bridge contract, and names it", () => {
    const result = envSchema.safeParse({
      ...base,
      robinhoodBridgeAddress: ROBINHOOD_V1_BRIDGE_ADDRESS,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.path.includes("robinhoodBridgeAddress"),
      );
      expect(issue?.message).toContain("RETIRED V1");
      // Actionable: the operator is told what to use instead.
      expect(issue?.message).toContain(ROBINHOOD_V2_BRIDGE_ADDRESS);
    }
  });

  it("refuses the retired V1 contract in any casing", () => {
    // An address is 20 bytes; EIP-55 casing is a checksum, not identity.
    // A lowercase stale value is the same stale value.
    for (const spelling of [
      ROBINHOOD_V1_BRIDGE_ADDRESS.toLowerCase(),
      ROBINHOOD_V1_BRIDGE_ADDRESS.toUpperCase().replace("0X", "0x"),
    ]) {
      const result = envSchema.safeParse({
        ...base,
        robinhoodBridgeAddress: spelling,
      });
      expect(result.success).toBe(false);
    }
  });

  it("refuses an unrecognised bridge contract", () => {
    const result = envSchema.safeParse({
      ...base,
      robinhoodBridgeAddress: "0x000000000000000000000000000000000000dEaD",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.path.includes("robinhoodBridgeAddress"),
      );
      expect(issue?.message).toContain(ROBINHOOD_V2_BRIDGE_ADDRESS);
    }
  });

  it("accepts the pinned V2 address, in any casing", () => {
    for (const spelling of [
      ROBINHOOD_V2_BRIDGE_ADDRESS,
      ROBINHOOD_V2_BRIDGE_ADDRESS.toLowerCase(),
    ]) {
      expect(
        envSchema.safeParse({ ...base, robinhoodBridgeAddress: spelling }).success,
      ).toBe(true);
    }
  });

  it("refuses a chain id that is not Robinhood Network", () => {
    const result = envSchema.safeParse({ ...base, robinhoodChainId: "1" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.find((i) => i.path.includes("robinhoodChainId"))?.message,
      ).toContain(String(ROBINHOOD_CHAIN_ID));
    }
  });

  it("accepts the pinned chain id", () => {
    const result = envSchema.safeParse({
      ...base,
      robinhoodChainId: String(ROBINHOOD_CHAIN_ID),
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.robinhoodChainId).toBe(ROBINHOOD_CHAIN_ID);
  });

  it("refuses a token the bridge contract does not hold", () => {
    const result = envSchema.safeParse({
      ...base,
      robinhoodTokenAddress: "0x000000000000000000000000000000000000dEaD",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.find((i) => i.path.includes("robinhoodTokenAddress"))
          ?.message,
      ).toContain(ROBINHOOD_GLC_TOKEN_ADDRESS);
    }
  });

  it("accepts the pinned token, in any casing", () => {
    for (const spelling of [
      ROBINHOOD_GLC_TOKEN_ADDRESS,
      ROBINHOOD_GLC_TOKEN_ADDRESS.toLowerCase(),
    ]) {
      expect(
        envSchema.safeParse({ ...base, robinhoodTokenAddress: spelling }).success,
      ).toBe(true);
    }
  });

  it("does not police PRESENTATION values", () => {
    // A display name and an RPC endpoint are not identity. A wrong RPC
    // can only make a read fail or succeed — it cannot redirect funds,
    // which the pinned chain id and contract decide. Failing a
    // deployment over a display name would be a false alarm.
    expect(
      envSchema.safeParse({
        ...base,
        robinhoodChainName: "Robinhood Chain",
        robinhoodRpcUrl: "https://rpc.example.test",
      }).success,
    ).toBe(true);
  });

  it("reproduces the exact production configuration, and refuses it", () => {
    // What `.env.production` actually carried: the chain id and token
    // correct, the bridge address stale. One wrong variable out of three
    // is still a refusal — the trio is checked independently, so a
    // correct-looking neighbour never vouches for a stale one.
    const result = envSchema.safeParse({
      ...base,
      bridgeApiMode: "http",
      bridgeApiUrl: "https://bridge.goldcoinproject.org/api/bridge",
      robinhoodChainId: "4663",
      robinhoodChainName: "Robinhood Chain",
      robinhoodTokenAddress: ROBINHOOD_GLC_TOKEN_ADDRESS,
      robinhoodBridgeAddress: ROBINHOOD_V1_BRIDGE_ADDRESS,
    });
    expect(result.success).toBe(false);

    // And the same configuration with that ONE variable corrected — or
    // simply removed — is accepted.
    for (const fixed of [{ robinhoodBridgeAddress: ROBINHOOD_V2_BRIDGE_ADDRESS }, {}]) {
      expect(
        envSchema.safeParse({
          ...base,
          bridgeApiMode: "http",
          bridgeApiUrl: "https://bridge.goldcoinproject.org/api/bridge",
          robinhoodChainId: "4663",
          robinhoodChainName: "Robinhood Chain",
          robinhoodTokenAddress: ROBINHOOD_GLC_TOKEN_ADDRESS,
          ...fixed,
        }).success,
      ).toBe(true);
    }
  });
});
