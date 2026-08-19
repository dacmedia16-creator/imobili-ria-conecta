import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABEL } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  agruparContagemPorGrupoVenda,
  proximoResponsavelRoles,
  type GrupoVenda,
  type SaleStatus,
} from "@/lib/status";
import { fetchLedMemberIds } from "@/lib/team";
import {
  PERIODO_LABEL,
  resolverPeriodo,
  validarPeriodoSearch,
  type PeriodoSearch,
  type PeriodoTipo,
} from "@/lib/dashboard-periodo";
import {
  fetchMovimentacaoPeriodo,
  type MovimentacaoPeriodo,
} from "@/lib/dashboard-movimentacao-query";
import {
  fetchResumoGrupoVenda,
  vgvAtivoTotal,
  type ResumoPorGrupo,
} from "@/lib/dashboard-perfil-query";
import {
  Plus,
  FileText,
  ClipboardCheck,
  Gavel,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  TrendingUp,
  Target,
  Send,
  Archive,
  Info,
  FileSignature,
  Landmark,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

const mesAtualISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const mesAtualLabel = () =>
  new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

/** As 4 etapas de negócio do funil geral (classificarGrupoVenda, src/lib/status.ts). Rótulos no
 * plural — são cabeçalhos de série/card agregado, não o rótulo de uma venda individual (esse é
 * GRUPO_VENDA_LABEL, em status.ts). Ordem de exibição pedida: preparação → futura → confirmada →
 * encerrada. */
const FUNIL_GRUPOS: { key: GrupoVenda; label: string }[] = [
  { key: "preparacao", label: "Em preparação" },
  { key: "futura", label: "Vendas futuras" },
  { key: "confirmada", label: "Vendas confirmadas" },
  { key: "encerrada", label: "Encerradas sem venda" },
];

const funilChartConfig = {
  total: { label: "Vendas", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

const comissaoChartConfig = {
  prevista: { label: "Prevista", color: "var(--color-chart-4)" },
  concluida: { label: "Concluída", color: "var(--color-chart-2)" },
} satisfies ChartConfig;

// Campos opcionais aqui (diferente de PeriodoSearch, que é o formato JÁ RESOLVIDO e estrito usado
// por resolverPeriodo/validarPeriodoSearch) só pra não obrigar todo `navigate({ to: "/dashboard" })`
// do resto do app a informar periodo/de/ate — a URL sem nenhum search param é um caso normal (1ª
// visita), e cai em "mes_atual" dentro do componente, não aqui.
type DashboardSearch = { periodo?: PeriodoTipo; de?: string | null; ate?: string | null };

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard" }] }),
  // Sanitiza search params da URL (periodo/de/ate) pra Movimentação do período (Etapa 2B) — valor
  // desconhecido ou ausente cai com segurança em "mes_atual", nunca propaga lixo pro resto da tela.
  // de/ate só aparecem na URL quando periodo === "personalizado" (chave ausente vira `undefined`,
  // que o router omite da querystring — diferente de `null`, que apareceria como "?de=null").
  validateSearch: (raw: Record<string, unknown>): DashboardSearch => {
    const v = validarPeriodoSearch(raw);
    if (v.periodo !== "personalizado") return { periodo: v.periodo };
    return { periodo: v.periodo, de: v.de ?? undefined, ate: v.ate ?? undefined };
  },
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
  comissao_parceria_externa_prevista_total: number;
  comissao_parceria_externa_concluida_total: number;
  comissao_por_corretor: Record<string, number>;
};

const RECENTES_COLUMNS =
  "id, status, valor_negociado, imovel_id, codigo_interno, corretor_id, updated_at";

function Dashboard() {
  const { user, roles, hasAny } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentes, setRecentes] = useState<any[]>([]);
  const [profileName, setProfileName] = useState<Record<string, string>>({});
  const [metaCorretor, setMetaCorretor] = useState<{
    meta_comissao: number;
    comissao_realizada: number;
  } | null>(null);
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
        supabase
          .from("sales")
          .select(RECENTES_COLUMNS)
          .order("updated_at", { ascending: false })
          .limit(8),
        supabase.from("profiles").select("id, nome"),
        supabase.rpc("metas_progresso", { _mes: mesAtualISO() }),
      ]);
      setStats(statsRes.data as DashboardStats | null);
      setRecentes(recentesRes.data ?? []);
      const names: Record<string, string> = {};
      for (const p of profRes.data ?? []) names[p.id] = p.nome ?? p.id;
      setProfileName(names);
      const metasData = metasRes.data as {
        corretor: { corretor_id: string; meta_comissao: number; comissao_realizada: number }[];
      } | null;
      setMetaCorretor(metasData?.corretor.find((m) => m.corretor_id === user.id) ?? null);
      setLoading(false);
    })();
  }, [user]);

  const isCorretor =
    hasAny(["corretor"]) &&
    !hasAny(["gestor", "team_leader", "juridico", "financeiro", "admin", "super_admin"]);
  const isGestor = hasAny(["gestor", "team_leader"]);
  const isJuridico = hasAny(["juridico"]);
  const isFinanceiro = hasAny(["financeiro", "admin", "super_admin"]);

  const contagemPorGrupo = agruparContagemPorGrupoVenda(stats?.funil ?? {});
  const funilData = FUNIL_GRUPOS.map(({ key, label }) => ({
    key,
    label,
    total: contagemPorGrupo[key],
  }));
  // Canceladas/arquivadas ("encerrada") não entram no total ativo nem no percentual das vendas
  // ativas — não viraram negócio, não fazem sentido no denominador de "quanto já avançou".
  const totalAtivo =
    contagemPorGrupo.preparacao + contagemPorGrupo.futura + contagemPorGrupo.confirmada;
  const totalGeral = totalAtivo + contagemPorGrupo.encerrada;
  const comissaoData = [
    {
      prevista: stats?.comissao_prevista_total ?? 0,
      concluida: stats?.comissao_concluida_total ?? 0,
    },
  ];

  const gestorItens = separarZerados([
    { icon: ClipboardCheck, label: "Aguardando revisão", value: stats?.gestor_aguardando_revisao ?? 0 },
    { icon: FileText, label: "Contratos para conferir", value: stats?.gestor_contratos_conferir ?? 0 },
    { icon: DollarSign, label: "Ocorrências para enviar", value: stats?.gestor_ocorrencias_enviar ?? 0 },
    { icon: AlertCircle, label: "Devolvidas", value: stats?.gestor_devolvidas ?? 0 },
  ]);
  const juridicoItens = separarZerados([
    { icon: ClipboardCheck, label: "Aprovadas pelo gestor", value: stats?.juridico_aprovadas_gestor ?? 0 },
    { icon: Gavel, label: "Em elaboração", value: stats?.juridico_em_elaboracao ?? 0 },
    { icon: FileText, label: "Aguardando assinatura", value: stats?.juridico_aguardando_assinatura ?? 0 },
    { icon: CheckCircle2, label: "Assinados", value: stats?.juridico_assinados ?? 0 },
  ]);
  const financeiroItens = separarZerados([
    { icon: DollarSign, label: "Ocorrências em análise", value: stats?.fin_ocorrencias_analise ?? 0 },
    { icon: AlertCircle, label: "Devolvidas por mim", value: stats?.fin_devolvidas ?? 0 },
    { icon: DollarSign, label: "Pendentes (total)", value: stats?.occ_pendentes_total ?? 0 },
    { icon: CheckCircle2, label: "Ocorrências concluídas", value: stats?.occ_concluidas_total ?? 0 },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Olá, {(user && profileName[user.id]) || user?.email?.split("@")[0]}
          </h1>
          <p className="text-sm text-muted-foreground">
            Perfis: {roles.map((r) => ROLE_LABEL[r]).join(", ") || "—"}
          </p>
        </div>
        {hasAny(["corretor", "gestor", "team_leader"]) && (
          <Button asChild>
            <Link to="/vendas/nova">
              <Plus className="mr-2 h-4 w-4" />
              Nova Venda
            </Link>
          </Button>
        )}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!loading && totalGeral > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Situação atual das vendas</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-[1fr_260px]">
            <ChartContainer config={funilChartConfig} className="aspect-auto h-[220px] w-full">
              <BarChart data={funilData} layout="vertical" margin={{ left: 12 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  width={140}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, _name, _item, _index, payload) => {
                        // "encerrada" fica fora do % — requisito 6 (não entra no percentual das
                        // vendas ativas).
                        const grupo = (payload as unknown as { key?: GrupoVenda } | undefined)?.key;
                        const pct =
                          grupo !== "encerrada" && totalAtivo > 0
                            ? Math.round((Number(value) / totalAtivo) * 100)
                            : null;
                        return (
                          <span className="font-medium text-foreground">
                            {Number(value)} vendas{pct !== null ? ` (${pct}% das ativas)` : ""}
                          </span>
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
                const pct =
                  key !== "encerrada" && totalAtivo > 0
                    ? Math.round((total / totalAtivo) * 100)
                    : null;
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-md border p-2 text-sm"
                  >
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium">
                      {total}{" "}
                      <span className="text-xs text-muted-foreground">
                        {pct !== null ? `(${pct}% das ativas)` : "(fora do total ativo)"}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Movimentação do período — Etapa 2B. Só financeiro/admin/super_admin (mesma regra do
          Painel financeiro logo abaixo). Não depende de `stats`/`loading` do funil: tem seu
          próprio carregamento, porque vem de uma RPC diferente (dashboard_movimentacao_periodo). */}
      {isFinanceiro && <MovimentacaoPeriodoSection />}

      {/* Corretor — só quem opera como corretor "puro" (sem outros papéis de supervisão) vê essa
          seção; admin/super_admin/gestor/etc que também carregam o papel corretor (ex.: pra
          testes) não têm fila própria de vendas, então não faz sentido mostrar aqui. */}
      {isCorretor && (
        <DashSection title="Suas vendas">
          <KpiGrid>
            <KpiCard
              icon={FileText}
              label="Minhas vendas"
              value={stats?.minhas_vendas ?? 0}
              to="/vendas"
            />
            <KpiCard
              icon={AlertCircle}
              label="Pendências (rascunho / devolvidas)"
              value={stats?.minhas_pendencias ?? 0}
              to="/vendas"
            />
            <KpiCard
              icon={FileText}
              label="Contratos para conferir"
              value={stats?.meus_contratos_conferir ?? 0}
              to="/vendas"
            />
            <KpiCard
              icon={CheckCircle2}
              label="Contratos assinados"
              value={stats?.meus_assinados ?? 0}
              to="/vendas"
            />
            <KpiCard
              icon={TrendingUp}
              label="Comissão prevista (vendas em andamento)"
              value={`R$ ${Number(stats?.minha_comissao_prevista ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
              to="/vendas"
            />
            {user && <ResumoGrupoVendaCards corretorIds={[user.id]} />}
          </KpiGrid>
          {metaCorretor && (
            <Card className="mt-3">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="rounded-md bg-primary/10 p-2 text-primary">
                  <Target className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium">Meta de {mesAtualLabel()}</span>
                    <span className="text-muted-foreground">
                      R${" "}
                      {metaCorretor.comissao_realizada.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })}{" "}
                      de R${" "}
                      {metaCorretor.meta_comissao.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })}{" "}
                      (
                      {metaCorretor.meta_comissao > 0
                        ? Math.round(
                            (metaCorretor.comissao_realizada / metaCorretor.meta_comissao) * 100,
                          )
                        : 0}
                      %)
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${metaCorretor.comissao_realizada >= metaCorretor.meta_comissao ? "bg-emerald-500" : "bg-amber-500"}`}
                      style={{
                        width: `${Math.min(100, Math.max(0, metaCorretor.meta_comissao > 0 ? (metaCorretor.comissao_realizada / metaCorretor.meta_comissao) * 100 : 0))}%`,
                      }}
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
        <CollapsibleSection
          title="Painel do gestor"
          storageKey="dash-open-gestor"
          badge={badgeParaItens(gestorItens.comValor, "warn")}
        >
          <KpiGrid>
            {gestorItens.comValor.map((i) => (
              <KpiCard key={i.label} icon={i.icon} label={i.label} value={i.value} to="/vendas" />
            ))}
            <ResumoGrupoVendaCards corretorIds={Array.from(teamIds)} sufixoLabel="da equipe" />
          </KpiGrid>
          <LinhaZerados itens={gestorItens.zerados} />
        </CollapsibleSection>
      )}

      {/* Jurídico */}
      {isJuridico && (
        <CollapsibleSection
          title="Painel do jurídico"
          storageKey="dash-open-juridico"
          badge={badgeParaItens(juridicoItens.comValor, "warn")}
        >
          <KpiGrid>
            {juridicoItens.comValor.map((i) => (
              <KpiCard key={i.label} icon={i.icon} label={i.label} value={i.value} to="/vendas" />
            ))}
          </KpiGrid>
          <LinhaZerados itens={juridicoItens.zerados} />
        </CollapsibleSection>
      )}

      {/* Financeiro */}
      {isFinanceiro && (
        <CollapsibleSection
          title="Painel financeiro"
          storageKey="dash-open-financeiro"
          badge={badgeParaItens(financeiroItens.comValor, "calm")}
        >
          <KpiGrid>
            {financeiroItens.comValor.map((i) => (
              <KpiCard key={i.label} icon={i.icon} label={i.label} value={i.value} to="/vendas" />
            ))}
            <KpiCard
              icon={TrendingUp}
              label="Comissão prevista"
              value={`R$ ${Number(stats?.comissao_prevista_total ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
            />
            <KpiCard
              icon={TrendingUp}
              label="Comissão concluída"
              value={`R$ ${Number(stats?.comissao_concluida_total ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
            />
            <ResumoGrupoVendaCards corretorIds="todas" sufixoLabel="da imobiliária" />
          </KpiGrid>
          <LinhaZerados itens={financeiroItens.zerados} />
          {((stats?.comissao_prevista_total ?? 0) > 0 ||
            (stats?.comissao_concluida_total ?? 0) > 0) && (
            <Card className="mt-3">
              <CardHeader>
                <CardTitle className="text-base">Comissão: prevista x concluída</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={comissaoChartConfig}
                  className="aspect-auto h-[140px] w-full"
                >
                  <BarChart data={comissaoData} layout="vertical" margin={{ left: 12 }}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `R$ ${Number(v).toLocaleString("pt-BR")}`}
                    />
                    <YAxis type="category" hide />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value) =>
                            `R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                          }
                        />
                      }
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="prevista" fill="var(--color-prevista)" radius={4} />
                    <Bar dataKey="concluida" fill="var(--color-concluida)" radius={4} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}
          {((stats?.comissao_parceria_externa_prevista_total ?? 0) > 0 ||
            (stats?.comissao_parceria_externa_concluida_total ?? 0) > 0) && (
            <Card className="mt-3">
              <CardHeader>
                <CardTitle className="text-base">Parceria externa (controle à parte)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                <p>
                  Prevista: R${" "}
                  {Number(stats?.comissao_parceria_externa_prevista_total ?? 0).toLocaleString(
                    "pt-BR",
                    { minimumFractionDigits: 2 },
                  )}
                  {" · "}Concluída: R${" "}
                  {Number(stats?.comissao_parceria_externa_concluida_total ?? 0).toLocaleString(
                    "pt-BR",
                    { minimumFractionDigits: 2 },
                  )}
                </p>
                <p>
                  Comissão de parceiro(s) externo(s) confirmado(s) (sem cadastro no sistema) — já
                  descontada de "Comissão prevista"/"Comissão concluída" acima, nunca é receita da
                  imobiliária.
                </p>
              </CardContent>
            </Card>
          )}
          {Object.keys(stats?.comissao_por_corretor ?? {}).length > 0 && (
            <Card className="mt-3">
              <CardHeader>
                <CardTitle className="text-base">Comissão por corretor</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {Object.entries(stats?.comissao_por_corretor ?? {}).map(([cid, valor]) => (
                  <div
                    key={cid}
                    className="flex items-center justify-between rounded-md border p-2"
                  >
                    <span>{profileName[cid] ?? `${cid.slice(0, 8)}…`}</span>
                    <span className="font-medium">
                      R$ {Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </CollapsibleSection>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Vendas recentes</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/vendas">Ver todas</Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {!loading && recentes.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma venda ainda.</p>
          )}
          {recentes.map((s) => {
            // admin/super_admin enxerga tudo por definição — "Sua vez" é pra quem tem uma fila
            // operacional de verdade, não pra quem só está supervisionando o sistema.
            const minhaVez =
              !hasAny(["admin", "super_admin"]) &&
              proximoResponsavelRoles(s.status as SaleStatus).some((papel) =>
                papel === "corretor"
                  ? s.corretor_id === user?.id
                  : // gestor/team_leader só é "a vez dele" se ele lidera o corretor da venda — ver
                    // mesmo comentário em vendas.index.tsx.
                    papel === "gestor"
                    ? hasAny(["gestor", "team_leader"]) && teamIds.has(s.corretor_id)
                    : hasAny([papel]),
              );
            return (
              <Link
                key={s.id}
                to="/vendas/$id"
                params={{ id: s.id }}
                className={`flex items-center justify-between rounded-md border p-3 hover:bg-muted/50 ${minhaVez ? "border-l-2 border-l-destructive" : ""}`}
              >
                <div>
                  <div className="text-sm font-medium">
                    {s.imovel_id || s.codigo_interno || `Venda #${s.id.slice(0, 8)}`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.valor_negociado
                      ? `R$ ${Number(s.valor_negociado).toLocaleString("pt-BR")}`
                      : "Valor pendente"}
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
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

type PainelItem = { icon: LucideIcon; label: string; value: number };

/** Separa os KPIs de um painel (gestor/jurídico/financeiro) entre os que têm algo acontecendo e os
 * zerados — os zerados viram uma única linha de texto (LinhaZerados) em vez de um card cada, pra
 * não poluir a tela com "0" repetido. */
function separarZerados(itens: PainelItem[]) {
  return {
    comValor: itens.filter((i) => i.value !== 0),
    zerados: itens.filter((i) => i.value === 0),
  };
}

function LinhaZerados({ itens }: { itens: PainelItem[] }) {
  if (itens.length === 0) return null;
  return (
    <p className="mt-2 border-t border-dashed pt-2 text-xs text-muted-foreground">
      Sem pendência: {itens.map((i) => i.label).join(" · ")}
    </p>
  );
}

/** Badge do cabeçalho do painel — só aparece quando há algo com valor. "warn" (âmbar) pra painéis
 * de fila de trabalho (gestor/jurídico); "calm" (neutro) pro financeiro, onde nem todo item
 * com valor é uma pendência (ex.: ocorrências concluídas). */
function badgeParaItens(comValor: PainelItem[], tone: "warn" | "calm") {
  if (comValor.length === 0) return undefined;
  return {
    label: tone === "warn" ? `${comValor.length} com pendência` : `${comValor.length} ativos`,
    tone,
  };
}

/** Painel recolhível (gestor/jurídico/financeiro) — estado aberto/fechado fica salvo no navegador
 * por seção, então quem colapsa um painel que não usa não precisa refazer isso a cada visita.
 * Começa aberto por padrão (nada some na 1ª visita). */
function CollapsibleSection({
  title,
  storageKey,
  badge,
  children,
}: {
  title: string;
  storageKey: string;
  badge?: { label: string; tone: "warn" | "calm" };
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem(storageKey);
    return saved === null ? true : saved === "1";
  });

  useEffect(() => {
    window.localStorage.setItem(storageKey, open ? "1" : "0");
  }, [open, storageKey]);

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-2 flex w-full items-center gap-2 text-left"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        {badge && (
          <span
            className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              badge.tone === "warn"
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {badge.label}
          </span>
        )}
      </button>
      {open && children}
    </section>
  );
}

/**
 * "O que aconteceu no período selecionado?" — separado da "Situação atual" (funil acima) de
 * propósito: contam coisas diferentes. O funil é status ATUAL (agora); aqui é MOVIMENTO dentro do
 * período (RPC dashboard_movimentacao_periodo, corrigida em 20260819010000 pra fechar um bug de
 * duplicidade). Cada venda é contada em EXATAMENTE UM dos 4 cards, pelo grupo de negócio do seu
 * status MAIS RECENTE dentro da janela do período — se ela entrou em futura e depois avançou pra
 * confirmada no mesmo período, conta só em confirmada; se foi encerrada, conta só em encerrada. Por
 * isso os 4 cards são mutuamente exclusivos (nenhuma venda em 2 ao mesmo tempo), mas ainda assim não
 * é o mesmo número da "Situação atual" — aqui é "onde cada venda movimentada terminou dentro do
 * período", lá é "onde cada venda está agora", e os dois podem divergir (ex.: uma venda pode ter
 * avançado pra confirmada em julho e continuar confirmada hoje — ela não teve nenhuma transição em
 * agosto, então não aparece na Movimentação de agosto, mas continua contando na Situação atual).
 *
 * "Confirmada" se divide em 2 cards desde 20260819020000: auditoria pedida pelo usuário achou que o
 * card único misturava contrato assinado de verdade (venda padrão) com venda de Lançamento, que por
 * desenho pula direto de rascunho pra ocorrencia_analise_financeiro e NUNCA passa por contrato
 * assinado (parceria com construtora, sem documento/jurídico/contrato). Ver classificarGrupoVenda /
 * chegouAoJuridico em status.ts pro mesmo conceito aplicado noutros lugares do dashboard.
 */
const ERRO_MOVIMENTACAO_PERIODO = "Não foi possível carregar a movimentação do período.";

function MovimentacaoPeriodoSection() {
  const searchBruto = Route.useSearch();
  const navigate = Route.useNavigate();
  // DashboardSearch tem tudo opcional (pra não travar navigate({to:"/dashboard"}) de outras
  // páginas) — aqui, dentro do componente, sempre trabalhamos com o formato resolvido/estrito.
  const search: PeriodoSearch = {
    periodo: searchBruto.periodo ?? "mes_atual",
    de: searchBruto.de ?? null,
    ate: searchBruto.ate ?? null,
  };
  const periodoResolvido = resolverPeriodo(search, new Date());

  const [dado, setDado] = useState<MovimentacaoPeriodo | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (periodoResolvido.incompleto) {
      setDado(null);
      setErro(null);
      setCarregando(false);
      return;
    }
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    fetchMovimentacaoPeriodo(periodoResolvido.inicioUtc, periodoResolvido.fimExclusivoUtc)
      .then((r) => {
        if (!cancelado) setDado(r);
      })
      .catch((e: unknown) => {
        // A mensagem técnica (erro do Postgres/Supabase) só vai pro console — o usuário só vê a
        // mensagem fixa abaixo, nunca o texto bruto do banco.
        console.error("dashboard_movimentacao_periodo:", e);
        if (!cancelado) setErro(ERRO_MOVIMENTACAO_PERIODO);
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
    // periodoResolvido é recalculado a cada render a partir de `search` — dependendo só dos campos
    // primitivos que realmente mudam o intervalo (em vez do objeto inteiro) evita refetch em
    // renders que não alteraram nada, sem precisar suprimir exhaustive-deps.
  }, [periodoResolvido.incompleto, periodoResolvido.inicioUtc, periodoResolvido.fimExclusivoUtc]);

  const mudarPeriodo = (valor: string) => {
    const periodo = valor as PeriodoTipo;
    navigate({
      search: (prev) =>
        periodo === "personalizado"
          ? { periodo, de: prev.de ?? undefined, ate: prev.ate ?? undefined }
          : { periodo },
    });
  };
  const mudarData = (campo: "de" | "ate", valor: string) => {
    navigate({
      search: (prev) => ({ ...prev, periodo: "personalizado", [campo]: valor || undefined }),
    });
  };

  const semDataTotal =
    (dado?.semDataFutura ?? 0) + (dado?.semDataConfirmada ?? 0) + (dado?.semDataEncerrada ?? 0);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-base">Movimentação do período</CardTitle>
          <p className="text-xs text-muted-foreground">{periodoResolvido.label}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={search.periodo} onValueChange={mudarPeriodo}>
            <SelectTrigger className="w-40 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIODO_LABEL) as PeriodoTipo[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {PERIODO_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {search.periodo === "personalizado" && (
            <>
              <Input
                type="date"
                value={search.de ?? ""}
                onChange={(e) => mudarData("de", e.target.value)}
                className="w-[9.5rem]"
                aria-label="Data inicial"
              />
              <Input
                type="date"
                value={search.ate ?? ""}
                onChange={(e) => mudarData("ate", e.target.value)}
                className="w-[9.5rem]"
                aria-label="Data final"
              />
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {periodoResolvido.incompleto ? (
          <p className="text-sm text-muted-foreground">{periodoResolvido.label}</p>
        ) : carregando ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MovimentacaoCard
                icon={Send}
                label="Terminaram o período em futura"
                quantidade={dado?.futurasQuantidade ?? 0}
                vgv={dado?.futurasVgv}
              />
              <MovimentacaoCard
                icon={FileSignature}
                label="Confirmadas por contrato assinado"
                quantidade={dado?.confirmadasContratoQuantidade ?? 0}
                vgv={dado?.confirmadasContratoVgv}
              />
              <MovimentacaoCard
                icon={Landmark}
                label="Lançamento enviado ao financeiro"
                quantidade={dado?.confirmadasLancamentoQuantidade ?? 0}
                vgv={dado?.confirmadasLancamentoVgv}
              />
              <MovimentacaoCard
                icon={Archive}
                label="Foram encerradas no período"
                quantidade={dado?.encerradasQuantidade ?? 0}
              />
            </div>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Cada venda conta uma única vez, pelo status mais recente atingido dentro do período
              selecionado — não é o saldo atual (para isso, veja "VGV ativo total" nos painéis
              abaixo). Venda de Lançamento nunca passa por contrato assinado (vai direto pro
              financeiro em parceria com a construtora) — por isso conta separado das confirmadas
              por contrato.
            </p>
            {semDataTotal > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {semDataTotal} vendas não possuem marco histórico e não podem ser atribuídas a um
                período.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MovimentacaoCard({
  icon: Icon,
  label,
  quantidade,
  vgv,
}: {
  icon: LucideIcon;
  label: string;
  quantidade: number;
  vgv?: number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={`rounded-md p-2 ${quantidade === 0 ? "bg-muted text-muted-foreground/50" : "bg-primary/10 text-primary"}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div
            className={`text-xl font-semibold leading-none ${quantidade === 0 ? "text-muted-foreground/50" : ""}`}
          >
            {quantidade}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{label}</div>
          {vgv !== undefined && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              VGV: R$ {vgv.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Posição ATUAL de VGV (não confundir com a Movimentação do período, que é histórico de eventos) —
 * escopada por um conjunto de corretores, ou `"todas"` pra financeiro/admin/super_admin (que já
 * enxergam toda a `sales` via RLS). Usado no painel do Corretor (`[user.id]`), do Gestor
 * (`Array.from(teamIds)`) e do Financeiro (`"todas"`).
 *
 * Cada venda pertence a exatamente um grupo pelo status ATUAL (classificarGrupoVenda é exaustivo e
 * mutuamente exclusivo) — por isso "VGV em andamento" + "VGV confirmado" nunca contam a mesma
 * venda duas vezes, e "VGV ativo total" (vgvAtivoTotal) é a soma direta dos dois sem risco de
 * sobreposição. Vendas de Lançamento que pulam contrato_assinado (vão direto de rascunho pra
 * ocorrencia_analise_financeiro — ver criar_ocorrencia_lancamento_rpc) já caem em "confirmada"
 * porque a classificação é só por status, não por modalidade nem por caminho percorrido.
 *
 * Não usa dashboard_stats() nem RPC nova — busca direta em `sales` (RLS já restringe pelo papel de
 * quem está logado) mais `agruparVendasPorGrupoComVgv` (dashboard-perfil-query.ts), pura e testada
 * isoladamente.
 */
function ResumoGrupoVendaCards({
  corretorIds,
  sufixoLabel,
}: {
  corretorIds: string[] | "todas";
  sufixoLabel?: string;
}) {
  const idsKey = corretorIds === "todas" ? "todas" : [...corretorIds].sort().join(",");
  const [resumo, setResumo] = useState<ResumoPorGrupo | null>(null);

  useEffect(() => {
    if (idsKey !== "todas" && idsKey === "") {
      setResumo(null);
      return;
    }
    let cancelado = false;
    fetchResumoGrupoVenda(idsKey === "todas" ? "todas" : idsKey.split(","))
      .then((r) => {
        if (!cancelado) setResumo(r);
      })
      .catch((e: unknown) => {
        // Silencioso na interface de propósito: são cards a mais dentro de um painel que já tem
        // outros KPIs funcionando (vindos de dashboard_stats()) — um erro aqui não deve quebrar
        // nem exibir mensagem técnica sobre o resto do painel, só ficar de fora.
        console.error("fetchResumoGrupoVenda:", e);
      });
    return () => {
      cancelado = true;
    };
  }, [idsKey]);

  if (!resumo) return null;

  // Insere o sufixo (ex.: "da equipe", "da imobiliária") logo antes do travessão do rótulo
  // recomendado, mantendo o "— explicação" no final: "VGV em andamento da equipe — ainda não
  // confirmado".
  const rotulo = (base: string) => (sufixoLabel ? base.replace(" — ", ` ${sufixoLabel} — `) : base);
  const ativoTotal = vgvAtivoTotal(resumo);

  return (
    <>
      <MovimentacaoCard
        icon={Send}
        label={rotulo("VGV em andamento — ainda não confirmado")}
        quantidade={resumo.futura.quantidade}
        vgv={resumo.futura.vgv}
      />
      <MovimentacaoCard
        icon={CheckCircle2}
        label={rotulo("VGV confirmado — contrato assinado ou já avançado ao financeiro")}
        quantidade={resumo.confirmada.quantidade}
        vgv={resumo.confirmada.vgv}
      />
      <MovimentacaoCard
        icon={DollarSign}
        label={rotulo("VGV ativo total — sem duplicidade")}
        quantidade={ativoTotal.quantidade}
        vgv={ativoTotal.vgv}
      />
    </>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  to,
}: {
  icon: any;
  label: string;
  value: number | string;
  to?: string;
}) {
  const numeric =
    typeof value === "number"
      ? value
      : Number(
          String(value)
            .replace(/[^\d,.-]/g, "")
            .replace(/\./g, "")
            .replace(",", "."),
        );
  const isZero = !Number.isNaN(numeric) && numeric === 0;
  const inner = (
    <Card className={to ? "transition hover:shadow-md" : ""}>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={`rounded-md p-2 ${isZero ? "bg-muted text-muted-foreground/50" : "bg-primary/10 text-primary"}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div
            className={`text-xl font-semibold leading-none ${isZero ? "text-muted-foreground/50" : ""}`}
          >
            {value}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}
