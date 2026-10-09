import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WEIGHT_LABEL, type FeedbackAction } from "@/lib/owner-feedback-actions";
import {
  acoesSemSemana,
  ajustarSemanas,
  groupDossie,
  missingVitals,
  semanaSugerida,
  semanasDaAcao,
  SEMANAS_VISIVEIS,
  type PlanoSemanas,
} from "@/lib/capture-dossie";

const WEIGHT_STYLE: Record<string, string> = {
  vital: "bg-red-100 text-red-800",
  importante: "bg-amber-100 text-amber-800",
  complementar: "bg-slate-100 text-slate-700",
};

/** Etapa "Plano de Marketing" da captação: o corretor marca as ações e, em cada uma, as semanas. */
export function CaptureDossieStep({
  actions,
  selected,
  editable,
  loading,
  onChange,
  semanas,
  totalSemanas = 4,
  semanasPadrao = false,
  title = "Plano de Marketing",
  intro = "Obrigatório: marque as ações que você vai fazer por este imóvel e, em cada uma, as semanas. O Plano de Marketing sai anexado ao final do contrato, com assinatura do proprietário, e o Feedback mostra depois o que foi cumprido.",
  manual = false,
}: {
  actions: FeedbackAction[];
  selected: string[];
  editable: boolean;
  loading: boolean;
  /** Sempre devolve as semanas junto: plano novo ou editado passa a usar semanas. */
  onChange: (ids: string[], semanas: PlanoSemanas) => void;
  /** Semanas salvas; ausente = plano antigo (prazo automático por peso) ou ainda não escolhido. */
  semanas?: PlanoSemanas;
  /** Semanas até o fim da exclusividade (Semana 1 = aprovação). */
  totalSemanas?: number;
  /** true = sem fim de exclusividade registrado; usando 4 semanas. */
  semanasPadrao?: boolean;
  /** Cadastro manual (contrato já assinado): título/texto próprios; seleção continua obrigatória. */
  title?: string;
  intro?: string;
  manual?: boolean;
}) {
  const [maisSemanas, setMaisSemanas] = useState<Record<string, boolean>>({});
  const groups = groupDossie(actions);
  const set = new Set(selected);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const count = groups.reduce((n, g) => n + g.items.filter((a) => set.has(a.id)).length, 0);
  const missing = missingVitals(actions, selected);
  const legado = !semanas && count > 0;
  // Plano antigo: mostra as semanas sugeridas; a primeira mudança grava o modelo novo.
  const atuais = semanas ?? ajustarSemanas(actions, selected, undefined, totalSemanas);
  const semSemana = acoesSemSemana(actions, selected, semanas);
  const emit = (ids: string[], sem: PlanoSemanas) =>
    onChange(ids, ajustarSemanas(actions, ids, sem, totalSemanas));
  const ordered = (next: Set<string>) =>
    groups.flatMap((g) => g.items.map((a) => a.id)).filter((x) => next.has(x));
  const toggle = (id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const sem = { ...atuais };
    if (!next.has(id)) delete sem[id];
    emit(ordered(next), sem);
  };
  const setSemanas = (id: string, sem: number[]) => emit(selected, { ...atuais, [id]: sem });
  const toggleSemana = (id: string, n: number) => {
    const cur = semanasDaAcao(atuais, id, totalSemanas);
    setSemanas(
      id,
      cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].sort((a, b) => a - b),
    );
  };
  const todas = Array.from({ length: totalSemanas }, (_, i) => i + 1);
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
            {manual ? "Siga sem esta etapa." : "O contrato será gerado sem o Plano de Marketing."}
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
                    onClick={() => emit(ordered(new Set([...selected, ...vitals])), atuais)}
                  >
                    Marcar todas as essenciais
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => emit([], {})}>
                    Limpar
                  </Button>
                </>
              )}
            </div>
            <p className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
              A Semana 1 começa no dia em que a captação é aprovada; cada semana tem 7 dias. Dá para
              marcar mais de uma semana por ação.{" "}
              {semanasPadrao
                ? "Sem prazo de exclusividade registrado: mostrando 4 semanas."
                : `Exclusividade com ${totalSemanas} semana${totalSemanas === 1 ? "" : "s"}.`}
            </p>
            {legado && editable && (
              <p className="rounded-md border border-sky-300 bg-sky-50 p-3 text-sky-900">
                Plano salvo antes das semanas: as semanas abaixo são sugestões. Ao mudar qualquer
                coisa, o plano passa a usar as semanas escolhidas.
              </p>
            )}
            {count === 0 && (
              <p className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
                {manual
                  ? "Nenhuma ação marcada. Marque ao menos 1 para enviar ao gestor."
                  : "Nenhuma ação marcada. Marque ao menos 1 para gerar o contrato."}
              </p>
            )}
            {semSemana.length > 0 && (
              <p className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
                {semSemana.length === 1
                  ? `Escolha ao menos 1 semana para “${semSemana[0].label}”.`
                  : `${semSemana.length} ações estão sem semana. Escolha ao menos 1 semana em cada uma.`}
              </p>
            )}
            {count > 0 && missing.length > 0 && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                {missing.length === 1
                  ? "1 ação essencial está desmarcada."
                  : `${missing.length} ações essenciais estão desmarcadas.`}{" "}
                {manual
                  ? "Dá para enviar mesmo assim."
                  : "Dá para gerar mesmo assim, mas o proprietário verá menos compromisso."}
              </p>
            )}
            {groups.map((g) => (
              <fieldset key={g.category} className="rounded-md border p-3">
                <legend className="px-1 font-semibold">{g.category}</legend>
                <div className="space-y-1">
                  {g.items.map((a) => {
                    const on = set.has(a.id);
                    const sem = on ? semanasDaAcao(atuais, a.id, totalSemanas) : [];
                    const escondidaMarcada = sem.some((n) => n > SEMANAS_VISIVEIS);
                    const mais = !!maisSemanas[a.id] || escondidaMarcada;
                    const visiveis = mais ? todas : todas.slice(0, SEMANAS_VISIVEIS);
                    const todaSemana = sem.length === totalSemanas;
                    return (
                      <div key={a.id} className="rounded px-2 py-1.5 hover:bg-muted/40">
                        <label
                          className={`flex min-h-8 items-start gap-3 ${editable ? "cursor-pointer" : "opacity-90"}`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
                            checked={on}
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
                        {on && (
                          <div
                            className="ml-8 mt-1 flex flex-wrap items-center gap-1"
                            role="group"
                            aria-label={`Semanas de ${a.label}`}
                            data-testid="semanas-acao"
                          >
                            {totalSemanas > 1 && (
                              <SemanaChip
                                ativo={todaSemana}
                                disabled={!editable}
                                onClick={() => setSemanas(a.id, todaSemana ? [] : todas)}
                              >
                                Toda semana
                              </SemanaChip>
                            )}
                            {visiveis.map((n) => (
                              <SemanaChip
                                key={n}
                                ativo={sem.includes(n)}
                                disabled={!editable}
                                onClick={() => toggleSemana(a.id, n)}
                              >
                                Semana {n}
                              </SemanaChip>
                            ))}
                            {totalSemanas > SEMANAS_VISIVEIS && !escondidaMarcada && (
                              <button
                                type="button"
                                className="px-1 text-xs font-medium text-primary underline"
                                onClick={() => setMaisSemanas((m) => ({ ...m, [a.id]: !mais }))}
                              >
                                {mais
                                  ? "ver menos"
                                  : `ver mais semanas (${totalSemanas - SEMANAS_VISIVEIS})`}
                              </button>
                            )}
                            {!sem.length && (
                              <span className="text-xs font-medium text-red-700">
                                escolha ao menos 1 semana (sugestão: Semana{" "}
                                {semanaSugerida(a.weight, totalSemanas)})
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SemanaChip({
  ativo,
  disabled,
  onClick,
  children,
}: {
  ativo: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
        ativo
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background text-foreground hover:bg-muted"
      } disabled:cursor-default disabled:opacity-80`}
    >
      {children}
    </button>
  );
}
