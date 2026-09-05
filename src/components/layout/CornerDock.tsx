import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The bottom-right corner dock.
 *
 * The app has more than one floating control now (help, then the theme
 * toggle), and the moment there is a second one, "fixed to the corner" has
 * to become a shared layout rather than a class each control repeats. That
 * is the whole job of this component: one set of safe-area insets, one
 * stacking context, one gap — so two controls cannot land on top of each
 * other, and a third can be added without arithmetic.
 *
 * `max()` against the safe-area insets keeps the stack clear of the home
 * indicator and of a rounded display's corner rather than tucking under
 * either.
 *
 * It stacks vertically only where there is room beside the content column.
 * At 360px there is none: a column of floating controls would occlude a
 * second row of the page, and on a bridge form every row is a control
 * somebody needs. Below `md` the controls sit in a single row along the
 * bottom edge instead, so the band of screen this chrome covers is no taller
 * than the one control that was already there.
 *
 * Pointer events are off on the dock itself and back on for its children:
 * the container is as wide as its widest control, so without this the empty
 * strip beside a narrower one would silently swallow clicks meant for the
 * page underneath.
 */
export function CornerDock({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none fixed z-30 flex items-end gap-3 md:flex-col [&>*]:pointer-events-auto",
        "right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))]",
        "md:right-6 md:bottom-6",
        // Floating controls are chrome, and chrome does not belong on paper.
        "print:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}
