import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ContentPage, ContentSection } from "@/components/content/ContentPage";
import { FAQ_ENTRIES, type FaqId } from "@/lib/content/faq";
import { routes } from "@/lib/config/links";

export const metadata: Metadata = { title: "FAQ" };

/**
 * The answers.
 *
 * Keyed by `FaqId`, so a question added to the catalogue without an answer
 * here is a compile error rather than an empty section — and the help
 * widget's shortcut into that section cannot land on nothing.
 *
 * Every answer defers to the surface that actually knows: the transfer's own
 * page for one transfer, the bridge form for live limits, the status page for
 * the bridge as a whole. This page states how the bridge behaves; it never
 * restates a figure that the backend owns.
 */
const ANSWERS: Record<FaqId, ReactNode> = {
  "does-the-bridge-create-new-glc": (
    <p>
      No. This bridge never creates new GLC or changes its supply. A transfer releases
      existing GLC from a pre-funded reserve on the destination network after verifying
      your deposit on the source network.
    </p>
  ),
  "what-is-the-fee": (
    <p>
      A flat 3% of the gross amount, computed by the bridge backend on every quote and
      transfer. Network fees are separate. See{" "}
      <a href={routes.fees} className="underline underline-offset-2">
        fees &amp; limits
      </a>{" "}
      for the minimums and maximums that apply.
    </p>
  ),
  "where-are-my-funds": (
    <>
      <p>
        Every transfer has its own page, and that page is the record — it shows the state
        the backend reports, what it means for your funds, and the source and destination
        transactions once they exist.
      </p>
      <p>
        Until a transfer settles, your funds are either still on the source network, in
        the deposit address that request was given, or observed by the bridge and waiting
        on confirmations. Open{" "}
        <a href={routes.activity} className="underline underline-offset-2">
          activity
        </a>{" "}
        to find your transfers, or go straight to a transfer&apos;s page if you have its
        id.
      </p>
    </>
  ),
  "why-is-my-transfer-pending": (
    <>
      <p>
        Open the transfer&apos;s own page for its current state and what it means for your
        funds. A transfer under manual review or awaiting confirmations is not lost —
        check back, or contact support with the transfer id.
      </p>
      <p>
        A problem affecting every transfer in a direction — a paused direction, a backend
        that is degraded — shows on{" "}
        <a href={routes.status} className="underline underline-offset-2">
          bridge status
        </a>{" "}
        rather than on your transfer.
      </p>
    </>
  ),
  "how-many-confirmations-are-required": (
    <p>
      The bridge backend sets the number, and it differs by direction — this site does not
      choose it and does not hardcode it. While a deposit is confirming, the
      transfer&apos;s own page shows the live count as &ldquo;x of y confirmations&rdquo;.
      A deposit made from Solana has no confirmation ramp of this kind: it moves straight
      to source-confirmed once the network has finalised it.
    </p>
  ),
  "what-happens-if-i-send-the-wrong-amount": (
    <p>
      Send the exact amount the request was created for. A deposit that does not match it
      cannot settle automatically, so it is routed to manual review and the deposit is
      returned to where it came from. The transfer&apos;s own page shows what actually
      arrived and what was returned; contact support with the transfer id if it has not
      moved.
    </p>
  ),
  "why-was-my-transfer-refunded": (
    <>
      <p>
        A refund is how the bridge returns a deposit it cannot settle — a mismatched
        deposit amount, or any other condition that sends a request to manual review. It
        is a completed outcome, not a failure: your funds came back.
      </p>
      <p>
        The quote a refunded request was created under describes a settlement that never
        happened, so it says nothing about what you got back. The transfer&apos;s own page
        shows the amount actually returned, the fee actually charged, and the refund
        transaction, all read from the bridge&apos;s own refund record.
      </p>
    </>
  ),
  "why-was-my-transfer-refused": (
    <p>
      The most common reasons are an amount outside the published minimum/maximum, the
      destination direction being paused, or the destination reserve not having enough
      available capacity right now. The bridge form states which one applies before you
      submit.
    </p>
  ),
  "can-i-send-directly-to-an-exchange": (
    <p>
      You can, but you should not. Many exchanges do not credit bridge payouts, and funds
      sent to an address that does not accept them cannot be recovered by the bridge or by
      us. The bridge cannot tell an exchange deposit address from a personal one, so it
      warns rather than blocks. Use a wallet you control, and move the coins to an
      exchange yourself once the payout arrives.
    </p>
  ),
};

export default function FaqPage() {
  return (
    <ContentPage
      title="Frequently asked questions"
      sections={FAQ_ENTRIES.map((entry) => entry.question)}
    >
      {FAQ_ENTRIES.map((entry) => (
        <ContentSection key={entry.id} id={entry.id} title={entry.question}>
          {ANSWERS[entry.id]}
        </ContentSection>
      ))}
    </ContentPage>
  );
}
