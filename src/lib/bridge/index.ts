/**
 * Bridge form domain logic.
 *
 * Pure functions over strings and integers, with no React and no network.
 * There is deliberately no client-side fee/quote calculator here — the
 * bridge backend (`POST /quote`) is the sole source of truth for gross,
 * fee, and net amounts; see `src/lib/query/hooks.ts`'s `useQuote`.
 */

export {
  directions,
  oppositeDirection,
  routeDisplay,
  GOLDCOIN_GLC,
  SOLANA_GLC,
  ROBINHOOD_GLC,
  type RouteDisplay,
} from "./direction";
export {
  isRouteOpen,
  routeAvailability,
  routeAvailabilitySummary,
  type RouteAvailability,
  type RouteAvailabilitySummary,
} from "./route-availability";
export {
  canonicalToRobinhoodRaw,
  isCanonicalRobinhoodAmount,
  largestCanonicalRobinhoodAmountAtMost,
  robinhoodRawToCanonicalExact,
  CANONICAL_TO_ROBINHOOD_SCALE,
  ROBINHOOD_DECIMALS,
} from "./robinhood-amount";
export type {
  ChainDescriptor,
  DirectionDescriptor,
  DirectionSide,
  TokenDescriptor,
} from "./direction";

export { validateAmount, isReportableProblem, display } from "./amount";
export type { AmountBounds, AmountProblem, AmountValidation } from "./amount";

export {
  validateGoldcoinAddress,
  isReportableAddressProblem,
  encodeBase58Check,
} from "./glc-address";
export type { AddressProblem, AddressRules, AddressValidation } from "./glc-address";

export { goldcoinAddressRules } from "./address-rules";

export { RECIPIENT_RATE_LIMIT_TITLE } from "./recipient-rate-limit";
export { SOURCE_WALLET_RATE_LIMIT_TITLE } from "./source-wallet-rate-limit";

export {
  isTerminalState,
  isSuccessState,
  isFailureState,
  isManualReview,
  isRefundState,
  isUnexercisedState,
  isKnownRequestState,
  transitionLabel,
  happyPathFor,
  REQUEST_STATE_LABELS,
} from "./state";
export type { RefundState } from "./state";

export {
  directionGateState,
  destinationPaused,
  quotaExhausted,
  rollingVolumeRemaining,
  directionAvailable,
  QUOTA_EXHAUSTED_TITLE,
  QUOTA_EXHAUSTED_BODY,
  QUOTA_PAUSED_TITLE,
  QUOTA_PAUSED_BODY,
  QUOTA_PAUSED_NEXT,
} from "./direction-state";
export type { DirectionGateState, SolanaGovernedRoute } from "./direction-state";

export {
  CHAIN_DESCRIPTORS,
  descriptorFor,
  displayDescriptorFor,
  GOLDCOIN_GLC as GOLDCOIN_GLC_TOKEN,
  type ChainFamily,
} from "./chain-registry";

export {
  destinationsFor,
  isDefinedPair,
  resolveRoute,
  routeForPair,
  sourceChainIds,
  type RouteResolution,
} from "./route-resolution";

export {
  adapterFor,
  type AddressCheck,
  type ChainAdapter,
  type FundingKind,
} from "./chain-adapters";

export { maximumBridgeableAmount, type MaximumBridgeableInput } from "./max-amount";
