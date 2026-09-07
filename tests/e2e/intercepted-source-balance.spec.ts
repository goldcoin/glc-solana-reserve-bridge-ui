import { test, expect, type Page } from "@playwright/test";
import { mockHappyBackend, CORS_HEADERS } from "./intercepted-helpers";

/**
 * The source-wallet balance and MAX, in a real browser with a connected
 * wallet.
 *
 * Lives in the intercepted project because that is the server built with
 * `NEXT_PUBLIC_SOLANA_RPC_URL` set — without an RPC endpoint
 * `SolanaProvider` never mounts `WalletProvider`, so there is no wallet to
 * connect and no balance to read.
 *
 * The wallet below is SYNTHETIC: a minimal Wallet Standard implementation
 * registered exactly the way an extension's inpage script does, extended
 * from `intercepted-wallet-discovery.spec.ts`'s to actually return an
 * account on connect.
 *
 * # What is covered here, and what is not
 *
 * This proves the NEGATIVE case in a real browser: a wallet is genuinely
 * connected, and a Goldcoin source still shows no balance and no MAX —
 * the rule that matters most, since a fabricated Goldcoin balance is the
 * one number this form could show that has no source at all.
 *
 * The positive case — a real balance rendering and MAX filling the field —
 * is covered by `tests/unit/bridge-form-balance.test.tsx` instead. Driving
 * it here would need a byte-faithful `getParsedTokenAccountsByOwner`
 * response that satisfies web3.js's own response validation, and a mock
 * that is subtly wrong would test the mock rather than the app.
 */

const ACCOUNT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
/** 12,450.32 GLC at the mint's six decimals. */
const BALANCE_RAW = "12450320000";
const SOLANA_RPC = "http://127.0.0.1:8899";

const CONNECTING_WALLET = `
(() => {
  const account = {
    address: '${ACCOUNT}',
    // The base58 address decoded to its 32 raw bytes — wallet-adapter reads
    // \`publicKey\`, not the string.
    publicKey: Uint8Array.from([
      126, 140, 8, 135, 96, 191, 222, 29, 221, 207, 50, 193, 127, 32, 155, 130, 66, 238,
      82, 170, 241, 49, 250, 205, 136, 208, 234, 44, 109, 11, 6, 242,
    ]),
    chains: ['solana:mainnet', 'solana:devnet', 'solana:testnet', 'solana:localnet'],
    features: ['solana:signTransaction'],
  };
  const wallet = {
    version: '1.0.0',
    name: 'Synthetic Standard Wallet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
    chains: account.chains,
    accounts: [],
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async () => { wallet.accounts = [account]; return { accounts: [account] }; },
      },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => {} },
      'standard:events': { version: '1.0.0', on: () => () => {} },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: [0, 'legacy'],
        signTransaction: async () => { throw new Error('unsupported'); },
      },
    },
  };
  const callback = (api) => { api.register(wallet); };
  window.addEventListener('wallet-standard:app-ready', (event) => callback(event.detail));
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: callback }));
})();
`;

/** Answers the few JSON-RPC methods a balance read needs. */
async function mockSolanaRpc(page: Page) {
  await page.route(`${SOLANA_RPC}/**`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS_HEADERS });
    }
    const body = route.request().postDataJSON() as { id: number; method: string };
    const result =
      body.method === "getParsedTokenAccountsByOwner"
        ? {
            context: { slot: 1 },
            value: [
              {
                pubkey: ACCOUNT,
                account: {
                  lamports: 2039280,
                  owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
                  executable: false,
                  rentEpoch: 0,
                  space: 165,
                  data: {
                    program: "spl-token-2022",
                    space: 165,
                    parsed: {
                      type: "account",
                      info: {
                        tokenAmount: {
                          amount: BALANCE_RAW,
                          decimals: 6,
                          uiAmount: 12450.32,
                          uiAmountString: "12450.32",
                        },
                      },
                    },
                  },
                },
              },
            ],
          }
        : { context: { slot: 1 }, value: 0 };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: CORS_HEADERS,
      body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
    });
  });
}

/** Opens the header wallet dialog and connects the synthetic wallet. */
async function connectWallet(page: Page) {
  await page
    .getByRole("button", { name: /Connect wallet/i })
    .first()
    .click();
  await page.getByRole("button", { name: /Synthetic Standard Wallet/i }).click();
  // Scoped to the header: the form grows its own "use connected wallet"
  // shortcut carrying the same address once a Solana destination is picked.
  await expect(
    page.getByRole("banner").getByRole("button", { name: /9WzD/ }),
  ).toBeVisible();
}

test.describe("source-wallet balance and MAX", () => {
  test.beforeEach(async ({ page }) => {
    await mockHappyBackend(page);
    await mockSolanaRpc(page);
    await page.addInitScript(CONNECTING_WALLET);
  });

  test("shows no balance for a Goldcoin source, even with a wallet connected", async ({
    page,
  }) => {
    // There is no Goldcoin wallet to read one from, and it is never
    // derived from the bridge's own reserve figures.
    await page.goto("/bridge");
    await connectWallet(page);

    await expect(page.getByText(/Balance:/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "MAX" })).toHaveCount(0);
  });
});
