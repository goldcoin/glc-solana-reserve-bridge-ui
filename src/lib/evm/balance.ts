import { createPublicClient, http, type Address } from "viem";
import { ROBINHOOD_DECIMALS } from "@/lib/bridge/robinhood-amount";
import { erc20Abi } from "./abi";
import type { RobinhoodDeployment } from "./config";

/**
 * The connected wallet's GLC balance on Robinhood Chain.
 *
 * # Exact, or absent
 *
 * The balance is carried as an integer STRING of base units and converted
 * with `BigInt` only. At 18 decimals a single GLC is 10^18 base units —
 * eleven orders of magnitude past what a JavaScript number represents
 * exactly — so a `Number` anywhere in this path would silently corrupt the
 * figure a user is about to press MAX on.
 *
 * # Decimals are asserted, never adopted
 *
 * `decimals()` is read from the token and checked against
 * {@link ROBINHOOD_DECIMALS}. A token reporting anything else is not the
 * asset this bridge models — the same assertion
 * `preflightRobinhoodDeposit` makes before a deposit — so the read FAILS
 * rather than scaling by whatever the contract happened to say. Adopting a
 * surprise value would render a balance that looks plausible and is wrong
 * by a factor of ten to the something.
 */

export interface EvmTokenBalance {
  /** Integer string of base units. Never a float. */
  readonly raw: string;
  readonly decimals: number;
  readonly symbol: string;
}

export async function fetchRobinhoodGlcBalance(params: {
  readonly deployment: RobinhoodDeployment;
  readonly account: Address;
}): Promise<EvmTokenBalance> {
  const { deployment, account } = params;
  // The deployment's own RPC, not the wallet's: a wallet may be pointed at
  // any node, and a balance shown next to a MAX button should come from the
  // endpoint this deployment was configured with.
  const client = createPublicClient({ transport: http(deployment.rpcUrl) });

  const [raw, decimals] = await Promise.all([
    client.readContract({
      address: deployment.tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    }),
    client.readContract({
      address: deployment.tokenAddress,
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);

  if (Number(decimals) !== ROBINHOOD_DECIMALS) {
    throw new Error(
      `The configured token reports ${decimals} decimals, but this bridge requires ${ROBINHOOD_DECIMALS}`,
    );
  }

  return { raw: raw.toString(), decimals: ROBINHOOD_DECIMALS, symbol: "GLC" };
}
