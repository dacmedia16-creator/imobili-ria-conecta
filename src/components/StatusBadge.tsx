import { STATUS_LABEL, STATUS_TONE, type SaleStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: SaleStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_TONE[status], className)}>
      {STATUS_LABEL[status]}
    </span>
  );
}
