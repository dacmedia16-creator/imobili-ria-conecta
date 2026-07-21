import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { STATUS_LABEL, type SaleStatus } from "@/lib/status";
import { exportCsv } from "@/lib/csv";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({ meta: [{ title: "Relatórios — Financeiro" }] }),
  component: RelatoriosPage,
});

const money = (v: any) => (v != null ? `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—");
const dateBR = (v: any) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthsAgoISO = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); };
const inRange = (dateStr: string | null | undefined, from: string, to: string) => {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  return (!from || d >= from) && (!to || d <= to);
};

const FUNIL_STATUSES: SaleStatus[] = ["ocorrencia_pendente", "ocorrencia_analise_financeiro", "ocorrencia_devolvida_gestor", "ocorrencia_concluida"];

function RelatoriosPage() {
  const { hasAny, loading: authLoading } = useAuth();
  const allowed = hasAny(["financeiro", "admin", "super_admin"]);

  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState<any[]>([]);
  const [occs, setOccs] = useState<any[]>([]);
  const [comms, setComms] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [profileName, setProfileName] = useState<Record<string, string>>({});

  const [dateFrom, setDateFrom] = useState(monthsAgoISO(3));
  const [dateTo, setDateTo] = useState(todayISO());
  const [corretorQ, setCorretorQ] = useState("");

  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      const [{ data: s }, { data: o }, { data: prof }] = await Promise.all([
        supabase.from("sales").select("id, status, imovel_id, codigo_interno, corretor_id, valor_negociado, valor_total_comissao, updated_at, created_at"),
        supabase.from("occurrences").select("*"),
        supabase.from("profiles").select("id, nome"),
      ]);
      setSales(s ?? []);
      setOccs(o ?? []);
      const occIds = (o ?? []).map((r: any) => r.id);
      if (occIds.length) {
        const [{ data: c }, { data: p }] = await Promise.all([
          supabase.from("occurrence_commissions").select("*").in("occurrence_id", occIds),
          supabase.from("occurrence_partners").select("*").in("occurrence_id", occIds),
        ]);
        setComms(c ?? []);
        setPartners(p ?? []);
      } else {
        setComms([]);
        setPartners([]);
      }
      const names: Record<string, string> = {};
      for (const p of prof ?? []) names[p.id] = p.nome ?? p.id;
      setProfileName(names);
      setLoading(false);
    })();
  }, [allowed]);

  const saleById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const s of sales) m[s.id] = s;
    return m;
  }, [sales]);

  const saleLabel = (sale: any) => sale?.imovel_id || sale?.codigo_interno || (sale ? `Venda #${sale.id.slice(0, 8)}` : "—");
  const corretorNome = (sale: any) => (sale ? (profileName[sale.corretor_id] ?? "—") : "—");
  const matchesCorretor = (sale: any) => !corretorQ || corretorNome(sale).toLowerCase().includes(corretorQ.toLowerCase());

  if (authLoading || loading) return <p className="text-sm text-muted-foreground">Carregando relatórios...</p>;

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
        <h1 className="text-2xl font-semibold tracking-tight">Relatórios — Financeiro</h1>
        <p className="text-sm text-muted-foreground">Visão consolidada de comissões, recebimentos, financiamentos e ocorrências.</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div>
            <Label>Período — de</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <Label>Período — até</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="min-w-48 flex-1">
            <Label>Corretor</Label>
            <Input placeholder="Filtrar por nome do corretor" value={corretorQ} onChange={(e) => setCorretorQ(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="caixa">
        <TabsList>
          <TabsTrigger value="caixa">Fluxo de caixa</TabsTrigger>
          <TabsTrigger value="comissoes">Comissões</TabsTrigger>
          <TabsTrigger value="financiamentos">Financiamentos</TabsTrigger>
          <TabsTrigger value="funil">Funil de ocorrências</TabsTrigger>
        </TabsList>

        <TabsContent value="caixa">
          <p className="mb-3 text-xs text-muted-foreground">"Período" aqui filtra pela <b>data de cada parcela prevista</b> de recebimento.</p>
          <FluxoCaixaTab occs={occs} saleById={saleById} saleLabel={saleLabel} corretorNome={corretorNome} matchesCorretor={matchesCorretor} dateFrom={dateFrom} dateTo={dateTo} />
        </TabsContent>
        <TabsContent value="comissoes">
          <p className="mb-3 text-xs text-muted-foreground">"Período" aqui filtra pela <b>data de assinatura</b> da ocorrência (ou data de criação, se não houver assinatura registrada).</p>
          <ComissoesTab occs={occs} comms={comms} partners={partners} saleById={saleById} saleLabel={saleLabel} corretorNome={corretorNome} matchesCorretor={matchesCorretor} dateFrom={dateFrom} dateTo={dateTo} />
        </TabsContent>
        <TabsContent value="financiamentos">
          <p className="mb-3 text-xs text-muted-foreground">"Período" aqui filtra pela <b>previsão de liberação do crédito</b>.</p>
          <FinanciamentosTab occs={occs} saleById={saleById} saleLabel={saleLabel} corretorNome={corretorNome} matchesCorretor={matchesCorretor} dateFrom={dateFrom} dateTo={dateTo} />
        </TabsContent>
        <TabsContent value="funil">
          <p className="mb-3 text-xs text-muted-foreground">"Período" aqui filtra pela <b>última atualização</b> da venda.</p>
          <FunilTab sales={sales} occs={occs} saleLabel={saleLabel} corretorNome={corretorNome} matchesCorretor={matchesCorretor} dateFrom={dateFrom} dateTo={dateTo} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-muted-foreground">{children}</TableCell>
    </TableRow>
  );
}

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <Download className="mr-2 h-4 w-4" />Exportar CSV
    </Button>
  );
}

function FluxoCaixaTab({ occs, saleById, saleLabel, corretorNome, matchesCorretor, dateFrom, dateTo }: {
  occs: any[]; saleById: Record<string, any>; saleLabel: (s: any) => string; corretorNome: (s: any) => string; matchesCorretor: (s: any) => boolean;
  dateFrom: string; dateTo: string;
}) {
  const rows = useMemo(() => {
    const out: { sale: any; parcela: number; data: string; valor: number; forma: string | null }[] = [];
    for (const o of occs) {
      const sale = saleById[o.sale_id];
      if (!matchesCorretor(sale)) continue;
      const parcelas: [string | null, number | null, string | null][] = [
        [o.prev_recebimento_data, o.prev_recebimento_valor, o.prev_recebimento_forma],
        [o.prev_recebimento2_data, o.prev_recebimento2_valor, o.prev_recebimento2_forma],
        [o.prev_recebimento3_data, o.prev_recebimento3_valor, o.prev_recebimento3_forma],
      ];
      parcelas.forEach(([data, valor], i) => {
        if (!data || !valor) return;
        if (!inRange(data, dateFrom, dateTo)) return;
        out.push({ sale, parcela: i + 1, data, valor: Number(valor), forma: parcelas[i][2] });
      });
    }
    return out.sort((a, b) => a.data.localeCompare(b.data));
  }, [occs, saleById, matchesCorretor, dateFrom, dateTo]);

  const totalPrevisto = rows.reduce((s, r) => s + r.valor, 0);
  const hoje = todayISO();
  const totalVencido = rows.filter((r) => r.data < hoje).reduce((s, r) => s + r.valor, 0);
  const totalAVencer = totalPrevisto - totalVencido;

  const doExport = () => exportCsv(`fluxo-caixa_${dateFrom}_a_${dateTo}.csv`, rows.map((r) => ({
    Imovel: saleLabel(r.sale), Corretor: corretorNome(r.sale), Parcela: r.parcela, Data: r.data, Valor: r.valor.toFixed(2), Forma: r.forma ?? "", Situacao: r.data < hoje ? "Vencida" : "A vencer",
  })));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Total previsto no período</p><p className="text-xl font-semibold">{money(totalPrevisto)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Vencido (data já passou)</p><p className="text-xl font-semibold text-destructive">{money(totalVencido)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">A vencer</p><p className="text-xl font-semibold text-emerald-700 dark:text-emerald-400">{money(totalAVencer)}</p></CardContent></Card>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Parcelas previstas ({rows.length})</CardTitle>
          <ExportButton onClick={doExport} />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Imóvel</TableHead>
                <TableHead>Corretor</TableHead>
                <TableHead>Parcela</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Forma</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && <EmptyRow colSpan={7}>Nenhuma parcela prevista no período/filtro selecionado.</EmptyRow>}
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">
                    {r.sale ? <Link to="/vendas/$id" params={{ id: r.sale.id }} className="hover:underline">{saleLabel(r.sale)}</Link> : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{corretorNome(r.sale)}</TableCell>
                  <TableCell>{r.parcela}ª</TableCell>
                  <TableCell>{dateBR(r.data)}</TableCell>
                  <TableCell className="text-muted-foreground">{r.forma ?? "—"}</TableCell>
                  <TableCell>{money(r.valor)}</TableCell>
                  <TableCell>
                    <span className={r.data < hoje ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}>
                      {r.data < hoje ? "Vencida" : "A vencer"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ComissoesTab({ occs, comms, partners, saleById, saleLabel, corretorNome, matchesCorretor, dateFrom, dateTo }: {
  occs: any[]; comms: any[]; partners: any[]; saleById: Record<string, any>; saleLabel: (s: any) => string; corretorNome: (s: any) => string; matchesCorretor: (s: any) => boolean;
  dateFrom: string; dateTo: string;
}) {
  const [papelFilter, setPapelFilter] = useState("todos");

  const occById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const o of occs) m[o.id] = o;
    return m;
  }, [occs]);

  const rows = useMemo(() => {
    const out: { sale: any; occ: any; papel: string; nome: string | null; valor: number; percentual: number | null }[] = [];
    for (const c of comms) {
      const occ = occById[c.occurrence_id];
      if (!occ) continue;
      const sale = saleById[occ.sale_id];
      if (!matchesCorretor(sale)) continue;
      if (!inRange(occ.data_assinatura ?? occ.created_at, dateFrom, dateTo)) continue;
      if (!c.valor) continue;
      out.push({ sale, occ, papel: c.papel, nome: c.nome, valor: Number(c.valor), percentual: c.percentual });
    }
    for (const p of partners) {
      const occ = occById[p.occurrence_id];
      if (!occ) continue;
      const sale = saleById[occ.sale_id];
      if (!matchesCorretor(sale)) continue;
      if (!inRange(occ.data_assinatura ?? occ.created_at, dateFrom, dateTo)) continue;
      if (!p.valor) continue;
      out.push({ sale, occ, papel: "parceiro_externo", nome: p.nome, valor: Number(p.valor), percentual: p.percentual });
    }
    return out.filter((r) => papelFilter === "todos" || r.papel === papelFilter);
  }, [comms, partners, occById, saleById, matchesCorretor, dateFrom, dateTo, papelFilter]);

  const papeis = useMemo(() => {
    const s = new Set<string>();
    comms.forEach((c) => s.add(c.papel));
    if (partners.length) s.add("parceiro_externo");
    return Array.from(s);
  }, [comms, partners]);

  const papelLabel: Record<string, string> = {
    corretor_captador: "Corretor captador", indicador_captador: "Indicador do captador", coordenador_captador: "Coordenador captador",
    corretor_vendedor: "Corretor vendedor", indicador_vendedor: "Indicador do vendedor", coordenador_vendedor: "Coordenador vendedor",
    parceiro_externo: "Parceiro externo",
  };

  const total = rows.reduce((s, r) => s + r.valor, 0);

  const doExport = () => exportCsv(`comissoes_${dateFrom}_a_${dateTo}.csv`, rows.map((r) => ({
    Imovel: saleLabel(r.sale), Papel: papelLabel[r.papel] ?? r.papel, Beneficiario: r.nome ?? "", Percentual: r.percentual ?? "", Valor: r.valor.toFixed(2), DataAssinatura: r.occ.data_assinatura ?? "",
  })));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Total no período</p><p className="text-xl font-semibold">{money(total)}</p></CardContent></Card>
        <Card><CardContent className="flex items-end justify-between pt-6">
          <div>
            <Label>Papel</Label>
            <Select value={papelFilter} onValueChange={setPapelFilter}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os papéis</SelectItem>
                {papeis.map((p) => <SelectItem key={p} value={p}>{papelLabel[p] ?? p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent></Card>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Comissões e repasses ({rows.length})</CardTitle>
          <ExportButton onClick={doExport} />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Imóvel</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Beneficiário</TableHead>
                <TableHead>%</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Assinatura</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && <EmptyRow colSpan={6}>Nenhuma comissão encontrada no período/filtro selecionado.</EmptyRow>}
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">
                    {r.sale ? <Link to="/vendas/$id" params={{ id: r.sale.id }} className="hover:underline">{saleLabel(r.sale)}</Link> : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{papelLabel[r.papel] ?? r.papel}</TableCell>
                  <TableCell>{r.nome ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{r.percentual != null ? `${r.percentual}%` : "—"}</TableCell>
                  <TableCell>{money(r.valor)}</TableCell>
                  <TableCell className="text-muted-foreground">{dateBR(r.occ.data_assinatura)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function FinanciamentosTab({ occs, saleById, saleLabel, corretorNome, matchesCorretor, dateFrom, dateTo }: {
  occs: any[]; saleById: Record<string, any>; saleLabel: (s: any) => string; corretorNome: (s: any) => string; matchesCorretor: (s: any) => boolean;
  dateFrom: string; dateTo: string;
}) {
  const [bancoQ, setBancoQ] = useState("");
  const [somenteAbertos, setSomenteAbertos] = useState(true);

  const rows = useMemo(() => {
    return occs.filter((o) => {
      if (!o.financiamento) return false;
      const sale = saleById[o.sale_id];
      if (!matchesCorretor(sale)) return false;
      if (somenteAbertos && sale?.status === "ocorrencia_concluida") return false;
      if (o.financiamento_previsao && !inRange(o.financiamento_previsao, dateFrom, dateTo)) return false;
      if (bancoQ && !(o.financiamento_banco ?? "").toLowerCase().includes(bancoQ.toLowerCase())) return false;
      return true;
    }).map((o) => ({ occ: o, sale: saleById[o.sale_id] }));
  }, [occs, saleById, matchesCorretor, dateFrom, dateTo, bancoQ, somenteAbertos]);

  const total = rows.reduce((s, r) => s + Number(r.occ.financiamento_valor ?? 0), 0);

  const doExport = () => exportCsv(`financiamentos_${dateFrom}_a_${dateTo}.csv`, rows.map((r) => ({
    Imovel: saleLabel(r.sale), Corretor: corretorNome(r.sale), Banco: r.occ.financiamento_banco ?? "", Correspondente: r.occ.financiamento_correspondente ?? "",
    ValorFinanciado: Number(r.occ.financiamento_valor ?? 0).toFixed(2), PrevisaoLiberacao: r.occ.financiamento_previsao ?? "", StatusVenda: r.sale ? STATUS_LABEL[r.sale.status as SaleStatus] : "",
  })));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Valor total financiado (filtro atual)</p><p className="text-xl font-semibold">{money(total)}</p></CardContent></Card>
        <Card><CardContent className="pt-6">
          <Label>Banco / correspondente</Label>
          <Input placeholder="Filtrar por nome" value={bancoQ} onChange={(e) => setBancoQ(e.target.value)} />
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <Label>Situação</Label>
          <Select value={somenteAbertos ? "abertos" : "todos"} onValueChange={(v) => setSomenteAbertos(v === "abertos")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="abertos">Somente em aberto</SelectItem>
              <SelectItem value="todos">Todos (inclusive concluídos)</SelectItem>
            </SelectContent>
          </Select>
        </CardContent></Card>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Financiamentos ({rows.length})</CardTitle>
          <ExportButton onClick={doExport} />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Imóvel</TableHead>
                <TableHead>Corretor</TableHead>
                <TableHead>Banco</TableHead>
                <TableHead>Correspondente</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Previsão liberação</TableHead>
                <TableHead>Status da venda</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && <EmptyRow colSpan={7}>Nenhum financiamento encontrado no período/filtro selecionado.</EmptyRow>}
              {rows.map((r) => (
                <TableRow key={r.occ.id}>
                  <TableCell className="font-medium">
                    {r.sale ? <Link to="/vendas/$id" params={{ id: r.sale.id }} className="hover:underline">{saleLabel(r.sale)}</Link> : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{corretorNome(r.sale)}</TableCell>
                  <TableCell>{r.occ.financiamento_banco ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{r.occ.financiamento_correspondente ?? "—"}</TableCell>
                  <TableCell>{money(r.occ.financiamento_valor)}</TableCell>
                  <TableCell>{dateBR(r.occ.financiamento_previsao)}</TableCell>
                  <TableCell>{r.sale ? <StatusBadge status={r.sale.status as SaleStatus} /> : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function FunilTab({ sales, occs, saleLabel, corretorNome, matchesCorretor, dateFrom, dateTo }: {
  sales: any[]; occs: any[]; saleLabel: (s: any) => string; corretorNome: (s: any) => string; matchesCorretor: (s: any) => boolean;
  dateFrom: string; dateTo: string;
}) {
  const occBySaleId = useMemo(() => {
    const m: Record<string, any> = {};
    for (const o of occs) m[o.sale_id] = o;
    return m;
  }, [occs]);

  const rows = useMemo(() => {
    return sales
      .filter((s) => FUNIL_STATUSES.includes(s.status))
      .filter((s) => matchesCorretor(s))
      .filter((s) => inRange(s.updated_at, dateFrom, dateTo))
      .map((s) => ({ sale: s, occ: occBySaleId[s.id] }));
  }, [sales, occBySaleId, matchesCorretor, dateFrom, dateTo]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const st of FUNIL_STATUSES) c[st] = 0;
    for (const r of rows) c[r.sale.status] = (c[r.sale.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const reabertas = rows.filter((r) => r.occ?.reopened_at).length;

  const doExport = () => exportCsv(`funil-ocorrencias_${dateFrom}_a_${dateTo}.csv`, rows.map((r) => ({
    Imovel: saleLabel(r.sale), Corretor: corretorNome(r.sale), Status: STATUS_LABEL[r.sale.status as SaleStatus],
    AtualizadoEm: r.sale.updated_at, Reaberta: r.occ?.reopened_at ? "Sim" : "Não", MotivoReabertura: r.occ?.reopen_reason ?? "",
  })));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-5">
        {FUNIL_STATUSES.map((st) => (
          <Card key={st}><CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">{STATUS_LABEL[st]}</p>
            <p className="text-xl font-semibold">{counts[st] ?? 0}</p>
          </CardContent></Card>
        ))}
        <Card><CardContent className="pt-6">
          <p className="text-xs text-muted-foreground">Reabertas no período</p>
          <p className="text-xl font-semibold text-amber-700 dark:text-amber-400">{reabertas}</p>
        </CardContent></Card>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Vendas na etapa financeiro/ocorrência ({rows.length})</CardTitle>
          <ExportButton onClick={doExport} />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Imóvel</TableHead>
                <TableHead>Corretor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Atualizado em</TableHead>
                <TableHead>Reaberta?</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && <EmptyRow colSpan={5}>Nenhuma venda encontrada no período/filtro selecionado.</EmptyRow>}
              {rows.map((r) => (
                <TableRow key={r.sale.id}>
                  <TableCell className="font-medium">
                    <Link to="/vendas/$id" params={{ id: r.sale.id }} className="hover:underline">{saleLabel(r.sale)}</Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{corretorNome(r.sale)}</TableCell>
                  <TableCell><StatusBadge status={r.sale.status as SaleStatus} /></TableCell>
                  <TableCell className="text-muted-foreground">{dateBR(r.sale.updated_at)}</TableCell>
                  <TableCell>{r.occ?.reopened_at ? <span className="text-amber-700 dark:text-amber-400" title={r.occ.reopen_reason ?? ""}>Sim</span> : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
