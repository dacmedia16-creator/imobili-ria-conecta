import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { money, dateBR } from "@/components/vendas/shared";
import { RECEBIDO_COLS } from "@/lib/status";
import { toast } from "sonner";
import { Wallet } from "lucide-react";

export const Route = createFileRoute("/_authenticated/comissoes-a-receber")({
  head: () => ({ meta: [{ title: "Baixa de recebimentos" }] }),
  component: ComissoesAReceberPage,
});

const todayISO = () => new Date().toISOString().slice(0, 10);

const OCC_COLUMNS = "id, sale_id, valor_comissao, prev_recebimento_data, prev_recebimento_valor, prev_recebimento_forma, prev_recebimento_recebido_em, prev_recebimento2_data, prev_recebimento2_valor, prev_recebimento2_forma, prev_recebimento2_recebido_em, prev_recebimento3_data, prev_recebimento3_valor, prev_recebimento3_forma, prev_recebimento3_recebido_em";

function ComissoesAReceberPage() {
  const { hasAny, loading: authLoading } = useAuth();
  const allowed = hasAny(["financeiro", "admin", "super_admin"]);

  const [loading, setLoading] = useState(true);
  const [occs, setOccs] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [profileName, setProfileName] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [markDate, setMarkDate] = useState(todayISO());
  const [marking, setMarking] = useState(false);

  // Sem filtro de período de propósito: diferente de Relatórios (histórico), aqui é a fila de
  // trabalho do financeiro — só o que ainda não foi recebido, então não cresce sem limite (uma
  // parcela sai da lista assim que é marcada, em vez de se acumular ano após ano).
  const load = useCallback(async () => {
    setLoading(true);
    const pendingFilter = [1, 2, 3].map((n) => {
      const suf = n === 1 ? "" : String(n);
      return `and(prev_recebimento${suf}_data.not.is.null,prev_recebimento${suf}_valor.not.is.null,prev_recebimento${suf}_recebido_em.is.null)`;
    }).join(",");
    const { data: o } = await supabase.from("occurrences").select(OCC_COLUMNS).or(pendingFilter);
    setOccs(o ?? []);

    const saleIds = Array.from(new Set((o ?? []).map((r: any) => r.sale_id)));
    if (saleIds.length) {
      const { data: s } = await supabase.from("sales").select("id, imovel_id, codigo_interno, corretor_id, status").in("id", saleIds);
      setSales(s ?? []);
    } else {
      setSales([]);
    }

    const { data: prof } = await supabase.from("profiles").select("id, nome");
    const names: Record<string, string> = {};
    for (const p of prof ?? []) names[p.id] = p.nome ?? p.id;
    setProfileName(names);
    setSelected(new Set());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    load();
  }, [allowed, load]);

  const saleById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const s of sales) m[s.id] = s;
    return m;
  }, [sales]);

  const { rows, inconsistentes } = useMemo(() => {
    const out: { key: string; occId: string; parcela: number; sale: any; data: string; valor: number; forma: string | null }[] = [];
    const semVenda: any[] = [];
    for (const o of occs) {
      const sale = saleById[o.sale_id];
      // Ocorrência sem venda resolvida é uma inconsistência de dados — não deve entrar silenciosamente
      // no total pendente (ver item 7 do pedido de padronização financeira).
      if (!sale) { semVenda.push(o); continue; }
      // Venda arquivada/cancelada não deve gerar cobrança pendente — a ocorrência continua existindo
      // (histórico), mas a parcela prevista não é mais um recebimento de verdade.
      if (sale.status === "arquivada" || sale.status === "cancelada") continue;
      // prev_recebimento{1,2,3}_valor já é a fatia própria — parceria externa (quando existe) nunca
      // passa por essa conta, cobrada direto pelo parceiro.
      const parcelas: [string | null, number | null, string | null, string | null][] = [
        [o.prev_recebimento_data, o.prev_recebimento_valor, o.prev_recebimento_forma, o.prev_recebimento_recebido_em],
        [o.prev_recebimento2_data, o.prev_recebimento2_valor, o.prev_recebimento2_forma, o.prev_recebimento2_recebido_em],
        [o.prev_recebimento3_data, o.prev_recebimento3_valor, o.prev_recebimento3_forma, o.prev_recebimento3_recebido_em],
      ];
      parcelas.forEach(([data, valor, forma, recebidoEm], i) => {
        if (!data || !valor || recebidoEm) return;
        out.push({ key: `${o.id}-${i + 1}`, occId: o.id, parcela: i + 1, sale, data, valor: Number(valor), forma });
      });
    }
    return { rows: out.sort((a, b) => a.data.localeCompare(b.data)), inconsistentes: semVenda };
  }, [occs, saleById]);

  const hoje = todayISO();
  const saleLabel = (sale: any) => sale?.imovel_id || sale?.codigo_interno || (sale ? `Venda #${sale.id.slice(0, 8)}` : "—");
  const corretorNome = (sale: any) => (sale ? (profileName[sale.corretor_id] ?? "—") : "—");

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.key));
  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(rows.map((r) => r.key)) : new Set());
  const toggleOne = (key: string, checked: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    if (checked) next.add(key); else next.delete(key);
    return next;
  });

  const selecionadas = rows.filter((r) => selected.has(r.key));
  const totalSelecionado = selecionadas.reduce((s, r) => s + r.valor, 0);

  const abrirConfirmacao = () => { setMarkDate(hoje); setConfirmOpen(true); };

  const confirmarSelecionadas = async () => {
    if (!selecionadas.length) return;
    setMarking(true);
    try {
      const results = await Promise.all(selecionadas.map((r) => {
        const cols = RECEBIDO_COLS[r.parcela];
        return supabase.from("occurrences").update({ [cols.em]: markDate, [cols.valor]: r.valor } as any).eq("id", r.occId);
      }));
      const falhas = results.filter((r) => r.error);
      if (falhas.length) toast.error(`${falhas.length} de ${selecionadas.length} falharam ao salvar`);
      else toast.success(`${selecionadas.length} parcela(s) marcada(s) como recebida(s)`);
      setConfirmOpen(false);
      load();
    } finally {
      setMarking(false);
    }
  };

  if (authLoading || loading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  if (!allowed) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Esta área é restrita ao Financeiro. Se você acredita que deveria ter acesso, peça ao administrador.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Baixa de recebimentos</h1>
        <p className="text-sm text-muted-foreground">Área operacional para confirmar parcelas recebidas. Os valores já mostram somente a fatia própria da imobiliária, sem parcerias externas.</p>
      </div>

      {inconsistentes.length > 0 && (
        <Card className="border-destructive/40">
          <CardContent className="py-3 text-sm text-destructive">
            {inconsistentes.length} ocorrência(s) sem venda correspondente carregada — excluída(s) do total pendente por segurança. Verifique com o suporte técnico.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Total pendente (nossa parte)</p><p className="text-xl font-semibold">{money(rows.reduce((s, r) => s + r.valor, 0))}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Selecionado</p><p className="text-xl font-semibold text-primary">{money(totalSelecionado)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Pendentes ({rows.length})</CardTitle>
          <Button size="sm" disabled={selecionadas.length === 0} onClick={abrirConfirmacao}>
            <Wallet className="mr-2 h-4 w-4" />Marcar {selecionadas.length > 0 ? `${selecionadas.length} ` : ""}como recebida(s)
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={(v) => toggleAll(!!v)} disabled={rows.length === 0} /></TableHead>
                <TableHead>Imóvel</TableHead>
                <TableHead>Corretor</TableHead>
                <TableHead>Parcela</TableHead>
                <TableHead>Data prevista</TableHead>
                <TableHead>Forma</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">Nenhuma comissão pendente de recebimento.</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell><Checkbox checked={selected.has(r.key)} onCheckedChange={(v) => toggleOne(r.key, !!v)} /></TableCell>
                  <TableCell className="font-medium">
                    {r.sale ? <Link to="/vendas/$id" params={{ id: r.sale.id }} className="hover:underline">{saleLabel(r.sale)}</Link> : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{corretorNome(r.sale)}</TableCell>
                  <TableCell>{r.parcela}ª</TableCell>
                  <TableCell>{dateBR(r.data)}</TableCell>
                  <TableCell className="text-muted-foreground">{r.forma ?? "—"}</TableCell>
                  <TableCell>{money(r.valor)}</TableCell>
                  <TableCell>
                    <span className={r.data < hoje ? "text-destructive" : "text-muted-foreground"}>
                      {r.data < hoje ? "Vencida" : "A vencer"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!marking && !o) setConfirmOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar {selecionadas.length} parcela(s) como recebida(s)</DialogTitle>
            <DialogDescription>
              O valor recebido de cada parcela será o valor previsto ({money(totalSelecionado)} no total). Pra registrar um valor diferente do previsto numa parcela específica, use a tela de Relatórios.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="mb-1.5 block text-xs text-muted-foreground">Data do recebimento</Label>
            <Input type="date" value={markDate} onChange={(e) => setMarkDate(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={marking}>Cancelar</Button>
            <Button onClick={confirmarSelecionadas} disabled={marking || !markDate}>{marking ? "Salvando..." : "Confirmar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
