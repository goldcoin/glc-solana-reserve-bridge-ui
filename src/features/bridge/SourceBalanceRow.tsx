"use client";

import { formatDisplayAmount } from "@/lib/format/amount";
import { cn } from "@/lib/utils/cn";
import type { SourceBalanceState } from "./useSourceBalance";

/**
 * The `Balance: 12,450.32 GLC        MAX` row under the source amount.
 *
 * Renders NOTHING when there is no balance to speak of — an unsupported
 * network or a wallet that is not connected. An empty "Balance: —" row
 * would be a placeholder implying a figure is coming, when for a Goldcoin
 * source none ever is.
 *
 * The balance is shown at the app's usual two-decimal display precision.
 * The exact base units behind it never pass through this component: MAX
 * works from the raw string, so what the button fills in is exact even
 * though what the user reads is rounded.
 */
export function SourceBalanceRow({
  balance,
  maxAmount,
  onMax,
}: {
  balance: SourceBalanceState;
  /**
   * The largest amount that could actually be bridged, in source base
   * units, or `null` when there is nothing to offer. `null` disables MAX:
   * a button that fills in an amount the form then rejects is worse than
   * one that is plainly unavailable.
   */
  maxAmount: string | null;
  onMax: () => void;
}) {
  if (balance.kind === "unsupported" || balance.kind === "disconnected") return null;

  return (
    <div className="mt-1 flex items-center justify-between gap-3">
      <p className="text-body-sm text-ink-500 min-w-0 truncate">
        {balance.kind === "known" ? (
          <>
            Balance:{" "}
            <span className="tabular text-ink-700">
              {formatDisplayAmount(balance.raw, balance.decimals)} {balance.symbol}
            </span>
          </>
        ) : balance.kind === "loading" ? (
          "Balance: …"
        ) : (
          // Never "0": a balance that could not be read and a balance of
          // zero mean entirely different things to someone about to bridge.
          "Balance unavailable"
        )}
      </p>

      <button
        type="button"
        onClick={onMax}
        disabled={maxAmount === null}
        // The reason travels with the control, not only as a visual state.
        {...(maxAmount === null
          ? { title: "No amount is available to bridge right now." }
          : {})}
        className={cn(
          "text-label shrink-0 rounded-full border px-2.5 py-1 font-medium transition-colors",
          "focus-visible:border-ink-500 focus-visible:ring-ink-300 outline-none focus-visible:ring-2",
          maxAmount === null
            ? "border-ink-200 text-ink-400 cursor-not-allowed"
            : "border-ink-300 text-ink-700 hover:bg-ink-50",
        )}
      >
        MAX
      </button>
    </div>
  );
}
