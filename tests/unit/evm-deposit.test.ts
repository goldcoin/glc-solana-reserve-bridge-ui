import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as Viem from "viem";

/**
 * The `RhnToGlc` deposit orchestration.
 *
 * viem's clients are mocked so the sequence itself is under test: what is
 * read before anything is signed, what is refused, what the approval is
 * for, and what calldata the deposit names. None of this can be exercised
 * against a real chain — the custody contract is not deployed — which is
 * precisely why the shape of the calls is pinned here.
 */

const readContract = vi.fn();
const writeContract = vi.fn();
const waitForTransactionReceipt = vi.fn();

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof Viem>();
  return {
    ...actual,
    createPublicClient: () => ({ readContract, waitForTransactionReceipt }),
    createWalletClient: () => ({ writeContract }),
  };
});

const { depositToRobinhoodReserve, preflightRobinhoodDeposit } =
  await import("@/lib/evm/deposit");
const { CONTRACT_ROUTE_IDS } = await import("@/lib/evm/abi");

const DEPLOYMENT = {
  chainId: 4663,
  chainName: "Robinhood Network",
  rpcUrl: "https://rpc.example.invalid",
  bridgeAddress: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  tokenAddress: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
} as const;

const ACCOUNT = "0xdD870fA1b7C4700F2BD7f44238821C26f7392148" as const;
/** 1 GLC at 18 decimals — an exact multiple of the contract's canonical scale. */
const ONE_GLC = 1_000_000_000_000_000_000n;
const DESTINATION =
  "0x44745454663652523662743374436f5a4266583579564370367867414e6231475762" as const;

const LIMITS = {
  inboundMin: 100_000_000_000_000_000n,
  inboundMax: 20_000n * ONE_GLC,
  inboundRollingLimit: 100_000n * ONE_GLC,
  outboundMin: 0n,
  outboundMax: 0n,
  outboundRollingLimit: 0n,
  protectedMinReserve: 0n,
};

/**
 * The user-facing sentence, which is where these refusals actually live —
 * `ApiError.message` is a fixed internal label, and `presentation.what` is
 * what a person reads. Asserting the latter keeps these tests pointed at
 * the thing that matters.
 */
async function refusalText(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { presentation: { what: string } }).presentation.what;
  }
  throw new Error("expected the deposit to be refused, but it was not");
}

/** Preflight reads, in the order `Promise.all` requests them. */
function healthyReads(overrides: Partial<Record<string, unknown>> = {}) {
  const values: Record<string, unknown> = {
    token: DEPLOYMENT.tokenAddress,
    decimals: 18,
    isRouteLive: true,
    limits: LIMITS,
    balanceOf: 10n * ONE_GLC,
    allowance: 0n,
    ...overrides,
  };
  readContract.mockImplementation(
    ({ functionName }: { functionName: string }) => values[functionName],
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  healthyReads();
  writeContract.mockResolvedValue("0xhash");
  waitForTransactionReceipt.mockResolvedValue({ status: "success" });
});

describe("preflightRobinhoodDeposit", () => {
  const params = { deployment: DEPLOYMENT, account: ACCOUNT, amountRaw: ONE_GLC };

  it("passes when every on-chain gate is open", async () => {
    await expect(preflightRobinhoodDeposit(params)).resolves.toBeUndefined();
  });

  it("refuses when the contract holds a different token than this app is configured with", async () => {
    // An approval would otherwise be granted on a token the contract never
    // pulls: a standing allowance for nothing, and a deposit that reverts.
    healthyReads({ token: "0x0000000000000000000000000000000000000001" });
    expect(await refusalText(preflightRobinhoodDeposit(params))).toMatch(
      /holds a different token/i,
    );
  });

  it("refuses a token that does not report 18 decimals", async () => {
    // 18 decimals is what makes Robinhood amounts a separate unit at all,
    // so a different value means this is not the asset being modelled.
    healthyReads({ decimals: 6 });
    expect(await refusalText(preflightRobinhoodDeposit(params))).toMatch(/6 decimals/);
  });

  it("refuses when the contract itself says the route is not live", async () => {
    // The contract's gate is independent of the service's, and it can
    // close without notice.
    healthyReads({ isRouteLive: false });
    expect(await refusalText(preflightRobinhoodDeposit(params))).toMatch(
      /not currently accepting deposits/i,
    );
  });

  it("refuses when the wallet's balance is short", async () => {
    healthyReads({ balanceOf: ONE_GLC - 1n });
    expect(await refusalText(preflightRobinhoodDeposit(params))).toMatch(
      /balance is lower/i,
    );
  });

  it("enforces the CONTRACT's own limits, not any figure from the public API", async () => {
    // `GET /limits` describes the Solana program's reserve; these bounds
    // come from the contract that actually enforces them.
    expect(
      await refusalText(
        preflightRobinhoodDeposit({ ...params, amountRaw: LIMITS.inboundMin - 1n }),
      ),
    ).toMatch(/below the bridge contract's minimum/i);
    // Funded well past the maximum, so the balance check (which comes
    // first, being the more actionable of the two) does not answer instead.
    healthyReads({ balanceOf: 1_000_000n * ONE_GLC });
    expect(
      await refusalText(
        preflightRobinhoodDeposit({ ...params, amountRaw: LIMITS.inboundMax + 1n }),
      ),
    ).toMatch(/above the bridge contract's maximum/i);
  });

  it("says plainly that nothing was submitted, because nothing was", async () => {
    healthyReads({ isRouteLive: false });
    await expect(preflightRobinhoodDeposit(params)).rejects.toMatchObject({
      presentation: expect.objectContaining({
        funds: expect.stringContaining("No funds have left your wallet"),
      }),
    });
  });
});

describe("depositToRobinhoodReserve", () => {
  const params = {
    provider: {} as never,
    deployment: DEPLOYMENT,
    account: ACCOUNT,
    amountRaw: ONE_GLC,
    destination: DESTINATION,
  };

  it("approves exactly the deposit amount, never an unlimited allowance", async () => {
    await depositToRobinhoodReserve(params);

    const approval = writeContract.mock.calls.find(
      ([call]) => call.functionName === "approve",
    );
    expect(approval).toBeDefined();
    // A standing claim on the user's balance long after one transfer is
    // not a convenience this flow needs.
    expect(approval![0].args).toEqual([DEPLOYMENT.bridgeAddress, ONE_GLC]);
  });

  it("skips the approval entirely when the allowance already covers the amount", async () => {
    healthyReads({ allowance: ONE_GLC });
    const result = await depositToRobinhoodReserve(params);

    expect(
      writeContract.mock.calls.filter(([call]) => call.functionName === "approve"),
    ).toHaveLength(0);
    expect(result.approvalHash).toBeNull();
  });

  it("deposits on the RhnToGlc route id with the destination payload unchanged", async () => {
    await depositToRobinhoodReserve(params);

    const deposit = writeContract.mock.calls.find(
      ([call]) => call.functionName === "deposit",
    );
    expect(deposit).toBeDefined();
    expect(deposit![0].address).toBe(DEPLOYMENT.bridgeAddress);
    // 0x02 is a wire contract with deployed bytecode — naming the wrong
    // route id would authorize a payout on the wrong network.
    expect(deposit![0].args).toEqual([CONTRACT_ROUTE_IDS.RhnToGlc, ONE_GLC, DESTINATION]);
    expect(CONTRACT_ROUTE_IDS.RhnToGlc).toBe(0x02);
  });

  it("refuses before signing anything when preflight fails", async () => {
    healthyReads({ isRouteLive: false });
    await expect(depositToRobinhoodReserve(params)).rejects.toThrow();
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("reports a reverted deposit as reverted, without claiming the funds are safe", async () => {
    healthyReads({ allowance: ONE_GLC });
    waitForTransactionReceipt.mockResolvedValue({ status: "reverted" });

    await expect(depositToRobinhoodReserve(params)).rejects.toMatchObject({
      presentation: expect.objectContaining({
        what: expect.stringMatching(/reverted/i),
      }),
    });
  });

  it("points at the transaction hash when confirmation cannot be verified", async () => {
    healthyReads({ allowance: ONE_GLC });
    waitForTransactionReceipt.mockRejectedValue(new Error("timeout"));

    // Genuinely ambiguous: the transaction may have landed. Never claim
    // otherwise — point at the one artefact that can answer it.
    await expect(depositToRobinhoodReserve(params)).rejects.toMatchObject({
      presentation: expect.objectContaining({
        funds: expect.stringContaining("0xhash"),
      }),
    });
  });

  it("reports the steps in order, so a two-transaction flow can be narrated", async () => {
    const steps: string[] = [];
    await depositToRobinhoodReserve({ ...params, onStep: (step) => steps.push(step) });
    expect(steps).toEqual([
      "preflight",
      "approving",
      "approval-confirming",
      "depositing",
      "deposit-confirming",
    ]);
  });

  it("returns the deposit hash, which is what the indexer's event will correspond to", async () => {
    const result = await depositToRobinhoodReserve(params);
    expect(result.hash).toBe("0xhash");
  });
});
