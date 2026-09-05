"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme, type ResolvedTheme } from "@/lib/theme";
import { cn } from "@/lib/utils/cn";

/**
 * The theme control (design spec E2 "dark mode is a theme file").
 *
 * A two-segment pill, built from the same tokens, radius and elevation as
 * every other surface — it reads as part of the chrome rather than as a
 * widget bolted on. It is positioned by `CornerDock`, which owns the
 * bottom-right stack it shares with the help control; this component only
 * describes itself.
 *
 * Two things about it are deliberate and worth stating.
 *
 * FIRST: the segments show which theme is ACTIVE, not which preference is
 * stored. A visitor who has never touched it is on `system`, and the segment
 * matching their operating system lights up — because that is what they are
 * looking at. Pressing either segment turns that into an explicit, persisted
 * choice.
 *
 * SECOND: the selected segment is drawn entirely by CSS, through the `dark`
 * variant, and not from React state. The pre-paint script has already put the
 * class on <html> by the time this markup is parsed, so the pill is painted
 * correctly on the very first frame, and the server can render one fixed
 * markup for both themes with nothing to mismatch at hydration. Only
 * `aria-pressed` comes from the store, and it comes through
 * `useSyncExternalStore`, whose server snapshot is what hydration compares
 * against.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, setPreference } = useTheme();

  return (
    /*
      Its own landmark, matching how AppShell groups the notice strip. A
      floating control that belongs to no region is content a screen-reader
      user can only reach by walking the whole page, and it is the one thing
      on screen that is in neither the header, the main outlet nor the footer.
    */
    <div role="region" aria-label="Appearance" className={className}>
      <div
        role="group"
        aria-label="Colour theme"
        className={cn(
          "border-ink-200 bg-surface-raised shadow-elev-2 hover:shadow-elev-3 relative flex items-center rounded-full border p-1",
          "transition-shadow duration-[var(--duration-base)] ease-[var(--ease-standard)]",
        )}
      >
        {/*
        The moving indicator. One element that slides, rather than a
        background toggled on each button, so the transition reads as a single
        object changing position — and it collapses to an instant jump under
        `prefers-reduced-motion` via the global rule in globals.css.
      */}
        <span
          aria-hidden="true"
          className={cn(
            "bg-ink-200 pointer-events-none absolute top-1 left-1 size-9 rounded-full",
            "transition-transform duration-[var(--duration-base)] ease-[var(--ease-standard)]",
            "dark:translate-x-9",
          )}
        />

        <Segment
          theme="light"
          active={resolved === "light"}
          onSelect={setPreference}
          // Active in light, muted in dark — the inverse of the moon below.
          toneClassName="text-ink-950 dark:text-ink-500"
        />
        <Segment
          theme="dark"
          active={resolved === "dark"}
          onSelect={setPreference}
          toneClassName="text-ink-500 dark:text-ink-950"
        />
      </div>
    </div>
  );
}

const segmentCopy = {
  light: { label: "Light theme", Icon: Sun },
  dark: { label: "Dark theme", Icon: Moon },
} as const;

function Segment({
  theme,
  active,
  onSelect,
  toneClassName,
}: {
  theme: ResolvedTheme;
  active: boolean;
  onSelect: (theme: ResolvedTheme) => void;
  toneClassName: string;
}) {
  const { label, Icon } = segmentCopy[theme];

  return (
    <button
      type="button"
      // Not a radiogroup: two independent toggles with `aria-pressed` need no
      // roving tabindex and no arrow-key contract, so both segments are
      // reachable by Tab alone, which is what a two-item control should be.
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={() => onSelect(theme)}
      className={cn(
        "relative inline-flex size-9 cursor-pointer items-center justify-center rounded-full",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
        // The global focus rule squares the outline off at --radius-sm, which
        // would cut the corners of a circular target.
        "focus-visible:rounded-full",
        toneClassName,
      )}
    >
      <Icon aria-hidden="true" className="size-4" strokeWidth={2} />
    </button>
  );
}
