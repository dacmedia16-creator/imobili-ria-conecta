import { createFileRoute } from "@tanstack/react-router";
import { requireRoles } from "@/lib/route-access";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Scale } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { KpiGridSkeleton, ListSkeleton, PageHeader } from "@/components/visual/base";
import { podeAcessarComparativo6pct, resumoComparativo } from "@/lib/comparativo-comissao-calc";
import { aplicarFiltros, filtrosPadrao } from "@/lib/comparativo-comissao-filters";
import {
  fetchComparativoInconsistencias,
  fetchComparativoRows,
} from "@/lib/comparativo-comissao-query";
import type {
  ComparativoFiltros,
  ComparativoRowComCalculo,
  InconsistenciaRow,
} from "@/lib/comparativo-comissao-types";
import { SummaryCards } from "@/components/comparativo-comissao/SummaryCards";
import { Filters } from "@/components/comparativo-comissao/Filters";
import { DetailTable } from "@/components/comparativo-comissao/DetailTable";
import { MonthlyGrouping } from "@/components/comparativo-comissao/MonthlyGrouping";
import { InconsistenciasIndicator } from "@/components/comparativo-comissao/InconsistenciasIndicator";

export const Route = createFileRoute("/_authenticated/comparativo-comissao")({
  head: () => ({ meta: [{ title: "Comparativo 6%" }] }),
  // Proteção no nível da rota, além da checagem no componente (useAuth) e do RAISE EXCEPTION dentro
  // da RPC comparativo_comissao_6pct: quem tenta acessar a URL direto sem um dos três papéis é
  // barrado antes de qualquer dado carregar e mandado de volta pro Dashboard.
  beforeLoad: ({ context }) => requireRoles(context.auth, podeAcessarComparativo6pct),
  component: ComparativoComissaoPage,
});

function ComparativoComissaoPage() {
  const { hasAny, loading: authLoading } = useAuth();
  const allowed = hasAny(["admin", "super_admin", "financeiro"]);

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [rows, setRows] = useState<ComparativoRowComCalculo[]>([]);
  const [inconsistencias, setInconsistencias] = useState<InconsistenciaRow[]>([]);
  const [filtros, setFiltros] = useState<ComparativoFiltros>(filtrosPadrao());

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      setErro(null);
      try {
        setRows(await fetchComparativoRows());
      } catch (err) {
        setErro(err instanceof Error ? err.message : "Falha ao carregar o comparativo.");
      }
      // Falha aqui não pode travar o relatório principal — o indicador é só informativo.
      try {
        setInconsistencias(await fetchComparativoInconsistencias());
      } catch {
        setInconsistencias([]);
      }
      setLoading(false);
    })();
  }, [allowed]);

  const corretorOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.corretor_id, r.corretorNome);
    return Array.from(m.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const teamOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.teamId) m.set(r.teamId, r.teamNome ?? r.teamId);
    return Array.from(m.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const filtradas = useMemo(() => aplicarFiltros(rows, filtros), [rows, filtros]);
  const resumo = useMemo(() => resumoComparativo(filtradas), [filtradas]);

  if (authLoading || loading)
    return (
      <div className="space-y-6" role="status" aria-live="polite">
        <span className="sr-only">Carregando…</span>
        <KpiGridSkeleton count={6} className="lg:grid-cols-3 xl:grid-cols-6" />
        <ListSkeleton rows={6} label="Carregando vendas" />
      </div>
    );

  if (!allowed) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Esta área é restrita a administradores e financeiro.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Scale}
        title="Comparativo 6%"
        description="Comparação da produção atribuída à REMAX, já sem parceria externa, considerando comissão-padrão de 6%."
      />

      {erro && (
        <Card className="border-destructive/40">
          <CardContent className="py-3 text-sm text-destructive">{erro}</CardContent>
        </Card>
      )}

      <InconsistenciasIndicator rows={inconsistencias} />
      <Filters
        filtros={filtros}
        onChange={setFiltros}
        corretorOptions={corretorOptions}
        teamOptions={teamOptions}
      />
      <SummaryCards resumo={resumo} />
      <DetailTable rows={filtradas} />
      <MonthlyGrouping rows={filtradas} />
    </div>
  );
}
