import type { z } from "zod";
import type {
  BridgeApiClient,
  ListExplorerEventsParams,
  ListReserveHistoryParams,
  ListTransfersParams,
} from "./client";
import {
  badRequestError,
  directionUnavailableError,
  networkError,
  notFoundError,
  rateLimitedError,
  serverError,
  timeoutError,
  validationError,
} from "./errors";
import { apiErrorBodySchema, type Direction } from "./schemas/common";
import {
  bridgeStatusSchema,
  publicHealthSchema,
  reserveAvailabilitySchema,
  transferLimitsSchema,
} from "./schemas/status";
import { bridgeStatsSchema } from "./schemas/stats";
import { chainsViewSchema } from "./schemas/chains";
import { explorerEventListSchema } from "./schemas/explorer";
import { reserveHistoryListSchema } from "./schemas/reserves";
import { quoteOutputSchema } from "./schemas/quote";
import { recipientEligibilitySchema } from "./schemas/eligibility";
import {
  createTransferOutputSchema,
  createTransferRequestSchema,
  transferListSchema,
  transferViewSchema,
  type CreateTransferRequest,
  type RequestState,
} from "./schemas/transfer";

/**
 * The only module in this codebase that performs network I/O. ESLint
 * enforces that boundary (see eslint.config.mjs).
 *
 * Every response is parsed through its schema before it is returned.
 * Nothing downstream ever receives an unvalidated object. The backend sets
 * `cache-control: no-store` on every response itself; this client sends no
 * credentials either way, matching a backend that has no auth of its own
 * (service/src/api.rs module doc).
 */

/**
 * The client-side default. SSR first-paint uses a shorter caller-supplied
 * signal instead (src/lib/api/initial-status.ts) — composed with this via
 * `AbortSignal.any`, never replacing it. Exported so tests can pin the
 * value rather than re-deriving it.
 */
export const DEFAULT_TIMEOUT_MS = 15_000;

export class HttpBridgeClient implements BridgeApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, options: { timeoutMs?: number } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  getStatus(signal?: AbortSignal) {
    return this.request("/status", bridgeStatusSchema, {}, signal);
  }

  getChains(signal?: AbortSignal) {
    return this.request("/chains", chainsViewSchema, {}, signal);
  }

  getLimits(signal?: AbortSignal) {
    return this.request("/limits", transferLimitsSchema, {}, signal);
  }

  getReserve(signal?: AbortSignal) {
    return this.request("/reserve", reserveAvailabilitySchema, {}, signal);
  }

  getHealth(signal?: AbortSignal) {
    return this.request("/health", publicHealthSchema, {}, signal);
  }

  getStats(signal?: AbortSignal) {
    return this.request("/stats", bridgeStatsSchema, {}, signal);
  }

  getQuote(
    request: { direction: Direction; gross_amount: string },
    signal?: AbortSignal,
  ) {
    return this.request("/quote", quoteOutputSchema, {}, signal, request);
  }

  getSolToGlcRecipientEligibility(
    address: string,
    wallet: string | null,
    signal?: AbortSignal,
  ) {
    const query: Record<string, string> = { address };
    if (wallet) query.wallet = wallet;
    return this.request(
      "/recipients/sol-to-glc/eligibility",
      recipientEligibilitySchema,
      query,
      signal,
    );
  }

  getTransfer(id: number, signal?: AbortSignal) {
    return this.request(
      `/transfers/${encodeURIComponent(String(id))}`,
      transferViewSchema,
      {},
      signal,
    );
  }

  createTransfer(request: CreateTransferRequest, signal?: AbortSignal) {
    const validated = createTransferRequestSchema.parse(request);
    return this.request("/transfers", createTransferOutputSchema, {}, signal, validated, {
      expectStatus: 201,
    });
  }

  listTransfers(params: ListTransfersParams, signal?: AbortSignal) {
    const query: Record<string, string> = {};
    if (params.address) query.address = params.address;
    if (params.state) query.state = params.state satisfies RequestState;
    if (params.cursor) query.cursor = params.cursor;
    if (params.limit !== undefined) query.limit = String(params.limit);

    return this.request("/transfers", transferListSchema, query, signal);
  }

  listExplorerEvents(params: ListExplorerEventsParams, signal?: AbortSignal) {
    const query: Record<string, string> = {};
    if (params.direction) query.direction = params.direction;
    if (params.state) query.state = params.state;
    if (params.cursor) query.cursor = params.cursor;
    if (params.limit !== undefined) query.limit = String(params.limit);

    return this.request("/explorer/events", explorerEventListSchema, query, signal);
  }

  listReserveHistory(params: ListReserveHistoryParams, signal?: AbortSignal) {
    const query: Record<string, string> = {};
    if (params.direction) query.direction = params.direction;
    if (params.cursor) query.cursor = params.cursor;
    if (params.limit !== undefined) query.limit = String(params.limit);

    return this.request("/reserves/history", reserveHistoryListSchema, query, signal);
  }

  private async request<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
    query: Record<string, string>,
    signal?: AbortSignal,
    body?: unknown,
    options?: { expectStatus?: number },
  ): Promise<z.infer<TSchema>> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers:
          body === undefined
            ? { Accept: "application/json" }
            : { Accept: "application/json", "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: composed,
        credentials: "omit",
        cache: "no-store",
      });
    } catch (cause) {
      if (timeout.aborted) throw timeoutError(cause);
      throw networkError(cause);
    }

    if (!response.ok) {
      if (response.status === 404) throw notFoundError(describe(path));
      if (response.status === 429) throw rateLimitedError();

      let bodyText = "";
      try {
        bodyText = await response.text();
      } catch {
        bodyText = "";
      }
      // A reverse proxy in front of the real backend can return a non-JSON
      // body (an HTML error page on a 502/504, for instance) — that must
      // degrade to a generic server error, not an uncaught SyntaxError.
      let bodyJson: unknown = null;
      if (bodyText) {
        try {
          bodyJson = JSON.parse(bodyText);
        } catch {
          bodyJson = null;
        }
      }
      const parsed = apiErrorBodySchema.safeParse(bodyJson);
      const message = parsed.success
        ? parsed.data.error
        : `Bridge API responded ${response.status}`;

      if (response.status === 409) {
        // Every 409 cause (paused, insufficient liquidity, quota
        // exhausted) now carries the same approved backend message — the
        // specific cause is read from /status's fields, never parsed from
        // this string (api.rs's DIRECTION_UNAVAILABLE_MESSAGE docs).
        throw directionUnavailableError(message);
      }
      if (response.status === 400) throw badRequestError(message);

      throw serverError(parsed.success ? parsed.data : null, response.status);
    }

    if (options?.expectStatus !== undefined && response.status !== options.expectStatus) {
      throw serverError(null, response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw validationError(path, cause);
    }

    const result = schema.safeParse(payload);
    if (!result.success) throw validationError(path, result.error);

    return result.data as z.infer<TSchema>;
  }
}

function describe(path: string): string {
  if (path.startsWith("/transfers")) return "transfer";
  return "resource";
}
