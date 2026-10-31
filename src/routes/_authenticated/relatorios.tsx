import { createFileRoute, Link } from "@tanstack/react-router";
import { anyOf, requireRoles } from "@/lib/route-access";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { CurrencyInput } from "@/components/vendas/shared";
import { STATUS_LABEL, type SaleStatus } from "@/lib/status";
import { exportCsv } from "@/lib/csv";
import {
  AlertTriangle,
  BarChart3,
  Calculator,
  CalendarClock,
  CheckCircle2,
  Download,
  Landmark,
  RotateCcw,
  Wallet,
  Workflow,
} from "lucide-react";
import {
  CardField,
  EmptyState,
  KpiGridSkeleton,
  KpiTile,
  ListSkeleton,
  PageHeader,
  Pill,
} from "@/components/visual/base";
import { toast } from "sonner";
import { fetchVendasComerciaisValidas } from "@/lib/vendas-comerciais-query";
import { periodoMensalRelatorios, type AtalhoPeriodoRelatorios } from "@/lib/relatorios-periodo";
import type {
  OccurrenceCommissionRow,
  OccurrencePartnerRow,
  OccurrenceRow,
  OccurrenceUpdate,
  SaleRow,
} from "@/lib/database.types";
import { dataCivilSaoPaulo, hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import { confirmarLinhaAlterada } from "@/lib/relatorios-integridade";
import { consultarTodasLinhas } from "@/lib/consulta-paginada";
import { buscarCorretoresPorVenda } from "@/lib/sale-participantes";
import { dataOficialVendaComercial } from "@/lib/data-assinatura-oficial";

type ReportSale = Pick<
  SaleRow,
  | "id"
  | "status"
  | "imovel_id"
  | "codigo_interno"
  | "corretor_id"
  | "valor_negociado"
  | "valor_total_comissao"
  | "modalidade"
  | "data_assinatura"
  | "updated_at"
  | "created_at"
>;
type ReportOccurrence = Pick<
  OccurrenceRow,
  | "id"
  | "sale_id"
  | "valor_comissao"
  | "prev_recebimento_valor"
  | "prev_recebimento_data"
  | "prev_recebimento_forma"
  | "prev_recebimento_recebido_em"
  | "prev_recebimento_recebido_valor"
  | "prev_recebimento2_valor"
  | "prev_recebimento2_data"
  | "prev_recebimento2_forma"
  | "prev_recebimento2_recebido_em"
  | "prev_recebimento2_recebido_valor"
  | "prev_recebimento3_valor"
  | "prev_recebimento3_data"
  | "prev_recebimento3_forma"
  | "prev_recebimento3_recebido_em"
  | "prev_recebimento3_recebido_valor"
  | "data_assinatura"
  | "created_at"
  | "financiamento"
  | "financiamento_previsao"
  | "financiamento_banco"
  | "financiamento_correspondente"
  | "financiamento_valor"
  | "oba_credito"
  | "reopened_at"
  | "reopen_reason"
>;

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({ meta: [{ title: "Relatórios — Financeiro" }] }),
  beforeLoad: ({ context }) =>
    requireRoles(context.auth, anyOf("financeiro", "admin", "super_admin")),
  component: RelatoriosPage,
});

const money = (v: unknown) =>
  v != null ? `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—";
// Colunas `date` do banco chegam como "YYYY-MM-DD" sem hora — `new Date(...)` direto interpreta isso
// como meia-noite UTC, e em fusos atrás de UTC (Brasil) o toLocaleDateString mostra o dia anterior.
// Datas com hora (timestamptz) continuam indo pro Date normal, que já lida certo com fuso.
const dateBR = (v: unknown) => {
  if (!v) return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("pt-BR");
  }
  if (!(typeof v === "string" || typeof v === "number" || v instanceof Date)) return "—";
  return new Date(v).toLocaleDateString("pt-BR");
};
const todayISO = () => hojeSaoPaulo();
const recebimentoPatch = (
  parcela: number,
  data: string | null,
  valor: number | null,
): OccurrenceUpdate =>
  parcela === 1
    ? { prev_recebimento_recebido_em: data, prev_recebimento_recebido_valor: valor }
    : parcela === 2
      ? { prev_recebimento2_recebido_em: data, prev_recebimento2_recebido_valor: valor }
      : { prev_recebimento3_recebido_em: data, prev_recebimento3_recebido_valor: valor };
const monthsAgoISO = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
};
// Timestamps (venda_em, updated_at) chegam em UTC: compara pela data civil de São Paulo.
const inRange = (dateStr: string | null | undefined, from: string, to: string) => {
  const d = dataCivilSaoPaulo(dateStr);
  if (!d) return false;
  return (!from || d >= from) && (!to || d <= to);
};

const FUNIL_STATUSES: SaleStatus[] = [
  "ocorrencia_pendente",
  "ocorrencia_analise_financeiro",
  "ocorrencia_devolvida_gestor",
  "ocorrencia_concluida",
];

function RelatoriosPage() {
  const { hasAny, loading: authLoading } = useAuth();
  const allowed = hasAny(["financeiro", "admin", "super_admin"]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [carregouUmaVez, setCarregouUmaVez] = useState(false);
  const loadVersion = useRef(0);
  const [sales, setSales] = useState<ReportSale[]>([]);
  const [occs, setOccs] = useState<ReportOccurrence[]>([]);
  const [comms, setComms] = useState<OccurrenceCommissionRow[]>([]);
  const [partners, setPartners] = useState<OccurrencePartnerRow[]>([]);
  const [vendaComercialEm, setVendaComercialEm] = useState<Record<string, string>>({});
  const [profileName, setProfileName] = useState<Record<string, string>>({});
  // Corretores participantes por venda: nome/filtro "Corretor" segue quem participa, não quem cadastrou.
  const [corretoresPorVenda, setCorretoresPorVenda] = useState<Map<string, string[]>>(new Map());

  const [dateFrom, setDateFrom] = useState(monthsAgoISO(3));
  const [dateTo, setDateTo] = useState(todayISO());
  const [corretorQ, setCorretorQ] = useState("");
  // Desmarcado por padrão: vendas canceladas/arquivadas não compõem os totais ativos (fluxo de
  // caixa, comissões, financiamentos) a menos que o usuário explicitamente peça pra revisar histórico.
  const [incluirCanceladas, setIncluirCanceladas] = useState(false);

  const aplicarAtalhoPeriodo = (periodo: AtalhoPeriodoRelatorios) => {
    const intervalo = periodoMensalRelatorios(periodo);
    setDateFrom(intervalo.de);
    setDateTo(intervalo.ate);
  };

  const atalhoAtivo = (periodo: AtalhoPeriodoRelatorios) => {
    const intervalo = periodoMensalRelatorios(periodo);
    return dateFrom === intervalo.de && dateTo === intervalo.ate;
  };

  // O filtro de período existe na tela há tempo, mas nunca bateu de verdade na consulta — a busca
  // baixava sales/occurrences inteiras e só cortava por data no client, sem limite algum. Cada aba
  // usa um campo de data diferente (parcela prevista, assinatura, previsão de crédito, atualização
  // da venda), então o filtro do banco é uma união (OR) desses campos — sempre um superconjunto do
  // que cada aba realmente mostra, nunca um subconjunto: pode trazer alguma linha a mais que o
  // filtro client-side (já existente, inalterado) descarta depois, mas nunca deixa de trazer uma
  // linha que deveria aparecer. Casos "sempre aparece independente do período" (financiamento sem
  // previsão ainda definida) entram como uma condição incondicional à parte.
  const load = useCallback(async () => {
    const versao = ++loadVersion.current;
    setLoading(true);
    setLoadError(null);
    try {
      const vendasValidas = await fetchVendasComerciaisValidas();
      // Colunas "date" comparam direto com dateFrom/dateTo; colunas timestamptz (created_at) precisam
      // do horário de fim de dia no limite superior, senão o "lte" só bate em registros de meia-noite
      // exata do dia final — quase nunca, o que na prática anulava essa condição.
      const dateWindow = (col: string) => `and(${col}.gte.${dateFrom},${col}.lte.${dateTo})`;
      const timestampWindow = (col: string) =>
        `and(${col}.gte.${dateFrom}T00:00:00,${col}.lte.${dateTo}T23:59:59.999)`;
      const occFilterParts = [
        dateWindow("prev_recebimento_data"),
        dateWindow("prev_recebimento2_data"),
        dateWindow("prev_recebimento3_data"),
        dateWindow("prev_recebimento_recebido_em"),
        dateWindow("prev_recebimento2_recebido_em"),
        dateWindow("prev_recebimento3_recebido_em"),
        dateWindow("data_assinatura"),
        timestampWindow("created_at"),
        dateWindow("financiamento_previsao"),
        "and(financiamento.is.true,financiamento_previsao.is.null)",
      ];
      if (vendasValidas.length)
        occFilterParts.push(`sale_id.in.(${vendasValidas.map((v) => v.sale_id).join(",")})`);
      const occFilter = occFilterParts.join(",");
      const o = await consultarTodasLinhas("ocorrências", (a, b) =>
        supabase
          .from("occurrences")
          .select(
            "id, sale_id, valor_comissao, prev_recebimento_valor, prev_recebimento_data, prev_recebimento_forma, prev_recebimento_recebido_em, prev_recebimento_recebido_valor, prev_recebimento2_valor, prev_recebimento2_data, prev_recebimento2_forma, prev_recebimento2_recebido_em, prev_recebimento2_recebido_valor, prev_recebimento3_valor, prev_recebimento3_data, prev_recebimento3_forma, prev_recebimento3_recebido_em, prev_recebimento3_recebido_valor, data_assinatura, created_at, financiamento, financiamento_previsao, financiamento_banco, financiamento_correspondente, financiamento_valor, oba_credito, reopened_at, reopen_reason",
            { count: "exact" },
          )
          .or(occFilter)
          .order("id")
          .range(a, b),
      );

      // A aba "Funil" filtra sales por updated_at; as demais abas só precisam de sales pra resolver
      // nome/label das ocorrências já trazidas acima — union das duas necessidades.
      const occSaleIds = Array.from(new Set((o ?? []).map((r) => r.sale_id)));
      const updatedAtWindow = timestampWindow("updated_at");
      const salesFilter = occSaleIds.length
        ? `${updatedAtWindow},id.in.(${occSaleIds.join(",")})`
        : updatedAtWindow;
      const s = await consultarTodasLinhas("vendas", (a, b) =>
        supabase
          .from("sales")
          .select(
            "id, status, imovel_id, codigo_interno, corretor_id, valor_negociado, valor_total_comissao, modalidade, data_assinatura, updated_at, created_at",
            { count: "exact" },
          )
          .or(salesFilter)
          .order("id")
          .range(a, b),
      );

      const occIds = o.map((r) => r.id);
      const c: OccurrenceCommissionRow[] = [];
      const p: OccurrencePartnerRow[] = [];
      if (occIds.length) {
        for (let offset = 0; offset < occIds.length; offset += 100) {
          const ids = occIds.slice(offset, offset + 100);
          const [commRows, partnerRows] = await Promise.all([
            consultarTodasLinhas("comissões", (a, b) =>
              supabase
                .from("occurrence_commissions")
                .select("*", { count: "exact" })
                .in("occurrence_id", ids)
                .order("id")
                .range(a, b),
            ),
            consultarTodasLinhas("parcerias", (a, b) =>
              supabase
                .from("occurrence_partners")
                .select("*", { count: "exact" })
                .in("occurrence_id", ids)
                .order("id")
                .range(a, b),
            ),
          ]);
          c.push(...commRows);
          p.push(...partnerRows);
        }
      }
      const prof = await consultarTodasLinhas("perfis", (a, b) =>
        supabase.from("profiles").select("id, nome", { count: "exact" }).order("id").range(a, b),
      );
      const names: Record<string, string> = {};
      for (const item of prof) names[item.id] = item.nome ?? item.id;
      const participantes = await buscarCorretoresPorVenda(s.map((x) => x.id));
      if (versao !== loadVersion.current) return;
      setCorretoresPorVenda(participantes);
      // Data oficial da venda (regra única de public.data_assinatura_oficial), YYYY-MM-DD.
      const saleDoLoad = new Map(s.map((x) => [x.id, x]));
      const occDoLoad = new Map(o.map((x) => [x.sale_id, x.data_assinatura]));
      const datasOficiais: Record<string, string> = {};
      for (const v of vendasValidas) {
        const venda = saleDoLoad.get(v.sale_id);
        const d = dataOficialVendaComercial({
          vendaEm: v.venda_em,
          modalidade: venda?.modalidade,
          saleDataAssinatura: venda?.data_assinatura,
          occDataAssinatura: occDoLoad.get(v.sale_id),
        });
        if (d) datasOficiais[v.sale_id] = d;
      }
      setVendaComercialEm(datasOficiais);
      setOccs(o);
      setSales(s);
      setComms(c);
      setPartners(p);
      setProfileName(names);
      if (versao === loadVersion.current) setCarregouUmaVez(true);
    } catch (error) {
      if (versao === loadVersion.current)
        setLoadError(error instanceof Error ? error.message : "Falha ao carregar relatórios.");
    } finally {
      if (versao === loadVersion.current) setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    if (!allowed) {
      ++loadVersion.current;
      setLoading(false);
      return;
    }
    // Enquanto a data é digitada o campo passa por "" (data incompleta): não consulta com data vazia
    // (dava "invalid input syntax for type date" e trocava a tela pelo erro). Mantém os números
    // anteriores até as duas datas estarem completas (item 8 t_8730be75).
    const dataOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (!dataOk(dateFrom) || !dataOk(dateTo)) return;
    load();
  }, [allowed, load, dateFrom, dateTo]);

  const saleById = useMemo(() => {
    const m: Record<string, ReportSale> = {};
    for (const s of sales) m[s.id] = s;
    return m;
  }, [sales]);

  // Fonte única da regra "cancelada/arquivada não compõe totais ativos", usada pelas 3 abas que
  // somam dinheiro (Fluxo de caixa, Comissões, Financiamentos) — Funil já se auto-exclui porque
  // FUNIL_STATUSES nunca inclui cancelada/arquivada, então continua recebendo occs/sales cheios.
  // Ocorrência cujo sale_id não resolve em nenhuma venda carregada é tratada como inconsistência:
  // nunca entra nos totais ativos, mesmo com "Incluir canceladas/arquivadas" marcado.
  const { occsAtivas, inconsistentes } = useMemo(() => {
    const ativas: ReportOccurrence[] = [];
    const semVenda: ReportOccurrence[] = [];
    for (const o of occs) {
      const sale = saleById[o.sale_id];
      if (!sale) {
        semVenda.push(o);
        continue;
      }
      if (!incluirCanceladas && (sale.status === "cancelada" || sale.status === "arquivada"))
        continue;
      ativas.push(o);
    }
    return { occsAtivas: ativas, inconsistentes: semVenda };
  }, [occs, saleById, incluirCanceladas]);

  const saleLabel = (sale: ReportSale | undefined) =>
    sale?.imovel_id || sale?.codigo_interno || (sale ? `Venda #${sale.id.slice(0, 8)}` : "—");
  const corretorNome = (sale: ReportSale | undefined) =>
    sale
      ? (corretoresPorVenda.get(sale.id) ?? [sale.corretor_id])
          .map((id) => profileName[id] ?? "—")
          .join(", ") || "—"
      : "—";
  const matchesCorretor = (sale: ReportSale | undefined) =>
    !corretorQ || corretorNome(sale).toLowerCase().includes(corretorQ.toLowerCase());

  // Esqueleto só na PRIMEIRA carga (item 8 t_8730be75): ao trocar a data a tela continua montada,
  // o campo não perde o foco e a aba escolhida não volta para a primeira.
  if (authLoading || (loading && !carregouUmaVez))
    return (
      <div role="status" aria-live="polite" className="space-y-6">
        <span className="sr-only">Carregando relatórios…</span>
        <KpiGridSkeleton count={4} />
        <ListSkeleton rows={6} label="Carregando relatórios" />
      </div>
    );

  if (!allowed) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Esta área é restrita ao Financeiro e a administradores. Se você acredita que deveria ter
          acesso, peça ao administrador.
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="space-y-3 py-8 text-sm text-destructive">
          <p>Relatórios indisponíveis: {loadError}. Nenhum total ou CSV parcial foi publicado.</p>
          <Button type="button" variant="outline" onClick={() => void load()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BarChart3}
        title="Relatórios — Financeiro"
        description="Visão consolidada de comissões, recebimentos, financiamentos e ocorrências."
      />
      {loading && (
        <p
          role="status"
          aria-live="polite"
          data-testid="relatorios-atualizando"
          className="text-sm text-muted-foreground"
        >
          Atualizando os números para o novo período…
        </p>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div>
            <Label>Atalhos</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={atalhoAtivo("mes_atual") ? "default" : "outline"}
                onClick={() => aplicarAtalhoPeriodo("mes_atual")}
              >
                Mês atual
              </Button>
              <Button
                type="button"
                variant={atalhoAtivo("mes_anterior") ? "default" : "outline"}
                onClick={() => aplicarAtalhoPeriodo("mes_anterior")}
              >
                Mês anterior
              </Button>
            </div>
          </div>
          <div>
            <Label>Período — de</Label>
            <Input
              aria-label="Período — de"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div>
            <Label>Período — até</Label>
            <Input
              aria-label="Período — até"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="min-w-48 flex-1">
            <Label>Corretor</Label>
            <Input
              aria-label="Corretor"
              placeholder="Filtrar por nome do corretor"
              value={corretorQ}
              onChange={(e) => setCorretorQ(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Checkbox
              id="incluir-canceladas"
              checked={incluirCanceladas}
              onCheckedChange={(v) => setIncluirCanceladas(!!v)}
            />
            <Label
              htmlFor="incluir-canceladas"
              className="cursor-pointer text-sm font-normal text-muted-foreground"
            >
              Incluir vendas canceladas/arquivadas (histórico)
            </Label>
          </div>
        </CardContent>
      </Card>

      {inconsistentes.length > 0 && (
        <Card className="border-destructive/40">
          <CardContent className="py-3 text-sm text-destructive">
            {inconsistentes.length} ocorrência(s) sem venda correspondente carregada — excluída(s)
            de todos os totais desta página por segurança. Verifique com o suporte técnico.
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="caixa">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="caixa" className="shrink-0">
              Fluxo de caixa
            </TabsTrigger>
            <TabsTrigger value="comissoes" className="shrink-0">
              Comissões
            </TabsTrigger>
            <TabsTrigger value="financiamentos" className="shrink-0">
              Financiamentos
            </TabsTrigger>
            <TabsTrigger value="funil" className="shrink-0">
              Funil de ocorrências
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="caixa">
          <p className="mb-3 text-xs text-muted-foreground">
            "Período" aqui filtra pela <b>data efetiva quando recebido</b> e pela data prevista
            enquanto pendente.
            {!incluirCanceladas && " Vendas canceladas/arquivadas não entram nos totais."}
          </p>
          <FluxoCaixaTab
            occs={occsAtivas}
            saleById={saleById}
            saleLabel={saleLabel}
            corretorNome={corretorNome}
            matchesCorretor={matchesCorretor}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={load}
          />
        </TabsContent>
        <TabsContent value="comissoes">
          <p className="mb-3 text-xs text-muted-foreground">
            "Período" aqui filtra pela <b>data comercial da venda</b>, usando a assinatura válida
            mais recente (ou a entrada no Financeiro para lançamento).
            {!incluirCanceladas && " Vendas canceladas/arquivadas não entram nos totais."}
          </p>
          <ComissoesTab
            occs={occsAtivas}
            comms={comms}
            partners={partners}
            saleById={saleById}
            vendaComercialEm={vendaComercialEm}
            saleLabel={saleLabel}
            corretorNome={corretorNome}
            matchesCorretor={matchesCorretor}
            dateFrom={dateFrom}
            dateTo={dateTo}
          />
        </TabsContent>
        <TabsContent value="financiamentos">
          <p className="mb-3 text-xs text-muted-foreground">
            "Período" aqui filtra pela <b>previsão de liberação do crédito</b>.
            {!incluirCanceladas && " Vendas canceladas/arquivadas não entram nos totais."}
          </p>
          <FinanciamentosTab
            occs={occsAtivas}
            saleById={saleById}
            saleLabel={saleLabel}
            corretorNome={corretorNome}
            matchesCorretor={matchesCorretor}
            dateFrom={dateFrom}
            dateTo={dateTo}
          />
        </TabsContent>
        <TabsContent value="funil">
          <p className="mb-3 text-xs text-muted-foreground">
            "Período" aqui filtra pela <b>última atualização</b> da venda.
          </p>
          <FunilTab
            sales={sales}
            occs={occs}
            saleLabel={saleLabel}
            corretorNome={corretorNome}
            matchesCorretor={matchesCorretor}
            dateFrom={dateFrom}
            dateTo={dateTo}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <Download className="mr-2 h-4 w-4" />
      Exportar CSV
    </Button>
  );
}

function FluxoCaixaTab({
  occs,
  saleById,
  saleLabel,
  corretorNome,
  matchesCorretor,
  dateFrom,
  dateTo,
  onChange,
}: {
  occs: ReportOccurrence[];
  saleById: Record<string, ReportSale>;
  saleLabel: (s: ReportSale | undefined) => string;
  corretorNome: (s: ReportSale | undefined) => string;
  matchesCorretor: (s: ReportSale | undefined) => boolean;
  dateFrom: string;
  dateTo: string;
  onChange: () => void;
}) {
  const rows = useMemo(() => {
    const out: {
      sale: ReportSale;
      occId: string;
      parcela: number;
      data: string;
      valor: number;
      forma: string | null;
      recebidoEm: string | null;
      recebidoValor: number | null;
    }[] = [];
    for (const o of occs) {
      const sale = saleById[o.sale_id];
      if (!matchesCorretor(sale)) continue;
      // prev_recebimento{1,2,3}_valor já é a fatia própria — a parceria externa (quando existe) nunca
      // passa por essa conta, cobrada direto pelo parceiro.
      const parcelas: [
        string | null,
        number | null,
        string | null,
        string | null,
        number | null,
      ][] = [
        [
          o.prev_recebimento_data,
          o.prev_recebimento_valor,
          o.prev_recebimento_forma,
          o.prev_recebimento_recebido_em,
          o.prev_recebimento_recebido_valor,
        ],
        [
          o.prev_recebimento2_data,
          o.prev_recebimento2_valor,
          o.prev_recebimento2_forma,
          o.prev_recebimento2_recebido_em,
          o.prev_recebimento2_recebido_valor,
        ],
        [
          o.prev_recebimento3_data,
          o.prev_recebimento3_valor,
          o.prev_recebimento3_forma,
          o.prev_recebimento3_recebido_em,
          o.prev_recebimento3_recebido_valor,
        ],
      ];
      parcelas.forEach(([data, valor, forma, recebidoEm, recebidoValor], i) => {
        if (!data || !valor) return;
        // Recebido entra pelo dia efetivo; pendente entra pela data prevista.
        if (!inRange(recebidoEm ?? data, dateFrom, dateTo)) return;
        out.push({
          sale,
          occId: o.id,
          parcela: i + 1,
          data,
          valor: Number(valor),
          forma,
          recebidoEm,
          recebidoValor: recebidoValor != null ? Number(recebidoValor) : null,
        });
      });
    }
    return out.sort((a, b) => a.data.localeCompare(b.data));
  }, [occs, saleById, matchesCorretor, dateFrom, dateTo]);

  const hoje = todayISO();
  const totalPrevisto = rows.reduce((s, r) => s + r.valor, 0);
  const totalRecebido = rows
    .filter((r) => r.recebidoEm)
    .reduce((s, r) => s + (r.recebidoValor ?? 0), 0);
  const totalVencido = rows
    .filter((r) => !r.recebidoEm && r.data < hoje)
    .reduce((s, r) => s + r.valor, 0);
  const totalAVencer = rows
    .filter((r) => !r.recebidoEm && r.data >= hoje)
    .reduce((s, r) => s + r.valor, 0);

  const situacao = (r: (typeof rows)[number]) =>
    r.recebidoEm ? "Recebida" : r.data < hoje ? "Vencida" : "A vencer";

  const doExport = () =>
    exportCsv(
      `fluxo-caixa_${dateFrom}_a_${dateTo}.csv`,
      rows.map((r) => ({
        Imovel: saleLabel(r.sale),
        Corretor: corretorNome(r.sale),
        Parcela: r.parcela,
        Data: r.data,
        Valor: r.valor.toFixed(2),
        Forma: r.forma ?? "",
        Situacao: situacao(r),
        RecebidoEm: r.recebidoEm ?? "",
        ValorRecebido: r.recebidoValor != null ? r.recebidoValor.toFixed(2) : "",
      })),
    );

  const [marcando, setMarcando] = useState<{ occId: string; parcela: number } | null>(null);
  const [recValor, setRecValor] = useState<number | null>(null);
  const [recData, setRecData] = useState(hoje);
  const [saving, setSaving] = useState(false);

  const abrirMarcar = (r: (typeof rows)[number]) => {
    setMarcando({ occId: r.occId, parcela: r.parcela });
    setRecValor(r.valor);
    setRecData(hoje);
  };

  const confirmarRecebido = async () => {
    if (!marcando) return;
    setSaving(true);
    try {
      const result = await supabase
        .from("occurrences")
        .update(recebimentoPatch(marcando.parcela, recData, recValor))
        .eq("id", marcando.occId)
        .select("id");
      confirmarLinhaAlterada(result, marcando.occId);
      toast.success("Recebimento registrado");
      setMarcando(null);
      onChange();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao registrar recebimento.");
    } finally {
      setSaving(false);
    }
  };

  // Desfazer apaga a data e o valor recebidos: sempre pede confirmação antes (item 3 t_8730be75).
  const [desfazendo, setDesfazendo] = useState<(typeof rows)[number] | null>(null);

  const desfazerRecebido = async (occId: string, parcela: number) => {
    try {
      const result = await supabase
        .from("occurrences")
        .update(recebimentoPatch(parcela, null, null))
        .eq("id", occId)
        .select("id");
      confirmarLinhaAlterada(result, occId);
      toast.success("Desfeito");
      onChange();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao desfazer recebimento.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          icon={Wallet}
          tom="blue"
          label="Total previsto no período (nossa parte)"
          value={money(totalPrevisto)}
        />
        <KpiTile
          icon={CheckCircle2}
          tom="green"
          label="Recebido"
          value={money(totalRecebido)}
          valueClassName="text-emerald-700 dark:text-emerald-400"
        />
        <KpiTile
          icon={AlertTriangle}
          tom="red"
          label="Vencido (não recebido)"
          value={money(totalVencido)}
          valueClassName="text-destructive"
        />
        <KpiTile icon={CalendarClock} tom="amber" label="A vencer" value={money(totalAVencer)} />
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Parcelas previstas ({rows.length})</CardTitle>
          <ExportButton onClick={doExport} />
        </CardHeader>
        <CardContent>
          <div className="hidden md:block print:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Imóvel</TableHead>
                  <TableHead>Corretor</TableHead>
                  <TableHead>Parcela</TableHead>
                  <TableHead>Data prevista</TableHead>
                  <TableHead>Forma</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <EmptyRow colSpan={8}>
                    Nenhuma parcela prevista no período/filtro selecionado.
                  </EmptyRow>
                )}
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">
                      {r.sale ? (
                        <Link
                          to="/vendas/$id"
                          params={{ id: r.sale.id }}
                          className="hover:underline"
                        >
                          {saleLabel(r.sale)}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{corretorNome(r.sale)}</TableCell>
                    <TableCell>{r.parcela}ª</TableCell>
                    <TableCell>{dateBR(r.data)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.forma ?? "—"}</TableCell>
                    <TableCell>{money(r.valor)}</TableCell>
                    <TableCell>
                      {r.recebidoEm ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          Recebida em {dateBR(r.recebidoEm)}
                          {r.recebidoValor != null ? ` — ${money(r.recebidoValor)}` : ""}
                        </span>
                      ) : (
                        <span
                          className={r.data < hoje ? "text-destructive" : "text-muted-foreground"}
                        >
                          {r.data < hoje ? "Vencida" : "A vencer"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.recebidoEm ? (
                        <Button size="sm" variant="ghost" onClick={() => setDesfazendo(r)}>
                          Desfazer
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => abrirMarcar(r)}>
                          Marcar recebido
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Celular: mesmas parcelas e as mesmas ações (marcar/desfazer) em cartões. */}
          <div className="space-y-3 md:hidden print:hidden">
            {rows.length === 0 && (
              <EmptyState>Nenhuma parcela prevista no período/filtro selecionado.</EmptyState>
            )}
            {rows.map((r, i) => (
              <div key={i} className="space-y-2 rounded-xl border bg-card p-3 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    {r.sale ? (
                      <Link
                        to="/vendas/$id"
                        params={{ id: r.sale.id }}
                        className="break-words font-medium hover:underline"
                      >
                        {saleLabel(r.sale)}
                      </Link>
                    ) : (
                      <span className="font-medium">—</span>
                    )}
                    <p className="text-xs text-muted-foreground">{r.parcela}ª parcela</p>
                  </div>
                  {r.recebidoEm ? (
                    <Pill tom="green">Recebida</Pill>
                  ) : r.data < hoje ? (
                    <Pill tom="red">Vencida</Pill>
                  ) : (
                    <Pill tom="blue">A vencer</Pill>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <CardField label="Valor">
                    <span className="font-semibold">{money(r.valor)}</span>
                  </CardField>
                  <CardField label="Data prevista">{dateBR(r.data)}</CardField>
                  <CardField label="Corretor">{corretorNome(r.sale)}</CardField>
                  <CardField label="Forma">{r.forma ?? "—"}</CardField>
                  {r.recebidoEm && (
                    <CardField label="Recebimento" className="col-span-2">
                      Recebida em {dateBR(r.recebidoEm)}
                      {r.recebidoValor != null ? ` — ${money(r.recebidoValor)}` : ""}
                    </CardField>
                  )}
                </dl>
                {r.recebidoEm ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full"
                    onClick={() => setDesfazendo(r)}
                  >
                    Desfazer
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => abrirMarcar(r)}
                  >
                    Marcar recebido
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={!!marcando}
        onOpenChange={(o) => {
          if (!saving && !o) setMarcando(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar recebimento</DialogTitle>
            <DialogDescription>
              Confirme o valor e a data em que a comissão foi efetivamente recebida.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Valor recebido</Label>
              <CurrencyInput value={recValor} onChange={setRecValor} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                Data do recebimento
              </Label>
              <Input
                aria-label="Data do recebimento"
                type="date"
                value={recData}
                onChange={(e) => setRecData(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMarcando(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={confirmarRecebido} disabled={saving || !recData}>
              {saving ? "Salvando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!desfazendo}
        onOpenChange={(o) => {
          if (!o) setDesfazendo(null);
        }}
        testId="confirmar-desfazer-recebimento"
        title="Desfazer este recebimento?"
        description={
          desfazendo ? (
            <>
              <p>
                {saleLabel(desfazendo.sale)} — {desfazendo.parcela}ª parcela
                {desfazendo.recebidoEm ? `, recebida em ${dateBR(desfazendo.recebidoEm)}` : ""}
                {desfazendo.recebidoValor != null ? ` (${money(desfazendo.recebidoValor)})` : ""}.
              </p>
              <p>A data e o valor recebidos serão apagados e a parcela volta para “A vencer”.</p>
            </>
          ) : null
        }
        confirmLabel="Desfazer recebimento"
        destructive
        onConfirm={() => {
          if (desfazendo) void desfazerRecebido(desfazendo.occId, desfazendo.parcela);
        }}
      />
    </div>
  );
}

function ComissoesTab({
  occs,
  comms,
  partners,
  saleById,
  vendaComercialEm,
  saleLabel,
  corretorNome,
  matchesCorretor,
  dateFrom,
  dateTo,
}: {
  occs: ReportOccurrence[];
  comms: OccurrenceCommissionRow[];
  partners: OccurrencePartnerRow[];
  saleById: Record<string, ReportSale>;
  saleLabel: (s: ReportSale | undefined) => string;
  corretorNome: (s: ReportSale | undefined) => string;
  matchesCorretor: (s: ReportSale | undefined) => boolean;
  vendaComercialEm: Record<string, string>;
  dateFrom: string;
  dateTo: string;
}) {
  const [papelFilter, setPapelFilter] = useState("todos");

  const occById = useMemo(() => {
    const m: Record<string, ReportOccurrence> = {};
    for (const o of occs) m[o.id] = o;
    return m;
  }, [occs]);

  const rows = useMemo(() => {
    const out: {
      sale: ReportSale;
      occ: ReportOccurrence;
      papel: string;
      nome: string | null;
      valor: number;
      percentual: number | null;
    }[] = [];
    for (const c of comms) {
      if (c.sem_cadastro_confirmado === true) continue;
      const occ = occById[c.occurrence_id];
      if (!occ) continue;
      const sale = saleById[occ.sale_id];
      if (!matchesCorretor(sale)) continue;
      if (!inRange(vendaComercialEm[occ.sale_id], dateFrom, dateTo)) continue;
      if (!c.valor) continue;
      out.push({
        sale,
        occ,
        papel: c.papel,
        nome: c.nome,
        valor: Number(c.valor),
        percentual: c.percentual,
      });
    }
    return out.filter((r) => papelFilter === "todos" || r.papel === papelFilter);
  }, [comms, occById, saleById, vendaComercialEm, matchesCorretor, dateFrom, dateTo, papelFilter]);

  const papeis = useMemo(() => {
    const s = new Set<string>();
    comms.forEach((c) => s.add(c.papel));
    return Array.from(s);
  }, [comms]);

  const papelLabel: Record<string, string> = {
    corretor_captador: "Corretor captador",
    indicador_captador: "Indicador do captador",
    coordenador_captador: "Coordenador captador",
    corretor_vendedor: "Corretor vendedor",
    indicador_vendedor: "Indicador do vendedor",
    coordenador_vendedor: "Coordenador vendedor",
  };

  const total = rows.reduce((s, r) => s + r.valor, 0);

  const doExport = () =>
    exportCsv(
      `comissoes_${dateFrom}_a_${dateTo}.csv`,
      rows.map((r) => ({
        Imovel: saleLabel(r.sale),
        Papel: papelLabel[r.papel] ?? r.papel,
        Beneficiario: r.nome ?? "",
        Percentual: r.percentual ?? "",
        Valor: r.valor.toFixed(2),
        DataVendaComercial: dataCivilSaoPaulo(vendaComercialEm[r.occ.sale_id]) ?? "",
      })),
    );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <KpiTile
          icon={Calculator}
          tom="blue"
          label="Total REMAX no período (sem parceria)"
          value={money(total)}
        />
        <Card>
          <CardContent className="flex items-end justify-between pt-6">
            <div>
              <Label>Papel</Label>
              <Select value={papelFilter} onValueChange={setPapelFilter}>
                <SelectTrigger aria-label="Papel" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os papéis</SelectItem>
                  {papeis.map((p) => (
                    <SelectItem key={p} value={p}>
                      {papelLabel[p] ?? p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Comissões calculadas ({rows.length})</CardTitle>
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
                <TableHead>Assinada em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <EmptyRow colSpan={6}>
                  Nenhuma comissão encontrada no período/filtro selecionado.
                </EmptyRow>
              )}
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">
                    {r.sale ? (
                      <Link to="/vendas/$id" params={{ id: r.sale.id }} className="hover:underline">
                        {saleLabel(r.sale)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {papelLabel[r.papel] ?? r.papel}
                  </TableCell>
                  <TableCell>{r.nome ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.percentual != null ? `${r.percentual}%` : "—"}
                  </TableCell>
                  <TableCell>{money(r.valor)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {dateBR(vendaComercialEm[r.occ.sale_id])}
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

function FinanciamentosTab({
  occs,
  saleById,
  saleLabel,
  corretorNome,
  matchesCorretor,
  dateFrom,
  dateTo,
}: {
  occs: ReportOccurrence[];
  saleById: Record<string, ReportSale>;
  saleLabel: (s: ReportSale | undefined) => string;
  corretorNome: (s: ReportSale | undefined) => string;
  matchesCorretor: (s: ReportSale | undefined) => boolean;
  dateFrom: string;
  dateTo: string;
}) {
  const [bancoQ, setBancoQ] = useState("");
  const [somenteAbertos, setSomenteAbertos] = useState(true);
  const [obaFiltro, setObaFiltro] = useState<"todos" | "somente" | "sem">("todos");

  const rows = useMemo(() => {
    return occs
      .filter((o) => {
        if (!o.financiamento) return false;
        const sale = saleById[o.sale_id];
        if (!matchesCorretor(sale)) return false;
        if (somenteAbertos && sale?.status === "ocorrencia_concluida") return false;
        if (o.financiamento_previsao && !inRange(o.financiamento_previsao, dateFrom, dateTo))
          return false;
        if (bancoQ && !(o.financiamento_banco ?? "").toLowerCase().includes(bancoQ.toLowerCase()))
          return false;
        if (obaFiltro === "somente" && !o.oba_credito) return false;
        if (obaFiltro === "sem" && o.oba_credito) return false;
        return true;
      })
      .map((o) => ({ occ: o, sale: saleById[o.sale_id] }));
  }, [occs, saleById, matchesCorretor, dateFrom, dateTo, bancoQ, somenteAbertos, obaFiltro]);

  const total = rows.reduce((s, r) => s + Number(r.occ.financiamento_valor ?? 0), 0);

  const doExport = () =>
    exportCsv(
      `financiamentos_${dateFrom}_a_${dateTo}.csv`,
      rows.map((r) => ({
        Imovel: saleLabel(r.sale),
        Corretor: corretorNome(r.sale),
        Banco: r.occ.financiamento_banco ?? "",
        Correspondente: r.occ.financiamento_correspondente ?? "",
        ValorFinanciado: Number(r.occ.financiamento_valor ?? 0).toFixed(2),
        ObaCredito: r.occ.oba_credito ? "Sim" : "Não",
        PrevisaoLiberacao: r.occ.financiamento_previsao ?? "",
        StatusVenda: r.sale ? STATUS_LABEL[r.sale.status as SaleStatus] : "",
      })),
    );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          icon={Landmark}
          tom="blue"
          label="Valor total financiado (filtro atual)"
          value={money(total)}
        />
        <Card>
          <CardContent className="pt-6">
            <Label>Banco / correspondente</Label>
            <Input
              aria-label="Banco / correspondente"
              placeholder="Filtrar por nome"
              value={bancoQ}
              onChange={(e) => setBancoQ(e.target.value)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Label>Situação</Label>
            <Select
              value={somenteAbertos ? "abertos" : "todos"}
              onValueChange={(v) => setSomenteAbertos(v === "abertos")}
            >
              <SelectTrigger aria-label="Situação">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="abertos">Somente em aberto</SelectItem>
                <SelectItem value="todos">Todos (inclusive concluídos)</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Label>Oba Crédito</Label>
            <Select
              value={obaFiltro}
              onValueChange={(v) => setObaFiltro(v as "todos" | "somente" | "sem")}
            >
              <SelectTrigger aria-label="Oba Crédito">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os financiamentos</SelectItem>
                <SelectItem value="somente">Somente Oba Crédito</SelectItem>
                <SelectItem value="sem">Sem Oba Crédito</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
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
                <TableHead>Oba Crédito</TableHead>
                <TableHead>Previsão liberação</TableHead>
                <TableHead>Status da venda</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <EmptyRow colSpan={8}>
                  Nenhum financiamento encontrado no período/filtro selecionado.
                </EmptyRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.occ.id}>
                  <TableCell className="font-medium">
                    {r.sale ? (
                      <Link to="/vendas/$id" params={{ id: r.sale.id }} className="hover:underline">
                        {saleLabel(r.sale)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{corretorNome(r.sale)}</TableCell>
                  <TableCell>{r.occ.financiamento_banco ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.occ.financiamento_correspondente ?? "—"}
                  </TableCell>
                  <TableCell>{money(r.occ.financiamento_valor)}</TableCell>
                  <TableCell>
                    {r.occ.oba_credito ? (
                      <Badge variant="secondary">Oba Crédito</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{dateBR(r.occ.financiamento_previsao)}</TableCell>
                  <TableCell>
                    {r.sale ? <StatusBadge status={r.sale.status as SaleStatus} /> : "—"}
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

function FunilTab({
  sales,
  occs,
  saleLabel,
  corretorNome,
  matchesCorretor,
  dateFrom,
  dateTo,
}: {
  sales: ReportSale[];
  occs: ReportOccurrence[];
  saleLabel: (s: ReportSale | undefined) => string;
  corretorNome: (s: ReportSale | undefined) => string;
  matchesCorretor: (s: ReportSale | undefined) => boolean;
  dateFrom: string;
  dateTo: string;
}) {
  const occBySaleId = useMemo(() => {
    const m: Record<string, ReportOccurrence> = {};
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

  const doExport = () =>
    exportCsv(
      `funil-ocorrencias_${dateFrom}_a_${dateTo}.csv`,
      rows.map((r) => ({
        Imovel: saleLabel(r.sale),
        Corretor: corretorNome(r.sale),
        Status: STATUS_LABEL[r.sale.status as SaleStatus],
        AtualizadoEm: r.sale.updated_at,
        Reaberta: r.occ?.reopened_at ? "Sim" : "Não",
        MotivoReabertura: r.occ?.reopen_reason ?? "",
      })),
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {FUNIL_STATUSES.map((st) => (
          <KpiTile
            key={st}
            icon={Workflow}
            tom="slate"
            label={STATUS_LABEL[st]}
            value={String(counts[st] ?? 0)}
          />
        ))}
        <KpiTile
          icon={RotateCcw}
          tom="amber"
          label="Reabertas no período"
          value={String(reabertas)}
          valueClassName="text-amber-700 dark:text-amber-400"
        />
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Vendas na etapa financeiro/ocorrência ({rows.length})
          </CardTitle>
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
              {rows.length === 0 && (
                <EmptyRow colSpan={5}>
                  Nenhuma venda encontrada no período/filtro selecionado.
                </EmptyRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.sale.id}>
                  <TableCell className="font-medium">
                    <Link to="/vendas/$id" params={{ id: r.sale.id }} className="hover:underline">
                      {saleLabel(r.sale)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{corretorNome(r.sale)}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.sale.status as SaleStatus} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {dateBR(r.sale.updated_at)}
                  </TableCell>
                  <TableCell>
                    {r.occ?.reopened_at ? (
                      <span
                        className="text-amber-700 dark:text-amber-400"
                        title={r.occ.reopen_reason ?? ""}
                      >
                        Sim
                      </span>
                    ) : (
                      "—"
                    )}
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
