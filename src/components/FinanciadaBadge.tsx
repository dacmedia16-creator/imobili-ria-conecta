import { Landmark } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { detalheFinanciada, ehFinanciada } from "@/lib/vendas-pagamento-filtro";
import { cn } from "@/lib/utils";

/**
 * Etiqueta "Financiada" (t_7538ddac). Aparece só quando tipo_pagamento = 'financiamento'.
 * Mouse: o título nativo mostra banco/correspondente. Toque/clique: abre um balão com o mesmo
 * texto, sem disparar o clique da linha (que abriria a venda).
 */
export function FinanciadaBadge({
  tipo,
  banco,
  correspondente,
  className,
}: {
  tipo: string | null | undefined;
  banco?: string | null;
  correspondente?: string | null;
  className?: string;
}) {
  if (!ehFinanciada(tipo)) return null;
  const detalhe = detalheFinanciada(banco, correspondente);
  const parar = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={detalhe}
          aria-label={detalhe}
          onClick={parar}
          onKeyDown={parar}
          className={cn(
            "inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-900 dark:bg-sky-950 dark:text-sky-200",
            className,
          )}
        >
          <Landmark className="h-3 w-3" aria-hidden />
          Financiada
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-xs p-2 text-xs" onClick={parar}>
        {detalhe}
      </PopoverContent>
    </Popover>
  );
}
