import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABEL } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from "@/components/ui/chart";
import { proximoResponsavelRoles, type SaleStatus } from "@/lib/status";
import { fetchLedMemberIds } from "@/lib/team";
import { Plus, FileText, ClipboardCheck, Gavel, DollarSign, AlertCircle, CheckCircle2, TrendingUp, Target } from "lucide-react";

const mesAtualISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
const mesAtualLabel = () => new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

/** Agrupa os status granulares de venda em etapas macro, só para leitura visual no funil do dashboard. */
const FUNIL_STAGES: { key: string; label: string; statuses: SaleStatus[] }[] = [
  { key: "inicio", label: "Rascunho / devolvida", statuses: ["rascunho", "devolvida_ajuste", "ocorrencia_devolvida_gestor"] },
  { key: "aprovacao", label: "Em aprovação", statuses: ["enviada_revisao", "aprovada_gestor"] },
  { key: "juridico", label: "Jurídico / contrato", statuses: ["enviada_juridico", "em_elaboracao_contrato", "contrato_conferencia_gestor", "contrato_conferencia_corretor", "contrato_ok_corretor", "aguardando_assinatura"] },
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

/** Formato de retorno de dashboard_stats() — contagens/somas já agregadas no banco (respeitando o
 * RLS de cada papel, igual às queries diretas de antes), em vez de baixar sales/occurrences
 * inteiras só pra contar no client. */
type DashboardStats = {
  funil: Record<string, number>;
  minhas_vendas: number;
  minhas_pendencias: number;
  meus_contratos_conferir: number;
  meus_assinados: number;
  minha_comissao_prevista: number;
  gestor_aguardando_revisao: number;
  gestor_contratos_conferir: number;
  gestor_ocorrencias_enviar: number;
  gestor_devolvidas: number;
  juridico_aprovadas_gestor: number;
  juridico_em_elaboracao: number;
  juridico_aguardando_assinatura: number;
  juridico_assinados: number;
  fin_ocorrencias_analise: number;
  fin_devolvidas: number;
  occ_pendentes_total: number;
  occ_concluidas_total: number;
  comissao_prevista_total: number;
  comissao_concluida_total: number;
  comissao_por_corretor: Record<string, number>;
};

const RECENTES_COLUMNS = "id, status, valor_negociado, imovel_id, codigo_interno, corretor_id, updated_at";

function Dashboard() {
  const { user, roles, hasAny } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentes, setRecentes] = useState<any[]>([]);
  const [profileName, setProfileName] = useState<Record<string, string>>({});
  const [metaCorretor, setMetaCorretor] = useState<{ meta_comissao: number; comissao_realizada: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    if (!hasAny(["gestor", "team_leader"])) return;
    fetchLedMemberIds(user.id).then(setTeamIds);
  }, [user, hasAny]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const [statsRes, recentesRes, profRes, metasRes] = await Promise.all([
        supabase.rpc("dashboard_stats"),
        supabase.from("sales").select(RECENTES_COLUMNS).order("updated_at", { ascending: false }).limit(8),
        supabase.from("profiles").select("id, nome"),
        supabase.rpc("metas_progresso", { _mes: mesAtualISO() }),
      ]);
      setStats(statsRes.data as DashboardStats | null);
      setRecentes(recentesRes.data ?? []);
      const names: Record<string, string> = {};
      for (const p of profRes.data ?? []) names[p.id] = p.nome ?? p.id;
      setProfileName(names);
      const metasData = metasRes.data as { corretor: { corretor_id: string; meta_comissao: number; comissao_realizada: number }[] } | null;
      setMetaCorretor(metasData?.corretor.find((m) => m.corretor_id === user.id) ?? null);
      setLoading(false);
    })();
  }, [user]);

  const isCorretor = hasAny(["corretor"]) && !hasAny(["gestor", "team_leader", "juridico", "financeiro", "admin", "super_admin"]);
  const isGestor = hasAny(["gestor", "team_leader"]);
  const isJuridico = hasAny(["juridico"]);
  const isFinanceiro = hasAny(["financeiro", "admin", "super_admin"]);

  const funilData = FUNIL_STAGES.map(({ key, label, statuses }) => ({
    key, label, total: statuses.reduce((sum, st) => sum + (stats?.funil[st] ?? 0), 0),
  }));
  const totalFunil = funilData.reduce((sum, f) => sum + f.total, 0);
  const comissaoData = [{ prevista: stats?.comissao_prevista_total ?? 0, concluida: stats?.comissao_concluida_total ?? 0 }];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Olá, {(user && profileName[user.id]) || user?.email?.split("@")[0]}</h1>
          <p className="text-sm text-muted-foreground">Perfis: {roles.map(r => ROLE_LABEL[r]).join(", ") || "—"}</p>
        </div>
        {hasAny(["corretor", "gestor", "team_leader"]) && (
          <Button asChild>
            <Link to="/vendas/nova"><Plus className="mr-2 h-4 w-4" />Nova Venda</Link>
          </Button>
        )}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!loading && totalFunil > 0 && (
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
            <KpiCard icon={FileText} label="Minhas vendas" value={stats?.minhas_vendas ?? 0} to="/vendas" />
            <KpiCard icon={AlertCircle} label="Pendências (rascunho / devolvidas)" value={stats?.minhas_pendencias ?? 0} to="/vendas" />
            <KpiCard icon={FileText} label="Contratos para conferir" value={stats?.meus_contratos_conferir ?? 0} to="/vendas" />
            <KpiCard icon={CheckCircle2} label="Contratos assinados" value={stats?.meus_assinados ?? 0} to="/vendas" />
            <KpiCard
              icon={TrendingUp}
              label="Comissão prevista (vendas em andamento)"
              value={`R$ ${Number(stats?.minha_comissao_prevista ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
              to="/vendas"
            />
          </KpiGrid>
          {metaCorretor && (
            <Card className="mt-3">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="rounded-md bg-primary/10 p-2 text-primary"><Target className="h-5 w-5" /></div>
                <div className="flex-1">
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium">Meta de {mesAtualLabel()}</span>
                    <span className="text-muted-foreground">
                      R$ {metaCorretor.comissao_realizada.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} de R$ {metaCorretor.meta_comissao.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      {" "}({metaCorretor.meta_comissao > 0 ? Math.round((metaCorretor.comissao_realizada / metaCorretor.meta_comissao) * 100) : 0}%)
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${metaCorretor.comissao_realizada >= metaCorretor.meta_comissao ? "bg-emerald-500" : "bg-amber-500"}`}
                      style={{ width: `${Math.min(100, Math.max(0, metaCorretor.meta_comissao > 0 ? (metaCorretor.comissao_realizada / metaCorretor.meta_comissao) * 100 : 0))}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </DashSection>
      )}

      {/* Gestor */}
      {isGestor && (
        <DashSection title="Painel do gestor">
          <KpiGrid>
            <KpiCard icon={ClipboardCheck} label="Aguardando revisão" value={stats?.gestor_aguardando_revisao ?? 0} to="/vendas" />
            <KpiCard icon={FileText} label="Contratos para conferir" value={stats?.gestor_contratos_conferir ?? 0} to="/vendas" />
            <KpiCard icon={DollarSign} label="Ocorrências para enviar" value={stats?.gestor_ocorrencias_enviar ?? 0} to="/vendas" />
            <KpiCard icon={AlertCircle} label="Devolvidas" value={stats?.gestor_devolvidas ?? 0} to="/vendas" />
          </KpiGrid>
        </DashSection>
      )}

      {/* Jurídico */}
      {isJuridico && (
        <DashSection title="Painel do jurídico">
          <KpiGrid>
            <KpiCard icon={ClipboardCheck} label="Aprovadas pelo gestor" value={stats?.juridico_aprovadas_gestor ?? 0} to="/vendas" />
            <KpiCard icon={Gavel} label="Em elaboração" value={stats?.juridico_em_elaboracao ?? 0} to="/vendas" />
            <KpiCard icon={FileText} label="Aguardando assinatura" value={stats?.juridico_aguardando_assinatura ?? 0} to="/vendas" />
            <KpiCard icon={CheckCircle2} label="Assinados" value={stats?.juridico_assinados ?? 0} to="/vendas" />
          </KpiGrid>
        </DashSection>
      )}

      {/* Financeiro */}
      {isFinanceiro && (
        <DashSection title="Painel financeiro">
          <KpiGrid>
            <KpiCard icon={DollarSign} label="Ocorrências em análise" value={stats?.fin_ocorrencias_analise ?? 0} to="/vendas" />
            <KpiCard icon={AlertCircle} label="Devolvidas por mim" value={stats?.fin_devolvidas ?? 0} to="/vendas" />
            <KpiCard icon={DollarSign} label="Pendentes (total)" value={stats?.occ_pendentes_total ?? 0} to="/vendas" />
            <KpiCard icon={CheckCircle2} label="Ocorrências concluídas" value={stats?.occ_concluidas_total ?? 0} to="/vendas" />
            <KpiCard icon={TrendingUp} label="Comissão prevista" value={`R$ ${Number(stats?.comissao_prevista_total ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`} />
            <KpiCard icon={TrendingUp} label="Comissão concluída" value={`R$ ${Number(stats?.comissao_concluida_total ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`} />
          </KpiGrid>
          {((stats?.comissao_prevista_total ?? 0) > 0 || (stats?.comissao_concluida_total ?? 0) > 0) && (
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
          {Object.keys(stats?.comissao_por_corretor ?? {}).length > 0 && (
            <Card className="mt-3">
              <CardHeader><CardTitle className="text-base">Comissão por corretor</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                {Object.entries(stats?.comissao_por_corretor ?? {}).map(([cid, valor]) => (
                  <div key={cid} className="flex items-center justify-between rounded-md border p-2">
                    <span>{profileName[cid] ?? `${cid.slice(0, 8)}…`}</span>
                    <span className="font-medium">R$ {Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
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
          {!loading && recentes.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma venda ainda.</p>}
          {recentes.map((s) => {
            // admin/super_admin enxerga tudo por definição — "Sua vez" é pra quem tem uma fila
            // operacional de verdade, não pra quem só está supervisionando o sistema.
            const minhaVez = !hasAny(["admin", "super_admin"]) && proximoResponsavelRoles(s.status as SaleStatus).some((papel) =>
              papel === "corretor" ? s.corretor_id === user?.id
              // gestor/team_leader só é "a vez dele" se ele lidera o corretor da venda — ver
              // mesmo comentário em vendas.index.tsx.
              : papel === "gestor" ? hasAny(["gestor", "team_leader"]) && teamIds.has(s.corretor_id)
              : hasAny([papel])
            );
            return (
              <Link
                key={s.id}
                to="/vendas/$id"
                params={{ id: s.id }}
                className={`flex items-center justify-between rounded-md border p-3 hover:bg-muted/50 ${minhaVez ? "border-l-2 border-l-destructive" : ""}`}
              >
                <div>
                  <div className="text-sm font-medium">{s.imovel_id || s.codigo_interno || `Venda #${s.id.slice(0, 8)}`}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.valor_negociado ? `R$ ${Number(s.valor_negociado).toLocaleString("pt-BR")}` : "Valor pendente"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={s.status as SaleStatus} />
                  {minhaVez && (
                    <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                      Sua vez
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
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
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  const isZero = !Number.isNaN(numeric) && numeric === 0;
  const inner = (
    <Card className={to ? "transition hover:shadow-md" : ""}>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`rounded-md p-2 ${isZero ? "bg-muted text-muted-foreground/50" : "bg-primary/10 text-primary"}`}><Icon className="h-5 w-5" /></div>
        <div>
          <div className={`text-xl font-semibold leading-none ${isZero ? "text-muted-foreground/50" : ""}`}>{value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}
