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
import { requestStateStatus } from "@/lib/status";
import {
  routeDisplay,
  isFailureState,
  isManualReview,
  isRefundState,
  isUnexercisedState,
} from "@/lib/bridge";
import type { RefundState } from "@/lib/bridge";
import type { TransferViewDto } from "@/lib/api/schemas/transfer";
import { chainTxUrl } from "@/lib/config/links";
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
 * `readOnly` is used by the public explorer route: it is the same component
 * with nothing hidden, because `TransferView` never carries a recipient
 * address or anything else sensitive to begin with (backend module doc,
 * service/src/api.rs).
 */
export function TransferDetail({
  id,
  readOnly = false,
}: {
  id: number;
  readOnly?: boolean;
}) {
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
        <StatusBadge status={requestStateStatus[transfer.state]} />
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

      {!isFailureState(transfer.state) &&
        !isManualReview(transfer.state) &&
        !isRefundState(transfer.state) && (
          <TransferStepper
            direction={transfer.direction}
            state={transfer.state}
            sourceConfirmations={transfer.source_confirmations}
            requiredSourceConfirmations={transfer.required_source_confirmations}
          />
        )}

      {isUnexercisedState(transfer.state) && (
        <p className="text-body-sm text-ink-500 mt-2">
          This state is part of the settlement pipeline that is still being rolled out on
          this deployment — the transfer is real and being tracked, but automatic progress
          past this point is not yet guaranteed.
        </p>
      )}

      <dl className="border-ink-100 mt-6 grid grid-cols-3 gap-4 border-t pt-4">
        {isRefundState(transfer.state) ? (
          <RefundAmounts transfer={transfer} />
        ) : (
          <SettlementAmounts transfer={transfer} />
        )}

        {transfer.source_txid && (
          <TxRow
            label="Source transaction"
            txid={transfer.source_txid}
            href={
              readOnly
                ? undefined
                : (chainTxUrl(sourceChain, transfer.source_txid) ?? undefined)
            }
          />
        )}
        {transfer.refund?.refund_txid && (
          <TxRow
            label="Refund transaction"
            txid={transfer.refund.refund_txid}
            href={
              readOnly
                ? undefined
                : // A refund travels back down the SOURCE chain — the one the
                  // deposit arrived on — which is the opposite of the
                  // destination transaction below.
                  (chainTxUrl(sourceChain, transfer.refund.refund_txid) ?? undefined)
            }
          />
        )}
        {transfer.destination_txid && (
          <TxRow
            label="Destination transaction"
            txid={transfer.destination_txid}
            href={
              readOnly
                ? undefined
                : (chainTxUrl(destinationChain, transfer.destination_txid) ?? undefined)
            }
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
  // `TransferView.refund` is deliberately absent for `RhnToGlc`: that
  // deposit refunds on the Robinhood side, from a different table in a
  // different unit, and the backend reports no refund view at all rather
  // than mislabelling it as one of the other two (`BridgeApi::refund_view`).
  // Absent-by-design and absent-because-old-backend look identical here, so
  // the one we can identify gets a real explanation.
  const robinhoodSourced = transfer.direction === "RhnToGlc";
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
