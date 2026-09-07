import type { Chain } from "@/lib/api/schemas/common";
import { cn } from "@/lib/utils/cn";

/**
 * ChainBadge (design spec E2 "chain accent colors", G3).
 *
 * Chain colour is IDENTITY, never state. Goldcoin's accent is the brand gold,
 * Solana's is violet and Robinhood Network's is teal; none of them means
 * "healthy" or "failed", and none is ever used to convey status. That
 * separation is the reason status tones carry no gold anywhere in the system.
 *
 * The badge is a diamond mark plus the chain's name. The mark alone would be a
 * bare coloured glyph, which acceptance criterion 1 forbids.
 */

const chainStyles: Record<Chain, { readonly mark: string; readonly label: string }> = {
  goldcoin: { mark: "text-chain-goldcoin", label: "Goldcoin" },
  solana: { mark: "text-chain-solana", label: "Solana" },
  // Identity, like the two above — never a status. A Robinhood route being
  // closed is said in words, never by tinting its chain mark.
  robinhood: { mark: "text-chain-robinhood", label: "Robinhood Network" },
};

export function ChainBadge({ chain, className }: { chain: Chain; className?: string }) {
  const style = chainStyles[chain];

  return (
    <span
      className={cn(
        "text-label text-ink-700 inline-flex items-center gap-1.5 font-medium",
        className,
      )}
    >
      <span aria-hidden="true" className={style.mark}>
        ◆
      </span>
      {style.label}
    </span>
  );
}
