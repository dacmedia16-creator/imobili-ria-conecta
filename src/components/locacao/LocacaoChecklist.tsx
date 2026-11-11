// Checklist do que falta por parte (t_28e583e2): Locatário PF/PJ, garantia (Fiador PF/PJ, Caução, Seguro-fiança) e
// Proprietário PF/PJ, com a data em que a documentação ficou completa. Só leitura: quem anexa é o corretor, na etapa
// Documentação. Visível a todos que veem a locação (corretor, gestora, setor de contratos…). O banco calcula tudo.
import { CheckCircle2, Circle, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LocacaoDetalhe as Detalhe } from "@/lib/locacao";

function quando(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";
}

export function ChecklistPartes({ d }: { d: Detalhe }) {
  if (!d.partes.length) return null;
  return (
    <Card className="max-md:scroll-mt-20 max-md:pb-16" data-testid="locacao-checklist-partes">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          Documentos por parte
          {d.docsCompleta ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-normal text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100">
              completa{d.docsCompletosEm ? ` em ${quando(d.docsCompletosEm)}` : ""}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-normal text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
              <Lock className="h-3 w-3" /> falta {d.faltando.length} — “Montar contrato” travado
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {d.partes.map((p) => {
          const obrig = p.itens.filter((i) => i.obrigatorio);
          const faltam = obrig.filter((i) => !i.entregue).length;
          return (
            <div key={p.parte} className="rounded-md border p-2 text-sm">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <b>{p.rotulo}</b>
                <span
                  className={`text-xs ${faltam ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}
                >
                  {faltam ? `falta ${faltam}` : "ok"}
                </span>
              </div>
              <ul className="space-y-0.5">
                {p.itens.map((i) => (
                  <li key={i.item} className="flex items-start gap-1.5">
                    {i.entregue ? (
                      <CheckCircle2
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600"
                        aria-label="entregue"
                      />
                    ) : (
                      <Circle
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${i.obrigatorio ? "text-amber-600" : "text-muted-foreground"}`}
                        aria-label={i.obrigatorio ? "falta" : "opcional"}
                      />
                    )}
                    <span className={i.entregue ? "text-muted-foreground" : undefined}>
                      {i.item}
                      {!i.obrigatorio && (
                        <span className="ml-1 text-[10px] text-muted-foreground">(não trava)</span>
                      )}
                    </span>
                  </li>
                ))}
                {!p.itens.length && (
                  <li className="text-xs text-muted-foreground">Nenhum documento nesta lista.</li>
                )}
              </ul>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
