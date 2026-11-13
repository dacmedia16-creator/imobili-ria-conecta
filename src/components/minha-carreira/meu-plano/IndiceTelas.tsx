import { useState } from "react";
import { List } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Respostas } from "@/lib/meu-plano-2027/regras";
import { ORDEM, statusTela, tela } from "@/lib/meu-plano-2027/telas";

/** Selo do índice: mesma regra do % do plano (statusTela). "auto" = tela automática, conta como pronta. */
const SELO: Record<string, { txt: string; cls: string }> = {
  ok: { txt: "✔ preenchida", cls: "text-emerald-700 dark:text-emerald-400" },
  auto: { txt: "✔ automática", cls: "text-emerald-700 dark:text-emerald-400" },
  parc: { txt: "em parte", cls: "text-amber-700 dark:text-amber-400" },
  vazio: { txt: "vazia", cls: "text-muted-foreground" },
};

/**
 * Índice do plano (t_0d2a2b8f; caminho único desde t_296fc69e): lista todas as telas, na ordem, com o
 * status de cada uma; tocar num item leva direto à tela. Só navega: não grava nada nem muda a ordem.
 */
export function IndiceTelas({
  atual,
  S,
  irTela,
}: {
  atual: string;
  S: Respostas;
  irTela: (id: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const ids = ORDEM;
  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1 font-semibold text-primary"
        onClick={() => setAberto(true)}
        data-testid="abrir-indice"
        aria-label="Abrir o índice de telas do plano"
      >
        <List className="h-3.5 w-3.5" aria-hidden /> Índice
      </button>
      <Sheet open={aberto} onOpenChange={setAberto}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto rounded-t-2xl px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4"
          data-testid="indice-telas"
        >
          <SheetHeader className="text-left">
            <SheetTitle>Meu Plano 2027 · índice</SheetTitle>
            <SheetDescription>Toque numa tela para ir direto a ela.</SheetDescription>
          </SheetHeader>
          <ol className="mt-3 space-y-1">
            {ids.map((id, i) => {
              const t = tela(id);
              if (!t) return null;
              const st = statusTela(id, S) ?? "vazio";
              const selo = SELO[st] ?? SELO.vazio;
              const eAtual = id === atual;
              return (
                <li key={id}>
                  <button
                    type="button"
                    data-testid={`indice-item-${id}`}
                    aria-current={eAtual ? "step" : undefined}
                    onClick={() => {
                      setAberto(false);
                      if (!eAtual) irTela(id);
                    }}
                    className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left ${eAtual ? "border-primary bg-primary/10" : "bg-card hover:bg-muted"}`}
                  >
                    <span className="mt-0.5 w-6 shrink-0 text-right text-sm font-bold text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-bold uppercase tracking-wide text-primary">
                        {t.ev}
                      </span>
                      <span className="block text-sm font-medium leading-snug">{t.t}</span>
                      <span className={`block text-xs ${selo.cls}`}>
                        {eAtual ? <b className="text-primary">● você está aqui · </b> : null}
                        {selo.txt}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </SheetContent>
      </Sheet>
    </>
  );
}
