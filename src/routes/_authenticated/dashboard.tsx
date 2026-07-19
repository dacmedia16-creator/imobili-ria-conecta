import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABEL } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from "@/components/ui/chart";
import { type SaleStatus } from "@/lib/status";
import { Plus, FileText, ClipboardCheck, Gavel, DollarSign, AlertCircle, CheckCircle2, TrendingUp } from "lucide-react";

/** Agrupa os status granulares de venda em etapas macro, só para leitura visual no funil do dashboard. */
const FUNIL_STAGES: { key: string; label: string; statuses: SaleStatus[] }[] = [
  { key: "inicio", label: "Rascunho / devolvida", statuses: ["rascunho", "devolvida_ajuste", "ocorrencia_devolvida_gestor"] },
  { key: "aprovacao", label: "Em aprovação", statuses: ["enviada_revisao", "aprovada_gestor"] },
  { key: "juridico", label: "Jurídico / contrato", statuses: ["em_elaboracao_contrato", "contrato_conferencia_gestor", "contrato_conferencia_corretor", "contrato_ok_corretor", "aguardando_assinatura"] },
  { key: "concluida", label: "Concluída", statuses: ["contrato_assinado", "ocorrencia_pendente", "ocorrencia_analise_financeiro", "ocorrencia_concluida"] },
  { key: "encerrada", label: "Cancelada / arquivada", statuses: ["cancelada", "arquivada"] },
];

const funilChartConfig = { total: { label: "Vendas", color: "var(--color-chart-1)" } } satisfies ChartConfig;

const comissaoChartConfig = {
  prevista: { label: "Prevista", color: "var(--color-chart-4)" },
  concluida: { label: "Concluída", color: "var(--color-chart-2)" },
} satisfies ChartConfig;

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user, roles, hasAny } = useAuth();
  const [sales, setSales] = useState<any[]>([]);
  const [occs, setOccs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const [s, o] = await Promise.all([
        supabase.from("sales").select("id, status, corretor_id, valor_negociado, valor_total_comissao, imovel_id, codigo_interno, updated_at, created_at").order("updated_at", { ascending: false }),
        supabase.from("occurrences").select("id, sale_id, valor_comissao, status, created_at"),
      ]);
      setSales(s.data ?? []);
      setOccs(o.data ?? []);
      setLoading(false);
    })();
  }, [user]);

  const isCorretor = hasAny(["corretor"]) && !hasAny(["gestor", "juridico", "financeiro", "admin", "super_admin"]);
  const isGestor = hasAny(["gestor"]);
  const isJuridico = hasAny(["juridico"]);
  const isFinanceiro = hasAny(["financeiro", "admin", "super_admin"]);

  const count = (fn: (s: any) => boolean) => sales.filter(fn).length;
  const juridicoStatuses = ["aprovada_gestor", "em_elaboracao_contrato", "contrato_conferencia_gestor", "contrato_conferencia_corretor", "contrato_ok_corretor", "aguardando_assinatura"];
  const contratoParaConferirCorretor = (uid?: string) => (s: any) => s.corretor_id === uid && s.status === "contrato_conferencia_corretor";
  const contratoParaConferirGestor = (s: any) => s.status === "contrato_conferencia_gestor" || s.status === "contrato_ok_corretor";

  const totalComissaoPrevista = occs
    .filter(o => o.status !== "concluida")
    .reduce((sum, o) => sum + Number(o.valor_comissao ?? 0), 0);
  const totalComissaoConcluida = occs
    .filter(o => o.status === "concluida")
    .reduce((sum, o) => sum + Number(o.valor_comissao ?? 0), 0);

  const comissaoPorCorretor: Record<string, number> = {};
  occs.forEach(o => {
    const sale = sales.find(s => s.id === o.sale_id);
    if (!sale) return;
    comissaoPorCorretor[sale.corretor_id] = (comissaoPorCorretor[sale.corretor_id] ?? 0) + Number(o.valor_comissao ?? 0);
  });

  const funilData = FUNIL_STAGES.map(({ key, label, statuses }) => ({
    key, label, total: sales.filter(s => statuses.includes(s.status)).length,
  }));
  const totalFunil = funilData.reduce((sum, f) => sum + f.total, 0);
  const comissaoData = [{ prevista: totalComissaoPrevista, concluida: totalComissaoConcluida }];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Olá, {user?.email?.split("@")[0]}</h1>
          <p className="text-sm text-muted-foreground">Perfis: {roles.map(r => ROLE_LABEL[r]).join(", ") || "—"}</p>
        </div>
        {hasAny(["corretor"]) && (
          <Button asChild>
            <Link to="/vendas/nova"><Plus className="mr-2 h-4 w-4" />Nova Venda</Link>
          </Button>
        )}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!loading && sales.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Vendas por etapa</CardTitle></CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-[1fr_260px]">
            <ChartContainer config={funilChartConfig} className="aspect-auto h-[220px] w-full">
              <BarChart data={funilData} layout="vertical" margin={{ left: 12 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={140} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => {
                        const pct = totalFunil > 0 ? Math.round((Number(value) / totalFunil) * 100) : 0;
                        return (
                          <span className="font-medium text-foreground">{Number(value)} vendas ({pct}%)</span>
                        );
                      }}
                    />
                  }
                />
                <Bar dataKey="total" fill="var(--color-total)" radius={4} />
              </BarChart>
            </ChartContainer>
            <div className="flex flex-col justify-center gap-1.5">
              {funilData.map(({ key, label, total }) => {
                const pct = totalFunil > 0 ? Math.round((total / totalFunil) * 100) : 0;
                return (
                  <div key={key} className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium">{total} <span className="text-xs text-muted-foreground">({pct}%)</span></span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Corretor */}
      {(hasAny(["corretor"]) || isCorretor) && (
        <DashSection title="Suas vendas">
          <KpiGrid>
            <KpiCard icon={FileText} label="Minhas vendas" value={count(s => s.corretor_id === user?.id)} to="/vendas" />
            <KpiCard icon={AlertCircle} label="Pendências (rascunho / devolvidas)" value={count(s => s.corretor_id === user?.id && (s.status === "rascunho" || s.status === "devolvida_ajuste"))} to="/vendas" />
            <KpiCard icon={FileText} label="Contratos para conferir" value={count(contratoParaConferirCorretor(user?.id))} to="/vendas" />
            <KpiCard icon={CheckCircle2} label="Contratos assinados" value={count(s => s.corretor_id === user?.id && ["contrato_assinado","ocorrencia_pendente","ocorrencia_analise_financeiro","ocorrencia_devolvida_gestor","ocorrencia_concluida"].includes(s.status))} to="/vendas" />
          </KpiGrid>
        </DashSection>
      )}

      {/* Gestor */}
      {isGestor && (
        <DashSection title="Painel do gestor">
          <KpiGrid>
            <KpiCard icon={ClipboardCheck} label="Aguardando revisão" value={count(s => s.status === "enviada_revisao")} to="/vendas" />
            <KpiCard icon={FileText} label="Contratos para conferir" value={count(contratoParaConferirGestor)} to="/vendas" />
            <KpiCard icon={DollarSign} label="Ocorrências para enviar" value={count(s => s.status === "ocorrencia_pendente" || s.status === "ocorrencia_devolvida_gestor")} to="/vendas" />
            <KpiCard icon={AlertCircle} label="Devolvidas" value={count(s => s.status === "devolvida_ajuste" || s.status === "ocorrencia_devolvida_gestor")} to="/vendas" />
          </KpiGrid>
        </DashSection>
      )}

      {/* Jurídico */}
      {isJuridico && (
        <DashSection title="Painel do jurídico">
          <KpiGrid>
            <KpiCard icon={ClipboardCheck} label="Aprovadas pelo gestor" value={count(s => s.status === "aprovada_gestor")} to="/vendas" />
            <KpiCard icon={Gavel} label="Em elaboração" value={count(s => s.status === "em_elaboracao_contrato")} to="/vendas" />
            <KpiCard icon={FileText} label="Aguardando assinatura" value={count(s => s.status === "aguardando_assinatura")} to="/vendas" />
            <KpiCard icon={CheckCircle2} label="Assinados" value={count(s => s.status === "contrato_assinado")} to="/vendas" />
          </KpiGrid>
        </DashSection>
      )}

      {/* Financeiro */}
      {isFinanceiro && (
        <DashSection title="Painel financeiro">
          <KpiGrid>
            <KpiCard icon={DollarSign} label="Ocorrências em análise" value={count(s => s.status === "ocorrencia_analise_financeiro")} to="/vendas" />
            <KpiCard icon={AlertCircle} label="Devolvidas por mim" value={count(s => s.status === "ocorrencia_devolvida_gestor")} to="/vendas" />
            <KpiCard icon={DollarSign} label="Pendentes (total)" value={occs.filter(o => o.status !== "concluida").length} to="/vendas" />
            <KpiCard icon={CheckCircle2} label="Ocorrências concluídas" value={occs.filter(o => o.status === "concluida").length} to="/vendas" />
            <KpiCard icon={TrendingUp} label="Comissão prevista" value={`R$ ${totalComissaoPrevista.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`} />
            <KpiCard icon={TrendingUp} label="Comissão concluída" value={`R$ ${totalComissaoConcluida.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`} />
          </KpiGrid>
          {(totalComissaoPrevista > 0 || totalComissaoConcluida > 0) && (
            <Card className="mt-3">
              <CardHeader><CardTitle className="text-base">Comissão: prevista x concluída</CardTitle></CardHeader>
              <CardContent>
                <ChartContainer config={comissaoChartConfig} className="aspect-auto h-[140px] w-full">
                  <BarChart data={comissaoData} layout="vertical" margin={{ left: 12 }}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                    <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v) => `R$ ${Number(v).toLocaleString("pt-BR")}`} />
                    <YAxis type="category" hide />
                    <ChartTooltip content={<ChartTooltipContent formatter={(value) => `R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`} />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="prevista" fill="var(--color-prevista)" radius={4} />
                    <Bar dataKey="concluida" fill="var(--color-concluida)" radius={4} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}
          {Object.keys(comissaoPorCorretor).length > 0 && (
            <Card className="mt-3">
              <CardHeader><CardTitle className="text-base">Comissão por corretor</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                {Object.entries(comissaoPorCorretor).map(([cid, valor]) => (
                  <div key={cid} className="flex items-center justify-between rounded-md border p-2">
                    <span className="font-mono text-xs">{cid.slice(0, 8)}…</span>
                    <span className="font-medium">R$ {valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </DashSection>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Vendas recentes</CardTitle>
          <Button asChild variant="ghost" size="sm"><Link to="/vendas">Ver todas</Link></Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {sales.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma venda ainda.</p>}
          {sales.slice(0, 8).map((s) => (
            <Link key={s.id} to="/vendas/$id" params={{ id: s.id }} className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/50">
              <div>
                <div className="text-sm font-medium">{s.imovel_id || s.codigo_interno || `Venda #${s.id.slice(0, 8)}`}</div>
                <div className="text-xs text-muted-foreground">
                  {s.valor_negociado ? `R$ ${Number(s.valor_negociado).toLocaleString("pt-BR")}` : "Valor pendente"}
                </div>
              </div>
              <StatusBadge status={s.status as SaleStatus} />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function DashSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

function KpiCard({ icon: Icon, label, value, to }: { icon: any; label: string; value: number | string; to?: string }) {
  const inner = (
    <Card className={to ? "transition hover:shadow-md" : ""}>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></div>
        <div>
          <div className="text-xl font-semibold leading-none">{value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}
