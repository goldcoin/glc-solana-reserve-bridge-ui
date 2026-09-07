import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as Viem from "viem";

/**
 * The Robinhood Chain balance read.
 *
 * Two properties are load-bearing: the figure survives as an exact string
 * (an 18-decimal balance is far outside what a double holds exactly), and
 * the token's decimals are ASSERTED rather than adopted — a token
 * reporting something other than 18 is not the asset this bridge models,
 * and scaling by whatever it said would render a balance that looks
 * plausible and is wrong by orders of magnitude.
 */

const readContract = vi.fn();

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof Viem>();
  return { ...actual, createPublicClient: () => ({ readContract }) };
});

const { fetchRobinhoodGlcBalance } = await import("@/lib/evm/balance");

const DEPLOYMENT = {
  chainId: 4663,
  chainName: "Robinhood Chain",
  rpcUrl: "https://rpc.example.invalid",
  bridgeAddress: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  tokenAddress: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
} as const;

const ACCOUNT = "0xdD870fA1b7C4700F2BD7f44238821C26f7392148" as const;

function reads(values: { balanceOf?: bigint; decimals?: number }) {
  readContract.mockImplementation(({ functionName }: { functionName: string }) =>
    functionName === "balanceOf" ? (values.balanceOf ?? 0n) : (values.decimals ?? 18),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  reads({});
});

describe("fetchRobinhoodGlcBalance", () => {
  it("reads balanceOf for the connected account", async () => {
    reads({ balanceOf: 1_000_000_000_000_000_000n });
    const balance = await fetchRobinhoodGlcBalance({
      deployment: DEPLOYMENT,
      account: ACCOUNT,
    });

    expect(balance).toEqual({ raw: "1000000000000000000", decimals: 18, symbol: "GLC" });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: DEPLOYMENT.tokenAddress,
        functionName: "balanceOf",
        args: [ACCOUNT],
      }),
    );
  });

  it("keeps every digit of a balance past Number.MAX_SAFE_INTEGER", async () => {
    // 12,450.32 GLC at 18 decimals. A `Number` anywhere in this path would
    // corrupt the very figure MAX is computed from.
    const exact = 12_450_320_000_000_000_000_000n;
    reads({ balanceOf: exact });

    const balance = await fetchRobinhoodGlcBalance({
      deployment: DEPLOYMENT,
      account: ACCOUNT,
    });
    expect(balance.raw).toBe("12450320000000000000000");
    expect(BigInt(balance.raw)).toBe(exact);
    expect(Number(balance.raw) > Number.MAX_SAFE_INTEGER).toBe(true);
  });

  it("reports a zero balance as a real zero", async () => {
    // Distinct from a failed read, which the caller renders as unavailable.
    reads({ balanceOf: 0n });
    await expect(
      fetchRobinhoodGlcBalance({ deployment: DEPLOYMENT, account: ACCOUNT }),
    ).resolves.toMatchObject({ raw: "0" });
  });

  it("refuses a token that does not report 18 decimals", async () => {
    reads({ balanceOf: 1n, decimals: 6 });
    await expect(
      fetchRobinhoodGlcBalance({ deployment: DEPLOYMENT, account: ACCOUNT }),
    ).rejects.toThrow(/6 decimals.*requires 18/);
  });

  it("reads over the deployment's configured RPC, not the wallet's node", async () => {
    // The number shown beside MAX should come from the endpoint this
    // deployment was configured with, whatever node the wallet is using.
    reads({ balanceOf: 5n });
    await fetchRobinhoodGlcBalance({ deployment: DEPLOYMENT, account: ACCOUNT });
    expect(readContract).toHaveBeenCalledTimes(2);
  });
});
