"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorState } from "@/components/ui";
import { toBigInt } from "@/lib/api/schemas/common";
import type { SettlementRoute } from "@/lib/api/schemas/common";
import type { RecipientEligibilityDto } from "@/lib/api/schemas/eligibility";
import {
  bridgeApi,
  recipientRateLimitedError,
  sourceWalletRateLimitedError,
} from "@/lib/api";
import {
  adapterFor,
  CHAIN_DESCRIPTORS,
  destinationsFor,
  directionGateState,
  display,
  displayDescriptorFor,
  isCanonicalRobinhoodAmount,
  isDefinedPair,
  isReportableProblem,
  largestCanonicalRobinhoodAmountAtMost,
  maximumBridgeableAmount,
  CANONICAL_TO_ROBINHOOD_SCALE,
  resolveRoute,
  robinhoodRawToCanonicalExact,
  rollingVolumeRemaining,
  routeAvailability,
  validateAmount,
  QUOTA_EXHAUSTED_BODY,
  QUOTA_EXHAUSTED_TITLE,
  QUOTA_PAUSED_BODY,
  QUOTA_PAUSED_TITLE,
  RECIPIENT_RATE_LIMIT_TITLE,
  SOLANA_GLC,
  SOURCE_WALLET_RATE_LIMIT_TITLE,
} from "@/lib/bridge";
import type { ChainAdapter, SolanaGovernedRoute } from "@/lib/bridge";
import {
  atomicRescaleCeil,
  atomicRescaleFloor,
  canonicalToSourceRawExact,
  minimumGrossCanonicalForMinTransferAmount,
  sourceRawToCanonical,
} from "@/lib/bridge/canonical";
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";
import { formatBaseUnits, formatDisplayDecimal } from "@/lib/format/amount";
import { routes } from "@/lib/config/links";
import {
  encodeGoldcoinDestination,
  evmWalletQueryKeys,
  robinhoodDeployment,
  robinhoodDepositCapability,
  useEvmWallet,
  useRobinhoodDeposit,
} from "@/lib/evm";
import {
  useBridgeStatus,
  useChains,
  useCreateTransfer,
  useLimits,
  useQuote,
  useReserve,
  useSolToGlcRecipientEligibility,
} from "@/lib/query/hooks";
import { useDepositToReserve, useWalletConnection, walletQueryKeys } from "@/lib/solana";
import { useQueryClient } from "@tanstack/react-query";
import { BlockerAlert, type Blocker } from "./BlockerAlert";
import { DepositInstructions } from "./DepositInstructions";
import { DestinationContext, SourceContext } from "./chain-context";
import { DirectionSwitch } from "./DirectionSwitch";
import { AmountEstimate, AmountInput, NetworkPanel } from "./NetworkPanel";
import { NetworkSelector, type NetworkOption } from "./NetworkSelector";
import { RouteSummary } from "./RouteSummary";
import { SourceBalanceRow } from "./SourceBalanceRow";
import { useSourceBalance } from "./useSourceBalance";

/**
 * The bridge form: pick two networks, enter an amount, send.
 *
 * # Network-first, route-derived
 *
 * A user chooses a SOURCE and a DESTINATION network. The backend route is
 * derived from that pair by `resolveRoute` — one function, one table — and
 * never chosen directly. That is what lets this page scale: a new network
 * is a registry entry plus a backend route mapping, and this file does not
 * change. The previous design put one card per route on the page, which
 * meant every added network multiplied the cards and eventually the
 * layout.
 *
 * A pair that resolves to no route is unusable and says so. It never falls
 * back to a route that does exist.
 *
 * # Where the per-network differences live
 *
 * Not here. Address formats, labels and funding kinds come from the
 * `ChainAdapter` table; the chain-specific JSX lives in `./chain-context`.
 * What remains in this file is the part that is the same for every pair:
 * amount handling, the quote, the gate, and the three funding paths the
 * backend actually offers.
 *
 * # This is a bridge
 *
 * The layout borrows the clarity of a swap interface, and none of its
 * meaning. Nothing is exchanged, priced against another asset, or traded:
 * the same GLC is released from a reserve on the destination network. The
 * copy says so and never says otherwise.
 */

type Phase =
  | { kind: "form" }
  | {
      /**
       * Both Goldcoin-SOURCED routes end here: the backend creates the
       * request and returns an address to send Goldcoin to, and nothing
       * about that step differs between a Solana and a Robinhood
       * destination.
       */
      kind: "goldcoin-deposit";
      requestId: number;
      depositAddress: string;
      amountAtomic: string;
    }
  | { kind: "solana-deposit-submitted"; signature: string }
  | { kind: "robinhood-deposit-submitted"; hash: string };

const DEFAULT_SOURCE = "goldcoin";
const DEFAULT_DESTINATION = "solana";

export function BridgeForm() {
  const router = useRouter();
  const wallet = useWalletConnection();

  const [sourceChainId, setSourceChainId] = useState(DEFAULT_SOURCE);
  const [destinationChainId, setDestinationChainId] = useState(DEFAULT_DESTINATION);
  const [amountInput, setAmountInput] = useState("");
  const [recipient, setRecipient] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const status = useBridgeStatus();
  const chains = useChains();
  const limits = useLimits();
  const reserve = useReserve();
  const createTransfer = useCreateTransfer();
  const depositToReserve = useDepositToReserve();
  const evmWallet = useEvmWallet();
  const robinhoodDeposit = useRobinhoodDeposit(evmWallet);
  const queryClient = useQueryClient();

  // Keyed on the SOURCE network, so switching networks reads a different
  // hook's result rather than carrying the previous chain's figure across.
  const sourceBalance = useSourceBalance(sourceChainId, evmWallet);

  const source = displayDescriptorFor(sourceChainId);
  const destination = displayDescriptorFor(destinationChainId);
  const sourceAdapter = adapterFor(sourceChainId);
  const destinationAdapter = adapterFor(destinationChainId);

  // The single derivation of "which backend route is this". Everything
  // below reads `route`; nothing re-derives it.
  const resolution = resolveRoute(sourceChainId, destinationChainId);
  const route = resolution.kind === "route" ? resolution.route : null;
  const availability = routeAvailability(chains.data, route ?? "");

  const sourceToken = source.token;
  const destinationToken = destination.token;
  const sourceIsRobinhood = sourceChainId === "robinhood";

  /**
   * `GET /limits` reports the SOLANA program's `BridgeConfig`. Those
   * bounds govern that program's reserve in that mint's own units — they
   * are not the Robinhood contract's, and no public endpoint publishes a
   * Robinhood equivalent (its `inboundMin`/`inboundMax` live on-chain and
   * are read at deposit preflight). So a Robinhood-legged pair gets no
   * client-side bound rather than a Solana figure relabelled.
   */
  const limitsGovernRoute =
    sourceChainId !== "robinhood" && destinationChainId !== "robinhood";

  const amountBounds = useMemo(() => {
    if (!limitsGovernRoute) {
      return { decimals: sourceToken.decimals, symbol: sourceToken.symbol };
    }
    if (!limits.data) return null;
    const minimumCanonical = minimumGrossCanonicalForMinTransferAmount(
      String(limits.data.min_transfer_amount),
      limits.data.bridge_fee_bps,
      SOLANA_GLC.decimals,
    );
    return {
      decimals: sourceToken.decimals,
      symbol: sourceToken.symbol,
      minimum: atomicRescaleCeil(
        minimumCanonical,
        GOLDCOIN_DECIMALS,
        sourceToken.decimals,
      ),
      maximum: atomicRescaleFloor(
        String(limits.data.per_transfer_limit),
        SOLANA_GLC.decimals,
        sourceToken.decimals,
      ),
    };
  }, [limits.data, sourceToken, limitsGovernRoute]);

  const amountValidation = amountBounds
    ? validateAmount(amountInput, amountBounds)
    : null;

  const canonicalGrossAmount = useMemo(() => {
    const raw = amountValidation?.raw;
    if (raw === null || raw === undefined) return "0";
    // Robinhood is the one source whose precision EXCEEDS the canonical
    // unit's, so its conversion narrows and can fail. Never floored: the
    // contract rejects a non-canonical amount rather than rounding it,
    // and rounding here would either strand the remainder in the reserve
    // or claim GLC that was never deposited.
    if (sourceIsRobinhood) return robinhoodRawToCanonicalExact(raw) ?? "0";
    return sourceRawToCanonical(raw, sourceToken.decimals);
  }, [amountValidation?.raw, sourceIsRobinhood, sourceToken.decimals]);

  const amountIsCanonical =
    !sourceIsRobinhood ||
    amountValidation?.raw === null ||
    amountValidation?.raw === undefined ||
    isCanonicalRobinhoodAmount(amountValidation.raw);

  // A quote is only meaningful for a route with settlement machinery. The
  // two Solana<->Robinhood routes resolve but have none, so they are never
  // priced — the backend would refuse, and it already told us via /chains.
  const settlementRoute = isSettlementRouteName(route) ? route : "GlcToSol";
  const quote = useQuote(
    settlementRoute,
    canonicalGrossAmount,
    isSettlementRouteName(route) && availability.kind === "open",
  );

  const recipientValidation = useMemo(
    () =>
      destinationAdapter
        ? destinationAdapter.validateAddress(recipient)
        : { valid: false, message: null },
    [destinationAdapter, recipient],
  );

  const recipientEligibility = useSolToGlcRecipientEligibility(
    recipient.trim(),
    route === "SolToGlc" ? wallet.address : null,
    route === "SolToGlc" && recipientValidation.valid,
  );

  /**
   * `GET /reserve` carries the Goldcoin and Solana reserves only. The
   * ledger HAS a `RobinhoodReserve`, but no public endpoint exposes its
   * capacity — so a Robinhood destination has no capacity figure and this
   * is `null` rather than a stand-in. Nothing is estimated.
   */
  const destinationReserveCapacity =
    reserve.data && destinationChainId !== "robinhood"
      ? destinationChainId === "solana"
        ? reserve.data.solana_available_capacity
        : reserve.data.goldcoin_available_capacity
      : null;

  // `/status`'s availability, quota and rolling-volume fields are named
  // per SOLANA route and derive from a Solana PDA. There is no Robinhood
  // equivalent, and the backend deliberately does not apply the Solana
  // window to a Robinhood payout.
  const solanaGovernedRoute: SolanaGovernedRoute | null =
    route === "GlcToSol" || route === "SolToGlc" ? route : null;
  const dirState =
    status.data && solanaGovernedRoute
      ? directionGateState(status.data, solanaGovernedRoute)
      : null;
  const remainingMintRaw =
    status.data && solanaGovernedRoute
      ? String(rollingVolumeRemaining(status.data, solanaGovernedRoute))
      : null;

  /**
   * The largest amount that could actually be bridged right now.
   *
   * Only bounds that govern THIS route are passed in. `amountBounds`
   * carries a maximum solely for the Solana-governed pairs — `GET /limits`
   * describes the Solana program's reserve — and `remainingMintRaw` is
   * likewise `null` for a Robinhood-legged route, so neither is applied
   * where it would be a ceiling that no chain enforces.
   *
   * The granularity is where the Robinhood custody contract's own rule
   * enters: it reverts any amount that is not an exact multiple of 10^10,
   * so a MAX that ignored it would fill in a number guaranteed to fail.
   */
  const maxAmount = useMemo(() => {
    if (sourceBalance.kind !== "known") return null;
    return maximumBridgeableAmount({
      balanceRaw: sourceBalance.raw,
      routeMaximumRaw: amountBounds?.maximum ?? null,
      remainingCapacityRaw:
        remainingMintRaw === null
          ? null
          : atomicRescaleFloor(
              remainingMintRaw,
              SOLANA_GLC.decimals,
              sourceBalance.decimals,
            ),
      granularity: sourceIsRobinhood ? CANONICAL_TO_ROBINHOOD_SCALE : 1n,
    });
  }, [sourceBalance, amountBounds, remainingMintRaw, sourceIsRobinhood]);

  /**
   * Fills the amount field with the exact MAX, at full precision.
   *
   * Deliberately routed through the ordinary `amountInput` state: the
   * value is then validated, quoted and gated exactly as a typed one is.
   * MAX is a typing shortcut, never a bypass — pressing it on a closed
   * route still cannot submit.
   */
  function applyMax() {
    if (maxAmount === null || sourceBalance.kind !== "known") return;
    setAmountInput(
      formatBaseUnits(maxAmount, sourceBalance.decimals, {
        // Full precision and no separators: this is a form value, not a
        // display string. Rounding it to two places would fill in an
        // amount the user does not hold, or silently drop the dust that
        // makes it exactly bridgeable.
        grouping: false,
        minFractionDigits: 0,
        maxFractionDigits: sourceBalance.decimals,
      }),
    );
    setSubmitError(null);
  }

  // Called directly rather than memoized by hand: it is a pure
  // function of values already computed above, the React Compiler
  // memoizes it, and a hand-written dependency list for this many
  // inputs could only drift from them.
  const gate: Gate = computeGate({
    resolution,
    availability,
    chainsPending: chains.isPending,
    chainsError: chains.isError,
    statusPending: status.isPending,
    statusError: status.isError,
    limitsPending: limits.isPending,
    reservePending: reserve.isPending,
    sourceAdapter,
    destinationAdapter,
    dirState,
    remainingMintRaw,
    destinationReserveCapacity,
    amountValidation,
    amountIsCanonical,
    recipientValid: recipientValidation.valid,
    recipientMessage: recipientValidation.message,
    recipientTouched: recipient.trim() !== "",
    sourceToken,
    routeLabel: `${source.name} → ${destination.name}`,
    solanaCapability: depositToReserve.capability,
    robinhoodCapability: () =>
      robinhoodDepositCapability({
        deployment: robinhoodDeployment(),
        injectedWalletAvailable: evmWallet.hasInjectedWallet,
        walletConnected: evmWallet.address !== null,
        connectedChainId: evmWallet.chainId,
        // Established by the availability check above, which returns
        // before this is ever called for a non-open route.
        routeOpen: true,
        amountIsCanonical,
        destinationValid: recipientValidation.valid,
      }),
    eligibility: {
      applies: route === "SolToGlc",
      pending: recipientEligibility.isPending,
      data: recipientEligibility.data ?? null,
    },
    quotePending: quote.isPending,
    quoteError: quote.isError,
    recipientRaw: recipient,
  });

  /** Clears everything that belonged to the previous pair. */
  function selectPair(nextSource: string, nextDestination: string) {
    setSourceChainId(nextSource);
    setDestinationChainId(nextDestination);
    setAmountInput("");
    // The recipient is ALWAYS cleared on a pair change. An address is only
    // meaningful on one network, and carrying a Solana address into a
    // field that now wants a Goldcoin one is the single most expensive
    // thing this form could leave behind — the validator would reject it,
    // but a user who does not re-read the field would not know why.
    setRecipient("");
    setSubmitError(null);
  }

  /**
   * Picking a source keeps the current destination when that still makes a
   * usable pair, and otherwise moves to one that does.
   *
   * "Usable" here means the route has settlement machinery — `/chains`'
   * `implemented` flag, not `enabled`. A CLOSED route is a fine place to
   * land: it is real, it may open, and the form explains it. A route with
   * no machinery at all is not, because nothing will ever happen there, and
   * silently parking someone on one after a single click is a bad first
   * answer to "does this bridge support my network".
   *
   * This reads availability rather than deriving it, and it only chooses
   * which defined pair to show — it never makes a closed route usable.
   */
  function onSourceChange(nextSource: string) {
    const candidates = destinationsFor(nextSource);
    const isUsable = (destinationId: string) => {
      const resolved = resolveRoute(nextSource, destinationId);
      if (resolved.kind !== "route") return false;
      return routeAvailability(chains.data, resolved.route).kind !== "unimplemented";
    };
    const next =
      isDefinedPair(nextSource, destinationChainId) && isUsable(destinationChainId)
        ? destinationChainId
        : (candidates.find(isUsable) ?? candidates[0] ?? destinationChainId);
    selectPair(nextSource, next);
  }

  const reverseDefined = isDefinedPair(destinationChainId, sourceChainId);

  return phase.kind !== "form" ? (
    <SubmittedPhase phase={phase} router={router} />
  ) : (
    <Card variant="raised" padding="lg">
      <div className="mb-5">
        <h1 className="text-heading-2">Bridge GLC</h1>
        <p className="text-body-sm text-ink-500 mt-1">
          Reserve-backed, 1:1. Nothing is minted, burned, or wrapped.
        </p>
      </div>

      {/* Its own landmark: the header carries a "Connect wallet" control of
          its own, and both tests and assistive tech need to address THIS
          form's primary action without ambiguity. */}
      <section aria-label="Bridge transfer" className="flex flex-col gap-3">
        <NetworkPanel
          label="From"
          selector={
            <NetworkSelector
              label="Source network"
              value={source}
              options={sourceOptions(chains.data, sourceChainId)}
              onChange={onSourceChange}
            />
          }
          amount={
            <div>
              <AmountInput
                id="bridge-amount"
                ariaLabel={`Amount in ${sourceToken.symbol}`}
                value={amountInput}
                onChange={setAmountInput}
                symbol={sourceToken.symbol}
              />
              {amountValidation && isReportableProblem(amountValidation.problem) && (
                <p className="text-body-sm text-danger-700 mt-1">
                  {amountValidation.message}
                </p>
              )}
              <SourceBalanceRow
                balance={sourceBalance}
                maxAmount={maxAmount}
                onMax={applyMax}
              />
              {amountBounds?.minimum !== undefined && (
                <p className="text-body-sm text-ink-500 mt-1">
                  Min{" "}
                  {display(
                    amountBounds.minimum,
                    amountBounds.decimals,
                    amountBounds.symbol,
                  )}{" "}
                  · Max{" "}
                  {display(
                    amountBounds.maximum!,
                    amountBounds.decimals,
                    amountBounds.symbol,
                  )}
                  {remainingMintRaw !== null && (
                    <span title="Remaining 24-hour bridge capacity for this route. Reopening after exhaustion is a manual operator action, not automatic.">
                      {" · "}
                      {display(
                        atomicRescaleFloor(
                          remainingMintRaw,
                          SOLANA_GLC.decimals,
                          amountBounds.decimals,
                        ),
                        amountBounds.decimals,
                        amountBounds.symbol,
                      )}{" "}
                      remaining today
                    </span>
                  )}
                </p>
              )}
            </div>
          }
          context={<SourceContext chainId={sourceChainId} evmWallet={evmWallet} />}
        />

        <DirectionSwitch
          disabled={!reverseDefined}
          disabledReason={
            reverseDefined ? undefined : "This bridge has no route in that direction."
          }
          onSwitch={() => selectPair(destinationChainId, sourceChainId)}
        />

        <NetworkPanel
          label="To"
          selector={
            <NetworkSelector
              label="Destination network"
              value={destination}
              options={destinationOptions(chains.data, sourceChainId)}
              onChange={(next) => selectPair(sourceChainId, next)}
            />
          }
          amount={
            <div>
              <AmountEstimate
                ariaLabel={`Estimated amount received in ${destinationToken.symbol}`}
                value={
                  quote.data ? formatDisplayDecimal(quote.data.net_display_amount) : null
                }
                symbol={destinationToken.symbol}
                pending={quote.isPending && toBigInt(canonicalGrossAmount) > 0n}
              />
              {/* A quote failure is stated in full, through the same
                  three-part error formula as everywhere else. The disabled
                  button's reason alone would leave the user with a dead
                  control and no account of what went wrong. */}
              {quote.isError && (
                <div className="mt-2">
                  <ErrorState error={quote.error} />
                </div>
              )}
              {destinationReserveCapacity !== null &&
                toBigInt(destinationReserveCapacity) > 0n && (
                  <p className="text-body-sm text-ink-500 mt-1">
                    Available capacity:{" "}
                    {display(
                      destinationReserveCapacity,
                      destinationToken.decimals,
                      destinationToken.symbol,
                    )}
                  </p>
                )}
            </div>
          }
          context={
            destinationAdapter ? (
              <DestinationContext
                adapter={destinationAdapter}
                value={recipient}
                onChange={setRecipient}
                message={recipientValidation.message}
                connectedSolanaAddress={wallet.address}
              />
            ) : null
          }
        />

        {gate.blocker && (
          <BlockerAlert
            blocker={gate.blocker}
            directionLabel={`${source.name} → ${destination.name}`}
            reason={gate.reason ?? ""}
          />
        )}

        <RouteSummary
          source={source}
          destination={destination}
          availability={availability}
          quote={quote.data}
          quotePending={quote.isPending && toBigInt(canonicalGrossAmount) > 0n}
          {...(quote.data && solanaGovernedRoute === "GlcToSol"
            ? { requiredConfirmations: undefined }
            : {})}
        />

        {submitError ? <ErrorState error={submitError} /> : null}

        <Button
          fullWidth
          size="lg"
          variant="primary"
          loading={submitting}
          onClick={() => void submit()}
          {...(!gate.can
            ? {
                disabled: true,
                disabledReason: gate.reason ?? "Cannot submit yet.",
                reasonPlacement:
                  gate.reasonShownInline || gate.blocker ? "accessible" : "inline",
              }
            : {})}
        >
          {gate.cta}
        </Button>
      </section>
    </Card>
  );

  async function submit() {
    if (!gate.can || !amountValidation?.raw || !sourceAdapter || !route) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      switch (sourceAdapter.funding) {
        case "goldcoin-deposit-address": {
          // `route` is sent explicitly even where it is the backend's own
          // default: what a request creates is stated by the caller, not
          // inherited from a server-side default that could change.
          const output = await createTransfer.mutateAsync({
            amount_atomic: canonicalGrossAmount,
            recipient: recipient.trim(),
            route: settlementRoute,
          });
          setPhase({
            kind: "goldcoin-deposit",
            requestId: output.request_id,
            depositAddress: output.deposit_address,
            amountAtomic: amountValidation.raw,
          });
          break;
        }
        case "solana-program": {
          if (!status.data) throw new Error("Bridge status is not loaded");
          // FINAL pre-submit dual rate-limit re-check, fetched fresh: the
          // address may have received a payout, or this wallet may have
          // deposited, between being typed and this click. A blocked
          // verdict stops everything BEFORE the wallet is invoked. A read
          // that FAILS does not stop the submit — the backend re-checks
          // authoritatively at admission, so failing open degrades to a
          // slower transfer, never a lost one.
          let finalEligibility: RecipientEligibilityDto | null = null;
          try {
            finalEligibility = await bridgeApi.getSolToGlcRecipientEligibility(
              recipient.trim(),
              wallet.address,
            );
          } catch {
            finalEligibility = null;
          }
          if (finalEligibility && !finalEligibility.eligible) {
            void recipientEligibility.refetch();
            throw finalEligibility.blocked_reason === "source_wallet_rate_limited"
              ? sourceWalletRateLimitedError()
              : recipientRateLimitedError();
          }
          const baselineRequestId = await highestKnownRequestId(wallet.address).catch(
            () => null,
          );
          const result = await depositToReserve.deposit({
            amountAtomic: BigInt(
              canonicalToSourceRawExact(canonicalGrossAmount, sourceToken.decimals),
            ),
            goldcoinAddress: recipient.trim(),
            obligationIndex: status.data.next_solana_obligation_index,
          });
          setPhase({ kind: "solana-deposit-submitted", signature: result.signature });
          refreshSourceBalance();
          void pollForTransfer(wallet.address, baselineRequestId);
          break;
        }
        case "evm-contract": {
          const encoded = encodeGoldcoinDestination(recipient);
          if (!encoded.ok) throw new Error(encoded.message);
          const result = await robinhoodDeposit.deposit({
            // Taken from the form's own 18-decimal figure, never
            // re-widened from the canonical one: re-deriving it would
            // round a user's amount to something they did not type.
            amountRaw: BigInt(amountValidation.raw),
            destination: encoded.value.hex,
          });
          setPhase({ kind: "robinhood-deposit-submitted", hash: result.hash });
          // The approval and the deposit have both confirmed by this point,
          // so the on-chain balance has genuinely changed.
          refreshSourceBalance();
          break;
        }
      }
    } catch (error) {
      setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Re-reads the source wallet's balance after a transaction has moved it.
   *
   * Invalidated by key PREFIX, so it covers whichever chain's balance is
   * in play without this function knowing which one that is. Polling would
   * catch the change within thirty seconds anyway; this makes the number
   * under MAX correct immediately, which is when someone is most likely to
   * look at it.
   */
  function refreshSourceBalance() {
    void queryClient.invalidateQueries({ queryKey: walletQueryKeys.balances() });
    void queryClient.invalidateQueries({ queryKey: evmWalletQueryKeys.balances() });
  }

  /**
   * The highest `bridge_requests.id` this wallet already has, or `0` when
   * it has none — every real id is positive, so `0` still correctly means
   * "any id that appears is unambiguously new". `null` is reserved for
   * "this read itself failed", which `pollForTransfer` must not treat the
   * same way: there, no id is safe as a floor, so it must not guess.
   */
  async function highestKnownRequestId(address: string | null): Promise<number | null> {
    if (!address) return null;
    const page = await bridgeApi.listTransfers({ address, limit: 1 });
    return page.items[0]?.id ?? 0;
  }

  /**
   * Finds the request this specific deposit created and redirects to it.
   *
   * The backend has no field correlating a contract-funded request to the
   * wallet transaction that created it, so this must not just take the
   * first matching item: an older request would already be in the very
   * first poll response. Requiring `id > baselineRequestId` — captured
   * before submission — rules out every request that could have existed
   * beforehand. If no baseline could be established, or polling times
   * out, it sends the user to their own activity list rather than risking
   * a redirect to the wrong request.
   */
  async function pollForTransfer(
    address: string | null,
    baselineRequestId: number | null,
  ) {
    if (!address) return;
    if (baselineRequestId !== null) {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        try {
          const page = await bridgeApi.listTransfers({ address, limit: 5 });
          const match = page.items.find(
            (item) => item.direction === "SolToGlc" && item.id > baselineRequestId,
          );
          if (match) {
            router.push(`/bridge/${match.id}`);
            return;
          }
        } catch {
          // Keep polling silently; the waiting copy already tells the user
          // their deposit is on-chain regardless of this poll's outcome.
        }
      }
    }
    router.push(`${routes.activity}?address=${encodeURIComponent(address)}`);
  }
}

/** Post-submission states. Each names what has happened and what happens next. */
function SubmittedPhase({
  phase,
  router,
}: {
  phase: Exclude<Phase, { kind: "form" }>;
  router: ReturnType<typeof useRouter>;
}) {
  if (phase.kind === "goldcoin-deposit") {
    return (
      <Card variant="raised" padding="lg">
        <h1 className="text-heading-2 mb-4">Send your deposit</h1>
        <DepositInstructions
          depositAddress={phase.depositAddress}
          amountAtomic={phase.amountAtomic}
        />
        <Button
          className="mt-4"
          fullWidth
          onClick={() => router.push(`/bridge/${phase.requestId}`)}
        >
          I&apos;ve sent it — track this transfer
        </Button>
      </Card>
    );
  }

  if (phase.kind === "solana-deposit-submitted") {
    return (
      <Card variant="raised" padding="lg">
        <h1 className="text-heading-2 mb-2">Deposit submitted</h1>
        <p className="text-body-sm text-ink-600">
          Your Solana transaction has been submitted (signature{" "}
          {phase.signature.slice(0, 12)}…). Waiting for the bridge to observe it — this
          page will move on automatically once it does.
        </p>
      </Card>
    );
  }

  return (
    <Card variant="raised" padding="lg">
      <h1 className="text-heading-2 mb-2">Deposit submitted</h1>
      <p className="text-body-sm text-ink-600">
        Your Robinhood Chain transaction has confirmed (transaction{" "}
        {phase.hash.slice(0, 12)}…). The bridge indexes the deposit from the
        contract&apos;s own event, so your transfer will appear in your activity once it
        has been observed.
      </p>
      <Button className="mt-4" fullWidth onClick={() => router.push(routes.activity)}>
        View my activity
      </Button>
    </Card>
  );
}

function isSettlementRouteName(route: string | null): route is SettlementRoute {
  return (
    route === "GlcToSol" ||
    route === "SolToGlc" ||
    route === "GlcToRhn" ||
    route === "RhnToGlc"
  );
}

/**
 * Source options: every network this build describes that has at least one
 * defined outbound route. Availability is per-PAIR, so a source's own
 * status line stays coarse — the destination selector and the summary
 * carry the precise answer.
 */
function sourceOptions(
  chains: Parameters<typeof routeAvailability>[0],
  selectedSourceId: string,
): readonly NetworkOption[] {
  return CHAIN_DESCRIPTORS.filter((chain) => destinationsFor(chain.id).length > 0).map(
    (chain) => {
      const anyOpen = destinationsFor(chain.id).some((destinationId) => {
        const resolved = resolveRoute(chain.id, destinationId);
        return (
          resolved.kind === "route" &&
          routeAvailability(chains, resolved.route).kind === "open"
        );
      });
      return {
        chain,
        selectable: true,
        status:
          chain.id === selectedSourceId
            ? "Selected"
            : anyOpen
              ? "Routes available"
              : "No routes open yet",
      };
    },
  );
}

/**
 * Destination options for the selected source. Every entry's status is the
 * real state of THAT pair, read from `/chains`.
 */
function destinationOptions(
  chains: Parameters<typeof routeAvailability>[0],
  sourceChainId: string,
): readonly NetworkOption[] {
  return CHAIN_DESCRIPTORS.map((chain): NetworkOption => {
    if (chain.id === sourceChainId) {
      // There is no self-route: this bridge moves GLC between networks.
      return { chain, selectable: false, status: "Same network" };
    }
    const resolved = resolveRoute(sourceChainId, chain.id);
    if (resolved.kind !== "route") {
      return { chain, selectable: false, status: "No route" };
    }
    const state = routeAvailability(chains, resolved.route);
    switch (state.kind) {
      case "open":
        return { chain, selectable: true, status: "Available" };
      case "closed":
        // Selectable on purpose: choosing a closed route is allowed, and
        // the form then explains why it cannot be used. Hiding it would
        // leave a user unable to find out.
        return { chain, selectable: true, status: "Coming soon", detail: state.reason };
      case "unimplemented":
        return { chain, selectable: true, status: "Not available", detail: state.reason };
      case "unknown":
        return { chain, selectable: false, status: "Checking…" };
    }
  });
}

interface Gate {
  readonly can: boolean;
  readonly reason: string | null;
  readonly reasonShownInline: boolean;
  readonly blocker: Blocker | null;
  /** The primary button's label, which states what pressing it would do. */
  readonly cta: string;
}

interface GateInput {
  resolution: ReturnType<typeof resolveRoute>;
  availability: ReturnType<typeof routeAvailability>;
  chainsPending: boolean;
  chainsError: boolean;
  statusPending: boolean;
  statusError: boolean;
  limitsPending: boolean;
  reservePending: boolean;
  sourceAdapter: ChainAdapter | null;
  destinationAdapter: ChainAdapter | null;
  dirState: ReturnType<typeof directionGateState> | null;
  remainingMintRaw: string | null;
  destinationReserveCapacity: string | null;
  amountValidation: ReturnType<typeof validateAmount> | null;
  amountIsCanonical: boolean;
  recipientValid: boolean;
  recipientMessage: string | null;
  recipientTouched: boolean;
  recipientRaw: string;
  sourceToken: { decimals: number; symbol: string };
  routeLabel: string;
  solanaCapability: (glcAddressBytes: number) => {
    available: boolean;
    message: string | null;
  };
  robinhoodCapability: () => { available: boolean; message: string | null };
  eligibility: {
    applies: boolean;
    pending: boolean;
    data: RecipientEligibilityDto | null;
  };
  quotePending: boolean;
  quoteError: boolean;
}

/**
 * Every reason this transfer cannot be submitted, in the order a user can
 * act on them.
 *
 * Extracted from the component so the ordering is readable in one piece
 * and testable on its own. The order is the design: a closed route is
 * stated before any wallet is asked for, because a wallet prompt for a
 * route that cannot run wastes the user's time and teaches them to click
 * through prompts.
 */
function computeGate(input: GateInput): Gate {
  const blocked = (reason: string, extra: Partial<Gate> = {}): Gate => ({
    can: false,
    reason,
    reasonShownInline: false,
    blocker: null,
    cta: "Bridge GLC",
    ...extra,
  });

  // 1. Is this pair even a route?
  if (input.resolution.kind === "same-chain") {
    return blocked("Choose two different networks.", { cta: "Choose networks" });
  }
  if (input.resolution.kind === "undefined-pair") {
    return blocked("This bridge has no route between those networks.", {
      cta: "Route unavailable",
      blocker: "route-closed",
    });
  }
  if (!input.sourceAdapter || !input.destinationAdapter) {
    // A network `/chains` names but this build cannot describe. Refused
    // rather than transacted on with another network's rules.
    return blocked("This app cannot bridge that network yet.", {
      cta: "Route unavailable",
      blocker: "route-closed",
    });
  }

  // 2. Is it open? Straight from /chains, before anything else is asked.
  if (input.chainsPending) {
    return blocked("Loading route availability…", { cta: "Bridge GLC" });
  }
  if (input.chainsError) {
    // Distinct from "this route is closed": nothing was refused, the
    // registry simply could not be read. Reported as an unreachable
    // service rather than as a verdict about the route.
    return blocked("Bridge status is unavailable.", { blocker: "unavailable" });
  }
  if (input.availability.kind !== "open") {
    return blocked(input.availability.reason, {
      cta: "Route unavailable",
      blocker: "route-closed",
    });
  }

  // 2b. Source-side readiness that no amount or address can fix — an
  // unconfigured deployment, a missing browser wallet, a wallet on the
  // wrong network. Checked BEFORE the amount and the address, because
  // "enter an amount" is unhelpful advice when the real problem is that
  // this build cannot reach the network at all.
  //
  // The amount and address legs of that capability are neutralised here:
  // the gate has its own steps for both, with messages that name the
  // specific defect rather than a generic refusal.
  if (input.sourceAdapter.funding === "evm-contract") {
    const capability = input.robinhoodCapability();
    if (!capability.available) {
      return blocked(capability.message ?? "This route is unavailable.", {
        cta: capability.message?.startsWith("Connect")
          ? "Connect wallet"
          : "Route unavailable",
      });
    }
  }

  if (input.statusPending || input.limitsPending || input.reservePending) {
    return blocked("Loading bridge status…");
  }
  if (input.statusError) {
    return blocked("Bridge status is unavailable.", { blocker: "unavailable" });
  }

  // 3. Reserve and quota state, for the routes /status describes.
  if (input.dirState === "quota-paused") {
    return blocked(`${QUOTA_PAUSED_TITLE} ${QUOTA_PAUSED_BODY}`, {
      blocker: "quota-paused",
      cta: "Route unavailable",
    });
  }
  if (input.dirState === "quota-exhausted") {
    return blocked(`${QUOTA_EXHAUSTED_TITLE} ${QUOTA_EXHAUSTED_BODY}`, {
      blocker: "quota-exhausted",
      cta: "Route unavailable",
    });
  }
  if (input.dirState === "operator-paused") {
    return blocked(`${input.routeLabel} is currently paused.`, {
      blocker: "paused",
      cta: "Route unavailable",
    });
  }
  if (
    input.dirState === "capacity-constrained" ||
    (input.destinationReserveCapacity !== null &&
      BigInt(input.destinationReserveCapacity) <= 0n)
  ) {
    return blocked("Insufficient reserve liquidity for this route right now.", {
      blocker: "insufficient-liquidity",
      cta: "Route unavailable",
    });
  }

  // 4. The amount.
  if (!input.amountValidation || input.amountValidation.raw === null) {
    const reportable = isReportableProblem(input.amountValidation?.problem ?? null);
    return blocked(reportable ? input.amountValidation!.message! : "Enter an amount.", {
      reasonShownInline: reportable,
      cta: "Enter an amount",
    });
  }
  if (input.remainingMintRaw !== null) {
    const remainingCanonical = BigInt(
      sourceRawToCanonical(input.remainingMintRaw, SOLANA_GLC.decimals),
    );
    const grossCanonical = BigInt(
      sourceRawToCanonical(input.amountValidation.raw, input.sourceToken.decimals),
    );
    if (grossCanonical > remainingCanonical) {
      const remainingDisplay = display(
        atomicRescaleFloor(
          input.remainingMintRaw,
          SOLANA_GLC.decimals,
          input.sourceToken.decimals,
        ),
        input.sourceToken.decimals,
        input.sourceToken.symbol,
      );
      return blocked(
        `That amount exceeds the remaining 24-hour bridge capacity for this route (${remainingDisplay} remaining). Enter a smaller amount, or check back after capacity is replenished.`,
      );
    }
  }
  if (!input.amountIsCanonical) {
    const trimmedTo = largestCanonicalRobinhoodAmountAtMost(input.amountValidation.raw);
    return blocked(
      `The bridge settles amounts to 8 decimal places, and the custody contract rejects anything finer rather than rounding it. The nearest amount it accepts at or below yours is ${display(trimmedTo, input.sourceToken.decimals, input.sourceToken.symbol)}.`,
    );
  }

  // 5. The destination address.
  if (!input.recipientValid) {
    const reportable = input.recipientTouched && input.recipientMessage !== null;
    return blocked(input.recipientMessage ?? "Enter a destination address.", {
      reasonShownInline: reportable,
      cta: "Enter destination",
    });
  }

  // 6. Source-side wallet capability, per funding kind.
  if (input.sourceAdapter.funding === "solana-program") {
    const capability = input.solanaCapability(
      new TextEncoder().encode(input.recipientRaw.trim()).length,
    );
    if (!capability.available) {
      return blocked(capability.message ?? "This route is unavailable.", {
        cta: capability.message?.startsWith("Connect")
          ? "Connect wallet"
          : "Route unavailable",
      });
    }
  }

  // 7. Rate limits, for the one route that has them.
  if (input.eligibility.applies) {
    if (input.eligibility.pending) {
      return blocked("Checking this address's recent bridge activity…");
    }
    const data = input.eligibility.data;
    if (data && !data.eligible) {
      // Wallet-first, matching the backend's own precedence. Both limits
      // are independently enforced regardless of which is surfaced.
      return data.blocked_reason === "source_wallet_rate_limited"
        ? blocked(SOURCE_WALLET_RATE_LIMIT_TITLE, {
            blocker: "source-wallet-rate-limited",
            cta: "Route unavailable",
          })
        : blocked(RECIPIENT_RATE_LIMIT_TITLE, {
            blocker: "recipient-rate-limited",
            cta: "Route unavailable",
          });
    }
    // A FAILED eligibility read deliberately does not block: the backend
    // re-checks the same rule authoritatively at admission, and submit()
    // makes one more fresh attempt right before the wallet opens.
  }

  // 8. The quote.
  if (input.quotePending) return blocked("Fetching quote…");
  if (input.quoteError) return blocked("Could not fetch a quote for this amount.");

  return {
    can: true,
    reason: null,
    reasonShownInline: false,
    blocker: null,
    cta: "Bridge GLC",
  };
}
