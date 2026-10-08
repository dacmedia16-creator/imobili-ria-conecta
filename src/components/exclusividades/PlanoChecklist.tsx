import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardCheck, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/errors";
import { formatDateBR } from "@/lib/exclusive-captures";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import { WEIGHT_LABEL } from "@/lib/owner-feedback-actions";
import { diasEntre, planItemState, planSummary, type PlanItem } from "@/lib/feedback-captacao";
import { PROOF_ACCEPT, planMark, planUnmark, planView, proofUrl } from "@/lib/feedback-captacao-db";

/** Plano de Marketing como checklist (captação aprovada): feito + data + prova opcional; atrasadas em destaque. */
export function PlanoChecklist({ captureId, editable }: { captureId: string; editable: boolean }) {
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [date, setDate] = useState(hojeSaoPaulo());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const hoje = hojeSaoPaulo();

  const load = useCallback(async () => {
    try {
      setItems(await planView(captureId));
    } catch {
      setItems([]);
    }
  }, [captureId]);
  useEffect(() => {
    void load();
  }, [load]);
  const resumo = useMemo(() => planSummary(items ?? [], hoje), [items, hoje]);
  const groups = useMemo(() => {
    const g: { category: string; items: PlanItem[] }[] = [];
    for (const it of items ?? []) {
      let x = g.find((y) => y.category === it.category);
      if (!x) g.push((x = { category: it.category, items: [] }));
      x.items.push(it);
    }
    return g;
  }, [items]);
  if (!items || !items.length) return null;

  const salvar = async (it: PlanItem) => {
    setBusy(true);
    try {
      await planMark(captureId, it.action_id, date, file);
      toast.success("Ação marcada como feita.");
      setOpen(null);
      setFile(null);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível salvar."));
    } finally {
      setBusy(false);
    }
  };
  const desmarcar = async (it: PlanItem) => {
    if (!window.confirm(`Desmarcar “${it.label}”? Fica registrado no histórico.`)) return;
    setBusy(true);
    try {
      await planUnmark(captureId, it.action_id);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível desmarcar."));
    } finally {
      setBusy(false);
    }
  };
  const verProva = async (path: string) => {
    try {
      window.open(await proofUrl(path), "_blank", "noopener");
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível abrir a prova."));
    }
  };

  return (
    <Card data-testid="plano-checklist">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" /> Plano de Marketing — execução
          </span>
          <span className="text-sm font-normal text-muted-foreground">
            {resumo.feitas} de {resumo.total} feitas
            {resumo.atrasadas ? (
              <span className="ml-1 font-medium text-red-700">
                · {resumo.atrasadas} atrasada(s)
              </span>
            ) : null}
          </span>
        </CardTitle>
        <div className="mt-2 h-2 w-full overflow-hidden rounded bg-muted">
          <div className="h-2 bg-green-600" style={{ width: `${resumo.percent}%` }} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-xs text-muted-foreground">
          Ações prometidas no contrato. Prazo contado da aprovação: essencial 7 dias, importante 14,
          complementar 30. O gestor vê as atrasadas no painel dele.
        </p>
        {groups.map((g) => (
          <div key={g.category}>
            <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              {g.category}
            </div>
            <div className="divide-y rounded-md border">
              {g.items.map((it) => {
                const st = planItemState(it, hoje);
                return (
                  <div
                    key={it.action_id}
                    className={`p-2 ${st === "atrasada" ? "bg-red-50" : ""} ${!it.in_plan ? "opacity-70" : ""}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Checkbox
                        checked={!!it.done_on}
                        disabled={!editable || busy || (!it.in_plan && !it.done_on)}
                        aria-label={it.label}
                        onCheckedChange={(v) => {
                          if (v === true) {
                            setDate(hoje);
                            setFile(null);
                            setOpen(it.action_id);
                          } else void desmarcar(it);
                        }}
                      />
                      <span className="flex-1">
                        {it.label}
                        {it.weight && (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                            {WEIGHT_LABEL[it.weight]}
                          </span>
                        )}
                        {!it.in_plan && (
                          <span className="ml-2 text-[10px] text-muted-foreground">
                            (saiu do plano; registro mantido)
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {it.prazo ? `prazo ${formatDateBR(it.prazo)}` : ""}
                      </span>
                      <span className="w-40 text-right text-xs">
                        {st === "feito" ? (
                          <span className="text-emerald-700">
                            feito em {formatDateBR(it.done_on!)}
                            {it.done_by_nome ? ` · ${it.done_by_nome.split(" ")[0]}` : ""}
                          </span>
                        ) : st === "atrasada" ? (
                          <span className="font-medium text-red-700">
                            Atrasada {diasEntre(it.prazo!, hoje)} dia(s)
                          </span>
                        ) : st === "no_prazo" ? (
                          <span className="text-muted-foreground">no prazo</span>
                        ) : null}
                      </span>
                      {it.proof_path && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => verProva(it.proof_path!)}
                        >
                          <Paperclip className="mr-1 h-3 w-3" /> prova
                        </Button>
                      )}
                    </div>
                    {open === it.action_id && (
                      <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md bg-muted/60 p-2">
                        <label className="text-xs">
                          Feito em
                          <Input
                            type="date"
                            className="h-8 w-40"
                            max={hoje}
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                          />
                        </label>
                        <label className="text-xs">
                          Prova (opcional: foto, print ou PDF)
                          <Input
                            type="file"
                            className="h-8 w-64"
                            accept={PROOF_ACCEPT}
                            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                          />
                        </label>
                        <Button size="sm" disabled={busy || !date} onClick={() => salvar(it)}>
                          {busy ? "Salvando..." : "Marcar feito"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                          Cancelar
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
