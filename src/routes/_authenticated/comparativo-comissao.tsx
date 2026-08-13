import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { podeAcessarComparativo6pct, resumoComparativo } from "@/lib/comparativo-comissao-calc";
import { aplicarFiltros, filtrosPadrao } from "@/lib/comparativo-comissao-filters";
import { fetchComparativoInconsistencias, fetchComparativoRows } from "@/lib/comparativo-comissao-query";
import type { ComparativoFiltros, ComparativoRowComCalculo, InconsistenciaRow } from "@/lib/comparativo-comissao-types";
import { SummaryCards } from "@/components/comparativo-comissao/SummaryCards";
import { Filters } from "@/components/comparativo-comissao/Filters";
import { DetailTable } from "@/components/comparativo-comissao/DetailTable";
import { MonthlyGrouping } from "@/components/comparativo-comissao/MonthlyGrouping";
import { InconsistenciasIndicator } from "@/components/comparativo-comissao/InconsistenciasIndicator";

export const Route = createFileRoute("/_authenticated/comparativo-comissao")({
  head: () => ({ meta: [{ title: "Comparativo de Comissão — Padrão 6%" }] }),
  // Proteção no nível da rota, além da checagem no componente (useAuth) e do RAISE EXCEPTION dentro
  // da RPC comparativo_comissao_6pct: quem tenta acessar a URL direto sem um dos três papéis é
  // barrado antes de qualquer dado carregar e mandado de volta pro Dashboard.
  beforeLoad: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/auth" });
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", session.user.id);
    const roles = (data ?? []).map((r) => r.role);
    if (!podeAcessarComparativo6pct(roles)) {
      toast.error("Acesso não autorizado.");
      throw redirect({ to: "/" });
    }
  },
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
    if (!allowed) { setLoading(false); return; }
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
    return Array.from(m.entries()).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const teamOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.teamId) m.set(r.teamId, r.teamNome ?? r.teamId);
    return Array.from(m.entries()).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const filtradas = useMemo(() => aplicarFiltros(rows, filtros), [rows, filtros]);
  const resumo = useMemo(() => resumoComparativo(filtradas), [filtradas]);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Comparativo de Comissão — Padrão 6%</h1>
        <p className="text-sm text-muted-foreground">
          Comparação entre o valor real das vendas e o VGV equivalente considerando comissão-padrão de 6%.
        </p>
      </div>

      {erro && (
        <Card className="border-destructive/40">
          <CardContent className="py-3 text-sm text-destructive">{erro}</CardContent>
        </Card>
      )}

      <InconsistenciasIndicator rows={inconsistencias} />
      <Filters filtros={filtros} onChange={setFiltros} corretorOptions={corretorOptions} teamOptions={teamOptions} />
      <SummaryCards resumo={resumo} />
      <DetailTable rows={filtradas} />
      <MonthlyGrouping rows={filtradas} />
    </div>
  );
}
