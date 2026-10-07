import { agingInfo, type AgingLimites } from "@/lib/status";
import { cn } from "@/lib/utils";

/** Indicador de "há quanto tempo" a venda está parada numa etapa/status, colorido por faixa (verde/âmbar/vermelho). */
export function AgingBadge({
  since,
  className,
  limites,
}: {
  since: string;
  className?: string;
  limites?: AgingLimites;
}) {
  const { label, tone } = agingInfo(since, limites);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "destructive" && "bg-destructive/15 text-destructive",
        tone === "amber" && "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
        tone === "muted" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      {label}
    </span>
  );
}
