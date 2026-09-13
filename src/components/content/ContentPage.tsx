import type { ReactNode } from "react";
import { buildToc } from "@/lib/content/toc";
import { cn } from "@/lib/utils/cn";

/**
 * Long-form page layout (design spec F11).
 *
 * A sticky table of contents beside the prose on desktop, collapsing to a
 * native `<details>` disclosure below `md`. `<details>` rather than a custom
 * component: it is keyboard-operable, announced correctly, and works before
 * hydration — on a reference page that people reach mid-problem, that last
 * property is worth more than a matching animation.
 *
 * The measure is capped by `--container-prose` (680px), which is the 68–72
 * character line the design asks for at our body size.
 */
export function ContentPage({
  title,
  intro,
  lede,
  sections,
  children,
}: {
  title: string;
  intro?: string;
  /**
   * Optional block rendered under the intro, above the contents/prose row.
   *
   * For the one thing a reader must see before they start reading — a
   * legal page's dates, or a notice that changes what they should do. It
   * sits in the header rather than as the first child so it stays above the
   * table of contents on mobile, where the prose column begins below a
   * collapsed disclosure.
   */
  lede?: ReactNode;
  /** Section headings, in document order. Ids are derived from them. */
  sections: readonly string[];
  children: ReactNode;
}) {
  const toc = buildToc(sections);

  return (
    <div className="max-w-page mx-auto w-full px-4 py-8 md:px-6 md:py-12">
      <header className="max-w-prose">
        <h1 className="text-display-lg text-ink-950">{title}</h1>
        {intro && <p className="text-body-lg text-ink-600 mt-3">{intro}</p>}
        {lede && <div className="mt-6 space-y-4">{lede}</div>}
      </header>

      <div className="mt-8 gap-10 md:flex md:items-start">
        {/*
          Two properties the sticky column needs on a long page.
          
          It sticks BELOW the 64px header (Header.tsx) rather than at the
          viewport top, which is where `top-8` put it — the first entries
          of any contents list were sliding under the header and could not
          be clicked. The offset matches the `scroll-mt` an anchored
          heading already uses, so a jumped-to heading and the list that
          jumped there clear the same chrome.
          
          And it scrolls within itself once its list is taller than the
          screen. A thirty-six-clause legal page is the case that needs it:
          without a bound, a sticky element taller than the viewport pins
          its TOP and the last entries are simply unreachable. Shorter
          pages never reach the bound, so their list is unchanged.
        */}
        <nav
          aria-label="On this page"
          className="md:sticky md:top-20 md:max-h-[calc(100vh-6rem)] md:w-56 md:shrink-0 md:overflow-y-auto"
        >
          <details className="border-ink-200 rounded-md border md:border-0" open={false}>
            <summary className="text-body-sm text-ink-700 cursor-pointer px-4 py-3 md:hidden">
              Contents
            </summary>
            <TocList toc={toc} className="px-4 pb-3 md:px-0 md:pb-0" />
          </details>
          {/* Always expanded at md and above; the disclosure above is hidden. */}
          <div className="hidden md:block">
            <p className="text-overline text-ink-500 uppercase">On this page</p>
            <TocList toc={toc} className="mt-2" />
          </div>
        </nav>

        <div className="max-w-prose min-w-0 flex-1 space-y-10">{children}</div>
      </div>
    </div>
  );
}

function TocList({
  toc,
  className,
}: {
  toc: readonly { title: string; id: string }[];
  className?: string;
}) {
  return (
    <ul className={cn("space-y-1.5", className)}>
      {toc.map((section) => (
        <li key={section.id}>
          <a
            href={`#${section.id}`}
            className="text-body-sm text-ink-600 hover:text-ink-950 underline-offset-2 hover:underline"
          >
            {section.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * One section, with the anchor its table-of-contents entry points at.
 *
 * `scroll-mt` keeps the heading clear of the sticky chrome when jumped to —
 * without it the anchor lands with the heading hidden behind the header, which
 * reads as a broken link.
 */
export function ContentSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-heading-1 text-ink-950">{title}</h2>
      <div className="text-body text-ink-700 mt-3 space-y-3">{children}</div>
    </section>
  );
}
