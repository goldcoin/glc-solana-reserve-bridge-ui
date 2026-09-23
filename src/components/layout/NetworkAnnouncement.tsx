"use client";

import Image from "next/image";
import {
  CircleCheck,
  CircleHelp,
  CircleSlash,
  Pause,
  X,
  type LucideIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { useIsMounted } from "@/lib/hooks/useIsMounted";
import { useChains } from "@/lib/query/hooks";
import {
  ANNOUNCEMENT_STATUS_DESCRIPTION,
  ANNOUNCEMENT_STATUS_LABEL,
  NETWORK_ANNOUNCEMENT,
  networkAnnouncementStatus,
  type NetworkAnnouncement as NetworkAnnouncementConfig,
  type NetworkAnnouncementStatus,
} from "@/lib/config/announcement";
import { cn } from "@/lib/utils/cn";

/**
 * The network integration strip.
 *
 * Sits directly beneath the global trust strip and reads as a second system
 * strip — which is very nearly what it now is, with one deliberate
 * difference in scope. `BridgeStatusBar` speaks for the bridge as a whole:
 * how many of its executable routes are usable. This one is scoped to a
 * SINGLE network's integration and reports only that network's routes.
 *
 * It used to be derived from a static constant, and that was right while
 * the thing it announced did not exist — there was no live state to read,
 * and a marketing line reacting to the status endpoint would eventually
 * have been mistaken for it. The routes now exist and are shipped, so the
 * constant had become the failure mode instead: it went on saying "COMING
 * SOON … launches next week" about machinery that was already built. The
 * strip therefore reads `GET /chains`, through the same
 * `routeAvailability` every other consumer uses, and reports the same
 * verdict rather than a second opinion.
 *
 * It is still its own landmark rather than part of AppShell's "Bridge
 * notices" region: a reader navigating by landmark should find the
 * bridge-wide notices together, and this is scoped to one network.
 *
 * One consequence worth stating: the state is carried by text and an icon,
 * never by colour. The strip's green wash is the same token family the
 * trust strip uses and stays put whatever the badge says, which is why the
 * state is spelled out in words — a reader who cannot separate two
 * outlines loses nothing.
 *
 * Nothing here hardcodes which state is being reported: the badge's label,
 * icon, outline and the line of copy are all looked up from the resolved
 * status. Adding a status is an edit to `src/lib/config/announcement.ts`
 * plus one entry in the total `Record` below, which is what stops a new
 * state from silently falling through to an existing one.
 *
 * Nothing here hardcodes WHICH network is being announced either. The
 * name, the title, the dismissal key and the brand mark all arrive as one
 * config object, and whether the strip renders at all is deployment
 * configuration (`NEXT_PUBLIC_ANNOUNCEMENT_ENABLED`, fail-closed), so
 * retiring one announcement and running the next is configuration rather
 * than a rewrite of this file.
 *
 * The strip offers no call to action. There is no per-network page to
 * open, and the reason a route is closed belongs beside that route on /status
 * rather than duplicated here — the backend's sentence is cause-agnostic
 * and there can be a different one per route. The heading, one line of
 * copy and the dismiss control are the whole row.
 */

/**
 * The dismissal is per browser session and per browser, by design: this is a
 * product notice, not a preference. `sessionStorage` throws outright in a
 * Safari private window and in an embedded webview with storage disabled, and
 * an announcement is not a good enough reason to take the page down — the
 * same guard `src/lib/theme/theme.ts` puts around `localStorage`.
 */
const DISMISSED_VALUE = "dismissed";

/**
 * The badge, per announced status. Adding a status to the config forces a
 * case here rather than silently falling through to the pre-launch one —
 * which is the whole reason this is a total `Record` and not a ternary.
 */
const STATUS_BADGE: Record<
  NetworkAnnouncementStatus,
  { readonly icon: LucideIcon; readonly className: string }
> = {
  available: { icon: CircleCheck, className: "border-success-700 text-success-700" },
  partial: { icon: Pause, className: "border-warn-700 text-warn-700" },
  unavailable: { icon: CircleSlash, className: "border-ink-400 text-ink-700" },
  unknown: { icon: CircleHelp, className: "border-ink-300 text-ink-500" },
};

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
   * The one live read this strip makes. `/chains` is the availability
   * authority for the whole app, and this strip reports the same verdict
   * it does rather than a second opinion — which is why it calls the same
   * `routeAvailability` every other consumer does, through
   * `networkAnnouncementStatus`. A read that has not landed is `unknown`,
   * never "available".
   */
  const chains = useChains();

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

  /*
   * `enabled` first, and it is the flag's fail-closed value: an unset or
   * malformed `NEXT_PUBLIC_ANNOUNCEMENT_ENABLED` renders nothing at all —
   * no region, no landmark, no dismissal control — rather than shipping a
   * stale announcement.
   */
  if (!announcement.enabled || !mounted || dismissed) return null;

  /*
   * The network name carries the primary text colour and the rest of the
   * title carries brand gold. Derived from the configured strings rather than
   * hardcoded, so changing the network in one place changes both.
   */
  const remainder = announcement.title.startsWith(announcement.network)
    ? announcement.title.slice(announcement.network.length).trimStart()
    : null;

  const status = networkAnnouncementStatus(chains.data);
  const badge = STATUS_BADGE[status];
  const BadgeIcon = badge.icon;

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
            <span
              className={cn(
                "text-overline inline-flex shrink-0 items-center gap-1 rounded-sm border px-2 py-0.5 uppercase",
                badge.className,
              )}
            >
              <BadgeIcon aria-hidden="true" className="size-3" strokeWidth={2} />
              {ANNOUNCEMENT_STATUS_LABEL[status]}
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
              <p className="text-body-sm text-ink-700">
                {ANNOUNCEMENT_STATUS_DESCRIPTION[status](announcement.network)}
              </p>
            </div>

            {/*
              The announced network's own mark, from the config rather than
              written in here — the component has no network in it. Purely
              decorative: the network is already named in the heading, so
              announcing the image would say it twice. Shown only from `xl`
              up, because below that the row has no width left to give it;
              decorative artwork is the part that yields, not the copy.

              Rendered at the mark's own intrinsic ratio with only a height
              set: a brand mark that has been stretched is worse than a brand
              mark that is absent — and `null` says absent, which is a
              supported announcement rather than a missing asset.
            */}
            {announcement.mark ? (
              <Image
                src={announcement.mark.src}
                alt=""
                aria-hidden="true"
                width={announcement.mark.width}
                height={announcement.mark.height}
                priority={false}
                className="ml-1 hidden h-9 w-auto shrink-0 select-none xl:block"
              />
            ) : null}
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
