import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { StatusBadge, TokenAmount } from "@/components/ui";
import { requestStateStatus } from "@/lib/status";
import { routeDisplay } from "@/lib/bridge";
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";
import type { TransferViewDto } from "@/lib/api/schemas/transfer";

export function TransferRow({ transfer }: { transfer: TransferViewDto }) {
  const descriptor = routeDisplay(transfer.direction);
  const created = new Date(transfer.created_at * 1000);

  return (
    <Link
      href={`/bridge/${transfer.id}`}
      className="border-ink-100 hover:bg-ink-50 focus-visible:bg-ink-50 flex flex-col gap-2 border-b px-4 py-3 outline-none last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center gap-2">
        <span className="text-body-sm text-ink-700 flex items-center gap-1">
          {descriptor.from.token.name}
          <ArrowRight aria-hidden="true" className="size-3.5" />
          {descriptor.to.token.name}
        </span>
        <span className="text-body-sm text-ink-500">#{transfer.id}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <TokenAmount
          raw={String(transfer.gross_amount_atomic)}
          decimals={GOLDCOIN_DECIMALS}
          symbol="GLC"
        />
        <StatusBadge status={requestStateStatus[transfer.state]} size="sm" />
        <time dateTime={created.toISOString()} className="text-body-sm text-ink-500">
          {created.toLocaleString()}
        </time>
      </div>
    </Link>
  );
}
