import { ChevronRight } from "lucide-react";
import type { Respostas } from "@/lib/meu-plano-2027/regras";
import { pendencias } from "@/lib/meu-plano-2027/telas";

/**
 * "O que falta para 100%" (Denis, 19/11, t_5b05b9cd): lista curta das telas obrigatórias ainda incompletas,
 * mesma regra do % (pendencias). Com `irTela` (corretor), cada item leva à tela; sem ele (broker/Equipe),
 * só leitura. Telas opcionais (p45, p49) nunca entram. Plano 100% = não mostra nada.
 */
export function OQueFalta({
  S,
  irTela,
  aberto = false,
}: {
  S: Respostas;
  irTela?: (id: string) => void;
  aberto?: boolean;
}) {
  const lista = pendencias(S);
  if (!lista.length) return null;
  const campos = lista.reduce((s, x) => s + x.faltam, 0);
  return (
    <details
      open={aberto}
      className="rounded-xl border border-amber-300/70 bg-amber-50/60 text-sm dark:border-amber-700/60 dark:bg-amber-950/20"
      data-testid="o-que-falta"
    >
      <summary className="cursor-pointer px-3 py-2 font-semibold text-amber-900 dark:text-amber-200">
        Falta{lista.length > 1 ? "m" : ""} {lista.length} tela{lista.length > 1 ? "s" : ""} para
        100% ({campos} campo{campos > 1 ? "s" : ""})
      </summary>
      <ul className="space-y-1 px-2 pb-2">
        {lista.map((x) => (
          <li key={x.id}>
            {irTela ? (
              <button
                type="button"
                onClick={() => irTela(x.id)}
                data-testid={`falta-${x.id}`}
                className="flex w-full items-center gap-2 rounded-lg bg-card px-2.5 py-1.5 text-left hover:bg-muted"
              >
                <span className="min-w-0 flex-1 truncate">{x.t}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  falta{x.faltam > 1 ? "m" : ""} {x.faltam}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              </button>
            ) : (
              <div
                data-testid={`falta-${x.id}`}
                className="flex items-center gap-2 rounded-lg bg-card px-2.5 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate">{x.t}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  falta{x.faltam > 1 ? "m" : ""} {x.faltam}
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
