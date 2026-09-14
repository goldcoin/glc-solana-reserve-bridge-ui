"use client";

import {
  AddressCompact,
  Alert,
  Card,
  CopyButton,
  ErrorState,
  Skeleton,
  StatusBadge,
  TokenAmount,
} from "@/components/ui";
import { useTransfer } from "@/lib/query/hooks";
import { manuallyRefundedStatus, requestStateStatus } from "@/lib/status";
import {
  routeDisplay,
  displayDescriptorFor,
  isClosedState,
  isFailureState,
  isManualReview,
  isManuallyRefunded,
  isRefundState,
  isInFlightState,
  manualRefundOf,
} from "@/lib/bridge";
import type { RefundState } from "@/lib/bridge";
import type { ManualRefundViewDto, TransferViewDto } from "@/lib/api/schemas/transfer";
import { chainTxUrl, solanaTxUrlOrDefault } from "@/lib/config/links";
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";
import { TransferStepper } from "./TransferStepper";

/**
 * `TransferView`'s `gross_amount_atomic`/`fee_amount_atomic`/
 * `net_amount_atomic` are all the ledger's own canonical accounting unit
 * (Goldcoin's 8 decimals, docs/20-bridge-fee.md) regardless of direction —
 * unlike `QuoteOutput`, this endpoint has no per-direction
 * source/destination decimals or pre-formatted display strings, so
 * formatting any of the three with the destination token's own decimals
 * (6 for Solana) understates or overstates the figure by orders of
 * magnitude. All three render at canonical decimals here; both tokens
 * already share the symbol "GLC".
 */
const CANONICAL_SYMBOL = "GLC";

/**
 * Reconstructed entirely from `GET /transfers/:id` plus the id in the URL —
 * there is no local state to lose, so this survives a reload, a device
 * switch, or a link opened days later.
 *
 * The public explorer route (`/explorer/tx/{id}`) renders this same
 * component, with nothing hidden, because `TransferView` never carries a
 * recipient address or anything else sensitive to begin with (backend
 * module doc, service/src/api.rs).
 *
 * It used to be handed a `readOnly` flag that suppressed every
 * chain-explorer link, which left the public explorer — the one surface
 * whose entire purpose is letting anyone verify a transfer independently —
 * rendering bare, unlinked hashes. Those links go to public block
 * explorers, are built from this deployment's own configured templates,
 * and disclose nothing the page is not already showing. The flag hid
 * nothing else, so it is gone rather than kept as a prop that claims a
 * restriction it does not impose.
 */
export function TransferDetail({ id }: { id: number }) {
  const query = useTransfer(id);

  if (query.isPending) {
    return (
      <Card>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-4 h-32 w-full" />
      </Card>
    );
  }

  if (query.isError) return <ErrorState error={query.error} />;

  const transfer = query.data;
  const display = routeDisplay(transfer.direction);
  const sourceChain = display.from.chain.id;
  const destinationChain = display.to.chain.id;

  // A manual refund is the backend's own imported record of a deposit
  // returned by hand — see `manualRefundViewSchema`. It replaces the
  // settlement trio and the stepper for the same reason the automated refund
  // does: a closed request settled nothing, so those three figures are the
  // quote it was created under, not an outcome.
  const manualRefund = manualRefundOf(transfer);
  const manuallyRefunded = isManuallyRefunded(transfer);
  const closed = isClosedState(transfer.state);

  return (
    <Card variant="raised" padding="lg">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-heading-2">
            {display.label} <span className="text-ink-500">#{transfer.id}</span>
          </h1>
          <div className="text-body-sm text-ink-500 mt-1 flex flex-wrap items-center gap-x-1 gap-y-1">
            <span>Created {new Date(transfer.created_at * 1000).toLocaleString()}</span>
            <CopyButton
              value={String(transfer.id)}
              label="request id"
              className="px-1.5 py-0.5"
            >
              Copy ID
            </CopyButton>
          </div>
        </div>
        <StatusBadge
          status={
            manuallyRefunded ? manuallyRefundedStatus : requestStateStatus[transfer.state]
          }
        />
      </div>

      {isFailureState(transfer.state) && (
        <Alert
          level="danger"
          title={`This transfer did not settle (${transfer.state}).`}
          funds={
            transfer.state === "InsufficientReserveAtSettlement"
              ? "Reserve capacity ran out before settlement could complete. Your deposit is not lost — contact support with this transfer id."
              : "No further automatic action will occur on this transfer. If you already deposited funds, they are not lost — contact support with this transfer id."
          }
          next="Contact support with this transfer id if you believe funds are affected."
        >
          {transfer.failure_reason && <p>{transfer.failure_reason}</p>}
        </Alert>
      )}

      {isManualReview(transfer.state) && (
        <Alert
          level="warn"
          title="This transfer is under manual review."
          funds="Your deposit has been observed. It is being reviewed before settlement continues — it is not lost."
          next="No action is needed. Check back here for updates, or contact support with this transfer id."
        >
          {transfer.failure_reason && <p>{transfer.failure_reason}</p>}
        </Alert>
      )}

      {isRefundState(transfer.state) && (
        <Alert level="info" {...refundCopy(transfer.state)}>
          {transfer.failure_reason && <p>{transfer.failure_reason}</p>}
        </Alert>
      )}

      {manualRefund !== null && (
        <Alert level="info" {...manualRefundCopy(manualRefund, manuallyRefunded)}>
          {transfer.failure_reason && <p>{transfer.failure_reason}</p>}
        </Alert>
      )}

      {/*
        Closed, with no manual-refund record to explain it. The state alone
        says the bridge stopped working the request and nothing about where
        the deposit went, so this says exactly that and sends the user to
        support — it does not reach for the settlement trio, and it does not
        guess at a refund nobody reported.
      */}
      {closed && manualRefund === null && (
        <Alert
          level="warn"
          title="This transfer was closed without settling."
          funds="The bridge is no longer working this request. It reports no refund against it here, which does not mean your deposit is lost — it means this page cannot say what happened to it."
          next="Contact support with this transfer id so the outcome can be confirmed."
        >
          {transfer.failure_reason && <p>{transfer.failure_reason}</p>}
        </Alert>
      )}

      {!isFailureState(transfer.state) &&
        !isManualReview(transfer.state) &&
        !isRefundState(transfer.state) &&
        !closed &&
        manualRefund === null && (
          <TransferStepper
            direction={transfer.direction}
            state={transfer.state}
            sourceConfirmations={transfer.source_confirmations}
            requiredSourceConfirmations={transfer.required_source_confirmations}
          />
        )}

      {/*
        A neutral progress line, and only while the transfer is actually in
        flight. It replaces a warning that told the user this part of the
        pipeline was "still being rolled out on this deployment" and that
        progress past it was "not yet guaranteed" — written when settlement
        was partly manual, left in place after automation went live, and
        shown on states as finished as `Settled`. Anything that genuinely
        needs the user's attention (failure, manual review, refund) is an
        Alert above, driven by the backend state alone.
      */}
      {isInFlightState(transfer.state) && (
        <p className="text-body-sm text-ink-500 mt-2">
          Your transfer is progressing through the settlement pipeline.
        </p>
      )}

      <dl className="border-ink-100 mt-6 grid grid-cols-3 gap-4 border-t pt-4">
        {manualRefund !== null ? (
          <ManualRefundAmounts transfer={transfer} refund={manualRefund} />
        ) : closed ? (
          <ClosedAmounts transfer={transfer} />
        ) : isRefundState(transfer.state) ? (
          <RefundAmounts transfer={transfer} />
        ) : (
          <SettlementAmounts transfer={transfer} />
        )}

        {transfer.source_txid && (
          <TxRow
            label="Source transaction"
            txid={transfer.source_txid}
            /* Resolved by the chain the transaction happened ON, never by
               the direction: a `GlcToRhn` source is a Goldcoin txid while
               its destination is an EVM hash, and a binary direction check
               would have sent one of them to the wrong explorer. */
            href={chainTxUrl(sourceChain, transfer.source_txid) ?? undefined}
          />
        )}
        {transfer.refund?.refund_txid && (
          <TxRow
            label="Refund transaction"
            txid={transfer.refund.refund_txid}
            // A refund travels back down the SOURCE chain — the one the
            // deposit arrived on — which is the opposite of the
            // destination transaction below.
            href={chainTxUrl(sourceChain, transfer.refund.refund_txid) ?? undefined}
          />
        )}
        {transfer.destination_txid && (
          <TxRow
            label="Destination transaction"
            txid={transfer.destination_txid}
            href={chainTxUrl(destinationChain, transfer.destination_txid) ?? undefined}
          />
        )}
      </dl>
    </Card>
  );
}

/**
 * The gross / fee / net trio, for a transfer that is on — or has completed —
 * the settlement path. Unchanged: for a `Settled` transfer these three are
 * exactly what happened.
 */
function SettlementAmounts({ transfer }: { transfer: TransferViewDto }) {
  return (
    <>
      <div>
        <dt className="text-body-sm text-ink-500">You bridge</dt>
        <dd>
          <TokenAmount
            raw={transfer.gross_amount_atomic}
            decimals={GOLDCOIN_DECIMALS}
            symbol={CANONICAL_SYMBOL}
          />
        </dd>
      </div>
      <div>
        <dt className="text-body-sm text-ink-500">
          Bridge fee (
          {(transfer.fee_bps / 100).toFixed(transfer.fee_bps % 100 === 0 ? 0 : 2)}%)
        </dt>
        <dd className="text-ink-600">
          <TokenAmount
            raw={transfer.fee_amount_atomic}
            decimals={GOLDCOIN_DECIMALS}
            symbol={CANONICAL_SYMBOL}
          />
        </dd>
      </div>
      <div>
        <dt className="text-body-sm text-ink-500">You receive</dt>
        <dd className="text-ink-950 font-medium">
          <TokenAmount
            raw={transfer.net_amount_atomic}
            decimals={GOLDCOIN_DECIMALS}
            symbol={CANONICAL_SYMBOL}
          />
        </dd>
      </div>
    </>
  );
}

/**
 * The amounts panel for a transfer that left the settlement path to be
 * refunded.
 *
 * A refunded request settles NOTHING: no bridge fee is charged and no
 * destination payout is made. `gross_amount_atomic`/`fee_amount_atomic`/
 * `net_amount_atomic` are the QUOTE the request was created under, so showing
 * them here shows three things that did not happen — which is exactly what
 * production request #2477 did, presenting "You bridge 29,100 GLC / Bridge fee
 * (3%) 873 GLC / You receive 28,227 GLC" for a request that was charged
 * nothing, paid out nothing, and had 29,050 GLC returned.
 *
 * So the fee and the net are not rendered at all here, and every figure that
 * IS rendered comes from `transfer.refund` — the backend's own refund row.
 * Nothing on this page derives a refund amount from the quote, from
 * `failure_reason`, or from arithmetic of its own.
 *
 * When `refund` is absent — an older backend, or a refund row the endpoint
 * could not read — the panel says so rather than falling back to the trio.
 * "We cannot show you the amount" is recoverable; a confidently wrong amount
 * is not.
 */
function RefundAmounts({ transfer }: { transfer: TransferViewDto }) {
  const refund = transfer.refund;
  // `TransferView.refund` is deliberately absent for a Robinhood-SOURCED
  // transfer: that deposit refunds on the Robinhood side, from a different
  // table in a different unit, and the backend reports no refund view at all
  // rather than mislabelling it as one of the other two
  // (`BridgeApi::refund_view`). Absent-by-design and
  // absent-because-old-backend look identical here, so the one we can
  // identify gets a real explanation.
  //
  // Read off the route's SOURCE CHAIN rather than matched against
  // `RhnToGlc`. `RhnToSol` refunds from the same contract for the same
  // reason, and a name check would have left it with the bare "Not
  // available on this page" and no explanation — the exact gap this
  // paragraph exists to close.
  const robinhoodSourced = routeDisplay(transfer.direction).from.chain.id === "robinhood";
  const requested = transfer.gross_amount_atomic;
  const deposited = refund?.observed_amount_atomic ?? null;

  // Amounts are normalised decimal strings (`atomicAmountSchema` canonicalises
  // them), so an exact string comparison IS an exact numeric comparison — no
  // BigInt round-trip needed, and no float ever involved.
  const depositDiffers = deposited !== null && deposited !== requested;
  const settled = refund !== null && refund.state === "Refunded";
  const feeWasCharged = refund !== null && refund.fee_charged_atomic !== "0";

  return (
    <>
      <div>
        <dt className="text-body-sm text-ink-500">You requested</dt>
        <dd className="text-ink-600">
          <TokenAmount
            raw={requested}
            decimals={GOLDCOIN_DECIMALS}
            symbol={CANONICAL_SYMBOL}
          />
        </dd>
      </div>

      {depositDiffers && (
        <div>
          <dt className="text-body-sm text-ink-500">Actually deposited</dt>
          <dd className="text-ink-600">
            <TokenAmount
              raw={deposited}
              decimals={GOLDCOIN_DECIMALS}
              symbol={CANONICAL_SYMBOL}
            />
          </dd>
        </div>
      )}

      <div>
        <dt className="text-body-sm text-ink-500">
          {settled ? "Refunded to you" : "Being returned to you"}
        </dt>
        <dd className="text-ink-950 font-medium">
          {refund ? (
            <TokenAmount
              raw={refund.refund_amount_atomic}
              decimals={GOLDCOIN_DECIMALS}
              symbol={CANONICAL_SYMBOL}
            />
          ) : (
            <span className="text-ink-500">Not available on this page</span>
          )}
        </dd>
      </div>

      {refund === null && robinhoodSourced && (
        <div className="col-span-3">
          <dt className="sr-only">Why the refund amount is not shown</dt>
          <dd className="text-body-sm text-ink-500">
            A Robinhood Network deposit is refunded on Robinhood Network, from the custody
            contract that holds it — a different chain and a different record from the two
            refund paths this page can read. The bridge does not publish those figures
            here yet, so this page states the refund&apos;s status and stops there rather
            than showing a number from somewhere else.
          </dd>
        </div>
      )}

      <div className="col-span-3">
        <dt className="sr-only">Bridge fee</dt>
        <dd className="text-body-sm text-ink-500">
          {feeWasCharged ? (
            <>
              A bridge fee of{" "}
              <TokenAmount
                raw={refund.fee_charged_atomic}
                decimals={GOLDCOIN_DECIMALS}
                symbol={CANONICAL_SYMBOL}
              />{" "}
              was charged on this transfer.
            </>
          ) : (
            <>
              No bridge fee was charged: this transfer did not settle, so the fee never
              applied and nothing was delivered on the destination chain.
              {depositDiffers &&
                " The amount returned is what actually arrived on chain, not the amount originally requested."}
            </>
          )}
        </dd>
      </div>
    </>
  );
}

/**
 * Refund copy, per state. A refund is not a failure — the deposit is coming
 * back — so this is an informational alert, not a danger one, and it never
 * tells the user to do something there is nothing to do about. The happy-path
 * stepper is suppressed for these states: this transfer left that path and
 * showing it with no step highlighted would imply it is still progressing
 * toward settlement.
 *
 * The destination of the refund is deliberately unnamed: `TransferView`
 * carries no refund address, so "returned to you" is the most this page can
 * say without inventing a detail.
 */
function refundCopy(state: RefundState): {
  title: string;
  funds: string;
  next: string;
} {
  switch (state) {
    case "RefundPending":
      return {
        title: "A refund for this transfer has been started.",
        funds:
          "This transfer will not settle, and your deposit is not lost — it is being returned to you.",
        next: "No action is needed. The refund transaction will appear here once it is broadcast.",
      };
    case "RefundBroadcast":
      return {
        title: "The refund for this transfer has been broadcast.",
        funds:
          "Your deposit is on its way back to you and is waiting to confirm on-chain.",
        next: "No action is needed. This page updates when the refund confirms.",
      };
    case "Refunded":
      return {
        title: "This transfer was refunded.",
        funds:
          "Your deposit has been returned to you. This transfer did not settle, and the bridge is not holding these funds.",
        next: "No action is needed. Contact support with this transfer id if the returned funds have not arrived.",
      };
  }
}

/**
 * The amounts panel for a transfer whose deposit was returned BY HAND and
 * whose request was then closed — production #4361 and the rest of that
 * import batch.
 *
 * Every figure is read off `transfer.manual_refund`, the backend's own
 * imported record. The settlement trio is not rendered at all, for the reason
 * `RefundAmounts` spells out and #4361 demonstrates: its `gross`/`fee`/`net`
 * are 50,000 / 3,000 / 47,000 GLC, the 6% fee was never charged, the 47,000
 * was never delivered, and the 50,000 below is what the depositor actually
 * got back. Showing the trio here would present three things that did not
 * happen beside one that did.
 *
 * The amount is rendered at the ledger's canonical 8 decimals like every
 * other amount on this page, NOT at the paying network's own precision. The
 * backend sends both (`refund_amount_native_atomic` is the same 50,000 GLC in
 * the SPL token's 6 decimals); rendering one figure in one unit is what stops
 * the page contradicting itself.
 */
function ManualRefundAmounts({
  transfer,
  refund,
}: {
  transfer: TransferViewDto;
  refund: ManualRefundViewDto;
}) {
  // Named from the backend's own chain id, never inferred from the route:
  // #4361 is a `SolToGlc` request refunded on Solana, its SOURCE side, so
  // anything derived from the direction's destination would print the wrong
  // network under a signature that proves otherwise. `displayDescriptorFor`
  // falls back to the raw id for a network this build cannot name, which is
  // still the backend's own word rather than a guess.
  const network = displayDescriptorFor(refund.network).name;
  const signatureUrl =
    refund.network === "solana"
      ? // Always a link: the signature is the only public evidence the money
        // came back, so it stays clickable even where this deployment has
        // configured no explorer template. See `solanaTxUrlOrDefault`.
        solanaTxUrlOrDefault(refund.tx_signature)
      : // Any other network keeps the template-driven rule: a configured
        // explorer or plain text, never a guessed host.
        (chainTxUrl(refund.network, refund.tx_signature) ?? undefined);

  return (
    <>
      <div>
        <dt className="text-body-sm text-ink-500">You requested</dt>
        <dd className="text-ink-600">
          <TokenAmount
            raw={transfer.gross_amount_atomic}
            decimals={GOLDCOIN_DECIMALS}
            symbol={CANONICAL_SYMBOL}
          />
        </dd>
      </div>

      <div>
        <dt className="text-body-sm text-ink-500">Refund amount</dt>
        <dd className="text-ink-950 font-medium">
          <TokenAmount
            raw={refund.refund_amount_atomic}
            decimals={GOLDCOIN_DECIMALS}
            symbol={CANONICAL_SYMBOL}
          />
        </dd>
      </div>

      <div>
        <dt className="text-body-sm text-ink-500">Network</dt>
        <dd className="text-ink-950 font-medium">{network}</dd>
      </div>

      <div className="border-ink-100 col-span-3 border-t pt-4">
        <dt className="text-body-sm text-ink-500">Transaction ID</dt>
        <dd className="mt-0.5 flex flex-wrap items-center justify-between gap-2">
          {signatureUrl ? (
            <a
              href={signatureUrl}
              target="_blank"
              rel="noreferrer"
              className="decoration-ink-300 hover:decoration-ink-600 underline underline-offset-2"
            >
              <AddressCompact address={refund.tx_signature} lead={10} tail={8} />
            </a>
          ) : (
            <AddressCompact address={refund.tx_signature} lead={10} tail={8} />
          )}
          <CopyButton value={refund.tx_signature} label="refund transaction id" />
        </dd>
      </div>

      <div className="col-span-3">
        <dt className="text-body-sm text-ink-500">Refunded at</dt>
        <dd className="text-ink-950">
          {refund.refunded_at === null ? (
            // The refund is recorded and its transaction is named; only the
            // timestamp is missing. Saying so beats printing the epoch, and
            // beats substituting `imported_at`, which is when the bridge
            // read the refund rather than when the refund happened.
            <span className="text-ink-500">Not recorded</span>
          ) : (
            <time dateTime={new Date(refund.refunded_at * 1000).toISOString()}>
              {new Date(refund.refunded_at * 1000).toLocaleString()}
            </time>
          )}
        </dd>
      </div>

      <div className="col-span-3">
        <dt className="sr-only">Bridge fee</dt>
        <dd className="text-body-sm text-ink-500">
          No bridge fee was charged: this transfer did not settle, so the fee never
          applied and nothing was delivered on the destination chain.
        </dd>
      </div>
    </>
  );
}

/**
 * A `Closed` transfer with no manual-refund record attached.
 *
 * Shows the amount the request was created for and nothing else. The fee and
 * the net belong to a settlement that did not happen, and there is no refund
 * record to put in their place, so the panel states what it knows and stops —
 * the same rule `RefundAmounts` applies when `refund` is absent.
 */
function ClosedAmounts({ transfer }: { transfer: TransferViewDto }) {
  return (
    <>
      <div>
        <dt className="text-body-sm text-ink-500">You requested</dt>
        <dd className="text-ink-600">
          <TokenAmount
            raw={transfer.gross_amount_atomic}
            decimals={GOLDCOIN_DECIMALS}
            symbol={CANONICAL_SYMBOL}
          />
        </dd>
      </div>

      <div className="col-span-3">
        <dt className="sr-only">Outcome</dt>
        <dd className="text-body-sm text-ink-500">
          No bridge fee was charged and nothing was delivered on the destination chain:
          this request never reached settlement. The bridge publishes no refund record
          against it here either.
        </dd>
      </div>
    </>
  );
}

/**
 * Alert copy for a manual refund.
 *
 * Informational, never a danger alert: the user's deposit came back, which is
 * a completed outcome rather than a failure — the same call `refundCopy`
 * makes for the automated refund lifecycle.
 *
 * `recognised` is false when the record carries a `status` this build has
 * never seen and no `refunded_out_of_band` disposition to corroborate it. The
 * figures are still the backend's own and are still shown, but the headline
 * quotes the backend rather than putting words in its mouth — the same
 * treatment `requestStateDescriptor` gives an unrecognised state name.
 */
function manualRefundCopy(
  refund: ManualRefundViewDto,
  recognised: boolean,
): { title: string; funds: string; next: string } {
  return {
    title: recognised
      ? "This transfer was manually refunded."
      : `This transfer was closed with a refund record (${refund.status}).`,
    funds:
      "Your deposit was returned to you directly, outside the bridge's automatic refund path. This transfer did not settle, and the bridge is not holding these funds.",
    next: "No action is needed. The refund transaction below can be checked on chain; contact support with this transfer id if the returned funds have not arrived.",
  };
}

function TxRow({
  label,
  txid,
  href,
}: {
  label: string;
  txid: string;
  href?: string | undefined;
}) {
  return (
    // `dt`/`dd` are direct children of this div — a dl's only valid
    // wrapping div is one that contains nothing but its dt/dd pairs
    // (axe's `dlitem` rule), so the copy button sits in its own row below
    // rather than nesting another div around just the text pair.
    <div className="border-ink-100 col-span-3 border-t pt-4">
      <dt className="text-body-sm text-ink-500">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-center justify-between gap-2">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="decoration-ink-300 hover:decoration-ink-600 underline underline-offset-2"
          >
            <AddressCompact address={txid} lead={10} tail={8} />
          </a>
        ) : (
          <AddressCompact address={txid} lead={10} tail={8} />
        )}
        <CopyButton value={txid} label={label.toLowerCase()} />
      </dd>
    </div>
  );
}
