"use client";

import Image from "next/image";
import { Clock, X } from "lucide-react";
import { useId, useState } from "react";
import { useIsMounted } from "@/lib/hooks/useIsMounted";
import {
  COMING_SOON_LABEL,
  NETWORK_ANNOUNCEMENT,
  type NetworkAnnouncement as NetworkAnnouncementConfig,
} from "@/lib/config/announcement";
import { cn } from "@/lib/utils/cn";

/**
 * The network announcement strip.
 *
 * Sits directly beneath the global trust strip and reads as a second system
 * strip, which is exactly what it must NOT be mistaken for. Everything it
 * says comes from `NETWORK_ANNOUNCEMENT` — a static constant. It calls no
 * hook that touches the bridge: no status query, no reserve query, no wallet,
 * no API client. A future integration cannot be reported by an endpoint that
 * describes the bridge as it is today, and letting this strip react to live
 * state would eventually let a marketing line contradict, or be mistaken for,
 * the operational truth above it.
 *
 * It is therefore also its own landmark rather than part of AppShell's
 * "Bridge notices" region: a reader navigating by landmark should not find a
 * product announcement filed among notices about money movement.
 *
 * One consequence worth stating: "coming soon" is carried by text and an icon,
 * never by colour. The gold outline is brand accent — gold is never a status
 * colour in this system (see src/lib/status) — and the strip's green is the
 * same token family the trust strip uses, which is why the state is spelled
 * out in words instead.
 *
 * The strip offers no call to action. There is no Robinhood page to open, and
 * a disabled button explaining that is still a control the eye and the tab
 * order have to account for. The heading, one line of copy and the dismiss
 * control are the whole row; the only interactive element is the dismiss.
 */

/**
 * The dismissal is per browser session and per browser, by design: this is a
 * product notice, not a preference. `sessionStorage` throws outright in a
 * Safari private window and in an embedded webview with storage disabled, and
 * an announcement is not a good enough reason to take the page down — the
 * same guard `src/lib/theme/theme.ts` puts around `localStorage`.
 */
const DISMISSED_VALUE = "dismissed";

function readDismissed(storageKey: string): boolean {
  try {
    return window.sessionStorage.getItem(storageKey) === DISMISSED_VALUE;
  } catch {
    return false;
  }
}

function writeDismissed(storageKey: string): void {
  try {
    window.sessionStorage.setItem(storageKey, DISMISSED_VALUE);
  } catch {
    // Storage unavailable. The dismissal still applies to this page view; it
    // just will not outlive it. Failing the interaction would be worse.
  }
}

export function NetworkAnnouncement({
  announcement = NETWORK_ANNOUNCEMENT,
}: {
  announcement?: NetworkAnnouncementConfig;
} = {}) {
  const headingId = useId();

  /*
   * The stored value is read in the initialiser rather than in an effect, so
   * the post-mount render is already correct and a reader who dismissed this
   * never sees it flash back. On the server `window` does not exist and the
   * guard above returns false; the `mounted` gate below means that value is
   * never painted, so there is no hydration mismatch either.
   */
  const [dismissed, setDismissed] = useState(() =>
    readDismissed(announcement.storageKey),
  );

  /*
   * Nothing renders until hydration. The alternative — server-render the
   * strip and hide it on mount — has no layout shift but flashes the banner
   * at every reader who already closed it, which is the one group that has
   * explicitly asked not to see it.
   */
  const mounted = useIsMounted();

  if (!announcement.enabled || !mounted || dismissed) return null;

  /*
   * The network name carries the primary text colour and the rest of the
   * title carries brand gold. Derived from the configured strings rather than
   * hardcoded, so changing the network in one place changes both.
   */
  const remainder = announcement.title.startsWith(announcement.network)
    ? announcement.title.slice(announcement.network.length).trimStart()
    : null;

  return (
    <div role="region" aria-label="Network announcement">
      <section
        aria-labelledby={headingId}
        className={cn(
          "relative isolate overflow-hidden",
          // A thin green hairline, with a shadow that only just clears the
          // edge. Enough to lift the strip off the page; far short of neon.
          "border-success-100 border-b shadow-[0_1px_10px_-6px_var(--color-success-500)]",
          // Pale green on white in the light theme, near-black with a green
          // cast in the dark one — the same two tokens, resolved per theme.
          // No raw colour values, and no `dark:` variant at the call site.
          // The green is held to 45% before it falls away, so the strip reads
          // as a wash rather than as a stripe down the left edge.
          "from-success-50 via-success-50 to-surface bg-linear-to-r via-45%",
        )}
      >
        {/*
          The highlight the mockup carries toward the right. Desktop only, and
          deliberately weak: it should read as depth behind the strip, never
          as a second light source competing with the gold. Decorative, so it
          is hidden from assistive technology and cannot take a pointer event.
          Mobile keeps the flat gradient it already had.
        */}
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 -z-10 hidden w-2/5 md:block",
            "from-success-100 bg-radial-[at_100%_50%] to-transparent to-75% opacity-60",
          )}
        />

        <div className="max-w-page relative mx-auto flex items-start gap-3 px-4 py-2.5 md:items-center md:gap-4 md:px-6 md:py-3">
          {/*
            The mascot, not the `BrandMark` coin: the header already carries
            the mark, and repeating it two strips down reads as a rendering
            bug rather than as branding.

            Square source (1254x1254), served at its natural ratio with only
            a height set, so it can never be stretched. Negative vertical
            margins let it stand slightly taller than the text beside it
            without paying for that height twice in the strip's padding —
            the banner grows by a few pixels, not by the full difference.

            Aligned with the badge row while the strip is stacked, and
            centred once it is a single line. Centring it against a
            three-line block leaves it floating beside the middle sentence.
          */}
          <Image
            src="/branding/goldcoin-mascot.png"
            alt=""
            aria-hidden="true"
            width={1254}
            height={1254}
            priority={false}
            className={cn(
              "w-auto shrink-0 select-none",
              "h-10 self-start sm:h-11 md:h-13 md:self-center lg:h-18",
              "md:-my-1.5 lg:-my-3",
            )}
          />

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 md:gap-x-4">
            {/*
              Text and an icon, never the outline alone: a reader who cannot
              distinguish the gold border still reads the words.
            */}
            <span className="text-overline border-gold-700 text-gold-700 inline-flex shrink-0 items-center gap-1 rounded-sm border px-2 py-0.5 uppercase">
              <Clock aria-hidden="true" className="size-3" strokeWidth={2} />
              {COMING_SOON_LABEL}
            </span>

            <div className="min-w-0 basis-full md:flex-1 md:basis-auto">
              <h2 id={headingId} className="text-heading-3 text-ink-950">
                {announcement.network}
                {remainder ? (
                  <>
                    {" "}
                    <span className="text-gold-700">{remainder}</span>
                  </>
                ) : null}
              </h2>
              <p className="text-body-sm text-ink-700">{announcement.description}</p>
            </div>

            {/*
              The Robinhood mark. Purely decorative — the network is already
              named in the heading, so announcing the image would say
              "Robinhood" twice — and shown only from `xl` up, because below
              that the row has no width left to give it. Decorative artwork is
              the part that yields, not the copy, so the breakpoint stays
              where it is rather than moving down into the space the removed
              secondary text and divider left behind.

              Natural ratio (1374x1145) with only a height set: a brand mark
              that has been stretched is worse than a brand mark that is
              absent.
            */}
            <Image
              src="/brands/robinhood-mark.png"
              alt=""
              aria-hidden="true"
              width={1374}
              height={1145}
              priority={false}
              className="ml-1 hidden h-9 w-auto shrink-0 select-none xl:block"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              setDismissed(true);
              writeDismissed(announcement.storageKey);
            }}
            aria-label={`Dismiss the ${announcement.network} announcement`}
            className="text-ink-700 hover:bg-ink-50 hover:text-ink-950 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md md:size-9 md:self-center"
          >
            <X aria-hidden="true" className="size-5" strokeWidth={2} />
          </button>
        </div>
      </section>
    </div>
  );
}
