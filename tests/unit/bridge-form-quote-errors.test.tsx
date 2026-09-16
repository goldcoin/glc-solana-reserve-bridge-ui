import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import {
  expectHeldOnlyByEligibility,
  primaryCta,
  renderWithQueryClient,
  routeEligibilityFrom,
  waitForRouteVerdict,
} from "./test-utils";
import { createQueryClient } from "@/lib/query/provider";
import * as fixtures from "@/lib/api/mock/fixtures";
import type * as EvmModule from "@/lib/evm";
import { HttpBridgeClient } from "@/lib/api/http";
import { isApiError, toPresentation } from "@/lib/api/errors";
import { BridgeForm } from "@/features/bridge/BridgeForm";

/**
 * What the form does when `POST /quote` fails, and what it must never do.
 *
 * Three rules, in order of how expensive breaking them is:
 *
 * 1. A quote is a statement about ONE exact amount. When the amount
 *    changes, the previous quote is not a slightly stale version of the new
 *    one — it is an answer to a different question. It must not remain on
 *    screen, and it must not let the submit gate open while the real answer
 *    is still in flight.
 * 2. A failed quote is reported through the product's three-part error
 *    formula, with the specific cause the backend gave. The generic
 *    "Something went wrong loading this page." is what `toPresentation`
 *    falls back to for a RAW error, and no failure of this endpoint may
 *    reach it — every path through the HTTP client produces an `ApiError`.
 * 3. A figure the formatter cannot read is still the backend's real number.
 *    It renders as sent rather than throwing out of a render, because an
 *    `AmountFormatError` from a render reaches the page boundary and
 *    replaces the entire working form.
 */

const getStatus = vi.fn();
const getChains = vi.fn();
const getLimits = vi.fn();
const getReserve = vi.fn();
const getQuote = vi.fn();
const listTransfers = vi.fn();
const getSolToGlcRecipientEligibility = vi.fn();

vi.mock("@/lib/api", async () => {
  return {
    // The real error factories: BridgeForm imports them by name, and a
    // partial mock of this module would leave them undefined.
    ...(await import("@/lib/api/errors")),
    bridgeApi: {
      getStatus: (...a: unknown[]) => getStatus(...a),
      getChains: (...a: unknown[]) => getChains(...a),
      getLimits: (...a: unknown[]) => getLimits(...a),
      getReserve: (...a: unknown[]) => getReserve(...a),
      getQuote: (...a: unknown[]) => getQuote(...a),
      createTransfer: vi.fn(),
      listTransfers: (...a: unknown[]) => listTransfers(...a),
      getSolToGlcRecipientEligibility: (...a: unknown[]) =>
        getSolToGlcRecipientEligibility(...a),
      // The one method `fetchRouteEligibility` calls. Built from the
      // per-route mocks above by the same rule `HttpBridgeClient` uses, so
      // a route with no landed endpoint rejects here exactly as it would
      // against the real backend.
      getRouteEligibility: routeEligibilityFrom({
        SolToGlc: (address: string, wallet: string | null) =>
          getSolToGlcRecipientEligibility(address, wallet),
      }),
    },
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const SOLANA_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => ({
    status: "connected" as const,
    address: SOLANA_ADDRESS,
    wallet: null,
    wallets: [],
    canSign: true,
    error: null,
    platform: "desktop" as const,
    connect: vi.fn(),
    disconnect: vi.fn(),
    dismissError: vi.fn(),
  }),
  useDepositToReserve: () => ({
    capability: () => ({ available: true, reason: null, message: null }),
    deposit: vi.fn(),
  }),
  isValidAddress: (v: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v),
  useTokenBalance: () => ({ isPending: false, isError: false, data: undefined }),
  isTokenBalanceAvailable: () => true,
  walletQueryKeys: { balances: () => ["solana", "balance"] },
}));

vi.mock("@/lib/evm", async (importOriginal) => {
  const actual = await importOriginal<typeof EvmModule>();
  return {
    ...actual,
    robinhoodDeployment: () => null,
    useEvmWallet: () => ({
      // The NETWORK identity, which the real hook always resolves: it is
      // what the wallet control reads, and it never depends on contract
      // configuration or on a route being open.
      network: {
        chainId: 4663,
        chainName: "Robinhood Network",
        rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
      },
      wallets: [],
      hasInjectedWallet: false,
      address: null,
      chainId: null,
      connecting: false,
      deployment: null,
      onExpectedChain: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      switchChain: vi.fn(),
      getProvider: () => null,
    }),
    useRobinhoodDeposit: () => ({ deposit: vi.fn() }),
    useRobinhoodGlcBalance: () => ({ isPending: false, isError: false, data: undefined }),
  };
});

/**
 * Renders against the application's OWN QueryClient rather than a
 * test-local one.
 *
 * `renderWithQueryClient` builds a bare client, which silently omits the
 * app-wide defaults in `createQueryClient` — including
 * `placeholderData: previous => previous`, the very default the
 * stale-quote rule is about. A test for that rule run against a bare
 * client passes without exercising anything.
 */
function renderWithAppQueryClient(ui: ReactElement) {
  return render(
    <QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>,
  );
}

function quoteFor(grossAmount: string, netDisplay: string) {
  return {
    direction: "GlcToSol",
    gross_amount: grossAmount,
    gross_display_amount: "1000.00000000",
    fee_bps: 300,
    fee_amount: "3000000000",
    fee_display_amount: "30.00000000",
    net_amount: "97000000000",
    net_display_amount: netDisplay,
    source_decimals: 8,
    destination_decimals: 6,
    source_asset: "GLC (Goldcoin)",
    destination_asset: "GLC (Solana)",
  };
}

function amountField() {
  return screen.getByLabelText(/Amount in GLC/i);
}

function estimate() {
  return screen.getByLabelText(/Estimated amount received/i);
}

beforeEach(() => {
  vi.resetAllMocks();
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getChains.mockResolvedValue(fixtures.chainsFixture(() => new Date()));
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  listTransfers.mockResolvedValue({ items: [], next_cursor: null, as_of: 1 });
  getSolToGlcRecipientEligibility.mockResolvedValue({
    direction: "SolToGlc",
    address: "unused",
    wallet: null,
    eligible: true,
    blocked_reason: null,
    retry_after: null,
    retry_after_seconds: null,
    window_seconds: 86_400,
  });
});

describe("quote success", () => {
  it("shows the backend's own received figure", async () => {
    getQuote.mockResolvedValue(quoteFor("100000000000", "970.00000000"));
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await user.type(amountField(), "1000");
    // "on Solana", not the backend's parenthesised "GLC (Solana)": the
    // network is the fact a user must not misread, so it is stated rather
    // than bracketed.
    expect(await screen.findByText(/970\.00 GLC on Solana/)).toBeVisible();
    expect(estimate()).toHaveTextContent("970.00");
  });
});

describe("quote failure", () => {
  it("states the backend's specific reason, never the generic page error", async () => {
    const { badRequestError } = await import("@/lib/api/errors");
    getQuote.mockRejectedValue(badRequestError("gross_amount must be > 0"));
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await user.type(amountField(), "1000");

    expect(await screen.findByText("gross_amount must be > 0")).toBeVisible();
    expect(
      screen.queryByText(/Something went wrong loading this page/i),
    ).not.toBeInTheDocument();
  });

  it("shows no received figure at all once the quote has failed", async () => {
    const { serverError } = await import("@/lib/api/errors");
    getQuote.mockRejectedValue(serverError(null, 503));
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await user.type(amountField(), "1000");

    expect(
      await screen.findByText("The bridge could not complete that request."),
    ).toBeVisible();
    // The placeholder, not a number: nothing is known about this amount.
    await waitFor(() => expect(estimate()).toHaveTextContent("0.00"));
    expect(screen.getByText(/Bridge fee/).closest("div")).toHaveTextContent("—");
  });

  it("drops the previous amount's quote instead of showing it beside a new amount", async () => {
    // The stale-quote rule, against the app's real defaults: once the
    // quote for the CURRENT amount has failed, the previous amount's
    // figure must not still be on screen. 970.00 is the answer for 1000
    // GLC; 2000 GLC is in the box and its own quote is unknown.
    const { serverError } = await import("@/lib/api/errors");
    // Not `...Once`: typing "1000" passes through "100", which now
    // CLEARS the 100 GLC source minimum and fires a quote of its own.
    // A one-shot mock would be consumed by that keystroke and leave
    // the quote under test unanswered — which is a fact about the
    // minimum, not about the caching this test is for.
    getQuote.mockResolvedValue(quoteFor("100000000000", "970.00000000"));
    const user = userEvent.setup();
    renderWithAppQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await user.type(amountField(), "1000");
    await waitFor(() => expect(estimate()).toHaveTextContent("970.00"));

    getQuote.mockRejectedValue(serverError(null, 503));
    await user.clear(amountField());
    await user.type(amountField(), "2000");

    await waitFor(() =>
      expect(
        screen.getByText("The bridge could not complete that request."),
      ).toBeVisible(),
    );
    expect(estimate()).not.toHaveTextContent("970.00");
  });

  it("holds the submit gate while a new amount's quote is still in flight", async () => {
    // A placeholder resolves as `success`, not `pending`, so retaining one
    // across a key change also silently reopened the gate: the form was
    // submittable against a figure computed for a different amount.
    const pending: { resolve?: (value: unknown) => void } = {};
    // Not `...Once`: typing "1000" passes through "100", which now
    // CLEARS the 100 GLC source minimum and fires a quote of its own.
    // A one-shot mock would be consumed by that keystroke and leave
    // the quote under test unanswered — which is a fact about the
    // minimum, not about the caching this test is for.
    getQuote.mockResolvedValue(quoteFor("100000000000", "970.00000000"));
    const user = userEvent.setup();
    renderWithAppQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await user.type(screen.getByLabelText(/Solana recipient address/i), SOLANA_ADDRESS);
    await user.type(amountField(), "1000");
    await waitFor(() => expect(estimate()).toHaveTextContent("970.00"));
    // The gate is held by eligibility on this route rather than by the
    // quote — `GlcToSol` has no published eligibility endpoint yet — so
    // what this test can still prove is the part it is actually about:
    // the stale figure does not survive the amount changing.
    await expectHeldOnlyByEligibility();

    getQuote.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.resolve = resolve;
        }),
    );
    await user.clear(amountField());
    await user.type(amountField(), "2000");

    await waitFor(() => expect(estimate()).not.toHaveTextContent("970.00"));
    expect(primaryCta()).toBeDisabled();

    pending.resolve?.(quoteFor("200000000000", "1940.00000000"));
    await waitFor(() => expect(estimate()).toHaveTextContent("1,940.00"));
  });

  it("cannot be submitted while the quote for the current amount is unknown", async () => {
    const { serverError } = await import("@/lib/api/errors");
    getQuote.mockRejectedValue(serverError(null, 503));
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await user.type(screen.getByLabelText(/Solana recipient address/i), SOLANA_ADDRESS);
    await user.type(amountField(), "1000");

    await waitFor(() =>
      expect(
        screen.getByText("The bridge could not complete that request."),
      ).toBeVisible(),
    );
    expect(primaryCta()).toBeDisabled();
  });
});

describe("every quote failure is a structured error", () => {
  /**
   * The claim the first test in this file rests on, asserted directly
   * against the client rather than inferred: there is no route through
   * `HttpBridgeClient` that yields a raw error, so `quote.isError` can
   * never render the generic page copy.
   */
  const GENERIC = "Something went wrong loading this page.";

  async function failedQuote(respond: () => Promise<Response> | never) {
    const client = new HttpBridgeClient("https://bridge.example.test");
    vi.stubGlobal("fetch", vi.fn(respond));
    try {
      await client.getQuote({ direction: "RhnToGlc", gross_amount: "100000000" });
      throw new Error("expected the quote to fail");
    } catch (error) {
      return error;
    } finally {
      vi.unstubAllGlobals();
    }
  }

  function json(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("maps a refused route (409) to a stated reason", async () => {
    const error = await failedQuote(async () => json({ error: "route disabled" }, 409));
    expect(isApiError(error)).toBe(true);
    expect(toPresentation(error).what).not.toBe(GENERIC);
  });

  it("maps a rejected request (400) to a stated reason", async () => {
    const error = await failedQuote(async () => json({ error: "unknown route" }, 400));
    expect(isApiError(error)).toBe(true);
    expect(toPresentation(error).what).toBe("unknown route");
  });

  it("maps an upstream fault (5xx) to a stated reason", async () => {
    const error = await failedQuote(async () => json({ error: "solana rpc" }, 502));
    expect(isApiError(error)).toBe(true);
    expect(toPresentation(error).what).toBe(
      "The bridge could not complete that request.",
    );
  });

  it("maps an unreachable bridge to a stated reason", async () => {
    const error = await failedQuote(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(isApiError(error)).toBe(true);
    expect(toPresentation(error).what).toBe("We could not reach the bridge.");
  });

  it("maps an unreadable body to a stated reason", async () => {
    const error = await failedQuote(
      async () =>
        new Response("<html>gateway</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    expect(isApiError(error)).toBe(true);
    expect(toPresentation(error).what).toBe(
      "The bridge returned data this page could not read.",
    );
  });

  it("maps a response that does not match the schema to a stated reason", async () => {
    const error = await failedQuote(async () => json({ direction: "RhnToGlc" }, 200));
    expect(isApiError(error)).toBe(true);
    expect(toPresentation(error).what).toBe(
      "The bridge returned data this page could not read.",
    );
  });
});

describe("an unreadable display figure never takes down the page", () => {
  it("renders the backend's string as sent rather than throwing out of a render", async () => {
    // `*_display_amount` is free text on the wire. Before this was guarded,
    // a value the formatter could not parse threw an AmountFormatError from
    // the render and the page boundary replaced the whole form.
    getQuote.mockResolvedValue(quoteFor("100000000000", "9 70,00"));
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await user.type(amountField(), "1000");

    await waitFor(() => expect(estimate()).toHaveTextContent("9 70,00"));
    expect(
      screen.queryByText(/Something went wrong loading this page/i),
    ).not.toBeInTheDocument();
  });
});
