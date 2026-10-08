import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WEIGHT_LABEL, type FeedbackAction } from "@/lib/owner-feedback-actions";
import { groupDossie, missingVitals } from "@/lib/capture-dossie";

const WEIGHT_STYLE: Record<string, string> = {
  vital: "bg-red-100 text-red-800",
  importante: "bg-amber-100 text-amber-800",
  complementar: "bg-slate-100 text-slate-700",
};

/** Etapa "Dossiê" da captação: o corretor marca as ações do plano de marketing. */
export function CaptureDossieStep({
  actions,
  selected,
  editable,
  loading,
  onChange,
  title = "Planejamento de Marketing",
  intro = "Obrigatório: marque as ações que você vai fazer por este imóvel. O Dossiê sai anexado ao final do contrato, com assinatura do proprietário, e o Feedback mostra depois o que foi cumprido.",
  optional = false,
}: {
  actions: FeedbackAction[];
  selected: string[];
  editable: boolean;
  loading: boolean;
  onChange: (ids: string[]) => void;
  /** Cadastro manual (contrato já assinado): título/texto próprios e seleção opcional. */
  title?: string;
  intro?: string;
  optional?: boolean;
}) {
  const groups = groupDossie(actions);
  const set = new Set(selected);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const count = groups.reduce((n, g) => n + g.items.filter((a) => set.has(a.id)).length, 0);
  const missing = missingVitals(actions, selected);
  const toggle = (id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(groups.flatMap((g) => g.items.map((a) => a.id)).filter((x) => next.has(x)));
  };
  const vitals = groups.flatMap((g) =>
    g.items.filter((a) => a.weight === "vital").map((a) => a.id),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{intro}</p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {loading ? (
          <p className="text-muted-foreground">Carregando a lista de ações…</p>
        ) : !total ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
            A lista de ações não está disponível para esta imobiliária (módulo Feedback desligado ou
            lista vazia).{" "}
            {optional ? "Siga sem esta etapa." : "O contrato será gerado sem o Dossiê."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-full bg-primary/10 px-3 py-1 font-medium text-primary"
                aria-live="polite"
              >
                {count} de {total} ações selecionadas
              </span>
              {editable && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onChange([...new Set([...selected, ...vitals])])}
                  >
                    Marcar todas as essenciais
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onChange([])}>
                    Limpar
                  </Button>
                </>
              )}
            </div>
            {count === 0 &&
              (optional ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                  Pendente: nenhuma ação marcada. Não impede o envio ao gestor.
                </p>
              ) : (
                <p className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
                  Nenhuma ação marcada. Marque ao menos 1 para gerar o contrato.
                </p>
              ))}
            {count > 0 && missing.length > 0 && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                {missing.length === 1
                  ? "1 ação essencial está desmarcada."
                  : `${missing.length} ações essenciais estão desmarcadas.`}{" "}
                {optional
                  ? "Dá para enviar mesmo assim."
                  : "Dá para gerar mesmo assim, mas o proprietário verá menos compromisso."}
              </p>
            )}
            {groups.map((g) => (
              <fieldset key={g.category} className="rounded-md border p-3">
                <legend className="px-1 font-semibold">{g.category}</legend>
                <div className="space-y-1">
                  {g.items.map((a) => (
                    <label
                      key={a.id}
                      className={`flex min-h-10 items-start gap-3 rounded px-2 py-1.5 ${
                        editable ? "cursor-pointer hover:bg-muted/60" : "opacity-90"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
                        checked={set.has(a.id)}
                        disabled={!editable}
                        onChange={() => toggle(a.id)}
                      />
                      <span className="flex-1">{a.label}</span>
                      {a.weight && (
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${WEIGHT_STYLE[a.weight] ?? ""}`}
                        >
                          {WEIGHT_LABEL[a.weight] ?? a.weight}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
