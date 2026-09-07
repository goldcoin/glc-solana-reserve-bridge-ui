"use client";

import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * The control between the two panels that reverses the transfer.
 *
 * # Why it can be unavailable
 *
 * Reversing is only offered when the reverse pair is STRUCTURALLY DEFINED
 * — when the backend has a route for it at all. It is deliberately not
 * gated on that route being OPEN: flipping into a closed route is a
 * legitimate thing to do, and the form then explains that it is closed.
 * Flipping into a pair no route describes is not, because there would be
 * nothing to explain and nothing to quote.
 *
 * Reversing is never silently partial. The caller clears recipient state
 * that belonged to the old destination network, because a Solana address
 * left sitting in a field that now wants a Goldcoin one is the single
 * most dangerous thing this control could leave behind.
 */
export function DirectionSwitch({
  onSwitch,
  disabled,
  disabledReason,
}: {
  onSwitch: () => void;
  disabled: boolean;
  /** Why reversing is unavailable, for assistive tech and a tooltip. */
  disabledReason?: string | undefined;
}) {
  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={onSwitch}
        disabled={disabled}
        aria-label="Reverse transfer direction"
        {...(disabled && disabledReason ? { title: disabledReason } : {})}
        className={cn(
          "border-ink-200 bg-surface-raised grid size-10 place-items-center rounded-full border transition-colors",
          disabled
            ? "cursor-not-allowed opacity-50"
            : "hover:bg-ink-50 focus-visible:border-ink-400",
        )}
      >
        <ArrowUpDown aria-hidden="true" className="text-ink-600 size-4" />
      </button>
    </div>
  );
}
