"use client";

import { Dialog } from "radix-ui";
import Link from "next/link";
import { ArrowUpRight, CircleQuestionMark, Search, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { BrandMark } from "@/components/layout/BrandMark";
import { routes } from "@/lib/config/links";
import { FAQ_SHORTCUTS, faqHref, searchFaq } from "@/lib/content/faq";
import { cn } from "@/lib/utils/cn";

/**
 * The floating help panel.
 *
 * A reader reaches for help mid-problem — a deposit sent, a transfer that
 * has not moved — so this is a router, not an encyclopaedia. It lists
 * questions and it hands out routes; it holds no answer text and no rule
 * about how the bridge behaves. Everything it can say lives on /faq, /status
 * or a transfer's own page, and those pages stay the single source of it.
 *
 * Three consequences worth stating.
 *
 * FIRST: search is local, over the FAQ catalogue in `@/lib/content/faq`.
 * Nine questions do not need an index, a service or a network call, and a
 * help panel that cannot answer while the backend is down is a help panel
 * that fails exactly when it is needed.
 *
 * SECOND: there is no live chat, and no "chat with us" that opens a form
 * nobody reads. The support route is the real channel this deployment has,
 * so it is the one offered.
 *
 * THIRD: it is a modal dialog. Radix supplies the focus trap, the escape
 * handler, the outside-click dismissal and focus restoration, which is the
 * difference between correct keyboard behaviour and an approximation of it.
 */
export function HelpWidget() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const searchInputId = useId();
  const listHeadingId = useId();

  const searching = query.trim().length > 0;
  const results = useMemo(
    () => (searching ? searchFaq(query) : FAQ_SHORTCUTS),
    [query, searching],
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // A reopened panel starts from the shortcuts rather than from a
        // stale query the reader has already navigated away from.
        if (!next) setQuery("");
      }}
    >
      {/*
        Its own landmark, matching how the theme control is grouped: a
        floating control that belongs to no region is content a screen-reader
        user can only reach by walking the entire page.
      */}
      <div role="region" aria-label="Help">
        <Dialog.Trigger
          className={cn(
            "bg-ink-950 text-on-inverse shadow-elev-2 hover:bg-ink-900 hover:shadow-elev-3",
            "text-body inline-flex h-12 items-center justify-center gap-2 rounded-full font-medium",
            // Icon-only where every pixel is spoken for, icon + label where
            // there is room. One element, so the accessible name is "Help"
            // either way and there is never a second control with the same
            // name to disambiguate.
            "w-12 sm:h-11 sm:w-auto sm:px-4",
            "transition-shadow duration-[var(--duration-base)] ease-[var(--ease-standard)]",
            "focus-visible:rounded-full",
          )}
        >
          <CircleQuestionMark aria-hidden="true" className="size-5" strokeWidth={2} />
          <span className="max-sm:sr-only">Help</span>
        </Dialog.Trigger>
      </div>

      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "bg-ink-950/30 fixed inset-0 z-50",
            "data-[state=open]:animate-[fade-in_var(--duration-base)_var(--ease-decelerate)]",
            "data-[state=closed]:animate-[fade-out_var(--duration-fast)_var(--ease-accelerate)]",
          )}
        />
        <Dialog.Content
          className={cn(
            "border-ink-200 bg-surface-raised shadow-elev-3 fixed z-50 flex flex-col overflow-hidden rounded-lg border",
            "focus:outline-none",
            /*
              Anchored into the same corner the launcher occupies, so the
              panel never covers the middle of the page — the bridge form
              sits there, and a reader consulting the FAQ about a transfer
              is usually mid-form. On desktop it is a fixed 352px column
              beside the card rather than over it; at 360px it spans the
              width but stays in the lower part of the viewport, with the
              header, the wallet control and the top of the form still
              visible above it.
            */
            "right-[max(0.75rem,env(safe-area-inset-right))] bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))]",
            "max-h-[min(70svh,32rem)]",
            "sm:left-auto sm:w-88",
            "md:right-6 md:bottom-6",
            "data-[state=open]:animate-[menu-in_var(--duration-base)_var(--ease-decelerate)]",
            "data-[state=closed]:animate-[menu-out_var(--duration-fast)_var(--ease-accelerate)]",
          )}
        >
          <div className="border-ink-200 flex items-center justify-between gap-3 border-b px-4 py-3">
            <Dialog.Title className="text-heading-3 text-ink-950 flex items-center gap-2">
              <BrandMark className="size-5" />
              Goldcoin Help
            </Dialog.Title>
            <Dialog.Close
              className="text-ink-700 hover:bg-ink-50 -mr-2 inline-flex size-11 items-center justify-center rounded-md md:size-9"
              aria-label="Close help"
            >
              <X aria-hidden="true" className="size-5" strokeWidth={2} />
            </Dialog.Close>
          </div>

          <Dialog.Description className="sr-only">
            Search the Goldcoin bridge FAQ, or jump to transfer status, bridge status and
            support.
          </Dialog.Description>

          <div className="px-4 pt-3">
            <label htmlFor={searchInputId} className="sr-only">
              Search the FAQ
            </label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="text-ink-500 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                strokeWidth={2}
              />
              <input
                id={searchInputId}
                type="search"
                // Duplicates the <label> above, exactly as ActivityView's
                // search field does: the lint rule cannot follow a generated
                // htmlFor/id pair, and the two names are identical, so nothing
                // is announced twice.
                aria-label="Search the FAQ"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search the FAQ"
                className={cn(
                  "border-ink-200 bg-surface text-body text-ink-950 placeholder:text-ink-600",
                  "h-10 w-full rounded-md border pr-3 pl-9",
                )}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {/*
              `ink-600`, not the `ink-500` this overline usually carries: at
              11px the AA threshold is 4.5:1, and ink-500 on the raised
              surface does not clear it in the dark theme.
            */}
            <p id={listHeadingId} className="text-overline text-ink-600 uppercase">
              {searching ? "Matching questions" : "Common questions"}
            </p>

            {results.length > 0 ? (
              <ul aria-labelledby={listHeadingId} className="mt-1.5">
                {results.map((entry) => (
                  <li key={entry.id}>
                    <Dialog.Close asChild>
                      <Link
                        href={faqHref(entry.id)}
                        className="text-body text-ink-700 hover:bg-ink-50 hover:text-ink-950 flex min-h-11 items-center rounded-md px-2 py-1.5"
                      >
                        {entry.question}
                      </Link>
                    </Dialog.Close>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body-sm text-ink-600 mt-2">
                Nothing in the FAQ matches that. Open the full FAQ below, or contact
                support with your transfer id.
              </p>
            )}

            {/*
              The result count, for a reader who cannot see the list shrink
              as they type. Silent until they have typed something, so
              opening the panel does not announce a count nobody asked for.
            */}
            <p aria-live="polite" className="sr-only">
              {searching
                ? `${results.length} matching ${results.length === 1 ? "question" : "questions"}`
                : ""}
            </p>
          </div>

          <div className="border-ink-200 border-t p-2">
            <ul>
              {/*
                `/activity` is this app's transfer lookup: the backend filters
                transfers by address, and there is no free-text transfer-id
                search to point at (see ActivityView). A reader who already
                has an id can open that transfer's page directly from there.
              */}
              <HelpAction href={routes.activity} label="Check transfer status" />
              <HelpAction href={routes.status} label="View bridge status" />
              <HelpAction href={routes.faq} label="Open full FAQ" />
              <HelpAction href={routes.support} label="Support" />
            </ul>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function HelpAction({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Dialog.Close asChild>
        <Link
          href={href}
          className="text-body text-ink-950 hover:bg-ink-50 flex min-h-11 items-center justify-between gap-3 rounded-md px-2 py-1.5 font-medium"
        >
          {label}
          <ArrowUpRight
            aria-hidden="true"
            className="text-ink-500 size-4 shrink-0"
            strokeWidth={2}
          />
        </Link>
      </Dialog.Close>
    </li>
  );
}
