"use client";

import { useQuery, useMutation, type UseQueryResult } from "@tanstack/react-query";
import { bridgeApi } from "@/lib/api";
import type {
  ListExplorerEventsParams,
  ListReserveHistoryParams,
  ListTransfersParams,
} from "@/lib/api";
import type { SettlementRoute } from "@/lib/api/schemas/common";
import type {
  BridgeStatusDto,
  PublicHealthDto,
  ReserveAvailabilityDto,
  TransferLimitsDto,
} from "@/lib/api/schemas/status";
import type { BridgeStatsDto } from "@/lib/api/schemas/stats";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import type { ExplorerEventListDto } from "@/lib/api/schemas/explorer";
import type { ReserveHistoryListDto } from "@/lib/api/schemas/reserves";
import type { QuoteOutputDto } from "@/lib/api/schemas/quote";
import type { RecipientEligibilityDto } from "@/lib/api/schemas/eligibility";
import type {
  CreateTransferOutputDto,
  CreateTransferRequest,
  TransferListDto,
  TransferViewDto,
} from "@/lib/api/schemas/transfer";
import { isTerminalState } from "@/lib/bridge/state";
import { queryKeys, pollIntervals } from "./keys";

/**
 * One typed hook per bridge endpoint. Application code uses these, never
 * `bridgeApi` directly, so every server-state read goes through react-query
 * caching/retry/staleness policy uniformly.
 */

export function useBridgeStatus(
  initialData?: BridgeStatusDto,
): UseQueryResult<BridgeStatusDto> {
  return useQuery({
    queryKey: queryKeys.status(),
    queryFn: ({ signal }) => bridgeApi.getStatus(signal),
    refetchInterval: pollIntervals.status,
    ...(initialData ? { initialData } : {}),
  });
}

/**
 * The chain/route registry — the authority on route availability.
 *
 * Nothing else in this app may answer "is this route usable". A failed or
 * still-loading read means availability is UNKNOWN, which every consumer
 * treats as closed (`routeAvailability`'s `unknown` case), never as open.
 */
export function useChains(initialData?: ChainsViewDto): UseQueryResult<ChainsViewDto> {
  return useQuery({
    queryKey: queryKeys.chains(),
    queryFn: ({ signal }) => bridgeApi.getChains(signal),
    refetchInterval: pollIntervals.chains,
    ...(initialData ? { initialData } : {}),
  });
}

export function useLimits(
  initialData?: TransferLimitsDto,
): UseQueryResult<TransferLimitsDto> {
  return useQuery({
    queryKey: queryKeys.limits(),
    queryFn: ({ signal }) => bridgeApi.getLimits(signal),
    refetchInterval: pollIntervals.limits,
    ...(initialData ? { initialData } : {}),
  });
}

export function useReserve(
  initialData?: ReserveAvailabilityDto,
): UseQueryResult<ReserveAvailabilityDto> {
  return useQuery({
    queryKey: queryKeys.reserve(),
    queryFn: ({ signal }) => bridgeApi.getReserve(signal),
    refetchInterval: pollIntervals.reserve,
    ...(initialData ? { initialData } : {}),
  });
}

export function useHealth(
  initialData?: PublicHealthDto,
): UseQueryResult<PublicHealthDto> {
  return useQuery({
    queryKey: queryKeys.health(),
    queryFn: ({ signal }) => bridgeApi.getHealth(signal),
    refetchInterval: pollIntervals.health,
    ...(initialData ? { initialData } : {}),
  });
}

export function useStats(initialData?: BridgeStatsDto): UseQueryResult<BridgeStatsDto> {
  return useQuery({
    queryKey: queryKeys.stats(),
    queryFn: ({ signal }) => bridgeApi.getStats(signal),
    refetchInterval: pollIntervals.stats,
    ...(initialData ? { initialData } : {}),
  });
}

/**
 * The authoritative gross/fee/net quote. `grossAmount` of 0 disables the
 * query — the form never shows a quote for an amount that has not been
 * entered.
 */
export function useQuote(
  direction: SettlementRoute,
  /** Exact canonical atomic amount as a decimal string; "0" means none. */
  grossAmount: string,
): UseQueryResult<QuoteOutputDto> {
  return useQuery({
    queryKey: queryKeys.quote(direction, grossAmount),
    queryFn: ({ signal }) =>
      bridgeApi.getQuote({ direction, gross_amount: grossAmount }, signal),
    enabled: BigInt(grossAmount) > 0n,
    staleTime: 5_000,
    retry: false,
  });
}

/**
 * The SolToGlc dual rate-limit check for the Goldcoin address AND (once
 * connected) the Solana source wallet in the form
 * (`GET /recipients/sol-to-glc/eligibility`). Enabled only once the
 * address has passed local validation — never fired per keystroke on
 * half-typed input; `wallet` is `null` until a wallet is connected, in
 * which case only the recipient leg is checked (the source-wallet leg
 * joins automatically once connected). This is the FORM-level check;
 * `BridgeCard.submit` additionally re-fetches through `bridgeApi` directly
 * immediately before invoking the wallet, so a stale cached "eligible"
 * here can never be what authorizes opening Phantom.
 */
export function useSolToGlcRecipientEligibility(
  address: string,
  wallet: string | null,
  enabled: boolean,
): UseQueryResult<RecipientEligibilityDto> {
  return useQuery({
    queryKey: queryKeys.recipientEligibility(address, wallet),
    queryFn: ({ signal }) =>
      bridgeApi.getSolToGlcRecipientEligibility(address, wallet, signal),
    enabled: enabled && address.length > 0,
    refetchInterval: pollIntervals.recipientEligibility,
    staleTime: 15_000,
    retry: false,
  });
}

export function useTransfer(
  id: number,
  initialData?: TransferViewDto,
): UseQueryResult<TransferViewDto> {
  return useQuery({
    queryKey: queryKeys.transfer(id),
    queryFn: ({ signal }) => bridgeApi.getTransfer(id, signal),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && isTerminalState(data.state)) return pollIntervals.terminalTransfer;
      return pollIntervals.activeTransfer;
    },
    ...(initialData ? { initialData } : {}),
  });
}

export function useTransfers(
  params: ListTransfersParams,
  options: { enabled?: boolean } = {},
): UseQueryResult<TransferListDto> {
  return useQuery({
    queryKey: queryKeys.transfers(params),
    queryFn: ({ signal }) => bridgeApi.listTransfers(params, signal),
    refetchInterval: pollIntervals.transferList,
    enabled: options.enabled ?? true,
  });
}

export function useExplorerEvents(
  params: ListExplorerEventsParams,
): UseQueryResult<ExplorerEventListDto> {
  return useQuery({
    queryKey: queryKeys.explorerEvents(params),
    queryFn: ({ signal }) => bridgeApi.listExplorerEvents(params, signal),
    refetchInterval: pollIntervals.explorerEvents,
  });
}

export function useReserveHistory(
  params: ListReserveHistoryParams,
): UseQueryResult<ReserveHistoryListDto> {
  return useQuery({
    queryKey: queryKeys.reserveHistory(params),
    queryFn: ({ signal }) => bridgeApi.listReserveHistory(params, signal),
    refetchInterval: pollIntervals.reserveHistory,
  });
}

export function useCreateTransfer() {
  return useMutation<CreateTransferOutputDto, unknown, CreateTransferRequest>({
    mutationFn: (request) => bridgeApi.createTransfer(request),
  });
}
