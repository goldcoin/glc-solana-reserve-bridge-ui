import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ContentPage, ContentSection } from "@/components/content/ContentPage";
import { Alert } from "@/components/ui";
import { primaryDomain, routes } from "@/lib/config/links";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { slugify } from "@/lib/content/toc";

/**
 * Privacy policy.
 *
 * The footer has linked at `/legal/privacy` since the navigation model was
 * written and nothing was served there, so the link 404'd on every page.
 *
 * # Everything here is checkable against this repository
 *
 * A privacy policy is the one document where boilerplate is actively
 * dangerous: a claim the code does not back is a false statement about
 * what happens to someone's data, and on this product the data in
 * question is wallet addresses. So every statement below names the thing
 * that makes it true and can be re-derived from source:
 *
 *   - no analytics, tracker, advertising or social embed anywhere in
 *     `app/` or `src/`, and `src/lib/security/csp.ts` pins the policy that
 *     would block one: `default-src 'self'`, `font-src 'self'`, and a
 *     `connect-src` built only from the configured backend and RPC origins
 *   - the two browser-storage keys are the whole list — `THEME_STORAGE_KEY`
 *     (imported here rather than retyped) and the announcement dismissal in
 *     `src/components/layout/NetworkAnnouncement.tsx`
 *   - no cookie is set anywhere; `document.cookie` appears nowhere
 *   - the addresses the interface sends are the ones in
 *     `src/lib/api/schemas/transfer.ts` and the eligibility endpoints
 *
 * If one of those changes, this page is wrong and has to change with it.
 * `tests/unit/legal-privacy.test.tsx` holds the claims that a scan can
 * actually police.
 *
 * No domain is hardcoded, per src/lib/config/env.ts.
 */

export const EFFECTIVE_DATE = "September 12, 2026";
export const LAST_UPDATED = "September 12, 2026";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What the Goldcoin Bridge interface does and does not handle: no accounts, no cookies, no analytics — and what is necessarily public when you bridge on a blockchain.",
  // Relative, and therefore resolved against the layout's `metadataBase`:
  // the canonical URL names the configured origin, never whichever host
  // happened to serve the response.
  alternates: { canonical: routes.privacy },
  openGraph: {
    type: "article",
    url: routes.privacy,
    title: "Privacy Policy",
    description:
      "What the Goldcoin Bridge interface handles, stores, and sends — and what a blockchain makes public regardless.",
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
  scope: "What this policy covers",
  noAccount: "No account, and no identity documents",
  onYourDevice: "What the interface stores on your device",
  whatYouSend: "What you send when you use the Bridge",
  publicChains: "What a blockchain makes public",
  explorer: "The public explorer",
  networkRequests: "Network requests, and who answers them",
  wallets: "Wallets and browser extensions",
  noTracking: "No analytics, advertising, or third-party tracking",
  urls: "Addresses in URLs",
  support: "Support and correspondence",
  retention: "How long information is kept",
  choices: "Your choices",
  children: "Children",
  changes: "Changes to this policy",
  contact: "Contact",
} as const;

const SECTIONS = Object.values(S);

export default function PrivacyPage() {
  return (
    <ContentPage
      title="Goldcoin Bridge — Privacy Policy"
      intro="This policy describes what the Goldcoin Bridge interface handles, what it keeps, and what it sends — and, just as importantly, what a public blockchain makes visible no matter what any website promises."
      sections={SECTIONS}
    >
      <div className="space-y-4">
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

        <Alert level="info" title="The short version">
          <p>
            This interface has no user accounts, sets no cookies, and runs no analytics,
            advertising, or third-party tracking of any kind. It asks for no name, email
            address, or identity document. What it does handle is wallet addresses and
            amounts — and those are public on the blockchains involved, permanently,
            whatever this page says.
          </p>
        </Alert>
      </div>

      <Clause title={S.scope}>
        <p>
          This policy covers the Goldcoin Bridge website and the interface served from{" "}
          <span className="font-mono font-semibold">{primaryDomain()}</span>.
        </p>
        <p>It does not, and cannot, cover:</p>
        <Bullets
          items={[
            "the public blockchains a transfer moves across;",
            "your wallet, wallet extension, or hardware device;",
            "blockchain node and RPC providers;",
            "your internet service provider; or",
            "any other website or service you reach from here.",
          ]}
        />
        <p>
          Each of those is operated by someone else, under their own terms and their own
          privacy practices.
        </p>
      </Clause>

      <Clause title={S.noAccount}>
        <p>
          There is no sign-up, no login, no password, and no profile. The interface asks
          for no name, no email address, no phone number, and no identity document.
        </p>
        <p>
          Nothing on this site identifies you as a person. What identifies a transfer is
          the wallet address it came from and the wallet address it is going to, which you
          supply at the moment you make it.
        </p>
      </Clause>

      <Clause title={S.onYourDevice}>
        <p>
          This site sets no cookies. Two preferences are stored in your browser, and both
          stay on your device:
        </p>
        <Bullets
          items={[
            `${THEME_STORAGE_KEY} (local storage) — whether you chose the light or dark theme. Absent until you choose one.`,
            "A per-announcement key (session storage) — that you dismissed a product notice, so it does not reappear on every page for the rest of the session.",
          ]}
        />
        <p>
          Neither is sent anywhere, neither is read by any other site, and neither
          contains a wallet address or an identifier for you. Clearing this site&apos;s
          data in your browser removes both.
        </p>
      </Clause>

      <Clause title={S.whatYouSend}>
        <p>
          Using the Bridge means asking the bridge backend to do something, and the
          request carries what that action needs:
        </p>
        <Bullets
          items={[
            "the source and destination wallet addresses for a transfer;",
            "the amount and the route;",
            "a transfer id, when you are looking one up; and",
            "the wallet address you search by on the activity page.",
          ]}
        />
        <p>
          This is the information the backend needs to quote a transfer, check the limits
          that apply to those wallets, create the request, and settle it. The interface
          computes no fee and authorises no payout of its own — it asks, and displays what
          the backend answers.
        </p>
        <p>
          The Bridge never asks for a private key, a seed phrase, or a wallet password,
          and no part of this interface can read one. A signature is requested through
          your wallet, which holds the key and never reveals it to the page.
        </p>
      </Clause>

      <Clause title={S.publicChains}>
        <p>
          A blockchain transaction is public and permanent. Once a deposit or a payout is
          confirmed, the addresses, the amount, and the time are readable by anyone,
          forever, on a network nobody operating this Bridge controls.
        </p>
        <p>
          That means an address you bridge from can be linked to the address you bridge
          to, by anyone who looks. No privacy policy can undo that, and this one does not
          claim to.
        </p>
        <p>
          Goldcoin cannot delete, edit, or hide a confirmed blockchain transaction. No one
          can.
        </p>
      </Clause>

      <Clause title={S.explorer}>
        <p>
          The Bridge publishes transfer activity on its own public{" "}
          <Link href={routes.explorer}>explorer</Link> — states, amounts, routes, and the
          source and destination transactions once they exist. That page is open to anyone
          and requires no wallet.
        </p>
        <p>
          It is a transparency surface on purpose: a reserve-backed bridge that asks to be
          trusted with custody should be inspectable without asking its operator for
          permission.
        </p>
      </Clause>

      <Clause title={S.networkRequests}>
        <p>
          Loading and using this site makes your browser contact a small, fixed set of
          servers:
        </p>
        <Bullets
          items={[
            "the host serving this site;",
            "the bridge backend this deployment is configured to call; and",
            "the blockchain RPC endpoints configured for the networks in use.",
          ]}
        />
        <p>
          Any server your browser contacts necessarily sees the connection: your IP
          address, the time, and what was requested. Whether those servers keep logs, and
          for how long, is a property of whoever operates them.
        </p>
        <p>
          The content policy this site ships prevents it from contacting anything outside
          that list. Fonts are served from this site itself and are never fetched from a
          font CDN; there are no third-party images, frames, or scripts to fetch.
        </p>
      </Clause>

      <Clause title={S.wallets}>
        <p>
          Your wallet is yours. Goldcoin does not control it, cannot see inside it, and
          cannot move funds from it — every transfer needs a signature your wallet asks
          you for.
        </p>
        <p>
          Connecting a wallet lets this page read your public address and your balance,
          and lets it ask your wallet to sign. Your wallet software makes its own network
          calls under its own privacy policy, which this page does not control and cannot
          speak for.
        </p>
        <p>
          You can read every page of this site — fees, limits, status, reserves, the
          explorer — without connecting a wallet at all.
        </p>
      </Clause>

      <Clause title={S.noTracking}>
        <p>
          There is no analytics script, no tracking pixel, no advertising network, no
          social embed, and no session-replay tool anywhere in this application.
        </p>
        <p>
          Nothing about your use of this site is sold, rented, shared for advertising, or
          used to build a profile of you. There is no profile to build: the site has no
          accounts and no cross-site identifier.
        </p>
      </Clause>

      <Clause title={S.urls}>
        <p>
          The <Link href={routes.activity}>activity</Link> page puts the wallet address
          you are viewing into the page URL, so a result stays put across a reload and can
          be shared or bookmarked.
        </p>
        <p>
          That is worth knowing before you share one: a link copied from that page
          contains the address it was showing. The same is true of a transfer&apos;s own
          page, whose URL contains that transfer&apos;s id.
        </p>
      </Clause>

      <Clause title={S.support}>
        <p>
          If you contact support, you provide whatever you choose to write — typically a
          transfer id, which is enough to look up that transfer&apos;s exact state.
        </p>
        <p>
          Never send a private key, seed phrase, or wallet password to anyone, through any
          channel, for any reason. No legitimate Goldcoin representative will ever ask for
          one, and anyone who does is trying to take your funds.
        </p>
      </Clause>

      <Clause title={S.retention}>
        <p>
          Blockchain transactions are permanent and outside anyone&apos;s control,
          including ours.
        </p>
        <p>
          The bridge backend keeps the transfer records it needs to operate the Service,
          reconcile reserves, and answer questions about a transfer later. This interface
          keeps no copy of its own: it holds what it is displaying for as long as the page
          is open, and nothing after that.
        </p>
        <p>
          The two preferences stored in your browser stay until you clear this site&apos;s
          data.
        </p>
      </Clause>

      <Clause title={S.choices}>
        <p>You can:</p>
        <Bullets
          items={[
            "browse the entire site without connecting a wallet;",
            "disconnect a connected wallet at any time, from the wallet itself;",
            "clear this site's stored preferences by clearing its site data in your browser;",
            "decide which address you bridge from and to, before anything is submitted; and",
            "decline any signature your wallet asks you to approve.",
          ]}
        />
        <p>
          What you cannot do — and neither can we — is make a confirmed blockchain
          transaction private after the fact. Decide what you are comfortable making
          public before you submit it.
        </p>
      </Clause>

      <Clause title={S.children}>
        <p>
          The Bridge is not directed at children, and is not intended for use by anyone
          under the age at which they can lawfully enter into these arrangements where
          they live.
        </p>
      </Clause>

      <Clause title={S.changes}>
        <p>
          This policy may be updated. The current version is always the one published
          here, with the &ldquo;Last updated&rdquo; date above.
        </p>
        <p>
          A change that materially affects what is handled or where it goes will be
          reflected here before it takes effect, and may also be communicated through the
          official Goldcoin channels.
        </p>
      </Clause>

      <Clause title={S.contact}>
        <p>
          Questions about this policy may be submitted through the official channels
          published on the Goldcoin Bridge itself, which this deployment serves from{" "}
          <Link href={routes.home}>
            <span className="font-mono font-semibold">{primaryDomain()}</span>
          </Link>
          .
        </p>
        <p>
          The <Link href={routes.support}>support</Link> page lists the channels available
          for this deployment. The <Link href={routes.terms}>terms of service</Link>{" "}
          govern use of the Bridge itself.
        </p>
        <p>
          Do not send private keys, wallet seed phrases, passwords, or other
          authentication credentials when contacting support.
        </p>
      </Clause>
    </ContentPage>
  );
}

/**
 * One section.
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

/** A section's enumerated list, styled as the other long-form pages style theirs. */
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
