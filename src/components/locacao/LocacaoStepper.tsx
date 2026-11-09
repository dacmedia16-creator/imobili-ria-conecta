import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ETAPAS,
  PAPEL_LABEL,
  diasParado,
  etapaIndex,
  textoParado,
  type EtapaLocacao,
} from "@/lib/locacao";

/**
 * Esteira da locação: 9 etapas com o responsável de cada uma (mesmo visual do SaleFlowStepper da venda).
 * Atual em azul; devolvida em âmbar; concluídas em verde. Clicar numa bolinha mostra aquela etapa.
 */
export function LocacaoStepper({
  etapa,
  devolvida,
  etapaDesde,
  vendo,
  onVer,
}: {
  etapa: EtapaLocacao;
  devolvida: boolean;
  etapaDesde: string;
  vendo?: number;
  onVer?: (i: number) => void;
}) {
  const atual = etapaIndex(etapa);
  return (
    <div className="flex items-start overflow-x-auto pb-1" data-testid="locacao-stepper">
      {ETAPAS.map((e, i) => {
        const feita = i < atual;
        const corrente = i === atual;
        return (
          <div
            key={e.key}
            className="flex items-start"
            aria-current={corrente ? "step" : undefined}
          >
            <button
              type="button"
              onClick={() => onVer?.(i)}
              className="flex flex-col items-center gap-1 rounded-md px-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Etapa ${i + 1}: ${e.label}`}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                  feita && "border-emerald-500 bg-emerald-500 text-white",
                  corrente && !devolvida && "border-primary bg-primary text-primary-foreground",
                  corrente && devolvida && "border-amber-500 bg-amber-500 text-white",
                  !feita &&
                    !corrente &&
                    "border-muted-foreground/30 bg-muted text-muted-foreground",
                  vendo === i && "ring-2 ring-primary/40 ring-offset-1",
                )}
              >
                {feita ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span
                className={cn(
                  "w-20 text-center text-[11px] leading-tight",
                  corrente ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {e.label}
                <span className="block text-[10px] text-muted-foreground">
                  {PAPEL_LABEL[e.papel]}
                </span>
                {corrente && devolvida && (
                  <span className="block text-amber-600 dark:text-amber-400">devolvida</span>
                )}
                {corrente && (
                  <span className="block text-[10px]">{textoParado(diasParado(etapaDesde))}</span>
                )}
              </span>
            </button>
            {i < ETAPAS.length - 1 && (
              <div
                className={cn(
                  "mx-0.5 mt-3 h-0.5 w-4 shrink-0 sm:w-6",
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
