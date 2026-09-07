/**
 * Robinhood Network (EVM) support.
 *
 * The counterpart of `@/lib/solana` for the second non-Goldcoin chain this
 * bridge spans. Everything here is inert in every environment today: the
 * custody contract is not deployed, so `robinhoodDeployment()` resolves to
 * `null`, every capability check refuses with a stated reason, and no
 * transaction can be built. That is the intended shipping state — the
 * route is opened backend-side, never by this code.
 */

export {
  validateEvmAddress,
  isEvmAddress,
  shortenEvmAddress,
  type EvmAddressProblem,
  type EvmAddressValidation,
} from "./address";

export {
  CONTRACT_ROUTE_IDS,
  MAX_DESTINATION_LEN,
  erc20Abi,
  glcRobinhoodBridgeAbi,
} from "./abi";

export {
  encodeGoldcoinDestination,
  type DestinationProblem,
  type DestinationResult,
  type EncodedDestination,
} from "./destination";

export {
  isRobinhoodDeploymentConfigured,
  robinhoodDeployment,
  robinhoodDepositCapability,
  type RobinhoodDeployment,
  type RobinhoodDepositCapability,
  type RobinhoodDepositContext,
  type RobinhoodDepositReason,
} from "./config";

export {
  subscribeToInjectedWallets,
  type InjectedWallet,
  type InjectedWalletInfo,
} from "./provider";

export {
  depositToRobinhoodReserve,
  preflightRobinhoodDeposit,
  type RobinhoodDepositResult,
  type RobinhoodDepositStep,
} from "./deposit";

export {
  useEvmWallet,
  useRobinhoodDeposit,
  useRobinhoodGlcBalance,
  evmWalletQueryKeys,
  type EvmWalletState,
} from "./hooks";

export { fetchRobinhoodGlcBalance, type EvmTokenBalance } from "./balance";
