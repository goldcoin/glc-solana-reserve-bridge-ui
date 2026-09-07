"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toBigInt } from "@/lib/api/schemas/common";
import { Wallet } from "lucide-react";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  ErrorState,
  TokenAmount,
} from "@/components/ui";
import {
  directionGateState,
  directions,
  display,
  isCanonicalRobinhoodAmount,
  largestCanonicalRobinhoodAmountAtMost,
  robinhoodRawToCanonicalExact,
  routeAvailability,
  goldcoinAddressRules,
  isReportableAddressProblem,
  isReportableProblem,
  QUOTA_EXHAUSTED_BODY,
  QUOTA_EXHAUSTED_TITLE,
  QUOTA_PAUSED_BODY,
  QUOTA_PAUSED_NEXT,
  QUOTA_PAUSED_TITLE,
  RECIPIENT_RATE_LIMIT_TITLE,
  rollingVolumeRemaining,
  SOLANA_GLC,
  SOURCE_WALLET_RATE_LIMIT_TITLE,
  validateAmount,
  validateGoldcoinAddress,
} from "@/lib/bridge";
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";
import { routes } from "@/lib/config/links";
import {
  atomicRescaleCeil,
  atomicRescaleFloor,
  canonicalToSourceRawExact,
  minimumGrossCanonicalForMinTransferAmount,
  sourceRawToCanonical,
} from "@/lib/bridge/canonical";
import {
  useBridgeStatus,
  useChains,
  useCreateTransfer,
  useLimits,
  useQuote,
  useReserve,
  useSolToGlcRecipientEligibility,
} from "@/lib/query/hooks";
import { isValidAddress, useDepositToReserve, useWalletConnection } from "@/lib/solana";
import {
  encodeGoldcoinDestination,
  robinhoodDeployment,
  robinhoodDepositCapability,
  useEvmWallet,
  useRobinhoodDeposit,
  validateEvmAddress,
} from "@/lib/evm";
import {
  bridgeApi,
  recipientRateLimitedError,
  sourceWalletRateLimitedError,
} from "@/lib/api";
import type { SettlementRoute } from "@/lib/api/schemas/common";
import type { SolanaGovernedRoute } from "@/lib/bridge/direction-state";
import type { RecipientEligibilityDto } from "@/lib/api/schemas/eligibility";
import { RobinhoodWalletConnect } from "@/features/wallet/RobinhoodWalletConnect";
import { DirectionSelector } from "./DirectionSelector";
import { QuoteBreakdown } from "./QuoteBreakdown";
import { DepositInstructions } from "./DepositInstructions";
import { ExchangeAddressWarning } from "./ExchangeAddressWarning";

type Phase =
  | { kind: "form" }
  | {
      // Shared by both Goldcoin-SOURCED routes: the backend creates the
      // request and returns an address to send Goldcoin to, and nothing
      // about that step differs between a Solana and a Robinhood
      // destination.
      kind: "goldcoin-deposit";
      requestId: number;
      depositAddress: string;
      amountAtomic: string;
    }
  | { kind: "sol-to-glc-waiting"; signature: string }
  | { kind: "rhn-to-glc-waiting"; hash: string };

export function BridgeCard() {
  const router = useRouter();
  const wallet = useWalletConnection();

  const [direction, setDirection] = useState<SettlementRoute>("GlcToSol");
  const [amountInput, setAmountInput] = useState("");
  const [recipient, setRecipient] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const descriptor = directions[direction];
  const sourceToken = descriptor.from.token;

  const status = useBridgeStatus();
  const chains = useChains();
  const limits = useLimits();
  const reserve = useReserve();
  const createTransfer = useCreateTransfer();
  const depositToReserve = useDepositToReserve();
  const evmWallet = useEvmWallet();
  const robinhoodDeposit = useRobinhoodDeposit(evmWallet);

  // Which chain each side of the selected route lives on. Every per-route
  // branch below asks one of these rather than testing the route name, so
  // the branches stay correct as routes are added.
  const sourceChain = descriptor.from.chain.id;
  const destinationChain = descriptor.to.chain.id;
  const sourceIsRobinhood = sourceChain === "robinhood";
  const destinationIsRobinhood = destinationChain === "robinhood";
  /** True only when `GET /chains` positively reports this route open. */
  const routeState = routeAvailability(chains.data, direction);

  /**
   * `GET /limits` reports the SOLANA program's `BridgeConfig`: its
   * `min_transfer_amount` and `per_transfer_limit` bound that program's
   * reserve, in that mint's own units. They are not the Robinhood
   * contract's limits, and the public API exposes no Robinhood equivalent
   * — the custody contract's `inboundMin`/`inboundMax` live on-chain and
   * are read at deposit preflight (`preflightRobinhoodDeposit`).
   *
   * So a Robinhood-legged route gets NO client-side min/max rather than a
   * Solana figure relabelled. Showing "Min 100 GLC" sourced from a limit
   * that governs a different reserve on a different chain would be a
   * number this app invented.
   */
  const limitsGovernRoute = !sourceIsRobinhood && !destinationIsRobinhood;

  const amountBounds = useMemo(() => {
    if (!limitsGovernRoute) {
      // Decimals and symbol still matter — they are what validate the
      // typed amount's precision — but no bound is asserted.
      return { decimals: sourceToken.decimals, symbol: sourceToken.symbol };
    }
    if (!limits.data) return null;
    // The minimum is a GROSS-side product floor, DERIVED from `/limits`'
    // own `min_transfer_amount` and `bridge_fee_bps` — never `/limits`'
    // `min_transfer_amount` used directly, since that figure is a
    // NET-side on-chain check (`limits.rs::enforce_transfer_amount`), and
    // displaying/enforcing it as if it were the minimum a user enters
    // understates the true floor by exactly the bridge fee (this was the
    // "Min 99 GLC" bug). Computed, not hardcoded, so it never goes stale
    // again the way a fixed constant did when the real fee moved from 1%
    // to 6% (later 3%) — see `minimumGrossCanonicalForMinTransferAmount`.
    const minimumCanonical = minimumGrossCanonicalForMinTransferAmount(
      String(limits.data.min_transfer_amount),
      limits.data.bridge_fee_bps,
      SOLANA_GLC.decimals,
    );
    // Ceil when narrowing to this direction's own source decimals — same
    // "never more permissive than the backend's" convention `atomicRescaleCeil`
    // documents; a no-op at 8 decimals (Goldcoin, already canonical).
    const minimum = atomicRescaleCeil(
      minimumCanonical,
      GOLDCOIN_DECIMALS,
      sourceToken.decimals,
    );
    // `/limits` passes the on-chain `BridgeConfig` value through raw, and
    // the on-chain check compares it against MINT-atomic amounts (6
    // decimals) — so this one IS in mint units, not the canonical
    // 8-decimal unit quotes use. Floor it so the client-side bound is
    // never more permissive than the on-chain one.
    const maximum = atomicRescaleFloor(
      String(limits.data.per_transfer_limit),
      SOLANA_GLC.decimals,
      sourceToken.decimals,
    );
    return {
      decimals: sourceToken.decimals,
      symbol: sourceToken.symbol,
      minimum,
      maximum,
    };
  }, [limits.data, sourceToken, limitsGovernRoute]);

  const amountValidation = amountBounds
    ? validateAmount(amountInput, amountBounds)
    : null;
  // Kept as an exact decimal string, never widened to a `number`: a
  // canonical amount can exceed Number.MAX_SAFE_INTEGER, and the value
  // submitted must be the value the user typed.
  const canonicalGrossAmount = useMemo(() => {
    const raw = amountValidation?.raw;
    if (raw === null || raw === undefined) return "0";
    // Robinhood is the one source whose precision EXCEEDS the canonical
    // unit's, so its conversion narrows and can fail. It is never floored:
    // an amount with more than 8 significant decimal places is not
    // settleable, the contract itself rejects it, and rounding here would
    // either strand the remainder in the reserve or claim GLC that was
    // never deposited.
    if (sourceIsRobinhood) return robinhoodRawToCanonicalExact(raw) ?? "0";
    return sourceRawToCanonical(raw, sourceToken.decimals);
  }, [amountValidation?.raw, sourceIsRobinhood, sourceToken.decimals]);

  /**
   * Whether a Robinhood-sourced amount survives narrowing to the canonical
   * unit — i.e. whether the custody contract would accept it
   * (`amount % CANONICAL_SCALE == 0`). Always true for every other source.
   */
  const amountIsCanonical =
    !sourceIsRobinhood ||
    amountValidation?.raw === null ||
    amountValidation?.raw === undefined ||
    isCanonicalRobinhoodAmount(amountValidation.raw);

  const quote = useQuote(direction, canonicalGrossAmount);

  /**
   * The recipient is validated as the DESTINATION chain's own address
   * type, chosen by the route — the same rule the backend applies to
   * `CreateTransferInput::recipient`, where "a Solana pubkey offered on a
   * `GlcToRhn` request fails to parse as an EVM address and the request is
   * refused". Getting the same answer here means the user is told while
   * typing rather than by a 400.
   */
  const recipientValidation = useMemo(() => {
    const trimmed = recipient.trim();
    switch (destinationChain) {
      case "solana": {
        if (trimmed.length === 0) return { valid: false, message: null };
        if (!isValidAddress(trimmed)) {
          return { valid: false, message: "That is not a valid Solana address." };
        }
        return { valid: true, message: null };
      }
      case "robinhood": {
        const result = validateEvmAddress(recipient);
        return { valid: result.valid, message: result.message };
      }
      case "goldcoin": {
        const result = validateGoldcoinAddress(recipient, goldcoinAddressRules());
        return {
          valid: result.valid,
          message: isReportableAddressProblem(result.problem) ? result.message : null,
        };
      }
    }
  }, [destinationChain, recipient]);

  // The FORM-level dual rate-limit check: fires once a syntactically valid
  // Goldcoin address is entered for SolToGlc, so the user learns "this
  // address already got a payout" or "this wallet already used the
  // bridge" in the last 24 hours before ever reaching for their wallet.
  // The connected wallet's pubkey joins the check automatically as soon
  // as it is available — before that, only the recipient leg is checked,
  // same as before this dual limit existed. `submit()` re-fetches the
  // same answer fresh immediately before invoking the wallet — this
  // hook's cached verdict is never what authorizes opening Phantom.
  const recipientEligibility = useSolToGlcRecipientEligibility(
    recipient.trim(),
    direction === "SolToGlc" ? wallet.address : null,
    direction === "SolToGlc" && recipientValidation.valid,
  );

  /**
   * `GET /reserve` carries the Goldcoin and Solana reserves only. The
   * ledger HAS a `RobinhoodReserve`, but no public endpoint exposes its
   * capacity, pause flag or availability — so a Robinhood destination has
   * no capacity figure, and this is `null` rather than a stand-in. The
   * capacity line is simply not rendered; nothing is estimated.
   */
  const destinationReserveCapacity =
    reserve.data && descriptor.destinationReserve !== "robinhood"
      ? descriptor.destinationReserve === "solana"
        ? reserve.data.solana_available_capacity
        : reserve.data.goldcoin_available_capacity
      : null;

  // Why a direction is unavailable comes from the /status booleans, not
  // from any backend message string: the backend deliberately returns one
  // cause-agnostic message for every unavailable cause on submit.
  //
  // `GET /status`'s availability, quota and rolling-volume fields are
  // named per SOLANA route (`glc_to_sol_*`, `sol_to_glc_*`) and derive
  // from a Solana PDA. There is no Robinhood equivalent, and the backend
  // deliberately does NOT apply the Solana rolling window to a Robinhood
  // payout — "a limit that neither chain enforces". So both are null for a
  // Robinhood-legged route, and its gate rests on `/chains` and the quote.
  const solanaGovernedRoute: SolanaGovernedRoute | null =
    direction === "GlcToSol" || direction === "SolToGlc" ? direction : null;
  const dirState =
    status.data && solanaGovernedRoute
      ? directionGateState(status.data, solanaGovernedRoute)
      : null;
  const remainingMintRaw =
    status.data && solanaGovernedRoute
      ? String(rollingVolumeRemaining(status.data, solanaGovernedRoute))
      : null;

  const gate = useMemo(() => {
    if (status.isPending || limits.isPending || reserve.isPending) {
      return {
        can: false,
        reason: "Loading bridge status…",
        reasonShownInline: false,
        blocker: null,
      };
    }
    if (status.isError) {
      return {
        can: false,
        reason: "Bridge status is unavailable.",
        reasonShownInline: false,
        blocker: "unavailable" as const,
      };
    }
    // Route admission comes FIRST and comes from `GET /chains` — the same
    // `RouteGate` verdict the create and quote endpoints enforce. Checked
    // ahead of every reserve, quota and amount rule below because a closed
    // route makes all of them moot, and because a route can close between
    // page load and submit.
    if (chains.isPending) {
      return {
        can: false,
        reason: "Loading route availability…",
        reasonShownInline: false,
        blocker: null,
      };
    }
    if (routeState.kind !== "open") {
      return {
        can: false,
        reason: routeState.reason,
        reasonShownInline: false,
        blocker: "route-closed" as const,
      };
    }
    if (dirState === "quota-paused") {
      return {
        can: false,
        reason: `${QUOTA_PAUSED_TITLE} ${QUOTA_PAUSED_BODY}`,
        reasonShownInline: false,
        blocker: "quota-paused" as const,
      };
    }
    if (dirState === "quota-exhausted") {
      return {
        can: false,
        reason: `${QUOTA_EXHAUSTED_TITLE} ${QUOTA_EXHAUSTED_BODY}`,
        reasonShownInline: false,
        blocker: "quota-exhausted" as const,
      };
    }
    if (dirState === "operator-paused") {
      return {
        can: false,
        reason: `${descriptor.label} is currently paused.`,
        reasonShownInline: false,
        blocker: "paused" as const,
      };
    }
    if (
      dirState === "capacity-constrained" ||
      (destinationReserveCapacity !== null && toBigInt(destinationReserveCapacity) <= 0n)
    ) {
      return {
        can: false,
        reason: "Insufficient reserve liquidity for this direction right now.",
        reasonShownInline: false,
        blocker: "insufficient-liquidity" as const,
      };
    }
    if (!amountValidation || amountValidation.raw === null) {
      const reportable = isReportableProblem(amountValidation?.problem ?? null);
      return {
        can: false,
        reason: reportable ? amountValidation!.message! : "Enter an amount.",
        // The amount field already prints this message inline when reportable.
        reasonShownInline: reportable,
        blocker: null,
      };
    }
    if (remainingMintRaw !== null) {
      // Mirror of the backend's proactive quota check on POST /transfers:
      // compare the requested amount against this direction's remaining
      // 24h window, in the canonical unit so no precision is lost. The
      // amount is never silently altered — the submit is blocked with the
      // remaining figure stated.
      const remainingCanonical = BigInt(
        sourceRawToCanonical(remainingMintRaw, SOLANA_GLC.decimals),
      );
      const grossCanonical = BigInt(
        sourceRawToCanonical(amountValidation.raw, sourceToken.decimals),
      );
      if (grossCanonical > remainingCanonical) {
        const remainingDisplay = display(
          atomicRescaleFloor(remainingMintRaw, SOLANA_GLC.decimals, sourceToken.decimals),
          sourceToken.decimals,
          sourceToken.symbol,
        );
        return {
          can: false,
          reason: `That amount exceeds the remaining 24-hour bridge capacity for this direction (${remainingDisplay} remaining). Enter a smaller amount, or check back after capacity is replenished.`,
          reasonShownInline: false,
          blocker: null,
        };
      }
    }
    if (!amountIsCanonical) {
      const trimmedTo = largestCanonicalRobinhoodAmountAtMost(amountValidation.raw);
      return {
        can: false,
        reason:
          `The bridge settles amounts to 8 decimal places, and the custody contract rejects anything finer rather than rounding it. ` +
          `The nearest amount it accepts at or below yours is ${display(trimmedTo, sourceToken.decimals, sourceToken.symbol)}.`,
        reasonShownInline: false,
        blocker: null,
      };
    }
    if (!recipientValidation.valid) {
      const reportable = recipient.trim() !== "" && recipientValidation.message !== null;
      return {
        can: false,
        reason: recipientValidation.message ?? "Enter a destination address.",
        // The recipient field already prints this message inline when reportable.
        reasonShownInline: reportable,
        blocker: null,
      };
    }
    if (sourceIsRobinhood) {
      // The mirror of the SolToGlc block below, for the other
      // contract-sourced route. Every reason is stated rather than
      // collapsed into one disabled button, and the deposit stays
      // fail-closed while the custody contract is unconfigured — which it
      // is in every environment today.
      const capability = robinhoodDepositCapability({
        deployment: robinhoodDeployment(),
        injectedWalletAvailable: evmWallet.hasInjectedWallet,
        walletConnected: evmWallet.address !== null,
        connectedChainId: evmWallet.chainId,
        // Established above: this gate is only reached once `/chains`
        // has positively reported the route open.
        routeOpen: true,
        amountIsCanonical,
        destinationValid: recipientValidation.valid,
      });
      if (!capability.available) {
        return {
          can: false,
          reason: capability.message ?? "This route is unavailable.",
          reasonShownInline: false,
          blocker: null,
        };
      }
    }
    if (direction === "SolToGlc") {
      const capability = depositToReserve.capability(
        new TextEncoder().encode(recipient.trim()).length,
      );
      if (!capability.available)
        return {
          can: false,
          reason: capability.message ?? "This direction is unavailable.",
          reasonShownInline: false,
          blocker: null,
        };
      if (recipientEligibility.isPending) {
        return {
          can: false,
          reason: "Checking this address's recent bridge activity…",
          reasonShownInline: false,
          blocker: null,
        };
      }
      if (recipientEligibility.data && !recipientEligibility.data.eligible) {
        // Wallet-first: if the connected wallet itself is rate-limited,
        // that is the ONLY message shown, even if the recipient is also
        // rate-limited — matching the backend's own precedence
        // (`RecipientEligibility::blocked_reason`). Both limits are
        // independently enforced at admission regardless of which one is
        // surfaced here.
        if (recipientEligibility.data.blocked_reason === "source_wallet_rate_limited") {
          return {
            can: false,
            reason: SOURCE_WALLET_RATE_LIMIT_TITLE,
            reasonShownInline: false,
            blocker: "source-wallet-rate-limited" as const,
          };
        }
        return {
          can: false,
          reason: RECIPIENT_RATE_LIMIT_TITLE,
          reasonShownInline: false,
          blocker: "recipient-rate-limited" as const,
        };
      }
      // A FAILED eligibility read (recipientEligibility.isError)
      // deliberately does not block the form: the backend re-checks the
      // same rule authoritatively at admission either way, and submit()
      // makes one more fresh attempt right before the wallet opens — a
      // transient API blip should not brick the whole direction.
    }
    if (quote.isPending) {
      return {
        can: false,
        reason: "Fetching quote…",
        reasonShownInline: false,
        blocker: null,
      };
    }
    if (quote.isError) {
      return {
        can: false,
        reason: "Could not fetch a quote for this amount.",
        reasonShownInline: false,
        blocker: null,
      };
    }
    return { can: true, reason: null, reasonShownInline: false, blocker: null };
  }, [
    status.isPending,
    status.isError,
    limits.isPending,
    reserve.isPending,
    dirState,
    remainingMintRaw,
    destinationReserveCapacity,
    amountValidation,
    recipientValidation,
    direction,
    recipient,
    depositToReserve,
    recipientEligibility.isPending,
    recipientEligibility.data,
    quote.isPending,
    quote.isError,
    descriptor.label,
    sourceToken,
    chains.isPending,
    routeState,
    sourceIsRobinhood,
    amountIsCanonical,
    evmWallet.hasInjectedWallet,
    evmWallet.address,
    evmWallet.chainId,
  ]);

  async function submit() {
    if (!gate.can || !amountValidation?.raw) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      if (descriptor.funding === "goldcoin-deposit-address") {
        // Both Goldcoin-SOURCED routes create their request the same way.
        // `route` is sent explicitly even for `GlcToSol`, whose default it
        // already is: what a request creates should be stated by the
        // caller, not inherited from a server-side default that could
        // change.
        const output = await createTransfer.mutateAsync({
          amount_atomic: canonicalGrossAmount,
          recipient: recipient.trim(),
          route: direction,
        });
        setPhase({
          kind: "goldcoin-deposit",
          requestId: output.request_id,
          depositAddress: output.deposit_address,
          // GOLDCOIN_GLC has zero canonical padding, so this is the exact
          // amount_atomic just sent to the API, as a base-unit string —
          // never re-derived from the `number` above, which exists only
          // for the wire request field.
          amountAtomic: amountValidation.raw,
        });
      } else if (descriptor.funding === "robinhood-contract") {
        // `RhnToGlc` has no create endpoint, exactly like `SolToGlc`: the
        // depositor calls the custody contract and the backend's indexer
        // folds the resulting obligation. Nothing is created server-side
        // first, so there is no request id until the chain has one.
        const destination = encodeGoldcoinDestination(recipient);
        if (!destination.ok) throw new Error(destination.message);
        const result = await robinhoodDeposit.deposit({
          // The amount is taken from the FORM's own 18-decimal figure, not
          // re-widened from the canonical one: re-deriving it would round
          // a user's amount to something they did not type.
          amountRaw: BigInt(amountValidation.raw),
          destination: destination.value.hex,
        });
        setPhase({ kind: "rhn-to-glc-waiting", hash: result.hash });
      } else {
        if (!status.data) throw new Error("Bridge status is not loaded");
        // FINAL pre-submit dual rate-limit re-check, fetched fresh through
        // the client (never the form hook's cache): the address may have
        // received a payout, or this wallet may have made a deposit,
        // between being typed/connected and this click — another tab,
        // another user, a deposit that just finalized. This is exactly
        // what closes the race a slower form-level poll could otherwise
        // miss. A blocked verdict here stops everything BEFORE the wallet
        // is invoked: no Phantom prompt, no Solana obligation, no funds
        // moved. A read that FAILS is a different case and does not stop
        // the submit — the backend re-checks both rules authoritatively at
        // admission, and a deposit admitted while actually rate-limited is
        // parked and auto-resumed once the window clears
        // (glc-solana-reserve-bridge docs/09-runbook.md), so failing open
        // here degrades to a slower transfer, never a lost one.
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
          // Refresh the form-level hook too, so the same verdict also
          // surfaces as the persistent blocker callout + disabled button,
          // not only as this one submit error.
          void recipientEligibility.refetch();
          throw finalEligibility.blocked_reason === "source_wallet_rate_limited"
            ? sourceWalletRateLimitedError()
            : recipientRateLimitedError();
        }
        const sourceAtomic = BigInt(
          canonicalToSourceRawExact(canonicalGrossAmount, sourceToken.decimals),
        );
        // `GET /transfers` has no way to ask for "the request this exact
        // deposit created" — SolToGlc requests carry no source_txid (see
        // pollForTransfer's docs) — so the highest request id that already
        // exists for this wallet, captured BEFORE the wallet even signs, is
        // the strongest available correlator: whatever request this deposit
        // creates is guaranteed to land with an id greater than every id
        // captured here, regardless of what else is in the list or how it's
        // ordered. A failure here must not abort the deposit itself (the
        // wallet transaction is independent of this read), so it falls back
        // to `null`, which `pollForTransfer` treats as "cannot correlate."
        const baselineRequestId = await highestKnownRequestId(wallet.address).catch(
          () => null,
        );
        const result = await depositToReserve.deposit({
          amountAtomic: sourceAtomic,
          goldcoinAddress: recipient.trim(),
          obligationIndex: status.data.next_solana_obligation_index,
        });
        setPhase({ kind: "sol-to-glc-waiting", signature: result.signature });
        void pollForTransfer(wallet.address, baselineRequestId);
      }
    } catch (error) {
      setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  }

  /** The highest `bridge_requests.id` this wallet already has, across both
   * directions (ids are a single shared auto-increment sequence — see
   * `service/src/ledger/schema.rs` in glc-solana-reserve-bridge), or `0` if
   * the wallet has no transfers yet — every real id is positive, so `0`
   * still correctly matches "any id that appears is unambiguously new."
   * `null` is reserved for "this read itself failed," a DIFFERENT case
   * `pollForTransfer` must not treat the same way (there, no id is safe to
   * trust as a floor, so it must not guess at all). */
  async function highestKnownRequestId(address: string | null): Promise<number | null> {
    if (!address) return null;
    const page = await bridgeApi.listTransfers({ address, limit: 1 });
    return page.items[0]?.id ?? 0;
  }

  /**
   * Finds the bridge request this specific deposit created and redirects to
   * it.
   *
   * The backend has no field correlating a SolToGlc request to the wallet
   * transaction that created it (`source_txid` is only ever populated for
   * GlcToSol — a SolToGlc request folds from an on-chain obligation INDEX,
   * not a stored transaction id; see `fold_sol_deposit` in
   * glc-solana-reserve-bridge). So this must NOT just take the first
   * `SolToGlc` item in the list: if the wallet has any older SolToGlc
   * request (in any state — completed, abandoned, anything), that item is
   * already in the very first poll response and would be matched
   * immediately, before the new one has even been indexed yet — the exact
   * wrong-request bug this replaces. Requiring `id > baselineRequestId`
   * (captured before submission) rules out every request that could
   * possibly have existed before this one.
   *
   * If `baselineRequestId` could not be established (the pre-submission
   * read failed) or polling times out without a qualifying match, this
   * deliberately does NOT guess — it sends the user to their own
   * wallet-scoped activity list instead, where the new transfer will show
   * up once it's indexed, rather than risking a redirect to someone else's
   * or an old request.
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
          // Keep polling silently; the waiting-state copy already tells the
          // user their deposit is on-chain regardless of this poll's outcome.
        }
      }
    }
    router.push(`${routes.activity}?address=${encodeURIComponent(address)}`);
  }

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

  if (phase.kind === "sol-to-glc-waiting") {
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

  if (phase.kind === "rhn-to-glc-waiting") {
    return (
      <Card variant="raised" padding="lg">
        <h1 className="text-heading-2 mb-2">Deposit submitted</h1>
        <p className="text-body-sm text-ink-600">
          Your Robinhood Network transaction has confirmed (transaction{" "}
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

  const destinationToken = descriptor.to.token;

  // The recipient field is named for the chain the payout lands on, so a
  // route change relabels it rather than leaving "Solana address" above a
  // field that now wants a Goldcoin one.
  const recipientFieldLabel =
    destinationChain === "solana"
      ? "Solana recipient address"
      : destinationChain === "robinhood"
        ? "Robinhood Network recipient address"
        : "Goldcoin destination address";
  const recipientFieldPlaceholder =
    destinationChain === "solana"
      ? "Solana address"
      : destinationChain === "robinhood"
        ? "0x…"
        : "Goldcoin address";

  return (
    <Card variant="raised" padding="lg">
      <div className="mb-5">
        <h1 className="text-heading-2">Bridge GLC</h1>
        <p className="text-body-sm text-ink-500 mt-1">
          Reserve-backed, 1:1. Nothing is minted, burned, or wrapped.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        <div>
          <DirectionSelector
            value={direction}
            chains={chains.data}
            onChange={(next) => {
              setDirection(next);
              setAmountInput("");
              setRecipient("");
            }}
          />
          {destinationReserveCapacity !== null &&
            toBigInt(destinationReserveCapacity) > 0n && (
              <p className="text-body-sm text-ink-500 mt-2">
                Available capacity:{" "}
                <TokenAmount
                  raw={destinationReserveCapacity}
                  decimals={destinationToken.decimals}
                  symbol={destinationToken.symbol}
                  className="text-ink-700"
                />
              </p>
            )}
        </div>

        {gate.blocker && (
          <BlockerAlert blocker={gate.blocker} directionLabel={descriptor.label} />
        )}

        {sourceIsRobinhood && (
          <div>
            <p className="text-body-sm text-ink-600 mb-1">Robinhood Network wallet</p>
            <RobinhoodWalletConnect wallet={evmWallet} />
          </div>
        )}

        <div>
          <label htmlFor="bridge-amount" className="text-body-sm text-ink-600 mb-1 block">
            You bridge
          </label>
          <div className="border-ink-200 focus-within:border-ink-400 flex items-center rounded-lg border pr-3 transition-colors">
            <input
              id="bridge-amount"
              aria-label={`Amount in ${sourceToken.symbol}`}
              inputMode="decimal"
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              placeholder="0.00"
              className="text-heading-2 tabular min-w-0 flex-1 rounded-lg px-3 py-2.5 outline-none"
            />
            <span className="text-body text-ink-500 font-medium">
              {sourceToken.symbol}
            </span>
          </div>
          {amountValidation && isReportableProblem(amountValidation.problem) && (
            <p className="text-body-sm text-danger-700 mt-1">
              {amountValidation.message}
            </p>
          )}
          {/*
            The bounds line renders only when real bounds exist. A
            Robinhood-legged route has none this app may state: `GET /limits`
            describes the Solana program's reserve, and the custody
            contract's own inboundMin/inboundMax are on-chain and are
            enforced at deposit preflight. No line is better than a
            borrowed number.
          */}
          {amountBounds?.minimum !== undefined && (
            <p className="text-body-sm text-ink-500 mt-1">
              Min{" "}
              {display(amountBounds.minimum, amountBounds.decimals, amountBounds.symbol)}{" "}
              · Max{" "}
              {display(amountBounds.maximum, amountBounds.decimals, amountBounds.symbol)}
              {remainingMintRaw !== null && (
                <span title="Remaining 24-hour bridge capacity for this direction. Reopening after exhaustion is a manual operator action, not automatic.">
                  {" "}
                  ·{" "}
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

        <div>
          <label
            htmlFor="bridge-recipient"
            className="text-body-sm text-ink-600 mb-1 block"
          >
            {recipientFieldLabel}
          </label>
          <div className="border-ink-200 focus-within:border-ink-400 flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors">
            <Wallet aria-hidden="true" className="text-ink-400 size-4 shrink-0" />
            <input
              id="bridge-recipient"
              aria-label={recipientFieldLabel}
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder={recipientFieldPlaceholder}
              className="text-mono-sm min-w-0 flex-1 outline-none"
            />
          </div>
          {destinationChain === "solana" && wallet.address && recipient.trim() === "" && (
            <button
              type="button"
              onClick={() => setRecipient(wallet.address ?? "")}
              className="bg-ink-50 text-ink-700 hover:bg-ink-100 text-body-sm mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors"
            >
              Use connected wallet ({wallet.address.slice(0, 4)}…
              {wallet.address.slice(-4)})
            </button>
          )}
          {recipient.trim() !== "" &&
            !recipientValidation.valid &&
            recipientValidation.message && (
              <p className="text-body-sm text-danger-700 mt-1">
                {recipientValidation.message}
              </p>
            )}
        </div>

        {destinationChain === "goldcoin" && <ExchangeAddressWarning />}

        {toBigInt(canonicalGrossAmount) > 0n && <QuoteBreakdown quote={quote} />}

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
                // A blocker already gets its own Alert above the form, so the
                // button doesn't repeat the same sentence a second time —
                // the reason still reaches assistive tech via "accessible".
                reasonPlacement:
                  gate.reasonShownInline || gate.blocker ? "accessible" : "inline",
              }
            : {})}
        >
          {descriptor.funding === "goldcoin-deposit-address"
            ? "Create deposit request"
            : "Deposit from wallet"}
        </Button>
      </div>
    </Card>
  );
}

type Blocker =
  | "unavailable"
  | "route-closed"
  | "paused"
  | "insufficient-liquidity"
  | "quota-exhausted"
  | "quota-paused"
  | "recipient-rate-limited"
  | "source-wallet-rate-limited";

/**
 * Bridge-wide, backend-driven blockers get their own callout rather than
 * disappearing into the submit button's disabled-reason text — these are
 * conditions the amount/recipient fields cannot fix, so a reader should
 * see them before filling anything in, not discover them only after
 * clicking a dead-looking button.
 */
function BlockerAlert({
  blocker,
  directionLabel,
}: {
  blocker: Blocker;
  directionLabel: string;
}) {
  const copy: Record<Blocker, { title: string; funds: string }> = {
    // The title IS the backend's `disabled_reason`, passed through
    // untouched — this UI does not author a second sentence about why a
    // route is closed, and does not try to infer which gate refused.
    "route-closed": {
      title: directionLabel,
      funds:
        "Nothing you enter below will submit while this route is closed — no funds move.",
    },
    unavailable: {
      title: "We could not reach the bridge status service.",
      funds:
        "No funds have moved. This is a problem loading information, not a problem with a transfer.",
    },
    paused: {
      title: `${directionLabel} is currently paused.`,
      funds:
        "Nothing you enter below will submit while this direction is paused — no funds move.",
    },
    "insufficient-liquidity": {
      title: "This direction has no reserve capacity available right now.",
      funds:
        "Nothing you enter below will submit until capacity is available — no funds move.",
    },
    // The two quota states carry the approved copy verbatim. Neither may
    // ever promise a reset time or an automatic reopening: the backend's
    // pause after exhaustion only clears by manual operator action
    // (docs/09-runbook.md, 2026-08-22).
    "quota-exhausted": {
      title: QUOTA_EXHAUSTED_TITLE,
      funds: `${QUOTA_EXHAUSTED_BODY} Nothing you enter below will submit — no funds move.`,
    },
    "quota-paused": {
      title: QUOTA_PAUSED_TITLE,
      funds: `${QUOTA_PAUSED_BODY} Nothing you enter below will submit — no funds move.`,
    },
    // Unlike every blocker above, this one is specific to the ADDRESS the
    // user typed, not to the bridge or the direction. Per the product
    // decision in `@/lib/bridge/recipient-rate-limit`, it shows exactly
    // one sentence: empty `funds`/`next` render nothing, and the
    // status-page link (which would show a perfectly healthy bridge) is
    // omitted too. The retry-after time the backend still returns is
    // deliberately not displayed.
    "recipient-rate-limited": {
      title: RECIPIENT_RATE_LIMIT_TITLE,
      funds: "",
    },
    // The source-wallet twin of the above — specific to the CONNECTED
    // WALLET, not the address typed. Same one-sentence product decision
    // (`@/lib/bridge/source-wallet-rate-limit`): no funds/next, no
    // status-page link, no retry-after time shown.
    "source-wallet-rate-limited": {
      title: SOURCE_WALLET_RATE_LIMIT_TITLE,
      funds: "",
    },
  };
  const isRateLimitedBlocker =
    blocker === "recipient-rate-limited" || blocker === "source-wallet-rate-limited";
  const next =
    blocker === "quota-paused"
      ? QUOTA_PAUSED_NEXT
      : blocker === "quota-exhausted"
        ? "See the current status page for live capacity."
        : isRateLimitedBlocker
          ? ""
          : "Check your connection and try again, or see the current status.";

  return (
    <Alert
      level="warn"
      title={copy[blocker].title}
      funds={copy[blocker].funds}
      next={next}
      actions={
        isRateLimitedBlocker ? undefined : (
          <ButtonLink href={routes.status} variant="secondary" size="sm">
            View status
          </ButtonLink>
        )
      }
    />
  );
}
