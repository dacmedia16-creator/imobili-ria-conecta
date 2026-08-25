import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download } from "lucide-react";
import { exportCsv } from "@/lib/csv";
import {
  aplicarFiltrosComissoes,
  aplicarFiltrosEfetivacao,
  aplicarFiltrosParcelas,
  calcularResumo,
  filtrosPadraoFinanceiro,
  podeAcessarCentralFinanceira,
} from "@/lib/financeiro-dashboard-calc";
import { fetchFinanceiroBundle, type FinanceiroBundle } from "@/lib/financeiro-dashboard-query";
import type { FinanceiroFiltros } from "@/lib/financeiro-dashboard-types";
import { SITUACAO_PARCELA_LABEL } from "@/lib/financeiro-dashboard-types";
import { Filters } from "@/components/financeiro/Filters";
import { SummaryCards } from "@/components/financeiro/SummaryCards";
import { OverviewCharts } from "@/components/financeiro/OverviewCharts";
import { RecebimentosTable } from "@/components/financeiro/RecebimentosTable";
import { ComissoesCalculadasTable } from "@/components/financeiro/ComissoesCalculadasTable";
import { AgingPanel } from "@/components/financeiro/AgingPanel";
import { DivergenciasList } from "@/components/financeiro/DivergenciasList";

export const Route = createFileRoute("/_authenticated/financeiro")({
  head: () => ({ meta: [{ title: "Financeiro" }] }),
  // Mesma proteção em 3 camadas do Comparativo 6%: rota (aqui), componente (useAuth) e RPC no
  // banco (comparativo_comissao_6pct* já barram quem não é financeiro/admin/super_admin — as
  // consultas diretas às tabelas usam RLS, que já restringe can_view_sale por papel).
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/auth" });
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id);
    const roles = (data ?? []).map((r) => r.role);
    if (!podeAcessarCentralFinanceira(roles)) {
      toast.error("Acesso não autorizado.");
      throw redirect({ to: "/dashboard" });
    }
  },
  component: CentralFinanceiraPage,
});

const hojeISO = () => new Date().toISOString().slice(0, 10);

function CentralFinanceiraPage() {
  const { hasAny, loading: authLoading } = useAuth();
  const allowed = hasAny(["financeiro", "admin", "super_admin"]);

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [bundle, setBundle] = useState<FinanceiroBundle | null>(null);
  const [filtros, setFiltros] = useState<FinanceiroFiltros>(filtrosPadraoFinanceiro());
  const hoje = hojeISO();

  const carregar = useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErro(null);
    try {
      setBundle(await fetchFinanceiroBundle());
    } catch (err) {
      setBundle(null);
      setErro(err instanceof Error ? err.message : "Falha ao carregar a Central Financeira.");
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const parcelasFiltradas = useMemo(
    () => (bundle ? aplicarFiltrosParcelas(bundle.parcelas, filtros) : []),
    [bundle, filtros],
  );
  const comissoesFiltradas = useMemo(
    () => (bundle ? aplicarFiltrosComissoes(bundle.comissoes, filtros) : []),
    [bundle, filtros],
  );
  const efetivadasFiltradas = useMemo(
    () => (bundle ? aplicarFiltrosEfetivacao(bundle.efetivadas, filtros) : []),
    [bundle, filtros],
  );
  // Divergências é uma fila own-scope (não respeita período/situação — mesmo padrão do indicador
  // de inconsistências do Comparativo 6%, que também não tem filtro de data).
  const divergencias = bundle?.divergencias ?? [];

  const resumo = useMemo(
    () =>
      calcularResumo({
        parcelas: parcelasFiltradas,
        comissoes: comissoesFiltradas,
        efetivadas: efetivadasFiltradas,
        divergenciasAbertas: divergencias.length,
        hoje,
      }),
    [parcelasFiltradas, comissoesFiltradas, efetivadasFiltradas, divergencias.length, hoje],
  );

  const exportarRecebimentos = () =>
    exportCsv(
      `recebimentos_${filtros.dataDe || "inicio"}_a_${filtros.dataAte || "fim"}.csv`,
      parcelasFiltradas.map((p) => ({
        Imovel: p.imovelLabel,
        CodigoInterno: p.codigoInterno ?? "",
        Corretor: p.corretorNome,
        Equipe: p.teamNome ?? "",
        Parcela: p.parcela,
        DataPrevista: p.dataPrevista,
        Forma: p.formaPrevista ?? "",
        ValorBruto: p.valorBrutoPrevisto.toFixed(2),
        ValorParceria: p.valorParceria.toFixed(2),
        ValorLiquidoPrevisto: p.valorLiquidoPrevisto.toFixed(2),
        DataRecebimento: p.dataRecebimento ?? "",
        ValorRecebido: p.valorRecebido != null ? p.valorRecebido.toFixed(2) : "",
        Diferenca: p.diferenca != null ? p.diferenca.toFixed(2) : "",
        Situacao: SITUACAO_PARCELA_LABEL[p.situacao],
      })),
    );

  const exportarComissoes = () =>
    exportCsv(
      `comissoes-calculadas_${filtros.dataDe || "inicio"}_a_${filtros.dataAte || "fim"}.csv`,
      comissoesFiltradas.map((r) => ({
        Imovel: r.imovelLabel,
        CodigoInterno: r.codigoInterno ?? "",
        DataEfetivacao: r.dataEfetivacao ?? "",
        Papel: r.papel,
        Beneficiario: r.beneficiarioNome ?? "",
        Equipe: r.teamNome ?? "",
        Gestor: r.gestorNome ?? "",
        Percentual: r.percentual ?? "",
        ValorCalculado: r.valor.toFixed(2),
        Origem: r.origem === "manual" ? "Ajuste manual" : "Automatica",
        SituacaoRecebimentoVenda: r.situacaoRecebimentoVenda,
        ComissaoCalculadaNaoEhPagamento: "true",
      })),
    );

  const exportarDivergencias = () =>
    exportCsv(
      "divergencias-financeiro.csv",
      divergencias.map((d) => ({
        Gravidade: d.gravidade,
        Tipo: d.tipo,
        Imovel: d.imovelLabel ?? "",
        Explicacao: d.explicacao,
        ValorAfetado: d.valorAfetado != null ? d.valorAfetado.toFixed(2) : "",
        AcaoRecomendada: d.acaoRecomendada,
      })),
    );

  if (authLoading || loading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  if (!allowed) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Esta área é restrita a administradores e financeiro.
        </CardContent>
      </Card>
    );
  }

  if (erro || !bundle) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="space-y-3 py-8 text-center">
          <p className="font-medium text-destructive">Não foi possível carregar todos os dados financeiros.</p>
          <p className="text-sm text-muted-foreground">
            {erro ?? "A Central Financeira recebeu uma resposta incompleta e não exibirá totais parciais."}
          </p>
          <Button type="button" variant="outline" onClick={() => void carregar()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
        <p className="text-sm text-muted-foreground">
          Produção gerada, receita líquida, caixa e próximos recebimentos em uma única visão.
        </p>
      </div>

      <Filters
        filtros={filtros}
        onChange={setFiltros}
        corretorOptions={bundle?.corretorOptions ?? []}
        gestorOptions={bundle?.gestorOptions ?? []}
        teamOptions={bundle?.teamOptions ?? []}
        periodoLabel="O período filtra por aba: Recebimentos/Aging usam a data prevista da parcela; Comissões Calculadas usa a data de efetivação da venda (mesma regra do Comparativo 6%). Divergências não usa período — é uma fila completa."
      />

      <Tabs defaultValue="visao-geral">
        {/* <640px: rolagem horizontal em vez de quebrar linha — TabsList herda h-9 fixo do
            componente base (ui/tabs.tsx); com flex-wrap a 2ª linha de abas ficava fora dessa
            altura fixa e sobrepunha o conteúdo logo abaixo. overflow-x-auto isola a rolagem
            dentro do próprio container, sem estourar a largura da página. */}
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="visao-geral" className="shrink-0">
              Visão Geral
            </TabsTrigger>
            <TabsTrigger value="recebimentos" className="shrink-0">
              Recebimentos
            </TabsTrigger>
            <TabsTrigger value="comissoes" className="shrink-0">
              Comissões Calculadas
            </TabsTrigger>
            <TabsTrigger value="aging" className="shrink-0">
              Previsão e Aging
            </TabsTrigger>
            <TabsTrigger value="divergencias" className="shrink-0">
              Divergências{divergencias.length > 0 ? ` (${divergencias.length})` : ""}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="visao-geral" className="space-y-4">
          <SummaryCards resumo={resumo} />
          <OverviewCharts parcelas={parcelasFiltradas} comissoes={comissoesFiltradas} hoje={hoje} />
        </TabsContent>

        <TabsContent value="recebimentos" className="space-y-3">
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {parcelasFiltradas.length} parcela(s) no filtro atual.
            </p>
            <Button size="sm" variant="outline" onClick={exportarRecebimentos}>
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
          <Card>
            <CardContent className="overflow-x-auto pt-6">
              <RecebimentosTable parcelas={parcelasFiltradas} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="comissoes" className="space-y-3">
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {comissoesFiltradas.length} linha(s) no filtro atual.
            </p>
            <Button size="sm" variant="outline" onClick={exportarComissoes}>
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
          <Card>
            <CardContent className="pt-6">
              <ComissoesCalculadasTable rows={comissoesFiltradas} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aging" className="space-y-3">
          <AgingPanel parcelas={parcelasFiltradas} hoje={hoje} />
        </TabsContent>

        <TabsContent value="divergencias" className="space-y-3">
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {divergencias.length} divergência(s) encontrada(s) — sempre sem filtro de período.
            </p>
            <Button size="sm" variant="outline" onClick={exportarDivergencias}>
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
          <DivergenciasList divergencias={divergencias} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
