"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * One half of the bridge form: a network, an amount, and whatever context
 * that network needs.
 *
 * The FROM and TO panels are the SAME component. Everything that differs
 * between them — an editable amount versus a quoted one, a wallet connect
 * versus a recipient field — arrives as a slot, so the layout is defined
 * once and cannot drift between the two halves as networks are added.
 */
export function NetworkPanel({
  label,
  selector,
  amount,
  context,
  className,
}: {
  /** "From" / "To". */
  label: string;
  /** The network picker. */
  selector: ReactNode;
  /** The amount row — editable on the source side, quoted on the destination side. */
  amount: ReactNode;
  /** Wallet, balance, or recipient controls for this network. May be absent. */
  context?: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "border-ink-200 bg-surface flex flex-col gap-3 rounded-xl border p-4",
        className,
      )}
    >
      <p className="text-label text-ink-500 font-medium tracking-wide uppercase">
        {label}
      </p>
      {selector}
      {amount}
      {context}
    </section>
  );
}

/**
 * The editable amount row, for the source panel.
 *
 * The value stays a STRING from keystroke to submission — it is parsed to
 * exact base units by `validateAmount` and never passes through a
 * JavaScript number, because an 18-decimal Robinhood amount exceeds what a
 * double represents exactly by orders of magnitude.
 */
export function AmountInput({
  id,
  value,
  onChange,
  symbol,
  disabled = false,
  ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  symbol: string;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <div className="border-ink-200 focus-within:border-ink-400 flex items-center rounded-lg border pr-3 transition-colors">
      <input
        id={id}
        aria-label={ariaLabel}
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0.00"
        // An explicit colour rather than an inherited one: the panel sits on a
        // tinted surface in dark mode, where an inherited value renders the
        // typed amount dimmer than the quoted one beside it.
        className="text-heading-2 tabular text-ink-900 placeholder:text-ink-500 min-w-0 flex-1 rounded-lg bg-transparent px-3 py-2.5 outline-none disabled:cursor-not-allowed"
      />
      <span className="text-body text-ink-500 font-medium">{symbol}</span>
    </div>
  );
}

/**
 * The read-only received amount, for the destination panel.
 *
 * Never computed here. The figure is `QuoteOutput.net_display_amount`, the
 * backend's own server-authoritative string — this UI does not do bridge
 * arithmetic, and a locally-derived "you receive" would be a second
 * calculation free to disagree with the one that actually settles.
 */
export function AmountEstimate({
  value,
  symbol,
  ariaLabel,
  pending = false,
}: {
  /** The backend's display string, or null when there is no quote to show. */
  value: string | null;
  symbol: string;
  ariaLabel: string;
  pending?: boolean;
}) {
  return (
    <div
      aria-label={ariaLabel}
      role="status"
      className="border-ink-200 bg-ink-50/40 flex items-center rounded-lg border pr-3"
    >
      <span
        className={cn(
          "text-heading-2 tabular min-w-0 flex-1 truncate px-3 py-2.5",
          // `ink-400` on the panel's tinted background falls below the 3:1
          // contrast threshold even at this size — a placeholder still has
          // to be readable.
          value === null ? "text-ink-500" : "text-ink-900",
        )}
      >
        {pending ? "…" : (value ?? "0.00")}
      </span>
      <span className="text-body text-ink-500 font-medium">{symbol}</span>
    </div>
  );
}
