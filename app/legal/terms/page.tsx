import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ContentPage, ContentSection } from "@/components/content/ContentPage";
import { Alert } from "@/components/ui";
import { primaryDomain, routes } from "@/lib/config/links";
import { slugify } from "@/lib/content/toc";

/**
 * Terms of Service.
 *
 * The footer has linked at `/legal/terms` since the navigation model was
 * written; until this page existed that link 404'd, which on a page whose
 * whole job is to tell people what they agreed to is the worst possible
 * failure. Everything here is selectable HTML text — no image, no
 * truncation, no disclosure that hides a clause — because a term a reader
 * cannot copy or find is a term that is hard to argue was ever presented.
 *
 * The clause numbers are part of the headings on purpose: they are what a
 * support conversation or a dispute cites, and deriving each anchor from
 * the heading (`slugify`) is what keeps "§8" and `#8-25-abuse-and-...`
 * from ever drifting apart.
 *
 * No domain is hardcoded, per src/lib/config/env.ts: the Bridge names
 * itself by the origin this deployment was configured with.
 */

export const EFFECTIVE_DATE = "September 13, 2026";
export const LAST_UPDATED = "September 13, 2026";

/**
 * The notice the top of the page must carry, in the Alert component's
 * required order: what happened / what it means for your funds / what to
 * do next. It is repeated verbatim in §36 so that a reader who scrolled
 * past the top of the page still meets it before the end.
 */
const ABUSE_NOTICE =
  "Rapid-succession, automated, limit-evading, or other abusive bridge activity may result in Manual Review. A minimum 72-hour review period may apply, and a USD $25 service and administrative fee may be charged per affected abusive order and deducted from any otherwise eligible refund.";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms governing use of the Goldcoin Bridge: transaction handling, fees, anti-abuse and Manual Review, refunds, limits, and liability.",
  // Relative, and therefore resolved against the layout's `metadataBase`:
  // the canonical URL names the configured origin, never whichever host
  // happened to serve the response.
  alternates: { canonical: routes.terms },
  openGraph: {
    type: "article",
    url: routes.terms,
    title: "Terms of Service",
    description:
      "The terms governing use of the Goldcoin Bridge, including anti-abuse, Manual Review, and refund handling.",
  },
};

/**
 * Every heading, in document order.
 *
 * One object rather than a list of string literals so a section's title is
 * written once and used three times — in the table of contents, as the
 * `<h2>`, and as the anchor its id is derived from.
 */
const S = {
  bridge: "1. The Goldcoin Bridge",
  transactions: "2. Blockchain transactions",
  processingTime: "3. No guarantee of processing time",
  fees: "4. Bridge fees",
  antiAbuse: "5. Anti-abuse and automation policy",
  rapidSuccession: "6. Rapid-succession and automated activity",
  reviewPeriod: "7. Minimum 72-hour abuse review period",
  serviceFee: "8. $25 abuse and administrative service fee",
  manualReview: "9. Manual Review",
  operatorHolds: "10. Operator holds",
  refunds: "11. Refunds",
  noDoublePayment: "12. No double payment",
  limits: "13. Transaction and wallet limits",
  liquidity: "14. Reserve liquidity",
  routeAvailability: "15. Route availability",
  emergencyPauses: "16. Emergency pauses",
  responsibilities: "17. User responsibilities",
  prohibited: "18. Prohibited conduct",
  walletSecurity: "19. Wallet security",
  chainRisk: "20. Smart contract and blockchain risk",
  thirdParties: "21. Third-party networks and services",
  maintenance: "22. Maintenance and updates",
  experimental: "23. Experimental technology",
  noAdvice: "24. No investment advice",
  taxes: "25. Taxes",
  availability: "26. Availability of the Service",
  warranties: "27. Disclaimer of warranties",
  liability: "28. Limitation of liability",
  suspension: "29. Suspension or restriction",
  changes: "30. Changes to these Terms",
  severability: "31. Severability",
  waiver: "32. No waiver",
  entireAgreement: "33. Entire agreement",
  governingLaw: "34. Governing law and disputes",
  contact: "35. Contact",
  importantNotice: "36. Important notice",
} as const;

const SECTIONS = Object.values(S);

export default function TermsPage() {
  return (
    <ContentPage
      title="Goldcoin Bridge — Terms of Service"
      intro="These Terms of Service (“Terms”) govern your access to and use of the Goldcoin Bridge (“Bridge,” “Service,” “we,” “us,” or “our”), including this website and the blockchain infrastructure associated with the Bridge."
      lede={
        <>
          <dl className="text-body-sm text-ink-600 flex flex-wrap gap-x-8 gap-y-1">
            <div className="flex gap-2">
              <dt className="text-ink-700 font-semibold">Effective date:</dt>
              <dd>{EFFECTIVE_DATE}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-700 font-semibold">Last updated:</dt>
              <dd>{LAST_UPDATED}</dd>
            </div>
          </dl>

          <Alert
            level="warn"
            title="Important"
            funds={ABUSE_NOTICE}
            next="Bridge within the published limits, and do not submit transactions by script or in rapid succession. See sections 5 to 8 for how abuse is identified and handled."
          />

          <p className="text-body text-ink-700">
            By accessing or using the Bridge, you acknowledge that you have read,
            understood, and agree to these Terms. If you do not agree to these Terms, do
            not use the Bridge.
          </p>
        </>
      }
      sections={SECTIONS}
    >
      <Clause title={S.bridge}>
        <p>
          The Goldcoin Bridge provides blockchain interoperability services that allow
          supported digital assets to be transferred between supported blockchain
          networks.
        </p>
        <p>
          The Bridge may support routes involving networks including, but not limited to:
        </p>
        <Bullets
          items={[
            "Goldcoin",
            "Solana",
            "Robinhood Network",
            "other networks added in the future",
          ]}
        />
        <p>
          Available networks, routes, transaction limits, fees, confirmation requirements,
          and operational status may change over time.
        </p>
        <p>
          The availability of a route shown in the interface does not guarantee that every
          submitted transaction will qualify for processing.
        </p>
      </Clause>

      <Clause title={S.transactions}>
        <p>Blockchain transactions are generally irreversible once confirmed.</p>
        <p>You are solely responsible for verifying:</p>
        <Bullets
          items={[
            "the source wallet;",
            "destination wallet;",
            "selected blockchain network;",
            "selected bridge route;",
            "token being transferred;",
            "transaction amount;",
            "wallet compatibility; and",
            "any other transaction information shown before submission.",
          ]}
        />
        <p>
          Transactions sent to an incorrect address, unsupported token contract,
          unsupported blockchain, or unsupported bridge address may be unrecoverable.
        </p>
        <p>Goldcoin does not guarantee recovery of incorrectly submitted assets.</p>
      </Clause>

      <Clause title={S.processingTime}>
        <p>Bridge processing times depend on several factors, including:</p>
        <Bullets
          items={[
            "source-chain confirmations;",
            "destination-chain confirmations;",
            "blockchain congestion;",
            "RPC availability;",
            "reserve liquidity;",
            "signer availability;",
            "security checks;",
            "rate limits;",
            "transaction limits;",
            "manual-review requirements; and",
            "other technical or operational conditions.",
          ]}
        />
        <p>Any estimated processing time is an estimate only.</p>
        <p>
          We do not guarantee that a transaction will be completed within a particular
          period.
        </p>
      </Clause>

      <Clause title={S.fees}>
        <p>Bridge transactions may be subject to a fee.</p>
        <p>
          The applicable fee will ordinarily be displayed by the Bridge before a
          transaction is initiated or calculated according to the applicable route
          configuration.
        </p>
        <p>Fees may differ depending on:</p>
        <Bullets
          items={[
            "source network;",
            "destination network;",
            "route;",
            "transaction amount; and",
            "operational conditions.",
          ]}
        />
        <p>Blockchain network fees may also apply independently of Bridge fees.</p>
        <p>
          Fees that have already been consumed by blockchain transactions or other
          irreversible network operations may not be refundable.
        </p>
        <p>
          The rates and limits in force for a given route are shown on the{" "}
          <Link href={routes.fees}>fees &amp; limits</Link> page and on the bridge form
          itself.
        </p>
      </Clause>

      <Clause title={S.antiAbuse}>
        <p>
          The Bridge is intended for legitimate transfers by users operating within the
          published limits and normal intended operation of the Service.
        </p>
        <p>Abuse of the Bridge is prohibited.</p>
        <p>Examples may include, without limitation:</p>
        <Bullets
          items={[
            "submitting transactions in unusually rapid succession;",
            "using scripts, bots, or automation to submit excessive transactions;",
            "deliberately splitting transactions among multiple wallets to evade restrictions;",
            "attempting to circumvent wallet, transaction, liquidity, or rolling limits;",
            "repeatedly sending transactions after a route has been restricted;",
            "intentionally creating excessive Manual Review transactions;",
            "attempting to exhaust Bridge liquidity or reserve capacity;",
            "attempting to interfere with normal Bridge processing;",
            "exploiting race conditions or timing behavior;",
            "deliberately creating unnecessary administrative or infrastructure load;",
            "manipulating or attempting to bypass Bridge safeguards; or",
            "other behavior reasonably determined to constitute abuse of the Service.",
          ]}
        />
        <p>
          Detection may be performed automatically using objective information available
          to the Bridge, including transaction timing, source wallets, destination
          wallets, routes, and transaction history.
        </p>
      </Clause>

      <Clause title={S.rapidSuccession}>
        <p>
          The Bridge may detect rapid-succession, automated, repetitive, or otherwise
          abnormal transaction activity.
        </p>
        <p>
          Transactions matching applicable anti-abuse rules may be prevented before
          submission where technically possible.
        </p>
        <p>
          Because blockchain transactions may also be submitted directly without using the
          official user interface, backend enforcement remains authoritative.
        </p>
        <p>
          If a transaction has already reached the blockchain before an abuse condition is
          detected, the transaction may be accepted into Bridge custody but withheld from
          destination payout.
        </p>
        <p>Such transactions may be designated:</p>
        <Bullets
          items={[
            "Under Manual Review,",
            "Rapid-Burst Hold,",
            "Operator Hold,",
            "or another equivalent review status.",
          ]}
        />
        <p>
          Placement into review does not mean the destination transfer has been approved.
        </p>
      </Clause>

      <Clause title={S.reviewPeriod}>
        <p>
          Transactions identified as abusive, automated, or rapid-succession activity may
          be subject to a minimum review period of 72 hours.
        </p>
        <p>During this period:</p>
        <Bullets
          items={[
            "the transaction may not proceed to destination payout;",
            "automated processing may be disabled;",
            "automatic resumption may be disabled;",
            "the transaction may remain under manual review; and",
            "the user may be required to wait for review to complete.",
          ]}
        />
        <p>
          The expiration of 72 hours does not require Goldcoin to automatically process or
          automatically refund the transaction.
        </p>
        <p>
          After the review period, the transaction may remain held until an authorized
          operator determines the appropriate disposition.
        </p>
        <p>Depending on the circumstances, the transaction may subsequently be:</p>
        <Bullets
          items={[
            "processed;",
            "refunded;",
            "held for additional review; or",
            "otherwise handled as permitted by these Terms and applicable law.",
          ]}
        />
      </Clause>

      <Clause title={S.serviceFee}>
        <p>
          Where automation, abusive activity, or prohibited use is detected, Goldcoin
          reserves the right to charge a USD $25 service and administrative fee per
          affected order.
        </p>
        <p>
          This fee is intended to cover administrative, infrastructure, server, network,
          investigation, reconciliation, recovery, and operational costs associated with
          handling abusive transactions.
        </p>
        <p>
          Where a refund is approved, the applicable service fee may be deducted from the
          original bridged token amount.
        </p>
        <p>
          The USD value of the fee may be converted into the applicable digital asset
          using a reasonable valuation method available at the time the refund is
          processed.
        </p>
        <p>
          Any eligible remainder will then be refunded to the appropriate originating
          wallet where technically possible.
        </p>
        <p>For example:</p>
        <Bullets
          items={[
            "Original eligible refund value: $500",
            "Administrative service fee: $25",
            "Remaining eligible refund value: $475",
          ]}
        />
        <p>
          Actual token quantities may vary according to the applicable valuation method.
        </p>
        <p>The service fee will not exceed the amount otherwise eligible for refund.</p>
        <p>
          Additional irreversible blockchain network costs may also reduce the amount
          recoverable where applicable.
        </p>
        <p>
          Please allow at least 72 hours for processing of transactions subject to this
          policy.
        </p>
      </Clause>

      <Clause title={S.manualReview}>
        <p>
          The Bridge may place a transaction into Manual Review whenever automated
          processing cannot safely continue.
        </p>
        <p>Reasons may include:</p>
        <Bullets
          items={[
            "insufficient available reserve capacity;",
            "liquidity protection rules;",
            "wallet usage restrictions;",
            "rapid-succession activity;",
            "anti-abuse rules;",
            "route admission restrictions;",
            "transactions received during or around maintenance;",
            "conflicting transaction information;",
            "unusual transaction behavior;",
            "security concerns;",
            "blockchain inconsistencies;",
            "failed or uncertain destination settlement;",
            "system safeguards; or",
            "other conditions requiring operator review.",
          ]}
        />
        <p>Manual Review is a safety mechanism.</p>
        <p>
          A transaction being placed into Manual Review does not by itself mean that funds
          have been lost or that a refund has been approved.
        </p>
      </Clause>

      <Clause title={S.operatorHolds}>
        <p>Certain transactions may be placed under an explicit operator hold.</p>
        <p>Transactions under an operator hold:</p>
        <Bullets
          items={[
            "will not automatically resume;",
            "may remain held despite restoration of liquidity;",
            "may remain held after a route reopens;",
            "may remain held after a daemon or service restart; and",
            "require an explicit authorized operator decision before further processing.",
          ]}
        />
        <p>
          An operator may subsequently determine that the transaction should be processed,
          refunded, or remain under review.
        </p>
      </Clause>

      <Clause title={S.refunds}>
        <p>Refund eligibility is determined on a transaction-by-transaction basis.</p>
        <p>Before issuing a refund, the Bridge may verify that:</p>
        <Bullets
          items={[
            "source funds were actually received;",
            "the request remains eligible for refund;",
            "no destination payout has already been successfully completed;",
            "no conflicting destination transaction exists;",
            "the transaction has not previously been refunded;",
            "the refund destination can be determined safely;",
            "reserve accounting remains valid; and",
            "issuing the refund will not create a duplicate payment.",
          ]}
        />
        <p>
          A refund may be refused or delayed where these conditions cannot be safely
          established.
        </p>
        <p>Refunds may also be reduced by:</p>
        <Bullets
          items={[
            "applicable administrative or abuse fees;",
            "unavoidable blockchain network costs; and",
            "other charges permitted by these Terms and applicable law.",
          ]}
        />
      </Clause>

      <Clause title={S.noDoublePayment}>
        <p>
          Goldcoin will not knowingly provide both a completed destination payout and a
          refund for the same bridged transaction.
        </p>
        <p>
          If a destination transaction has already been broadcast, confirmed, settled, or
          otherwise irreversibly committed, the associated request may no longer qualify
          for refund.
        </p>
        <p>
          Systems may therefore delay refund decisions while destination-chain status is
          verified.
        </p>
      </Clause>

      <Clause title={S.limits}>
        <p>The Bridge may apply restrictions including:</p>
        <Bullets
          items={[
            "minimum transaction amounts;",
            "maximum transaction amounts;",
            "per-transfer limits;",
            "wallet-based limits;",
            "source-wallet limits;",
            "destination-wallet limits;",
            "rolling time-window limits;",
            "reserve-capacity limits;",
            "liquidity-buffer requirements; and",
            "route-specific limits.",
          ]}
        />
        <p>These limits exist to protect the Bridge and its users.</p>
        <p>
          Attempting to circumvent them through multiple wallets, repeated transactions,
          automated requests, or other methods may constitute abuse under these Terms.
        </p>
      </Clause>

      <Clause title={S.liquidity}>
        <p>
          Bridge operation depends on sufficient liquidity being available on supported
          destination networks.
        </p>
        <p>
          A route may automatically become unavailable when reserve liquidity or confirmed
          headroom falls below configured safety thresholds.
        </p>
        <p>
          A transaction may consequently be delayed or placed into Manual Review even if
          the corresponding source-chain transaction has already confirmed.
        </p>
        <p>
          Liquidity protection mechanisms exist to prevent the Bridge from authorizing
          payouts it cannot safely satisfy. Live figures are published on the{" "}
          <Link href={routes.reserves}>reserves</Link> page.
        </p>
      </Clause>

      <Clause title={S.routeAvailability}>
        <p>Bridge routes may be:</p>
        <Bullets
          items={[
            "available;",
            "temporarily unavailable;",
            "paused;",
            "admission-closed;",
            "capacity-limited;",
            "under maintenance; or",
            "discontinued.",
          ]}
        />
        <p>
          Goldcoin may modify route availability without prior notice where required for
          security, maintenance, liquidity management, blockchain conditions, or
          operational reasons.
        </p>
        <p>
          A route being displayed as available does not constitute a guarantee that a
          particular transaction will be accepted.
        </p>
        <p>
          The backend Bridge service remains authoritative regarding final transaction
          eligibility. Current per-route state is published on the{" "}
          <Link href={routes.status}>status</Link> page.
        </p>
      </Clause>

      <Clause title={S.emergencyPauses}>
        <p>
          Goldcoin may temporarily pause some or all Bridge functionality where reasonably
          necessary to protect:
        </p>
        <Bullets
          items={[
            "user funds;",
            "reserve funds;",
            "blockchain infrastructure;",
            "Bridge accounting;",
            "signing systems;",
            "connected networks; or",
            "the integrity of the Service.",
          ]}
        />
        <p>Emergency actions may include:</p>
        <Bullets
          items={[
            "pausing a reserve;",
            "closing route admission;",
            "disabling deposits;",
            "disabling payouts;",
            "disabling automated processing;",
            "placing transactions into Manual Review; or",
            "temporarily suspending the Bridge.",
          ]}
        />
        <p>Such actions may occur without advance notice.</p>
      </Clause>

      <Clause title={S.responsibilities}>
        <p>You agree to:</p>
        <Bullets
          items={[
            "use the Bridge only for lawful purposes;",
            "comply with these Terms;",
            "verify wallet addresses before submission;",
            "use only supported assets and networks;",
            "keep your wallet credentials secure;",
            "respect published transaction and wallet limits;",
            "avoid abusive automated behavior;",
            "avoid attempts to circumvent Bridge safeguards; and",
            "review transaction information carefully before approving wallet requests.",
          ]}
        />
        <p>You are responsible for activity initiated from wallets you control.</p>
      </Clause>

      <Clause title={S.prohibited}>
        <p>You may not:</p>
        <Bullets
          items={[
            "attack or interfere with the Bridge;",
            "exploit vulnerabilities;",
            "intentionally overload Bridge infrastructure;",
            "circumvent technical restrictions;",
            "impersonate another person;",
            "submit fraudulent transactions;",
            "manipulate Bridge accounting;",
            "interfere with reserve reconciliation;",
            "attempt unauthorized access to administrative systems;",
            "submit malicious data;",
            "use the Bridge for unlawful purposes;",
            "knowingly exploit implementation defects; or",
            "use automation in a manner that disrupts normal Bridge operation.",
          ]}
        />
        <p>
          Goldcoin may restrict or terminate access in response to prohibited conduct.
        </p>
      </Clause>

      <Clause title={S.walletSecurity}>
        <p>Goldcoin does not control your self-custodial wallet.</p>
        <p>You are solely responsible for safeguarding:</p>
        <Bullets
          items={[
            "private keys;",
            "seed phrases;",
            "wallet passwords;",
            "hardware devices;",
            "browser extensions; and",
            "wallet permissions.",
          ]}
        />
        <p>
          Goldcoin representatives should never require your private key or seed phrase.
        </p>
        <p>
          Loss or compromise of wallet credentials may result in irreversible loss of
          assets.
        </p>
      </Clause>

      <Clause title={S.chainRisk}>
        <p>Digital-asset systems involve significant technical risks.</p>
        <p>These may include:</p>
        <Bullets
          items={[
            "smart-contract vulnerabilities;",
            "blockchain reorganizations;",
            "validator failures;",
            "network congestion;",
            "forks;",
            "RPC failures;",
            "software defects;",
            "wallet incompatibilities;",
            "protocol upgrades;",
            "transaction-ordering issues;",
            "chain outages; and",
            "unexpected behavior by third-party networks.",
          ]}
        />
        <p>You acknowledge and accept these risks when using the Bridge.</p>
      </Clause>

      <Clause title={S.thirdParties}>
        <p>
          The Bridge interacts with networks and infrastructure not controlled by
          Goldcoin.
        </p>
        <p>
          Goldcoin is not responsible for failures caused solely by third parties,
          including:
        </p>
        <Bullets
          items={[
            "blockchain networks;",
            "validators;",
            "RPC providers;",
            "wallet applications;",
            "internet service providers;",
            "hosting providers;",
            "token contracts; or",
            "external infrastructure.",
          ]}
        />
        <p>Third-party services may be governed by their own terms and policies.</p>
      </Clause>

      <Clause title={S.maintenance}>
        <p>Goldcoin may modify, upgrade, suspend, or maintain the Bridge at any time.</p>
        <p>Maintenance may result in:</p>
        <Bullets
          items={[
            "temporary route closures;",
            "delayed transactions;",
            "temporary unavailability;",
            "Manual Review;",
            "interface changes; or",
            "updated transaction requirements.",
          ]}
        />
        <p>
          Where practical, significant planned maintenance may be communicated publicly.
        </p>
        <p>Emergency maintenance may occur without notice.</p>
      </Clause>

      <Clause title={S.experimental}>
        <p>
          Blockchain bridge technology is inherently complex and may involve experimental
          components.
        </p>
        <p>The Bridge is provided on an “as available” basis.</p>
        <p>
          While Goldcoin employs safeguards intended to protect transaction integrity, no
          software or blockchain system can be guaranteed to operate without interruption
          or defects.
        </p>
      </Clause>

      <Clause title={S.noAdvice}>
        <p>Nothing provided through the Bridge constitutes:</p>
        <Bullets
          items={[
            "investment advice;",
            "financial advice;",
            "legal advice;",
            "tax advice; or",
            "a recommendation to purchase, sell, or hold any digital asset.",
          ]}
        />
        <p>You are responsible for your own decisions concerning digital assets.</p>
      </Clause>

      <Clause title={S.taxes}>
        <p>
          You are responsible for determining whether your use of the Bridge creates any
          tax obligations.
        </p>
        <p>Goldcoin does not provide tax advice.</p>
        <p>You should consult an appropriate professional if necessary.</p>
      </Clause>

      <Clause title={S.availability}>
        <p>We do not guarantee that:</p>
        <Bullets
          items={[
            "the Bridge will always be available;",
            "every route will remain supported;",
            "every transaction will succeed;",
            "transaction processing will occur within a specific time;",
            "every unsupported or erroneous transaction can be recovered; or",
            "every blockchain will continue operating as expected.",
          ]}
        />
        <p>We may modify or discontinue functionality when reasonably necessary.</p>
      </Clause>

      <Clause title={S.warranties}>
        <p>
          To the maximum extent permitted by applicable law, the Bridge is provided “AS
          IS” and “AS AVAILABLE.”
        </p>
        <p>
          Goldcoin disclaims warranties of merchantability, fitness for a particular
          purpose, non-infringement, continuous availability, and error-free operation to
          the extent permitted by law.
        </p>
        <p>Nothing in these Terms excludes warranties that cannot legally be excluded.</p>
      </Clause>

      <Clause title={S.liability}>
        <p>
          To the maximum extent permitted by applicable law, Goldcoin and its
          contributors, developers, operators, and affiliates will not be liable for
          indirect, incidental, special, consequential, exemplary, or punitive damages
          arising from use of the Bridge.
        </p>
        <p>This may include loss resulting from:</p>
        <Bullets
          items={[
            "blockchain network failures;",
            "incorrect wallet addresses;",
            "user error;",
            "unsupported transactions;",
            "market-price movements;",
            "third-party services;",
            "network congestion;",
            "wallet compromise;",
            "smart-contract failures; or",
            "circumstances outside Goldcoin’s reasonable control.",
          ]}
        />
        <p>Nothing in these Terms limits liability that cannot legally be limited.</p>
      </Clause>

      <Clause title={S.suspension}>
        <p>
          Goldcoin may restrict use of the Bridge where reasonably necessary because of:
        </p>
        <Bullets
          items={[
            "abuse;",
            "security concerns;",
            "technical incidents;",
            "legal requirements;",
            "suspected exploitation;",
            "maintenance;",
            "reserve constraints; or",
            "protection of users or Bridge infrastructure.",
          ]}
        />
        <p>
          Restrictions may apply to individual transactions, wallets, routes, networks, or
          the entire Service.
        </p>
      </Clause>

      <Clause title={S.changes}>
        <p>Goldcoin may update these Terms from time to time.</p>
        <p>
          The latest version will be published on the official Goldcoin Bridge website
          together with an updated “Last updated” date.
        </p>
        <p>
          Continued use of the Bridge after updated Terms become effective constitutes
          acceptance of the updated Terms to the extent permitted by applicable law.
        </p>
        <p>
          Material changes may be communicated through the website or other official
          Goldcoin channels where appropriate.
        </p>
      </Clause>

      <Clause title={S.severability}>
        <p>
          If any provision of these Terms is determined to be invalid or unenforceable,
          the remaining provisions will remain in effect to the fullest extent permitted
          by law.
        </p>
      </Clause>

      <Clause title={S.waiver}>
        <p>
          Failure by Goldcoin to enforce any provision of these Terms does not constitute
          a waiver of that provision or any other provision.
        </p>
      </Clause>

      <Clause title={S.entireAgreement}>
        <p>
          These Terms, together with any Bridge fee schedule, privacy policy, risk
          disclosures, or other policies expressly incorporated by reference, constitute
          the agreement governing use of the Goldcoin Bridge.
        </p>
      </Clause>

      <Clause title={S.governingLaw}>
        <p>
          These Terms will be governed by the laws of{" "}
          <mark className="bg-warn-50 text-ink-950 rounded-sm font-semibold">
            [INSERT APPROPRIATE JURISDICTION]
          </mark>
          , without regard to conflict-of-law principles.
        </p>
        <p>
          Any disputes relating to the Bridge will be handled in accordance with
          applicable law and any dispute-resolution provisions adopted by Goldcoin.
        </p>
        <p className="text-ink-600 italic">
          This section should be completed after legal review.
        </p>
      </Clause>

      <Clause title={S.contact}>
        <p>
          Questions regarding these Terms, transaction reviews, or Bridge operation may be
          submitted through the official Goldcoin communication channels listed on the
          Goldcoin Project website and on this Bridge, which this deployment serves from{" "}
          <span className="font-mono font-semibold">{primaryDomain()}</span>.
        </p>
        <p>
          The <Link href={routes.support}>support</Link> page lists the channels available
          for this deployment. Include the transfer id from the transfer&apos;s own page:
          it is enough for support to look up its exact state.
        </p>
        <p>
          Do not send private keys, wallet seed phrases, passwords, or other
          authentication credentials when contacting support.
        </p>
      </Clause>

      <Clause title={S.importantNotice}>
        <p>
          By using the Goldcoin Bridge, you acknowledge that rapid-succession, automated,
          limit-evading, or other abusive activity may result in transactions being placed
          under Manual Review. A minimum 72-hour review period may apply, and a USD $25
          service and administrative fee may be charged per affected abusive order and
          deducted from any otherwise eligible refund. Transactions under an abuse hold
          will not automatically proceed until reviewed by an authorized operator.
        </p>
      </Clause>
    </ContentPage>
  );
}

/**
 * One numbered clause.
 *
 * The id is derived from the title rather than written beside it, so a
 * heading and the anchor people cite it by cannot drift apart — the same
 * rule `buildToc` applies when it renders the contents list.
 */
function Clause({ title, children }: { title: string; children: ReactNode }) {
  return (
    <ContentSection id={slugify(title)} title={title}>
      {children}
    </ContentSection>
  );
}

/** A clause's enumerated list, styled as the other long-form pages style theirs. */
function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/** An in-app link, underlined as the other long-form pages underline theirs. */
function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="underline underline-offset-2">
      {children}
    </a>
  );
}
