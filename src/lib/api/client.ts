import type {
  BridgeStatusDto,
  PublicHealthDto,
  ReserveAvailabilityDto,
  TransferLimitsDto,
} from "./schemas/status";
import type { BridgeStatsDto } from "./schemas/stats";
import type { ChainsViewDto } from "./schemas/chains";
import type { ExplorerEventListDto } from "./schemas/explorer";
import type { ReserveHistoryListDto, ReserveDirectionParam } from "./schemas/reserves";
import type { QuoteOutputDto } from "./schemas/quote";
import type { RecipientEligibilityDto } from "./schemas/eligibility";
import type {
  CreateTransferOutputDto,
  CreateTransferRequest,
  RequestState,
  TransferListDto,
  TransferViewDto,
} from "./schemas/transfer";
import type { Direction } from "./schemas/common";

/**
 * The API boundary.
 *
 * Application code depends on this interface, never on an implementation.
 * The concrete client is chosen once, at the composition root, from public
 * config — this is what lets the UI be built and tested against typed
 * fixtures without a hardcoded backend response reaching a component.
 *
 * This mirrors the real, ground-truth surface of
 * `service/src/api.rs` in glc-solana-reserve-bridge — there is no more and
 * no less here than the backend actually implements. In particular there is
 * deliberately no "create SolToGlc transfer" method and no "create
 * RhnToGlc transfer" method: neither contract-sourced route has a backend
 * endpoint. The client submits the chain transaction itself (see
 * `src/lib/solana/deposit.ts` and `src/lib/evm/deposit.ts`), then discovers
 * the resulting transfer via `listTransfers({ address })`.
 *
 * # A known gap, recorded rather than papered over
 *
 * `listTransfers({ address })` accepts a base58 Solana pubkey ONLY. The
 * backend parses `?address=` as a `Pubkey` and its underlying query
 * matches just `GlcToSol.recipient` / `SolToGlc.requester`
 * (`Ledger::transfers_page`), so a 20-byte EVM address returns 400 and
 * Robinhood rows are never returned even if the bytes were accepted.
 * Wallet-scoped activity for Robinhood therefore does not exist yet, on
 * either side. This UI does not fake it: the backend must add EVM address
 * support to `GET /transfers` before that view can work.
 */

export interface ListReserveHistoryParams {
  readonly direction?: ReserveDirectionParam;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListExplorerEventsParams {
  readonly direction?: Direction;
  readonly state?: RequestState;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListTransfersParams {
  readonly address?: string;
  readonly state?: RequestState;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface BridgeApiClient {
  getStatus(signal?: AbortSignal): Promise<BridgeStatusDto>;
  /**
   * The chain/route registry — the ONLY authoritative answer to "can a
   * user start a transfer this way right now" (`GET /chains`).
   *
   * Every route-availability decision in this app reads from here. It is
   * never re-derived from public config, from which chains this build
   * knows about, or from whether a contract address happens to be set:
   * that is what makes opening a route a backend-only change.
   */
  getChains(signal?: AbortSignal): Promise<ChainsViewDto>;
  getLimits(signal?: AbortSignal): Promise<TransferLimitsDto>;
  getReserve(signal?: AbortSignal): Promise<ReserveAvailabilityDto>;
  getHealth(signal?: AbortSignal): Promise<PublicHealthDto>;
  getStats(signal?: AbortSignal): Promise<BridgeStatsDto>;

  getQuote(
    request: { direction: Direction; gross_amount: string },
    signal?: AbortSignal,
  ): Promise<QuoteOutputDto>;

  /**
   * SolToGlc only — whether this Goldcoin destination address AND (when
   * given) this Solana source wallet are currently eligible for a new
   * bridge payout, or either is still inside the backend's rolling 24-hour
   * window (`GET /recipients/sol-to-glc/eligibility`). `wallet` is the
   * connected wallet's base58 pubkey, or `null` before a wallet is
   * connected — omitting it simply means the source-wallet leg is not
   * checked yet, the recipient leg still is. Advisory: the backend
   * re-checks both rules authoritatively at admission time; the UI calls
   * this to warn BEFORE the wallet is invoked, and again immediately
   * before submission so a stale form-time answer never reaches the
   * wallet.
   */
  getSolToGlcRecipientEligibility(
    address: string,
    wallet: string | null,
    signal?: AbortSignal,
  ): Promise<RecipientEligibilityDto>;

  getTransfer(id: number, signal?: AbortSignal): Promise<TransferViewDto>;
  /**
   * Goldcoin-SOURCED routes only (`GlcToSol`, `GlcToRhn`). The backend has
   * no create endpoint for the contract-sourced routes: `SolToGlc` submits
   * `deposit_to_reserve` itself (`src/lib/solana/deposit.ts`) and
   * `RhnToGlc` calls the custody contract's `deposit` (`src/lib/evm`),
   * then both discover the resulting transfer through the activity list.
   */
  createTransfer(
    request: CreateTransferRequest,
    signal?: AbortSignal,
  ): Promise<CreateTransferOutputDto>;
  listTransfers(
    params: ListTransfersParams,
    signal?: AbortSignal,
  ): Promise<TransferListDto>;

  listExplorerEvents(
    params: ListExplorerEventsParams,
    signal?: AbortSignal,
  ): Promise<ExplorerEventListDto>;

  listReserveHistory(
    params: ListReserveHistoryParams,
    signal?: AbortSignal,
  ): Promise<ReserveHistoryListDto>;
}
