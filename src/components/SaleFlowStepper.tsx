import { Check } from "lucide-react";
import { FLOW_STAGES, isReturnStatus, type SaleStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

/** Mostra visualmente em qual das 6 macro-etapas do fluxo (corretor -> gestor -> jurídico -> contrato -> financeiro -> concluída) a venda está. */
export function SaleFlowStepper({ status }: { status: SaleStatus }) {
  const currentIndex = FLOW_STAGES.findIndex((s) => s.statuses.includes(status));
  if (currentIndex === -1) return null; // status fora do fluxo linear (ex: arquivada/cancelada)
  const returned = isReturnStatus(status);

  return (
    <div className="flex items-start overflow-x-auto pb-1">
      {FLOW_STAGES.map((stage, i) => {
        const done = i < currentIndex;
        const current = i === currentIndex;
        return (
          <div key={stage.key} className="flex items-start">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                  done && "border-emerald-500 bg-emerald-500 text-white",
                  current && !returned && "border-primary bg-primary text-primary-foreground",
                  current && returned && "border-amber-500 bg-amber-500 text-white",
                  !done && !current && "border-muted-foreground/30 bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span className={cn("w-16 whitespace-nowrap text-center text-[11px] leading-tight", current ? "font-medium text-foreground" : "text-muted-foreground")}>
                {stage.label}
                {current && returned && <span className="block text-amber-600 dark:text-amber-400">devolvida</span>}
              </span>
            </div>
            {i < FLOW_STAGES.length - 1 && (
              <div className={cn("mx-1 mt-3 h-0.5 w-6 shrink-0 sm:w-10", i < currentIndex ? "bg-emerald-500" : "bg-muted-foreground/20")} />
            )}
          </div>
        );
      })}
    </div>
  );
}
