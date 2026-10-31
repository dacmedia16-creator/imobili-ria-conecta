import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { FLOW_STAGES, isReturnStatus, type SaleStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

/** Mostra visualmente em qual das 6 macro-etapas do fluxo (corretor -> gestor -> jurídico -> contrato -> financeiro -> concluída) a venda está.
 * No celular as etapas não cabem: a etapa atual rola para a vista e um esmaecido com seta indica
 * que há mais etapas para os lados (item 13 t_8730be75). */
export function SaleFlowStepper({ status }: { status: SaleStatus }) {
  const currentIndex = FLOW_STAGES.findIndex((s) => s.statuses.includes(status));
  const returned = isReturnStatus(status);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atualRef = useRef<HTMLDivElement>(null);
  const [mais, setMais] = useState({ esquerda: false, direita: false });

  const medir = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setMais({
      esquerda: el.scrollLeft > 4,
      direita: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    const atual = atualRef.current;
    if (el && atual && el.scrollWidth > el.clientWidth) {
      el.scrollLeft = Math.max(0, atual.offsetLeft - el.clientWidth / 2 + atual.offsetWidth / 2);
    }
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [currentIndex, medir]);

  if (currentIndex === -1) return null; // status fora do fluxo linear (ex: arquivada/cancelada)

  return (
    <div className="relative" data-testid="sale-flow-stepper">
      <div ref={scrollRef} onScroll={medir} className="flex items-start overflow-x-auto pb-1">
        {FLOW_STAGES.map((stage, i) => {
          const done = i < currentIndex;
          const current = i === currentIndex;
          return (
            <div
              key={stage.key}
              ref={current ? atualRef : undefined}
              className="flex items-start"
              aria-current={current ? "step" : undefined}
            >
              <div className="flex flex-col items-center gap-1">
                <div
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                    done && "border-emerald-500 bg-emerald-500 text-white",
                    current && !returned && "border-primary bg-primary text-primary-foreground",
                    current && returned && "border-amber-500 bg-amber-500 text-white",
                    !done &&
                      !current &&
                      "border-muted-foreground/30 bg-muted text-muted-foreground",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <span
                  className={cn(
                    "w-16 whitespace-nowrap text-center text-[11px] leading-tight",
                    current ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {stage.label}
                  {current && returned && (
                    <span className="block text-amber-600 dark:text-amber-400">devolvida</span>
                  )}
                </span>
              </div>
              {i < FLOW_STAGES.length - 1 && (
                <div
                  className={cn(
                    "mx-1 mt-3 h-0.5 w-6 shrink-0 sm:w-10",
                    i < currentIndex ? "bg-emerald-500" : "bg-muted-foreground/20",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
      {mais.esquerda && (
        <div
          aria-hidden
          data-testid="stepper-mais-esquerda"
          className="pointer-events-none absolute inset-y-0 left-0 flex w-8 items-start bg-gradient-to-r from-background to-transparent pt-1"
        >
          <ChevronLeft className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      {mais.direita && (
        <div
          aria-hidden
          data-testid="stepper-mais-direita"
          className="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-start justify-end bg-gradient-to-l from-background to-transparent pt-1"
        >
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
