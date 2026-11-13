import { Check } from "lucide-react";
import type { CaptureStatus } from "@/lib/exclusive-captures";
import { ETAPAS_CAPTACAO, indiceEtapa } from "@/lib/captacoes-painel";
import { cn } from "@/lib/utils";

/**
 * Barra compacta das 4 etapas da captação (Corretor > Gestor > Assinatura > Aprovada) para o
 * cartão da lista (t_abf93125). Copia o visual do SaleFlowStepper de vendas sem alterá-lo.
 * Devolvida fica em âmbar na etapa Corretor; aprovada mostra as 4 etapas concluídas.
 * As 4 etapas cabem num celular de 360 px, então não precisa da rolagem lateral de vendas.
 */
export function CaptacaoStepper({ status }: { status: CaptureStatus }) {
  const atual = indiceEtapa(status);
  const devolvida = status === "devolvida";
  const concluida = status === "aprovada";
  return (
    <div
      className="mt-3 flex items-start"
      data-testid="captacao-stepper"
      aria-label="Etapas da captação"
    >
      {ETAPAS_CAPTACAO.map((etapa, i) => {
        const feita = i < atual || (concluida && i === atual);
        const corrente = i === atual && !concluida;
        return (
          <div
            key={etapa.key}
            className="flex items-start"
            aria-current={i === atual ? "step" : undefined}
          >
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                  feita && "border-emerald-500 bg-emerald-500 text-white",
                  corrente && !devolvida && "border-primary bg-primary text-primary-foreground",
                  corrente && devolvida && "border-amber-500 bg-amber-500 text-white",
                  !feita &&
                    !corrente &&
                    "border-muted-foreground/30 bg-muted text-muted-foreground",
                )}
              >
                {feita ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span
                className={cn(
                  "w-[4.25rem] whitespace-nowrap text-center text-[11px] leading-tight",
                  i === atual ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {etapa.label}
                {corrente && devolvida && (
                  <span className="block text-amber-600 dark:text-amber-400">devolvida</span>
                )}
              </span>
            </div>
            {i < ETAPAS_CAPTACAO.length - 1 && (
              <div
                className={cn(
                  "mt-3 h-0.5 w-3 shrink-0 sm:w-6",
                  i < atual ? "bg-emerald-500" : "bg-muted-foreground/20",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
