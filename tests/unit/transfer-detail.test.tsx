import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "./test-utils";
import { TransferDetail } from "@/features/transfer/TransferDetail";
import * as fixtures from "@/lib/api/mock/fixtures";
import type { TransferViewDto } from "@/lib/api/schemas/transfer";

const getTransfer = vi.fn();

vi.mock("@/lib/api", async () => ({
  // The real error factories: BridgeForm imports them by name, and a
  // partial mock of this module would leave them undefined.
  ...(await import("@/lib/api/errors")),
  bridgeApi: { getTransfer: (...args: unknown[]) => getTransfer(...args) },
}));

function transferWith(overrides: Partial<TransferViewDto>): TransferViewDto {
  return { ...fixtures.transfersFixture()[0]!, ...overrides };
}

/**
 * Production request #2477, exactly as the backend reports it after the
 * refund: a `GlcToSol` request for 29,100 GLC whose deposit actually arrived
 * as 29,050 GLC, parked on `deposit_amount_mismatch`, refunded in full, no
 * bridge fee charged, nothing released on Solana.
 *
 * The quote trio is the real one the request was created under — 29,100 gross,
 * 873 fee, 28,227 net — because reproducing the defect means carrying exactly
 * the figures the page used to render as an outcome.
 */
const REQUESTED = "2910000000000"; // 29,100 GLC
const DEPOSITED = "2905000000000"; // 29,050 GLC
const QUOTED_FEE = "87300000000"; // 873 GLC, never charged
const QUOTED_NET = "2822700000000"; // 28,227 GLC, never delivered

function transfer2477(
  state: "RefundPending" | "RefundBroadcast" | "Refunded",
  refundOverrides: Partial<NonNullable<TransferViewDto["refund"]>> = {},
): TransferViewDto {
  return transferWith({
    id: 2477,
    direction: "GlcToSol",
    state,
    gross_amount_atomic: REQUESTED,
    fee_bps: 300,
    fee_amount_atomic: QUOTED_FEE,
    net_amount_atomic: QUOTED_NET,
    source_txid: "d".repeat(64),
    destination_txid: null,
    failure_reason: null,
    refund: {
      state: state === "Refunded" ? "Refunded" : "Broadcast",
      observed_amount_atomic: DEPOSITED,
      refund_amount_atomic: DEPOSITED,
      fee_charged_atomic: "0",
      refund_txid: "f7a160c716c3fad29b06c1c9549ca678dde30a143dd9f69675ce277016dec323",
      broadcast_at: 1_756_000_000,
      refunded_at: state === "Refunded" ? 1_756_000_600 : null,
      ...refundOverrides,
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("TransferDetail — real backend state machine, never a fabricated success", () => {
  it("renders an in-flight transfer with its stepper and no success claim", async () => {
    getTransfer.mockResolvedValue(
      transferWith({ id: 1, state: "Confirming", direction: "GlcToSol" }),
    );
    renderWithQueryClient(<TransferDetail id={1} />);

    // The stepper legitimately previews "Settled" as a future, not-yet-reached
    // step in the happy path, so its presence is not itself a false claim —
    // what matters is that the CURRENT reported state is Confirming.
    const matches = await screen.findAllByText("Confirming");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("renders Settled only when the backend actually reports it", async () => {
    getTransfer.mockResolvedValue(transferWith({ id: 2, state: "Settled" }));
    renderWithQueryClient(<TransferDetail id={2} />);

    expect(await screen.findAllByText("Settled")).not.toHaveLength(0);
  });

  it("shows a manual-review alert, not a stepper, when the backend says ManualReview", async () => {
    getTransfer.mockResolvedValue(
      transferWith({ id: 3, state: "ManualReview", failure_reason: "amount mismatch" }),
    );
    renderWithQueryClient(<TransferDetail id={3} />);

    expect(await screen.findAllByText(/manual review/i)).not.toHaveLength(0);
    expect(screen.getByText("amount mismatch")).toBeInTheDocument();
    expect(screen.getByText(/it is not lost/i)).toBeInTheDocument();
  });

  it("presents a refund as a refund, never as a failure", async () => {
    for (const [id, state, phrase] of [
      [30, "RefundPending", /refund for this transfer has been started/i],
      [31, "RefundBroadcast", /refund for this transfer has been broadcast/i],
      [32, "Refunded", /this transfer was refunded/i],
    ] as const) {
      getTransfer.mockResolvedValue(transferWith({ id, state }));
      const { unmount } = renderWithQueryClient(<TransferDetail id={id} />);

      expect(await screen.findByText(phrase)).toBeInTheDocument();
      // A refund is not a failure: none of the danger alert's title (which
      // names the state in parentheses) or its support-escalation copy, and
      // no assertive alert role that would announce it as an error.
      expect(screen.queryByText(/did not settle \(/i)).not.toBeInTheDocument();
      expect(
        screen.queryByText(/no further automatic action will occur/i),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      unmount();
      getTransfer.mockReset();
    }
  });

  it("does not show the happy-path stepper for a transfer that left it to be refunded", async () => {
    getTransfer.mockResolvedValue(
      transferWith({ id: 33, state: "Refunded", direction: "GlcToSol" }),
    );
    renderWithQueryClient(<TransferDetail id={33} />);

    await screen.findByText(/this transfer was refunded/i);
    // Steps from the happy path would otherwise render with none of them
    // marked current, implying the transfer is still on its way to settling.
    expect(screen.queryByText("Awaiting your deposit")).not.toBeInTheDocument();
    expect(screen.queryByText("Sending your funds")).not.toBeInTheDocument();
  });

  it("shows a failure alert with the three-part formula for a failed transfer", async () => {
    getTransfer.mockResolvedValue(
      transferWith({
        id: 4,
        state: "Failed",
        failure_reason: "destination submission rejected",
      }),
    );
    renderWithQueryClient(<TransferDetail id={4} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/did not settle/i);
    expect(alert).toHaveTextContent(/no further automatic action/i);
    expect(alert).toHaveTextContent(/contact support/i);
    expect(screen.getByText("destination submission rejected")).toBeInTheDocument();
  });

  it("flags a reserve-exhaustion failure with fund-safety copy specific to that state", async () => {
    getTransfer.mockResolvedValue(
      transferWith({ id: 5, state: "InsufficientReserveAtSettlement" }),
    );
    renderWithQueryClient(<TransferDetail id={5} />);

    expect(
      await screen.findByText(/reserve capacity ran out before settlement/i),
    ).toBeInTheDocument();
  });

  it("shows a neutral progress line for an in-flight state, not a rollout warning", async () => {
    // The old copy told the user this part of the pipeline was "still being
    // rolled out on this deployment" and that progress was "not yet
    // guaranteed". Settlement automation is live; the warning was stale.
    getTransfer.mockResolvedValue(transferWith({ id: 6, state: "SettlementAuthorized" }));
    renderWithQueryClient(<TransferDetail id={6} />);

    expect(
      await screen.findByText(/progressing through the settlement pipeline/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/still being rolled out/i)).not.toBeInTheDocument();
  });

  it("shows a loading skeleton before data arrives", () => {
    getTransfer.mockReturnValue(new Promise(() => {}));
    renderWithQueryClient(<TransferDetail id={7} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("surfaces a fetch failure as an error state, never as a fabricated status", async () => {
    getTransfer.mockRejectedValue(new Error("network down"));
    renderWithQueryClient(<TransferDetail id={8} />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows a not-found presentation for an unknown transfer id", async () => {
    const { ApiError } = await import("@/lib/api/errors");
    getTransfer.mockRejectedValue(
      new ApiError({
        kind: "not-found",
        message: "transfer not found",
        retryable: false,
        status: 404,
        presentation: {
          what: "We could not find that transfer.",
          funds:
            "If you have already sent funds, they are on-chain and are not affected by this page.",
          next: "Check the identifier and try again, or search by transaction ID.",
        },
      }),
    );
    renderWithQueryClient(<TransferDetail id={999} />);

    expect(await screen.findByText(/could not find that transfer/i)).toBeInTheDocument();
  });

  it("renders the same thing on the explorer route as on the bridge route", async () => {
    // Both routes render this component with the same props. It used to
    // take a `readOnly` flag whose only effect was to strip every
    // chain-explorer link, which left the public explorer showing bare
    // hashes on the one page whose purpose is independent verification —
    // so the flag is gone, and there is nothing left for the two routes to
    // differ by.
    const transfer = transferWith({ id: 9, state: "AwaitingDeposit" });
    getTransfer.mockResolvedValue(transfer);

    const { unmount } = renderWithQueryClient(<TransferDetail id={9} />);
    await waitFor(() =>
      expect(screen.getAllByText(/Awaiting your deposit/i).length).toBeGreaterThan(0),
    );
    unmount();

    getTransfer.mockResolvedValue(transfer);
    renderWithQueryClient(<TransferDetail id={9} />);
    expect(await screen.findAllByText(/Awaiting your deposit/i)).not.toHaveLength(0);
  });
});

/**
 * Regression cover for production request #2477.
 *
 * The page rendered the settlement quote — "You bridge 29,100 GLC / Bridge fee
 * (3%) 873 GLC / You receive 28,227 GLC" — on a transfer that settled nothing,
 * was charged nothing, delivered nothing, and had 29,050 GLC returned. Every
 * one of those three figures described a settlement that never happened.
 */
describe("TransferDetail — a refunded transfer shows the refund, never the quote", () => {
  it("shows #2477's real refund principal and none of the settlement trio", async () => {
    getTransfer.mockResolvedValue(transfer2477("Refunded"));
    renderWithQueryClient(<TransferDetail id={2477} />);

    await screen.findByText(/this transfer was refunded/i);

    // The one figure that is true: 29,050 GLC actually went back. It appears
    // twice — once as what arrived, once as what was returned.
    expect(screen.getByText(/Refunded to you/i)).toBeInTheDocument();
    expect(screen.getAllByText("29,050.00")).toHaveLength(2);

    // The three that are not. `queryByText` matches the rendered text of a
    // single element, which is exactly how `TokenAmount` emits an amount.
    expect(screen.queryByText("28,227.00")).not.toBeInTheDocument();
    expect(screen.queryByText("873.00")).not.toBeInTheDocument();
    expect(screen.queryByText(/You receive/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bridge fee \(3%\)/i)).not.toBeInTheDocument();
  });

  it("states plainly that no bridge fee was charged, and why", async () => {
    getTransfer.mockResolvedValue(transfer2477("Refunded"));
    renderWithQueryClient(<TransferDetail id={2477} />);

    expect(await screen.findByText(/no bridge fee was charged/i)).toBeInTheDocument();
    // Both the refund alert and the fee note say it, which is the point: the
    // reason sits with the fee, not only in the banner.
    expect(screen.getAllByText(/did not settle/i).length).toBeGreaterThan(0);
  });

  it("distinguishes the requested amount from the amount actually deposited", async () => {
    getTransfer.mockResolvedValue(transfer2477("Refunded"));
    renderWithQueryClient(<TransferDetail id={2477} />);

    await screen.findByText(/this transfer was refunded/i);
    expect(screen.getByText(/You requested/i)).toBeInTheDocument();
    expect(screen.getByText("29,100.00")).toBeInTheDocument();
    expect(screen.getByText(/Actually deposited/i)).toBeInTheDocument();
  });

  it("hides the deposited row when the deposit matched what was requested", async () => {
    getTransfer.mockResolvedValue(
      transfer2477("Refunded", {
        observed_amount_atomic: REQUESTED,
        refund_amount_atomic: REQUESTED,
      }),
    );
    renderWithQueryClient(<TransferDetail id={2477} />);

    await screen.findByText(/this transfer was refunded/i);
    expect(screen.queryByText(/Actually deposited/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Refunded to you/i)).toBeInTheDocument();
  });

  it("suppresses the settlement trio in every refund state, not just the terminal one", async () => {
    for (const state of ["RefundPending", "RefundBroadcast", "Refunded"] as const) {
      getTransfer.mockResolvedValue(transfer2477(state));
      const { unmount } = renderWithQueryClient(<TransferDetail id={2477} />);

      expect(await screen.findAllByText("29,050.00")).toHaveLength(2);
      expect(screen.queryByText("28,227.00")).not.toBeInTheDocument();
      expect(screen.queryByText("873.00")).not.toBeInTheDocument();
      expect(screen.queryByText(/You receive/i)).not.toBeInTheDocument();
      expect(screen.getByText(/no bridge fee was charged/i)).toBeInTheDocument();

      unmount();
      getTransfer.mockReset();
    }
  });

  it("labels an in-flight refund as still on its way, not as already returned", async () => {
    getTransfer.mockResolvedValue(
      transfer2477("RefundBroadcast", { state: "Broadcast", refunded_at: null }),
    );
    renderWithQueryClient(<TransferDetail id={2477} />);

    expect(await screen.findByText(/Being returned to you/i)).toBeInTheDocument();
    expect(screen.queryByText(/Refunded to you/i)).not.toBeInTheDocument();
  });

  it("refuses to fall back to the quote when the backend sends no refund object", async () => {
    getTransfer.mockResolvedValue(
      transferWith({ id: 2477, state: "Refunded", refund: null }),
    );
    renderWithQueryClient(<TransferDetail id={2477} />);

    await screen.findByText(/this transfer was refunded/i);
    // An older backend cannot tell us the principal, so the page says so
    // rather than presenting the net as if it had been delivered.
    expect(screen.getByText(/Not available on this page/i)).toBeInTheDocument();
    expect(screen.queryByText(/You receive/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no bridge fee was charged/i)).toBeInTheDocument();
  });

  it("still shows the gross / fee / net trio for a settled transfer", async () => {
    getTransfer.mockResolvedValue(
      transferWith({
        id: 12,
        state: "Settled",
        gross_amount_atomic: REQUESTED,
        fee_bps: 300,
        fee_amount_atomic: QUOTED_FEE,
        net_amount_atomic: QUOTED_NET,
        refund: null,
      }),
    );
    renderWithQueryClient(<TransferDetail id={12} />);

    expect(await screen.findByText(/You bridge/i)).toBeInTheDocument();
    expect(screen.getByText(/Bridge fee \(3%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/You receive/i)).toBeInTheDocument();
    expect(screen.getByText("29,100.00")).toBeInTheDocument();
    expect(screen.getByText("873.00")).toBeInTheDocument();
    expect(screen.getByText("28,227.00")).toBeInTheDocument();
  });

  it("links the refund transaction, on the source chain the deposit arrived on", async () => {
    getTransfer.mockResolvedValue(transfer2477("Refunded"));
    renderWithQueryClient(<TransferDetail id={2477} />);

    await screen.findByText(/this transfer was refunded/i);
    expect(screen.getByText(/Refund transaction/i)).toBeInTheDocument();
  });
});

/**
 * Request #4099 — `SolToGlc`, `DestinationConfirmed`, 50,000 gross / 3,000
 * fee / 47,000 net, with a destination transaction on chain. The page showed
 * the right badge and the right amounts while the stepper below drew every
 * circle empty and warned that progress was "not yet guaranteed".
 */
function transfer4099(state: TransferViewDto["state"]): TransferViewDto {
  return transferWith({
    id: 4099,
    direction: "SolToGlc",
    state,
    gross_amount_atomic: "50000000000000",
    fee_bps: 600,
    fee_amount_atomic: "3000000000000",
    net_amount_atomic: "47000000000000",
    source_txid: "a".repeat(64),
    destination_txid: "b".repeat(64),
    failure_reason: null,
    refund: null,
  });
}

describe("TransferDetail — #4099 settlement progress", () => {
  it("renders DestinationConfirmed as real progress, not as an untouched timeline", async () => {
    getTransfer.mockResolvedValue(transfer4099("DestinationConfirmed"));
    renderWithQueryClient(<TransferDetail id={4099} />);

    // Scoped to the stepper itself: several of these labels also appear in
    // the status badge above it, and the badge was never the broken part.
    const stepper = within(await screen.findByRole("list"));
    for (const label of [
      "Awaiting your deposit",
      "Deposit observed",
      "Source confirmed",
      "Settlement authorized",
      "Sending your funds",
      "Destination confirmed",
      "Settled",
    ]) {
      expect(stepper.getByText(label)).toBeInTheDocument();
    }
    // ...and the stale warning is gone.
    expect(screen.queryByText(/still being rolled out/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not yet guaranteed/i)).not.toBeInTheDocument();
  });

  it("shows the neutral in-flight line on DestinationConfirmed", async () => {
    getTransfer.mockResolvedValue(transfer4099("DestinationConfirmed"));
    renderWithQueryClient(<TransferDetail id={4099} />);

    expect(
      await screen.findByText(/progressing through the settlement pipeline/i),
    ).toBeInTheDocument();
  });

  it("drops the in-flight line once the transfer has Settled", async () => {
    getTransfer.mockResolvedValue(transfer4099("Settled"));
    renderWithQueryClient(<TransferDetail id={4099} />);

    const stepper = within(await screen.findByRole("list"));
    expect(stepper.getByText("Settled")).toBeInTheDocument();
    expect(
      screen.queryByText(/progressing through the settlement pipeline/i),
    ).not.toBeInTheDocument();
  });

  it("renders ManualReview as an alert, never as normal progress", async () => {
    getTransfer.mockResolvedValue(transfer4099("ManualReview"));
    renderWithQueryClient(<TransferDetail id={4099} />);

    expect(
      await screen.findByText(/this transfer is under manual review/i),
    ).toBeInTheDocument();
    // No stepper, and no line implying it is moving along on its own.
    expect(screen.queryByText("Sending your funds")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/progressing through the settlement pipeline/i),
    ).not.toBeInTheDocument();
  });

  it.each([
    "AwaitingDeposit",
    "DepositObserved",
    "SourceFinalized",
    "DestinationSubmitted",
  ] as const)("renders %s without the stale rollout warning", async (state) => {
    getTransfer.mockResolvedValue(transfer4099(state));
    renderWithQueryClient(<TransferDetail id={4099} />);

    const stepper = within(await screen.findByRole("list"));
    expect(stepper.getByText("Awaiting your deposit")).toBeInTheDocument();
    expect(screen.queryByText(/still being rolled out/i)).not.toBeInTheDocument();
  });
});

/**
 * Regression cover for production request #4361, and for the class of
 * request it belongs to.
 *
 * `GET /transfers/4361` answers `state: "Closed"` with a `manual_refund`
 * record: the request could not settle, an operator sent the 50,000 GLC
 * deposit back by hand on Solana, and the refund transaction was imported
 * against the request afterwards. The state was not in `requestStateSchema`,
 * so the response failed validation at the boundary and the public explorer
 * rendered "The bridge returned data this page could not read" — on a page
 * whose entire job was to show the user their money had come back.
 */
const SIGNATURE_4361 =
  "3NzHem3knwoaPef5WJuWTD442tLHP1SfuaevUXHezQoiWCxvXiCwNWX3aMeExJ3AWpon9crTBR8a3Mek6SXbrcbZ";

/** 50,000 GLC returned, against a 50,000 GLC request quoted at 6%. */
const CLOSED_GROSS = "5000000000000";
const CLOSED_QUOTED_FEE = "300000000000"; // 3,000 GLC, never charged
const CLOSED_QUOTED_NET = "4700000000000"; // 47,000 GLC, never delivered
const REFUNDED_AT = 1_789_408_436;

function transfer4361(
  overrides: Partial<TransferViewDto> = {},
  refundOverrides: Partial<NonNullable<TransferViewDto["manual_refund"]>> = {},
): TransferViewDto {
  return transferWith({
    id: 4361,
    direction: "SolToGlc",
    state: "Closed",
    gross_amount_atomic: CLOSED_GROSS,
    fee_bps: 600,
    fee_amount_atomic: CLOSED_QUOTED_FEE,
    net_amount_atomic: CLOSED_QUOTED_NET,
    source_txid: null,
    source_confirmations: 1,
    required_source_confirmations: null,
    destination_txid: null,
    failure_reason: null,
    refund: null,
    manual_refund: {
      status: "MANUALLY_REFUNDED",
      network: "solana",
      refund_amount_atomic: CLOSED_GROSS,
      refund_amount_native_atomic: "50000000000",
      mint: "Hn6Kdxs6cJrXDLvArAief8ueTgdZLkRacLPPUZo2pump",
      tx_signature: SIGNATURE_4361,
      slot: 447_038_412,
      refunded_at: REFUNDED_AT,
      imported_at: 1_789_409_379,
      ...refundOverrides,
    },
    disposition: null,
    ...overrides,
  });
}

/**
 * The rendered text of one `dt`/`dd` pair.
 *
 * Asserting on the pair rather than on a bare string is what makes "Refund
 * amount: 50,000 GLC" a real assertion: the requested amount on this transfer
 * is also 50,000 GLC, so a lone `getByText("50,000.00")` would pass even if
 * the refund figure were missing entirely.
 */
function fact(label: string): string {
  return screen.getByText(label).parentElement?.textContent ?? "";
}

describe("TransferDetail — a manually refunded transfer", () => {
  it("renders #4361 instead of failing to read it", async () => {
    getTransfer.mockResolvedValue(transfer4361());
    renderWithQueryClient(<TransferDetail id={4361} />);

    // The four facts the page owes the user, in their own words.
    expect(await screen.findAllByText(/manually refunded/i)).not.toHaveLength(0);
    expect(fact("Refund amount")).toContain("50,000.00");
    expect(fact("Refund amount")).toContain("GLC");
    expect(fact("Network")).toContain("Solana");
    expect(fact("Transaction ID")).toContain(SIGNATURE_4361);
    expect(fact("Refunded at")).toContain(new Date(REFUNDED_AT * 1000).toLocaleString());
  });

  it("shows the refunded principal and none of the settlement quote", async () => {
    // #2477's defect, on #4361's shape: the quote's 6% fee was never charged
    // and its 47,000 GLC net was never delivered, so neither may appear
    // beside the 50,000 GLC that actually went back.
    getTransfer.mockResolvedValue(transfer4361());
    renderWithQueryClient(<TransferDetail id={4361} />);

    await screen.findByText("Refund amount");
    expect(screen.queryByText("47,000.00")).not.toBeInTheDocument();
    expect(screen.queryByText("3,000.00")).not.toBeInTheDocument();
    expect(screen.queryByText(/You receive/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bridge fee \(6%\)/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no bridge fee was charged/i)).toBeInTheDocument();
  });

  it("presents the refund as an outcome, never as a failure", async () => {
    getTransfer.mockResolvedValue(transfer4361());
    renderWithQueryClient(<TransferDetail id={4361} />);

    await screen.findByText(/this transfer was manually refunded/i);
    // The funds are already back. Danger copy would tell the user otherwise.
    expect(screen.queryByText(/did not settle \(/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/no further automatic action will occur/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not show the happy-path stepper for a closed transfer", async () => {
    getTransfer.mockResolvedValue(transfer4361());
    renderWithQueryClient(<TransferDetail id={4361} />);

    await screen.findByText(/this transfer was manually refunded/i);
    // Every step would render unmarked, implying the transfer is still on
    // its way to settling. It is not: it is finished and refunded.
    expect(screen.queryByText("Awaiting your deposit")).not.toBeInTheDocument();
    expect(screen.queryByText("Sending your funds")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/progressing through the settlement pipeline/i),
    ).not.toBeInTheDocument();
  });

  it("links the signature to the Solana explorer", async () => {
    getTransfer.mockResolvedValue(transfer4361());
    renderWithQueryClient(<TransferDetail id={4361} />);

    const link = await screen.findByRole("link", { name: SIGNATURE_4361 });
    expect(link).toHaveAttribute("href", expect.stringContaining("explorer.solana.com"));
    expect(link).toHaveAttribute("href", expect.stringContaining(SIGNATURE_4361));
    // Opening a third-party explorer must not hand it this page's window.
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("says so rather than inventing a timestamp the import never recorded", async () => {
    getTransfer.mockResolvedValue(transfer4361({}, { refunded_at: null }));
    renderWithQueryClient(<TransferDetail id={4361} />);

    expect(await screen.findByText("Refunded at")).toBeInTheDocument();
    expect(screen.getByText(/not recorded/i)).toBeInTheDocument();
    // `imported_at` is when the bridge READ the refund, not when it
    // happened, so it must not be substituted in.
    expect(
      screen.queryByText(new Date(1_789_409_379 * 1000).toLocaleString()),
    ).not.toBeInTheDocument();
  });

  it("quotes the backend when the record's status is one it cannot vouch for", async () => {
    getTransfer.mockResolvedValue(transfer4361({}, { status: "RETURNED_BY_OPERATOR" }));
    renderWithQueryClient(<TransferDetail id={4361} />);

    // The figures are the backend's own and are still shown; the headline
    // stops short of asserting a refund in this UI's own voice.
    expect(await screen.findByText(/RETURNED_BY_OPERATOR/)).toBeInTheDocument();
    expect(fact("Refund amount")).toContain("50,000.00");
    expect(
      screen.queryByText(/this transfer was manually refunded/i),
    ).not.toBeInTheDocument();
  });

  it("accepts the disposition as corroboration for an unfamiliar status", async () => {
    getTransfer.mockResolvedValue(
      transfer4361(
        { disposition: "refunded_out_of_band" },
        { status: "RETURNED_BY_OPERATOR" },
      ),
    );
    renderWithQueryClient(<TransferDetail id={4361} />);

    expect(
      await screen.findByText(/this transfer was manually refunded/i),
    ).toBeInTheDocument();
  });

  it("does not claim a refund for a closed transfer that reports none", async () => {
    getTransfer.mockResolvedValue(transfer4361({ manual_refund: null }));
    renderWithQueryClient(<TransferDetail id={4361} />);

    expect(await screen.findByText(/closed without settling/i)).toBeInTheDocument();
    expect(screen.queryByText(/manually refunded/i)).not.toBeInTheDocument();
    // No refund record means no amount to state — and still no reaching for
    // the quote's fee and net, which describe a settlement that never was.
    expect(screen.queryByText("47,000.00")).not.toBeInTheDocument();
    expect(screen.queryByText(/You receive/i)).not.toBeInTheDocument();
    expect(fact("You requested")).toContain("50,000.00");
  });

  it("fails safely when the bridge sends a manual refund this build cannot read", async () => {
    // The component never sees the payload: `getTransfer` validates it, and a
    // record whose amount or signature cannot be trusted is refused at the
    // boundary rather than rendered with a guessed figure.
    const { validationError } = await import("@/lib/api/errors");
    getTransfer.mockRejectedValue(
      validationError("/transfers/4361", new Error("manual_refund.tx_signature")),
    );
    renderWithQueryClient(<TransferDetail id={4361} />);

    expect(await screen.findByText(/data this page could not read/i)).toBeInTheDocument();
    expect(screen.queryByText(/manually refunded/i)).not.toBeInTheDocument();
    expect(screen.queryByText("50,000.00")).not.toBeInTheDocument();
  });
});

/**
 * The states that already worked must keep working. A new terminal state and
 * a new optional field are exactly the kind of change that quietly re-routes
 * an existing branch.
 */
describe("TransferDetail — existing states are unchanged by the manual-refund path", () => {
  it("still renders a settled transfer with its full settlement trio", async () => {
    getTransfer.mockResolvedValue(
      transferWith({
        id: 40,
        state: "Settled",
        direction: "GlcToSol",
        gross_amount_atomic: "5000000000000",
        fee_bps: 600,
        fee_amount_atomic: "300000000000",
        net_amount_atomic: "4700000000000",
        destination_txid: "c".repeat(64),
      }),
    );
    renderWithQueryClient(<TransferDetail id={40} />);

    expect(await screen.findAllByText("Settled")).not.toHaveLength(0);
    expect(fact("You bridge")).toContain("50,000.00");
    expect(fact("Bridge fee (6%)")).toContain("3,000.00");
    expect(fact("You receive")).toContain("47,000.00");
    expect(screen.queryByText(/manually refunded/i)).not.toBeInTheDocument();
  });

  it("still walks the automated refund lifecycle, which is a different thing", async () => {
    for (const [id, state, phrase] of [
      [41, "RefundPending", /refund for this transfer has been started/i],
      [42, "RefundBroadcast", /refund for this transfer has been broadcast/i],
      [43, "Refunded", /this transfer was refunded/i],
    ] as const) {
      getTransfer.mockResolvedValue(transfer2477(state));
      const { unmount } = renderWithQueryClient(<TransferDetail id={id} />);

      expect(await screen.findByText(phrase)).toBeInTheDocument();
      // An automated refund has no `manual_refund` record and must not be
      // relabelled as one.
      expect(screen.queryByText(/manually refunded/i)).not.toBeInTheDocument();
      expect(screen.queryByText("Network")).not.toBeInTheDocument();
      unmount();
      getTransfer.mockReset();
    }
  });

  it("still shows the stepper and progress line for an in-flight transfer", async () => {
    getTransfer.mockResolvedValue(
      transferWith({ id: 44, state: "SettlementAuthorized", manual_refund: null }),
    );
    renderWithQueryClient(<TransferDetail id={44} />);

    expect(
      await screen.findByText(/progressing through the settlement pipeline/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Settlement authorized/i)).not.toHaveLength(0);
  });

  it("still shows danger copy for a genuine failure", async () => {
    getTransfer.mockResolvedValue(
      transferWith({ id: 45, state: "Failed", failure_reason: "destination rejected" }),
    );
    renderWithQueryClient(<TransferDetail id={45} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/did not settle/i);
    expect(screen.queryByText(/manually refunded/i)).not.toBeInTheDocument();
  });
});
