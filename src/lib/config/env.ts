import { z } from "zod";

/**
 * Public runtime configuration.
 *
 * Every value here is shipped to the browser and is therefore public by
 * definition. This module is the ONLY place `process.env` is read in
 * application source, and `scripts/check-no-secrets.mjs` fails the build if
 * anything outside NEXT_PUBLIC_* is ever read.
 *
 * No domain, RPC endpoint, explorer URL, or repository link is hardcoded
 * anywhere else in this codebase. If the UI renders a URL, it originates
 * here.
 *
 * Transfer limits, the fee rate, reserve capacity, and direction pause state
 * are deliberately NOT env vars: the bridge backend is authoritative for all
 * of those (`GET /limits`, `GET /status`, `GET /stats`), so the UI can never
 * drift from protocol truth.
 */

const urlSchema = z.url({ error: "must be an absolute URL including scheme" });

/**
 * A decimal EIP-155 chain id.
 *
 * Decimal ONLY, never hex. `4663` and `0x4663` are different chain ids
 * (4663 and 18019), so a parser that guessed by the presence of a prefix
 * would be one missing `0x` away from signing for the wrong network — the
 * same reasoning the backend's `EvmChainId` documents for keeping its
 * decimal and hex entry points separate.
 */
const chainIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/, {
    error: "must be a positive decimal EIP-155 chain id (decimal, not hex)",
  })
  .transform((value) => Number(value))
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));

/**
 * A 20-byte EVM address in `0x`-prefixed hex.
 *
 * Deliberately shape-only and case-insensitive here: EIP-55 checksum
 * verification belongs at the point a user TYPES an address (see
 * `@/lib/evm/address`), where a checksum failure is actionable feedback.
 * A configured deployment address that merely differs in case is a
 * working address, and failing startup over it would be a false alarm.
 */
const evmAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, { error: "must be a 0x-prefixed 20-byte EVM address" });

/** An explorer link template containing the {value} placeholder. */
const templateSchema = z.string().refine((value) => value.includes("{value}"), {
  error: "must contain the {value} placeholder",
});

const csvSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .pipe(z.array(z.string()).min(1, { error: "at least one domain is required" }));

/**
 * A comma-separated list of byte values, e.g. "32,5".
 *
 * Parsed strictly: a malformed entry fails startup rather than being dropped,
 * because a silently shortened version list would quietly reject a whole
 * class of valid Goldcoin addresses.
 */
const versionBytesSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => (/^\d+$/.test(entry) ? Number(entry) : Number.NaN)),
  )
  .pipe(
    z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(255, { error: "each version byte must be a whole number 0-255" }),
      )
      .min(1, { error: "at least one version byte is required" }),
  );

/** The canonical Solana GLC (Token-2022) mint. Public, protocol-level data. */
const DEFAULT_RESERVE_MINT_ADDRESS = "Hn6Kdxs6cJrXDLvArAief8ueTgdZLkRacLPPUZo2pump";

/**
 * Program ids the bridge has permanently retired, mirrored from the backend's
 * own denylist (`service/src/bin/glc-mainnet-bootstrap.rs` /
 * `scripts/verify-program-id-replacement.sh` in glc-solana-reserve-bridge):
 *
 * - `BnCF…v2oY` — the original scaffold/dev id. Still what local validators
 *   deploy at during development, but never deployed to a public cluster.
 * - `7h2z…1GNn` — the first mainnet deployment, since permanently closed
 *   with its rent reclaimed. A transaction sent to it can never succeed.
 *
 * A mainnet-beta deployment configured with either is a stale config that
 *  would build deposit instructions against a dead or never-deployed
 * program, so it fails startup here rather than failing in users' wallets.
 * Non-mainnet clusters are exempt: the dev id is the legitimate localnet id.
 */
const RETIRED_RESERVE_PROGRAM_IDS = new Set([
  "BnCFcMaZtpXUzZhXZdQSeQWH4A2BMv5ZaebGe6Ysv2oY",
  "7h2zSJuqpmbSq4seeXDdaJChVoxhEWwA9b8qG6Ct1GNn",
]);

/**
 * Solana Labs' shared public RPC — free, unauthenticated, and explicitly
 * not meant for production traffic: it heavily rate-limits and, in
 * practice, outright rejects (403) many browser-origin requests, including
 * the `sendTransaction`/`getLatestBlockhash` calls this app's wallet flow
 * depends on. A mainnet-beta deployment pointed at it fails wallet
 * transactions in a way that looks like this app is broken, not like a
 * config problem — so that misconfiguration fails loudly at startup
 * instead. Every other cluster (devnet/testnet/localnet) keeps its own
 * public endpoint, which is the normal, supported way to use them.
 */
const PUBLIC_UNTHROTTLED_MAINNET_RPC_URLS = new Set([
  "https://api.mainnet-beta.solana.com",
  "https://api.mainnet-beta.solana.com/",
]);

const envSchema = z
  .object({
    appUrl: urlSchema,
    officialDomains: csvSchema,
    appVersion: z.string().min(1).optional(),

    bridgeApiMode: z.enum(["mock", "http"]).default("mock"),
    bridgeApiUrl: urlSchema.optional(),
    /**
     * Real backend origin for the local dev-only same-origin proxy
     * (`app/api/bridge/[...path]/route.ts`), read server-side only. Exists
     * because the real bridge service has no CORS headers of its own
     * (`service/src/api.rs` module doc) — pointing `bridgeApiUrl` at
     * `/api/bridge` keeps the browser's fetches same-origin during local
     * development, while this variable tells the proxy route what real
     * backend to forward them to. NOT a production mechanism: production
     * puts a real reverse proxy in front of the backend and points
     * `bridgeApiUrl` at that directly (see .env.example).
     */
    bridgeApiProxyUpstreamUrl: urlSchema.optional(),
    /**
     * Which unhappy path the mock client simulates. Exists purely so E2E
     * tests can exercise a paused direction or exhausted reserve capacity
     * against a real running server without a live backend — never read
     * outside `NEXT_PUBLIC_BRIDGE_API_MODE=mock`.
     */
    mockScenario: z
      .enum([
        "operational",
        "paused",
        "insufficient-liquidity",
        "quota-exhausted",
        "quota-paused",
      ])
      .default("operational"),

    solanaCluster: z
      .enum(["mainnet-beta", "testnet", "devnet", "localnet"])
      .default("devnet"),
    solanaRpcUrl: urlSchema.optional(),

    /** Canonical Solana GLC (Token-2022) mint. */
    reserveMintAddress: z.string().min(32).max(44),

    /**
     * The reserve bridge's on-chain Anchor program id, used to build the
     * Solana -> Goldcoin `deposit_to_reserve` instruction client-side (there
     * is no backend endpoint for that direction). Absent means that
     * direction disables with a stated reason rather than the UI guessing a
     * program id.
     */
    reserveProgramId: z.string().min(32).max(44).optional(),

    goldcoinRpcUrl: urlSchema.optional(),

    /**
     * Robinhood Network (EVM) deployment parameters.
     *
     * ALL of these are optional and ALL of them are absent today: the
     * `GlcRobinhoodBridge` custody contract is not deployed, and its
     * address, EIP-155 chain id and start block are recorded as unknown
     * in the backend's own docs/32-robinhood-settlement-phase-f.md. The
     * UI therefore ships knowing how to build the Robinhood deposit and
     * knowing it cannot: `robinhoodDepositCapability()` refuses with a
     * stated reason whenever any of them is missing, exactly as
     * `reserveProgramId` already gates the Solana deposit.
     *
     * Nothing here is a fallback or a default. There is deliberately no
     * "well-known" Robinhood chain id or contract address in this
     * codebase — guessing either would build a transaction against the
     * wrong chain or the wrong contract, and both cost the user their
     * funds. Absent means disabled, never assumed.
     *
     * These are also NOT an availability signal. A fully configured
     * deployment still shows the route as closed until `GET /chains`
     * says otherwise — the backend's RouteGate and the contract's own
     * `routeEnabled` are the gates, not this config.
     */
    robinhoodChainId: chainIdSchema.optional(),
    robinhoodChainName: z.string().min(1).optional(),
    robinhoodRpcUrl: urlSchema.optional(),
    /** `GlcRobinhoodBridge` — the custody contract `deposit()` is called on. */
    robinhoodBridgeAddress: evmAddressSchema.optional(),
    /** The ERC-20 GLC token the custody contract holds. 18 decimals, asserted backend-side. */
    robinhoodTokenAddress: evmAddressSchema.optional(),
    robinhoodExplorerTxUrl: templateSchema.optional(),
    robinhoodExplorerAddressUrl: templateSchema.optional(),

    /**
     * Goldcoin base58check address version bytes, as decimals.
     *
     * Deliberately configuration rather than a constant. Guessing a version
     * byte either rejects valid addresses or accepts addresses on the wrong
     * network, and both cost the user their funds. When this is unset the UI
     * states that address validation is unavailable and disables the
     * dependent action — it never falls back to validating against an
     * assumption.
     */
    glcAddressVersions: versionBytesSchema.optional(),
    glcBech32Hrp: z.string().min(1).max(83).optional(),

    glcExplorerTxUrl: templateSchema.optional(),
    glcExplorerAddressUrl: templateSchema.optional(),
    solanaExplorerTxUrl: templateSchema.optional(),
    solanaExplorerAddressUrl: templateSchema.optional(),

    protocolRepoUrl: urlSchema.optional(),
    docsUrl: urlSchema.optional(),
    auditsUrl: urlSchema.optional(),
    bugBountyUrl: urlSchema.optional(),
    supportUrl: urlSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.bridgeApiMode === "http" && !value.bridgeApiUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["bridgeApiUrl"],
        message:
          "NEXT_PUBLIC_BRIDGE_API_URL is required when NEXT_PUBLIC_BRIDGE_API_MODE is 'http'",
      });
    }
    if (
      value.solanaCluster === "mainnet-beta" &&
      value.reserveProgramId !== undefined &&
      RETIRED_RESERVE_PROGRAM_IDS.has(value.reserveProgramId)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["reserveProgramId"],
        message:
          `NEXT_PUBLIC_RESERVE_PROGRAM_ID ${value.reserveProgramId} is a ` +
          "permanently retired bridge program id and cannot be used on " +
          "mainnet-beta — see .env.example for the current production id",
      });
    }
    if (
      value.solanaCluster === "mainnet-beta" &&
      value.solanaRpcUrl !== undefined &&
      PUBLIC_UNTHROTTLED_MAINNET_RPC_URLS.has(value.solanaRpcUrl)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["solanaRpcUrl"],
        message:
          `NEXT_PUBLIC_SOLANA_RPC_URL ${value.solanaRpcUrl} is the public, ` +
          "shared Solana RPC endpoint — it rejects many browser-origin " +
          "requests and must not be used for a mainnet-beta deployment. " +
          "Use a dedicated RPC provider instead — see .env.example.",
      });
    }
  });

export type PublicEnv = z.infer<typeof envSchema>;

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function readEnv(): PublicEnv {
  const parsed = envSchema.safeParse({
    appUrl: present(process.env.NEXT_PUBLIC_APP_URL) ?? "http://localhost:3000",
    officialDomains: present(process.env.NEXT_PUBLIC_OFFICIAL_DOMAINS) ?? "localhost",
    appVersion: present(process.env.NEXT_PUBLIC_APP_VERSION),

    bridgeApiMode: present(process.env.NEXT_PUBLIC_BRIDGE_API_MODE) ?? "mock",
    mockScenario: present(process.env.NEXT_PUBLIC_MOCK_SCENARIO) ?? "operational",
    bridgeApiUrl: present(process.env.NEXT_PUBLIC_BRIDGE_API_URL),
    bridgeApiProxyUpstreamUrl: present(
      process.env.NEXT_PUBLIC_BRIDGE_API_PROXY_UPSTREAM_URL,
    ),

    solanaCluster: present(process.env.NEXT_PUBLIC_SOLANA_CLUSTER) ?? "devnet",
    solanaRpcUrl: present(process.env.NEXT_PUBLIC_SOLANA_RPC_URL),

    reserveMintAddress:
      present(process.env.NEXT_PUBLIC_RESERVE_MINT_ADDRESS) ??
      DEFAULT_RESERVE_MINT_ADDRESS,
    reserveProgramId: present(process.env.NEXT_PUBLIC_RESERVE_PROGRAM_ID),

    goldcoinRpcUrl: present(process.env.NEXT_PUBLIC_GOLDCOIN_RPC_URL),

    robinhoodChainId: present(process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_ID),
    robinhoodChainName: present(process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_NAME),
    robinhoodRpcUrl: present(process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL),
    robinhoodBridgeAddress: present(process.env.NEXT_PUBLIC_ROBINHOOD_BRIDGE_ADDRESS),
    robinhoodTokenAddress: present(process.env.NEXT_PUBLIC_ROBINHOOD_TOKEN_ADDRESS),
    robinhoodExplorerTxUrl: present(process.env.NEXT_PUBLIC_ROBINHOOD_EXPLORER_TX_URL),
    robinhoodExplorerAddressUrl: present(
      process.env.NEXT_PUBLIC_ROBINHOOD_EXPLORER_ADDRESS_URL,
    ),

    glcAddressVersions: present(process.env.NEXT_PUBLIC_GLC_ADDRESS_VERSIONS),
    glcBech32Hrp: present(process.env.NEXT_PUBLIC_GLC_BECH32_HRP),

    glcExplorerTxUrl: present(process.env.NEXT_PUBLIC_GLC_EXPLORER_TX_URL),
    glcExplorerAddressUrl: present(process.env.NEXT_PUBLIC_GLC_EXPLORER_ADDRESS_URL),
    solanaExplorerTxUrl: present(process.env.NEXT_PUBLIC_SOLANA_EXPLORER_TX_URL),
    solanaExplorerAddressUrl: present(
      process.env.NEXT_PUBLIC_SOLANA_EXPLORER_ADDRESS_URL,
    ),

    protocolRepoUrl: present(process.env.NEXT_PUBLIC_PROTOCOL_REPO_URL),
    docsUrl: present(process.env.NEXT_PUBLIC_DOCS_URL),
    auditsUrl: present(process.env.NEXT_PUBLIC_AUDITS_URL),
    bugBountyUrl: present(process.env.NEXT_PUBLIC_BUG_BOUNTY_URL),
    supportUrl: present(process.env.NEXT_PUBLIC_SUPPORT_URL),
  });

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid public environment configuration:\n${detail}\n\nSee .env.example.`,
    );
  }

  return parsed.data;
}

export const env: PublicEnv = readEnv();

/** Protocol-fixed native Goldcoin decimals (never derived at runtime). */
export const GOLDCOIN_DECIMALS = 8;

/** Exported for tests, which exercise the parser against crafted inputs. */
export const __envSchemaForTests = envSchema;
