import { describe, expect, it } from "vitest";
import {
  robinhoodDepositCapability,
  type RobinhoodDeployment,
  type RobinhoodDepositContext,
} from "@/lib/evm/config";

/**
 * The Robinhood deposit's fail-closed gate.
 *
 * Two properties matter here. First, an unconfigured deployment refuses —
 * which is the state of EVERY environment today, because the custody
 * contract is not deployed. Second, the reasons are ordered the way a user
 * can act on them: being sent through a network-switch prompt for a route
 * that is closed anyway would be wasted effort.
 */

const DEPLOYMENT: RobinhoodDeployment = {
  chainId: 4663,
  chainName: "Robinhood Network",
  rpcUrl: "https://rpc.example.invalid",
  bridgeAddress: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  tokenAddress: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
};

/** Everything satisfied — the only shape that yields `available: true`. */
function ready(
  overrides: Partial<RobinhoodDepositContext> = {},
): RobinhoodDepositContext {
  return {
    deployment: DEPLOYMENT,
    injectedWalletAvailable: true,
    walletConnected: true,
    connectedChainId: DEPLOYMENT.chainId,
    routeOpen: true,
    amountIsCanonical: true,
    destinationValid: true,
    ...overrides,
  };
}

describe("robinhoodDepositCapability", () => {
  it("permits a deposit only when every condition holds", () => {
    const capability = robinhoodDepositCapability(ready());
    expect(capability.available).toBe(true);
    expect(capability.reason).toBeNull();
  });

  it("refuses an unconfigured deployment — today's state in every environment", () => {
    const capability = robinhoodDepositCapability(ready({ deployment: null }));
    expect(capability.available).toBe(false);
    expect(capability.reason).toBe("deployment-unconfigured");
  });

  it("refuses an unconfigured deployment even when everything else is ready", () => {
    // The contract address is not something the UI may infer from a
    // connected wallet or an open route.
    expect(
      robinhoodDepositCapability({
        ...ready(),
        deployment: null,
        routeOpen: true,
        walletConnected: true,
      }).reason,
    ).toBe("deployment-unconfigured");
  });

  it("refuses a closed route before asking anything of the wallet", () => {
    // Ordering matters: prompting someone to install a wallet or switch
    // networks for a route that is closed anyway wastes their time.
    const capability = robinhoodDepositCapability(
      ready({ routeOpen: false, injectedWalletAvailable: false, walletConnected: false }),
    );
    expect(capability.reason).toBe("route-not-open");
  });

  it("reports a missing browser wallet distinctly from a disconnected one", () => {
    expect(
      robinhoodDepositCapability(ready({ injectedWalletAvailable: false })).reason,
    ).toBe("no-injected-wallet");
    expect(robinhoodDepositCapability(ready({ walletConnected: false })).reason).toBe(
      "wallet-disconnected",
    );
  });

  it("refuses a wallet on the wrong chain and names the expected network", () => {
    const capability = robinhoodDepositCapability(ready({ connectedChainId: 1 }));
    expect(capability.reason).toBe("wrong-chain");
    expect(capability.message).toContain("Robinhood Network");
  });

  it("refuses when the chain is not yet known, rather than assuming it matches", () => {
    expect(robinhoodDepositCapability(ready({ connectedChainId: null })).reason).toBe(
      "wrong-chain",
    );
  });

  it("refuses an invalid destination before an over-precise amount", () => {
    // Both are the user's to fix, but an unusable destination is the more
    // fundamental of the two.
    expect(
      robinhoodDepositCapability(
        ready({ destinationValid: false, amountIsCanonical: false }),
      ).reason,
    ).toBe("destination-invalid");
  });

  it("refuses an amount the contract would reject rather than rounding it", () => {
    const capability = robinhoodDepositCapability(ready({ amountIsCanonical: false }));
    expect(capability.reason).toBe("amount-not-canonical");
    expect(capability.message).toMatch(/rather than rounding/i);
  });
});
