import { STATUS_LABEL, STATUS_TONE, type SaleStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

export function StatusBadge({
  status,
  className,
  label,
}: {
  status: SaleStatus;
  className?: string;
  /** Texto no lugar do rótulo padrão (ex.: "Aguardando assinatura manual"). */
  label?: string | null;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_TONE[status],
        className,
      )}
    >
      {label || STATUS_LABEL[status]}
    </span>
  );
}
