import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { errorMessage } from "@/lib/errors";
import {
  draftFrom,
  fmtDataBr,
  fmtReais,
  insidePeriod,
  investedInPeriod,
  PAID_CHANNEL_LABEL,
  PAID_SCREEN_LABEL,
  validatePaid,
  type PaidDraft,
  type PaidTrafficEntry,
  type ReportPeriod,
} from "@/lib/paid-traffic";

const db = supabase as unknown as SupabaseClient;
const n = (x: number) => x.toLocaleString("pt-BR");
const campo =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm md:h-9";

/**
 * Lançamentos de tráfego pago do imóvel (t_f3f64be0). Só aparece para quem pode lançar (corretor responsável,
 * gestor/TL dele e admin): o banco (RLS) não entrega os lançamentos a mais ninguém, então o valor investido
 * fica restrito a quem lança e aos gestores.
 */
export function TrafegoPagoCard({
  listingCode,
  entries,
  period,
  onPeriodChange,
  onChanged,
}: {
  listingCode: string;
  entries: PaidTrafficEntry[];
  period: ReportPeriod;
  onPeriodChange: (p: ReportPeriod) => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<PaidTrafficEntry | "novo" | null>(null);
  const [draft, setDraft] = useState<PaidDraft>(() => draftFrom(null, period));
  const [saving, setSaving] = useState(false);
  const [apagar, setApagar] = useState<PaidTrafficEntry | null>(null);
  const investido = investedInPeriod(entries, period);

  const abrir = (e: PaidTrafficEntry | "novo") => {
    setDraft(draftFrom(e === "novo" ? null : e, period));
    setEditing(e);
  };
  const salvar = async () => {
    const v = validatePaid(draft);
    if (!v.ok) {
      toast.error(v.error);
      return;
    }
    setSaving(true);
    try {
      const { error } =
        editing && editing !== "novo"
          ? await db.from("listing_paid_traffic_entries").update(v.value).eq("id", editing.id)
          : await db
              .from("listing_paid_traffic_entries")
              .insert({ ...v.value, listing_code: listingCode });
      if (error) throw error;
      toast.success(editing === "novo" ? "Tráfego pago lançado." : "Lançamento atualizado.");
      setEditing(null);
      onChanged();
    } catch (e) {
      toast.error(
        errorMessage(
          e,
          "Não foi possível salvar. Só o corretor responsável pelo imóvel, o gestor dele ou a administração podem lançar.",
        ),
      );
    } finally {
      setSaving(false);
    }
  };
  const excluir = async (e: PaidTrafficEntry) => {
    const { error } = await db.from("listing_paid_traffic_entries").delete().eq("id", e.id);
    if (error) toast.error(errorMessage(error, "Não foi possível excluir o lançamento."));
    else {
      toast.success("Lançamento excluído.");
      onChanged();
    }
  };
  const set = (k: keyof PaidDraft) => (ev: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: ev.target.value }));

  return (
    <Card data-testid="trafego-pago-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Megaphone className="h-4 w-4" /> {PAID_SCREEN_LABEL}
          </span>
          <Button size="sm" onClick={() => abrir("novo")} data-testid="lancar-trafego-pago">
            <Plus className="mr-1 h-4 w-4" /> Lançar tráfego pago
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-muted/50 p-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Período do relatório: de
            <input
              type="date"
              aria-label="Período do relatório: início"
              className={campo}
              value={period.de}
              onChange={(e) => e.target.value && onPeriodChange({ ...period, de: e.target.value })}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            até
            <input
              type="date"
              aria-label="Período do relatório: fim"
              className={campo}
              value={period.ate}
              onChange={(e) => e.target.value && onPeriodChange({ ...period, ate: e.target.value })}
            />
          </label>
          <p className="basis-full text-xs text-muted-foreground">
            Entram no relatório (tela, mensagem e PDF) só os lançamentos com início e fim dentro
            deste período. O valor investido aparece só aqui, para quem lança e para os gestores;
            não vai para o proprietário.
          </p>
        </div>
        {!entries.length ? (
          <p className="text-muted-foreground">
            Nenhum lançamento ainda. Use o botão acima para informar visualizações e contatos de
            campanhas no Meta Ads, Google Ads ou outro canal.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="trafego-pago-lista">
            {entries.map((e) => {
              const dentro = insidePeriod(e, period);
              return (
                <li
                  key={e.id}
                  className={`flex flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-center sm:justify-between ${dentro ? "" : "opacity-60"}`}
                >
                  <div className="min-w-0">
                    <div className="font-medium">
                      {PAID_CHANNEL_LABEL[e.canal]}{" "}
                      <span className="font-normal text-muted-foreground">
                        · {fmtDataBr(e.inicio)} a {fmtDataBr(e.fim)}
                      </span>
                    </div>
                    <div className="text-xs tabular-nums">
                      {n(e.visualizacoes)} visualizações · {n(e.contatos)} contatos
                      {" · "}
                      <span data-testid="trafego-pago-investido">
                        investido{" "}
                        {e.investimento != null
                          ? fmtReais(Number(e.investimento))
                          : "não informado"}
                      </span>
                    </div>
                    {!dentro && (
                      <div className="text-xs text-amber-700 dark:text-amber-400">
                        Fora do período do relatório: não entra no total.
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => abrir(e)}
                      aria-label="Editar lançamento"
                    >
                      <Pencil className="mr-1 h-4 w-4" /> Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setApagar(e)}
                      aria-label="Excluir lançamento"
                    >
                      <Trash2 className="mr-1 h-4 w-4" /> Excluir
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {investido > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="trafego-pago-investido-total">
            Investido no período (interno):{" "}
            <span className="font-medium text-foreground">{fmtReais(investido)}</span>
          </p>
        )}
      </CardContent>

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing === "novo" ? "Lançar tráfego pago" : "Editar lançamento"}
            </DialogTitle>
            <DialogDescription>
              Imóvel {listingCode}. Visualizações e contatos entram no relatório do proprietário
              marcados como “Tráfego pago”. O valor investido fica só no sistema.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm sm:col-span-2">
              Canal
              <select
                aria-label="Canal"
                className={campo}
                value={draft.canal}
                onChange={set("canal")}
              >
                <option value="meta">Meta Ads</option>
                <option value="google">Google Ads</option>
                <option value="outro">Outro</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Início
              <input
                type="date"
                aria-label="Início"
                className={campo}
                value={draft.inicio}
                onChange={set("inicio")}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Fim
              <input
                type="date"
                aria-label="Fim"
                className={campo}
                value={draft.fim}
                onChange={set("fim")}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Visualizações
              <input
                aria-label="Visualizações"
                inputMode="numeric"
                className={campo}
                value={draft.visualizacoes}
                onChange={set("visualizacoes")}
                placeholder="0"
              />
            </label>
            <label className="grid gap-1 text-sm">
              Contatos
              <input
                aria-label="Contatos"
                inputMode="numeric"
                className={campo}
                value={draft.contatos}
                onChange={set("contatos")}
                placeholder="0"
              />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              Valor investido (R$) — opcional, só interno
              <input
                aria-label="Valor investido"
                inputMode="decimal"
                className={campo}
                value={draft.investimento}
                onChange={set("investimento")}
                placeholder="Ex.: 350,00"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={saving} data-testid="salvar-trafego-pago">
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={apagar != null}
        onOpenChange={(o) => !o && setApagar(null)}
        title="Excluir lançamento?"
        description="O lançamento sai da tela e do relatório do proprietário. Não dá para desfazer."
        confirmLabel="Excluir"
        destructive
        onConfirm={() => {
          if (apagar) void excluir(apagar);
          setApagar(null);
        }}
      />
    </Card>
  );
}
