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
  eligibilityBlockedDetail,
  eligibilityBlockedTitle,
  eligibilityEndpointFor,
  eligibilityMatchesInputs,
  eligibilityPermitsSubmission,
  formatEligibilityCooldown,
  hasAuthoritativeEligibility,
  sourceWalletKnownInBrowser,
  isEligibilityEndpointUnpublished,
  isEligibilityRoute,
  normalizeRecipientEligibility,
  normalizeRouteWalletEligibility,
  remainingSecondsFor,
  routeEligibilityVerdict,
  ELIGIBILITY_BACKEND_DEPENDENCY,
  ELIGIBILITY_BLOCKED_BOTH_TITLE,
  ELIGIBILITY_BLOCKED_LABEL,
  ELIGIBILITY_BLOCKED_TITLE,
  ELIGIBILITY_CHECKING_LABEL,
  ELIGIBILITY_ELIGIBLE_LABEL,
  ELIGIBILITY_ROUTES,
  ELIGIBILITY_SIDE_LABEL,
  ELIGIBILITY_UNAVAILABLE_LABEL,
  ELIGIBILITY_UNAVAILABLE_NEXT,
  ELIGIBILITY_UNAVAILABLE_TITLE,
  REASON_DESTINATION_RATE_LIMITED,
  REASON_SOURCE_WALLET_RATE_LIMITED,
  type EligibilityEndpoint,
  type EligibilityRoute,
  type EligibilitySide,
  type EligibilityUnavailableDetail,
  type EligibilityVerdict,
  EligibilityEndpointUnpublishedError,
  type RouteEligibility,
  type RouteEligibilityInput,
  type WalletEligibility,
} from "./eligibility";
export {
  isRouteEffectivelyAvailable,
  isRouteEnabled,
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
export {
  robinhoodContractLeg,
  robinhoodPerTransferMaximum,
  robinhoodRollingRemaining,
} from "./robinhood-limits";
export type { RobinhoodContractLeg } from "./robinhood-limits";
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

export {
  formatRetryAfter,
  formatRetryAt,
  isUsableRetryTimestamp,
  robinhoodPredepositVerdict,
  ROBINHOOD_ROUTE_UNAVAILABLE_FALLBACK,
  type RobinhoodPredepositInput,
  type RobinhoodPredepositVerdict,
} from "./robinhood-predeposit";

export {
  isTerminalState,
  isSuccessState,
  isFailureState,
  isManualReview,
  isRefundState,
  isClosedState,
  isInFlightState,
  isManuallyRefunded,
  manualRefundOf,
  stepperStatusesFor,
  isKnownRequestState,
  transitionLabel,
  happyPathFor,
  MANUAL_REFUND_DISPOSITION,
  MANUAL_REFUND_STATUS,
  REQUEST_STATE_LABELS,
} from "./state";
export type { ManualRefundFacts, RefundState } from "./state";

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
  robinhoodReserveCapacity,
  robinhoodRouteGateState,
  robinhoodWindowFor,
  robinhoodWindowRemaining,
} from "./robinhood-route-state";
export type {
  RobinhoodFigure,
  RobinhoodRoute,
  RobinhoodRouteGateState,
} from "./robinhood-route-state";

export { destinationReserveGroups, executableRoutes } from "./route-families";
export type { DestinationReserve, DestinationReserveGroup } from "./route-families";

export {
  executableRouteStatus,
  executableRouteStatuses,
  formatBps,
  AVAILABILITY_NOT_PUBLISHED_NOTE,
} from "./route-status";
export type {
  ExecutableRouteStatus,
  RouteFee,
  RouteFigure,
  RouteStatusInput,
  RouteStatusKind,
} from "./route-status";

export {
  systemRouteAvailability,
  systemRouteMessage,
  SYSTEM_ROUTE_MESSAGE,
} from "./system-banner";
export type { SystemRouteAvailability } from "./system-banner";

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
  routesTouchingChain,
  routeSourceMinimum,
  sourceChainIds,
  type RouteResolution,
} from "./route-resolution";

export { perTransferCeiling, type PerTransferCeiling } from "./route-limits";

export {
  payloadSelectsRobinhood,
  solanaDepositDestination,
  type SolanaDestinationResult,
  type SolanaSourcedRoute,
} from "./solana-destination";

export {
  adapterFor,
  type AddressCheck,
  type ChainAdapter,
  type FundingKind,
} from "./chain-adapters";

export { maximumBridgeableAmount, type MaximumBridgeableInput } from "./max-amount";
