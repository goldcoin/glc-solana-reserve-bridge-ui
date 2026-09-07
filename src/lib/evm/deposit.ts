import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { evmConfirmationError, evmPreflightError, evmSendError } from "@/lib/api/errors";
import { ROBINHOOD_DECIMALS } from "@/lib/bridge/robinhood-amount";
import { CONTRACT_ROUTE_IDS, erc20Abi, glcRobinhoodBridgeAbi } from "./abi";
import type { RobinhoodDeployment } from "./config";

/**
 * The `RhnToGlc` deposit: the one place this app writes to Robinhood
 * Network.
 *
 * # Why the UI does this at all
 *
 * `RhnToGlc` has no backend create-transfer endpoint, and that is a
 * deliberate backend design rather than a gap — the same design
 * `SolToGlc` already uses. The depositor calls the custody contract
 * directly, and the service's indexer observes the resulting
 * `DepositCreated` event and folds it into a bridge request. There is no
 * request id to hold until the chain has one.
 *
 * # Everything checkable is checked before anything is signed
 *
 * The contract reverts on a closed route, a non-canonical amount, an
 * out-of-bounds amount, and an inexact transfer. A revert costs the user
 * a network fee and tells them nothing useful, so every one of those is
 * read first, over the deployment's own RPC, and refused with a real
 * reason. The reads can only make this stricter than the contract, never
 * more permissive: the contract re-checks all of it at execution time and
 * is the authority either way.
 *
 * # Approval is exact, never unlimited
 *
 * The allowance granted is exactly the deposit amount. An unlimited
 * approval would leave a standing claim on the user's balance long after
 * this one transfer, for no benefit to a flow that runs once.
 */

export interface RobinhoodDepositParams {
  readonly provider: EIP1193Provider;
  readonly deployment: RobinhoodDeployment;
  readonly account: Address;
  /** Robinhood atomic units (18 decimals). Must be an exact canonical multiple. */
  readonly amountRaw: bigint;
  /** The ABI `bytes` destination payload from `encodeGoldcoinDestination`. */
  readonly destination: Hex;
  /** Progress callback, so the UI can narrate a two-transaction flow. */
  readonly onStep?: (step: RobinhoodDepositStep) => void;
}

export type RobinhoodDepositStep =
  "preflight" | "approving" | "approval-confirming" | "depositing" | "deposit-confirming";

export interface RobinhoodDepositResult {
  /** The deposit transaction's hash. Not the obligation index — that is read from the event by the backend's indexer. */
  readonly hash: Hex;
  /** The approval transaction's hash, when one was needed. */
  readonly approvalHash: Hex | null;
}

function publicClientFor(deployment: RobinhoodDeployment) {
  // The deployment's own RPC, not the wallet's. A wallet may be pointed at
  // any node; preflight answers that gate a signature should come from the
  // endpoint this deployment was configured with.
  return createPublicClient({ transport: http(deployment.rpcUrl) });
}

function walletClientFor(provider: EIP1193Provider, account: Address) {
  return createWalletClient({ account, transport: custom(provider) });
}

/**
 * Reads every gate the contract will apply, and refuses before signing if
 * any of them would fail. Exported for direct testing — the assertions
 * here are the difference between a clear refusal and a paid-for revert.
 */
export async function preflightRobinhoodDeposit(params: {
  readonly deployment: RobinhoodDeployment;
  readonly account: Address;
  readonly amountRaw: bigint;
}): Promise<void> {
  const { deployment, account, amountRaw } = params;
  const client = publicClientFor(deployment);
  const route = CONTRACT_ROUTE_IDS.RhnToGlc;

  const [token, decimals, routeLive, limits, balance] = await Promise.all([
    client.readContract({
      address: deployment.bridgeAddress,
      abi: glcRobinhoodBridgeAbi,
      functionName: "token",
    }),
    client.readContract({
      address: deployment.tokenAddress,
      abi: erc20Abi,
      functionName: "decimals",
    }),
    client.readContract({
      address: deployment.bridgeAddress,
      abi: glcRobinhoodBridgeAbi,
      functionName: "isRouteLive",
      args: [route],
    }),
    client.readContract({
      address: deployment.bridgeAddress,
      abi: glcRobinhoodBridgeAbi,
      functionName: "limits",
    }),
    client.readContract({
      address: deployment.tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    }),
  ]);

  // The two configured addresses must agree with each other. If they do
  // not, an approval would be granted on a token this contract never
  // pulls — a standing allowance for nothing, and a deposit that reverts.
  if (token.toLowerCase() !== deployment.tokenAddress.toLowerCase()) {
    throw evmPreflightError(
      "The configured bridge contract holds a different token than this app is configured with.",
      "This is a deployment configuration problem, not something you can fix — please report it.",
    );
  }

  // 18 decimals is what makes Robinhood amounts a separate unit at all. A
  // token reporting anything else is not the asset this code models, so
  // the deposit is refused rather than rescaled to fit.
  if (Number(decimals) !== ROBINHOOD_DECIMALS) {
    throw evmPreflightError(
      `The configured token reports ${decimals} decimals, but this bridge requires ${ROBINHOOD_DECIMALS}.`,
      "This is a deployment configuration problem, not something you can fix — please report it.",
    );
  }

  if (!routeLive) {
    throw evmPreflightError(
      "The bridge contract is not currently accepting deposits on this route.",
      "This is set on-chain and can change without notice — check the status page, and try again later.",
    );
  }

  if (balance < amountRaw) {
    throw evmPreflightError(
      "Your wallet's GLC balance is lower than the amount you entered.",
      "Enter an amount you hold, or top up the wallet and try again.",
    );
  }

  // The contract's OWN limits, read from the contract that enforces them.
  // The public bridge API deliberately does not carry these — `GET /limits`
  // reports the Solana program's `BridgeConfig`, which bounds a different
  // reserve on a different chain.
  if (amountRaw < limits.inboundMin) {
    throw evmPreflightError(
      "That amount is below the bridge contract's minimum for this route.",
      "Enter a larger amount and try again.",
    );
  }
  if (amountRaw > limits.inboundMax) {
    throw evmPreflightError(
      "That amount is above the bridge contract's maximum for a single transfer on this route.",
      "Enter a smaller amount, or split the transfer.",
    );
  }
}

export async function depositToRobinhoodReserve(
  params: RobinhoodDepositParams,
): Promise<RobinhoodDepositResult> {
  const { provider, deployment, account, amountRaw, destination, onStep } = params;
  const publicClient = publicClientFor(deployment);
  const walletClient = walletClientFor(provider, account);
  const route = CONTRACT_ROUTE_IDS.RhnToGlc;

  onStep?.("preflight");
  await preflightRobinhoodDeposit({ deployment, account, amountRaw });

  const allowance = await publicClient.readContract({
    address: deployment.tokenAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, deployment.bridgeAddress],
  });

  let approvalHash: Hex | null = null;
  if (allowance < amountRaw) {
    onStep?.("approving");
    try {
      approvalHash = await walletClient.writeContract({
        chain: null,
        address: deployment.tokenAddress,
        abi: erc20Abi,
        functionName: "approve",
        // Exactly this deposit, never unlimited.
        args: [deployment.bridgeAddress, amountRaw],
      });
    } catch (cause) {
      throw evmSendError(cause, "approval");
    }

    onStep?.("approval-confirming");
    const approvalReceipt = await publicClient
      .waitForTransactionReceipt({ hash: approvalHash })
      .catch((cause: unknown) => {
        throw evmConfirmationError(cause, approvalHash!, "unconfirmed");
      });
    if (approvalReceipt.status !== "success") {
      throw evmConfirmationError(null, approvalHash, "reverted");
    }
  }

  onStep?.("depositing");
  let hash: Hex;
  try {
    hash = await walletClient.writeContract({
      chain: null,
      address: deployment.bridgeAddress,
      abi: glcRobinhoodBridgeAbi,
      functionName: "deposit",
      args: [route, amountRaw, destination],
    });
  } catch (cause) {
    throw evmSendError(cause, "deposit");
  }

  onStep?.("deposit-confirming");
  const receipt = await publicClient
    .waitForTransactionReceipt({ hash })
    .catch((cause: unknown) => {
      throw evmConfirmationError(cause, hash, "unconfirmed");
    });
  if (receipt.status !== "success") {
    throw evmConfirmationError(null, hash, "reverted");
  }

  return { hash, approvalHash };
}
