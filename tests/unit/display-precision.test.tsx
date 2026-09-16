import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderWithQueryClient } from "./test-utils";
import { TokenAmount } from "@/components/ui/TokenAmount";
import { BridgeOverviewStats } from "@/features/explorer/BridgeOverviewStats";
import { ReservesView } from "@/features/reserves/ReservesView";
import { StatusView } from "@/features/status/StatusView";
import { TransferDetail } from "@/features/transfer/TransferDetail";
import { TransferRow } from "@/features/activity/TransferRow";
import { RouteSummary } from "@/features/bridge/RouteSummary";
import { descriptorFor } from "@/lib/bridge";
import { DepositInstructions } from "@/features/bridge/DepositInstructions";
import * as fixtures from "@/lib/api/mock/fixtures";
import type { QuoteOutputDto } from "@/lib/api/schemas/quote";
import type { TransferViewDto } from "@/lib/api/schemas/transfer";

/**
 * Displayed GLC precision.
 *
 * The reported defect: an explorer summary card read
 * `96,218,058.29927559 GLC`. Eight decimals on a headline figure is eight
 * digits a reader has to look past to find the magnitude they came for.
 *
 * Every surface below now shows exactly two places. What none of them do is
 * change the value: the atomic amount rendered is the exact string the API
 * returned, and the surfaces where a person acts on a figure literally — the
 * deposit amount, the published limits, a spendable balance — still show
 * every digit. These tests pin both halves, because a fix that quietly
 * rounded a deposit instruction would be worse than the defect.
 */

/** The reported figure, as 8-decimal Goldcoin base units. */
const REPORTED_ATOMIC = "9621805829927559";
/** The same figure as 6-decimal Solana mint base units. */
const REPORTED_MINT_ATOMIC = "96218058299275";
const REPORTED_DISPLAY = "96,218,058.30";

const getStats = vi.fn();
const getChains = vi.fn();
const getReserve = vi.fn();
const getStatus = vi.fn();
const getHealth = vi.fn();
const getTransfer = vi.fn();
const listReserveHistory = vi.fn();

vi.mock("@/lib/api", async () => ({
  // The real error factories: BridgeForm imports them by name, and a
  // partial mock of this module would leave them undefined.
  ...(await import("@/lib/api/errors")),
  bridgeApi: {
    getStats: (...args: unknown[]) => getStats(...args),
    getChains: (...args: unknown[]) => getChains(...args),
    getReserve: (...args: unknown[]) => getReserve(...args),
    getStatus: (...args: unknown[]) => getStatus(...args),
    getHealth: (...args: unknown[]) => getHealth(...args),
    getTransfer: (...args: unknown[]) => getTransfer(...args),
    listReserveHistory: (...args: unknown[]) => listReserveHistory(...args),
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  listReserveHistory.mockResolvedValue({ items: [], next_cursor: null, as_of: 0 });
  // The explorer summary reads its route families from `GET /chains` — the
  // settled figures are grouped by the reserve each executable route pays
  // out of, which is the granularity `/stats` publishes.
  getChains.mockResolvedValue(fixtures.chainsFixture(() => new Date()));
});

describe("TokenAmount", () => {
  it("shows two decimal places by default, so a new call site cannot regress", () => {
    render(<TokenAmount raw={REPORTED_ATOMIC} decimals={8} symbol="GLC" />);
    expect(screen.getByText(REPORTED_DISPLAY, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/29927559/)).not.toBeInTheDocument();
  });

  it("pads and groups: 29,100 GLC reads as 29,100.00, and zero as 0.00", () => {
    const { rerender } = render(
      <TokenAmount raw="2910000000000" decimals={8} symbol="GLC" />,
    );
    expect(screen.getByText("29,100.00", { exact: false })).toBeInTheDocument();

    rerender(<TokenAmount raw="0" decimals={8} symbol="GLC" />);
    expect(screen.getByText("0.00", { exact: false })).toBeInTheDocument();
  });

  it("still renders every digit when a call site asks for exact precision", () => {
    render(
      <TokenAmount raw={REPORTED_ATOMIC} decimals={8} symbol="GLC" precision="exact" />,
    );
    expect(screen.getByText(/96,218,058\.29927559/)).toBeInTheDocument();
  });

  it("renders an unreadable amount as unavailable, never as zero", () => {
    render(<TokenAmount raw="not-an-amount" decimals={8} symbol="GLC" />);
    expect(screen.getByText(/— GLC/)).toBeInTheDocument();
  });
});

describe("Explorer summary cards", () => {
  it("shows settled volume at two places, on both the 8dp and 6dp sides", async () => {
    getStats.mockResolvedValue({
      ...fixtures.statsFixture(),
      goldcoin_reserve: {
        ...fixtures.statsFixture().goldcoin_reserve,
        settled_volume_atomic: REPORTED_ATOMIC,
      },
      solana_reserve: {
        ...fixtures.statsFixture().solana_reserve,
        settled_volume_atomic: REPORTED_MINT_ATOMIC,
      },
    });
    renderWithQueryClient(<BridgeOverviewStats />);

    expect(await screen.findAllByText(new RegExp(REPORTED_DISPLAY))).toHaveLength(2);
    expect(screen.queryByText(/29927559/)).not.toBeInTheDocument();
    expect(screen.queryByText(/299275\b/)).not.toBeInTheDocument();
  });
});

describe("Reserves", () => {
  it("shows available capacity at two places", async () => {
    getReserve.mockResolvedValue({
      goldcoin_available_capacity: REPORTED_ATOMIC,
      solana_available_capacity: REPORTED_MINT_ATOMIC,
    });
    getStats.mockResolvedValue(fixtures.statsFixture());
    renderWithQueryClient(<ReservesView />);

    expect(await screen.findAllByText(new RegExp(REPORTED_DISPLAY))).toHaveLength(2);
    expect(screen.queryByText(/29927559/)).not.toBeInTheDocument();
  });
});

describe("Status stat cards", () => {
  it("shows reserve capacity and remaining daily capacity at two places", async () => {
    getStatus.mockResolvedValue({
      ...fixtures.statusFixture(() => new Date()),
      glc_to_sol_rolling_volume_remaining: REPORTED_MINT_ATOMIC,
      sol_to_glc_rolling_volume_remaining: REPORTED_MINT_ATOMIC,
    });
    getHealth.mockResolvedValue(fixtures.healthFixture());
    getReserve.mockResolvedValue({
      goldcoin_available_capacity: REPORTED_ATOMIC,
      solana_available_capacity: REPORTED_MINT_ATOMIC,
    });
    renderWithQueryClient(<StatusView />);

    // Six, because /status carries a card for every executable route and
    // each reserve pays TWO of them, so one capacity figure legitimately
    // appears on two cards. The tally: the Solana capacity on `GlcToSol` and
    // `RhnToSol`, the Goldcoin capacity on `SolToGlc` and `RhnToGlc`, and
    // the two Solana rolling-window figures. The four Robinhood-legged
    // routes' own contract windows are absent here because this case
    // configures no Robinhood reserve — and so is the Robinhood capacity the
    // two payout legs would need.
    expect(await screen.findAllByText(new RegExp(REPORTED_DISPLAY))).toHaveLength(6);
    expect(screen.queryByText(/29927559/)).not.toBeInTheDocument();
  });
});

describe("Activity", () => {
  it("shows a transfer's gross amount at two places", () => {
    const transfer: TransferViewDto = {
      ...fixtures.transfersFixture()[0]!,
      gross_amount_atomic: REPORTED_ATOMIC,
    };
    render(<TransferRow transfer={transfer} />);

    expect(screen.getByText(new RegExp(REPORTED_DISPLAY))).toBeInTheDocument();
    expect(screen.queryByText(/29927559/)).not.toBeInTheDocument();
  });
});

describe("Transfer detail", () => {
  it("shows the gross / fee / net trio at two places", async () => {
    getTransfer.mockResolvedValue({
      ...fixtures.transfersFixture()[0]!,
      id: 7,
      state: "Settled",
      gross_amount_atomic: REPORTED_ATOMIC,
      fee_bps: 300,
      fee_amount_atomic: "288654174897", // 2,886.54174897 GLC
      net_amount_atomic: "9333151655030", // 93,331.51655030 GLC
      refund: null,
    });
    renderWithQueryClient(<TransferDetail id={7} />);

    expect(await screen.findByText(new RegExp(REPORTED_DISPLAY))).toBeInTheDocument();
    expect(screen.getByText(/2,886\.54/)).toBeInTheDocument();
    expect(screen.getByText(/93,331\.52/)).toBeInTheDocument();
    expect(screen.queryByText(/54174897/)).not.toBeInTheDocument();
  });
});

describe("Bridge quote summary", () => {
  const quote: QuoteOutputDto = {
    direction: "GlcToSol",
    gross_amount: REPORTED_ATOMIC,
    gross_display_amount: "96218058.29927559",
    fee_bps: 300,
    fee_amount: "288654174897",
    fee_display_amount: "2886.54174897",
    net_amount: "9333151655030",
    net_display_amount: "93331.51655030",
    // A live Phase 2B rate, not the Phase 2A fixed 1.0 — the summary must
    // read correctly when the two rails are far from parity, which is the
    // case the fixed rate never exercised.
    bridge_quote: {
      bridge_rate: "3.430000000000",
      source_price_e12: "155836000",
      destination_price_e12: "45416000",
      gross_in_amount: REPORTED_ATOMIC,
      gross_out_amount: "9621805829927559",
      fee_bps: 300,
      bridge_fee_amount: "288654174897",
      net_out_amount: "9333151655030",
      dust_amount: "0",
      quoted_at: 1_757_900_000,
      quote_expires_at: 1_757_900_060,
    },
    source_decimals: 8,
    destination_decimals: 6,
    source_asset: "GLC (Goldcoin)",
    destination_asset: "GLC (Solana)",
  };

  /** The summary renders whatever quote it is handed; nothing else is needed. */
  function renderSummary(data: QuoteOutputDto) {
    return render(
      <RouteSummary
        source={descriptorFor("goldcoin")!}
        destination={descriptorFor("solana")!}
        availability={{
          kind: "open",
          availabilityKnown: true,
          view: {
            id: "GlcToSol",
            source_chain: "goldcoin",
            destination_chain: "solana",
            enabled: true,
            disabled_reason: null,
            implemented: true,
            available: true,
            unavailable_reason: null,
          },
        }}
        quote={data}
        quotePending={false}
      />,
    );
  }

  it("lays out the backend's own figures at two places, with separators", () => {
    renderSummary(quote);

    expect(screen.getByText(/2,886\.54/)).toBeInTheDocument();
    expect(screen.getByText(/93,331\.52/)).toBeInTheDocument();
    // The raw atomic digits never reach the page.
    expect(screen.queryByText(/29927559/)).not.toBeInTheDocument();
  });

  it("shows a figure it cannot parse exactly as the backend sent it", () => {
    renderSummary({ ...quote, fee_display_amount: "1.0e2" });
    expect(screen.getByText(/1\.0e2/)).toBeInTheDocument();
  });

  it("states the backend's bridge rate at two places, and which way it points", () => {
    renderSummary(quote);

    expect(screen.getByText("Bridge rate")).toBeInTheDocument();
    expect(
      screen.getByText("1 GLC on Goldcoin = 3.43 GLC on Solana"),
    ).toBeInTheDocument();
    // Twelve places is an audit figure; it never reaches the page.
    expect(screen.queryByText(/3\.430000000000/)).not.toBeInTheDocument();
  });

  it("does not label the bridge fee with the SOURCE network", () => {
    renderSummary(quote);

    // The fee is `fee_out` — the DESTINATION asset (decision J-5). Calling
    // it "GLC (Goldcoin)" named an amount that exists on neither chain once
    // the rate left 1.0.
    expect(screen.queryByText(/2,886\.54 GLC \(Goldcoin\)/)).not.toBeInTheDocument();
    expect(screen.getByText(/^3% · 2,886\.54 GLC$/)).toBeInTheDocument();
  });

  it("says what arrives and on which network", () => {
    renderSummary(quote);
    expect(screen.getByText("You receive")).toBeInTheDocument();
    expect(screen.getByText("93,331.52 GLC on Solana")).toBeInTheDocument();
  });

  it("shows no rate at all when the backend sent no quote", () => {
    const { bridge_quote: _omitted, ...withoutQuote } = quote;
    renderSummary(withoutQuote);

    // A pre-v37 daemon. Falling back to "1.00" would state a rate nobody
    // struck; the row is simply absent.
    expect(screen.queryByText("Bridge rate")).not.toBeInTheDocument();
    expect(screen.queryByText(/1 GLC on Goldcoin/)).not.toBeInTheDocument();
    // The figures that do not depend on the quote still render.
    expect(screen.getByText("93,331.52 GLC on Solana")).toBeInTheDocument();
  });
});

describe("surfaces that must keep every digit", () => {
  it("the deposit instruction still states the exact amount to send", () => {
    render(
      <DepositInstructions
        depositAddress="GLCdepos1t111111111111111111111111111111"
        amountAtomic={REPORTED_ATOMIC}
      />,
    );
    // Rounding this would tell someone to send an amount the bridge is not
    // expecting, which is the one place two decimals would do real harm.
    expect(screen.getByText(/96,218,058\.29927559/)).toBeInTheDocument();
  });
});
