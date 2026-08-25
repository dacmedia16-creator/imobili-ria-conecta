import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { InfoDot, KpiCard, ResumoGrupoVendaCards, comissaoChartConfig } from "@/components/dashboard/shared";
import {
  Banknote,
  Percent,
  Building2,
  PiggyBank,
  CheckCircle2,
  ClipboardList,
  ArrowLeft,
  ArrowUpRight,
  TrendingUp,
  Landmark,
  Info,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/visao-executiva")({
  head: () => ({ meta: [{ title: "Desempenho" }] }),
  component: VisaoExecutiva,
});

type Alerta = { n: number; max_dias?: number };
type VisaoExecutivaStats = {
  tempo_por_etapa: Record<string, number>;
  alertas: {
    assinatura_pendente: Alerta;
    financeiro_parado: Alerta;
    contrato_parado: Alerta;
    retrabalho: Alerta;
  };
  ranking_corretor: {
    corretor_id: string;
    vendas_fechadas: number;
    tempo_medio_dias: number | null;
    taxa_devolucao: number;
    comissao: number;
  }[];
  ranking_equipe: {
    team_id: string | null;
    team_nome: string | null;
    vendas_fechadas: number;
    comissao: number;
    taxa_devolucao: number;
  }[];
  /** Indicadores da operação (não por pessoa) — mesma janela de 30 dias do ranking. */
  resumo_operacional: {
    vgv: number;
    comissao_bruta_operacao: number;
    parceria_externa: number;
    parte_unidade: number;
    receita_liquida_imobiliaria: number;
    quantidade_vendas: number;
    quantidade_captacoes: number;
  };
  evolucao_mensal: { mes: string; vendas_fechadas: number; comissao: number }[];
  /** Só vem preenchido pra super_admin — a RPC devolve null pra qualquer outro papel. */
  whatsapp: { eventos: number; enviados: number; falhas: number; eventos_com_falha: number } | null;
};

/** Subconjunto de dashboard_stats() (mesma RPC que o Dashboard usa) com os números consolidados
 * que migraram pra cá — "Comissão em carteira", por status da ocorrência, sem janela de tempo
 * (diferente do "Resumo da operação" acima, que é sempre últimos 30 dias fechados). */
type ComissaoPorStatusStats = {
  comissao_prevista_total: number;
  comissao_concluida_total: number;
  comissao_parceria_externa_prevista_total: number;
  comissao_parceria_externa_concluida_total: number;
  liquido_imobiliaria_prevista_total: number;
  liquido_imobiliaria_concluida_total: number;
  comissao_por_corretor: Record<string, number>;
};

/** Mesmo agrupamento macro do funil em dashboard.tsx — "encerrada" (cancelada/arquivada) fica
 * de fora aqui porque tempo-até-cancelar não é um gargalo acionável. */
const STAGE_LABELS: Record<string, string> = {
  inicio: "Rascunho / devolvida",
  aprovacao: "Em aprovação",
  juridico: "Jurídico / contrato",
  concluida: "Pós-venda / ocorrência",
};
const STAGE_ORDER = ["inicio", "aprovacao", "juridico", "concluida"];

const money = (v: number) =>
  `R$ ${Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
const mesAtualISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

type MetaProgressoRow = {
  corretor_id?: string;
  team_id?: string;
  meta_comissao: number;
  comissao_realizada: number;
};
type MetaProgresso = { corretor: MetaProgressoRow[]; equipe: MetaProgressoRow[] };
const mesLabel = (m: string) => {
  const [ano, mes] = m.split("-");
  return new Date(Number(ano), Number(mes) - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
    .replace(".", "");
};

const evoChartConfig = {
  vendas_fechadas: { label: "Vendas fechadas", color: "var(--color-chart-1)" },
  comissao: { label: "Comissão", color: "var(--color-chart-4)" },
} satisfies ChartConfig;

/** Uma venda que compõe a comissão de uma pessoa (ou de uma equipe) no período — devolvida por
 * visao_executiva_detalhe_comissao(), mesma janela/regra de "fechada" de visao_executiva_stats(),
 * pra a soma aqui sempre bater com o número mostrado no ranking. */
type DetalheLinha = {
  sale_id: string;
  codigo_interno: string | null;
  imovel_id: string | null;
  modalidade: string;
  valor_negociado: number;
  valor_comissao: number;
  fechado_em: string;
  corretor_id: string;
};
/** O que foi clicado no ranking — decide qual filtro passar pra RPC de detalhe. */
type DetalheSelecao =
  | { tipo: "corretor"; id: string; nome: string }
  | { tipo: "equipe"; teamId: string | null; nome: string };

function VisaoExecutiva() {
  const { hasAny, loading: authLoading } = useAuth();
  // `financeiro` foi adicionado aqui junto com a migração dos cards de comissão/VGV consolidados
  // do Dashboard pra esta página — sem isso, esse papel perderia acesso aos próprios números.
  const allowed = hasAny(["admin", "super_admin", "financeiro"]);
  const isSuperAdmin = hasAny(["super_admin"]);
  const [stats, setStats] = useState<VisaoExecutivaStats | null>(null);
  const [operacaoRemax, setOperacaoRemax] = useState({ vgv_proprio: 0, comissao_propria: 0 });
  const [comissaoStats, setComissaoStats] = useState<ComissaoPorStatusStats | null>(null);
  const [profileName, setProfileName] = useState<Record<string, string>>({});
  const [metas, setMetas] = useState<MetaProgresso>({ corretor: [], equipe: [] });
  const [loading, setLoading] = useState(true);
  const [detalheSel, setDetalheSel] = useState<DetalheSelecao | null>(null);

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      const [statsRes, profRes, metasRes, carteiraRes, operacaoRes] = await Promise.all([
        supabase.rpc("visao_executiva_stats"),
        supabase.from("profiles").select("id, nome"),
        supabase.rpc("metas_progresso", { _mes: mesAtualISO() }),
        supabase.rpc("comissoes_carteira_sem_parceria" as never),
        supabase.rpc("resumo_operacao_sem_parceria_30d" as never),
      ]);
      setStats((statsRes.data as unknown as VisaoExecutivaStats) ?? null);
      const names: Record<string, string> = {};
      for (const p of profRes.data ?? []) names[p.id] = p.nome ?? p.id;
      setProfileName(names);
      setMetas((metasRes.data as unknown as MetaProgresso) ?? { corretor: [], equipe: [] });
      setComissaoStats((carteiraRes.data as unknown as ComissaoPorStatusStats) ?? null);
      setOperacaoRemax(
        (operacaoRes.data as unknown as { vgv_proprio: number; comissao_propria: number }) ??
          { vgv_proprio: 0, comissao_propria: 0 },
      );
      setLoading(false);
    })();
  }, [allowed]);

  if (authLoading || loading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  if (!allowed) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Esta área é restrita a administradores e ao financeiro.
        </CardContent>
      </Card>
    );
  }

  const etapas = STAGE_ORDER.filter((k) => stats?.tempo_por_etapa?.[k] != null).map((k) => ({
    key: k,
    label: STAGE_LABELS[k],
    dias: stats!.tempo_por_etapa[k],
  }));
  const maxDias = Math.max(1, ...etapas.map((e) => e.dias));
  const gargalo =
    etapas.length > 1 ? etapas.reduce((max, e) => (e.dias > max.dias ? e : max), etapas[0]) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Desempenho</h1>
        <p className="text-sm text-muted-foreground">
          Indicadores e rankings dos últimos 30 dias, usando as regras financeiras oficiais da
          operação e excluindo parcerias externas dos totais da REMAX.
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Resumo da operação — últimos 30 dias
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ResumoCard
            icon={Banknote}
            label="VGV atribuído à REMAX"
            valor={money(operacaoRemax.vgv_proprio)}
            info="VGV proporcional à comissão que ficou com a REMAX, já excluindo parceria externa."
          />
          <ResumoCard
            icon={Percent}
            label="Comissão gerada pela REMAX"
            valor={money(operacaoRemax.comissao_propria)}
            info="Comissão da operação depois de excluir a parceria externa."
          />
          <ResumoCard
            icon={Building2}
            label="Comissão destinada à unidade"
            valor={money(stats?.resumo_operacional?.parte_unidade ?? 0)}
            info="O que sobra da comissão bruta pra unidade depois de descontar a parceria externa e a comissão de captador/vendedor — ainda antes de descontar gestores, Team Leaders e extras."
          />
          <ResumoCard
            icon={PiggyBank}
            label="Receita líquida da imobiliária"
            valor={money(stats?.resumo_operacional?.receita_liquida_imobiliaria ?? 0)}
            info="Parte da unidade menos o que foi pago a gestores/Team Leaders e extras atribuídos à imobiliária — o que sobra de fato pra casa nas vendas fechadas no período."
          />
          <ResumoCard
            icon={CheckCircle2}
            label="Quantidade de vendas"
            valor={String(stats?.resumo_operacional?.quantidade_vendas ?? 0)}
            info="Número de vendas distintas que fecharam (contrato assinado, ou em Lançamento avançou pro financeiro) nos últimos 30 dias."
          />
          <ResumoCard
            icon={ClipboardList}
            label="Quantidade de captações"
            valor={String(stats?.resumo_operacional?.quantidade_captacoes ?? 0)}
            info="Número de vendas cadastradas (captadas) nos últimos 30 dias, entre as ainda ativas — grupo diferente de 'Quantidade de vendas' (que é sobre fechamento, não cadastro)."
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Comissões em carteira — posição atual
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icon={TrendingUp}
            label="Comissão de vendas em andamento"
            value={money(comissaoStats?.comissao_prevista_total ?? 0)}
            info="Soma da comissão das ocorrências ainda não concluídas, já descontando a parte de parceiro externo sem cadastro no sistema — essa parte nunca é receita da imobiliária."
          />
          <KpiCard
            icon={TrendingUp}
            label="Comissão de vendas concluídas"
            value={money(comissaoStats?.comissao_concluida_total ?? 0)}
            info="Mesma regra da comissão prevista (desconta parceria externa), mas só das ocorrências já concluídas."
          />
          <KpiCard
            icon={Landmark}
            label="Líquido da imobiliária em andamento"
            value={money(comissaoStats?.liquido_imobiliaria_prevista_total ?? 0)}
            info="Comissão das ocorrências ainda não concluídas, descontando TUDO que já foi pago: parte de corretores/gestores/team leaders internos (soma de 'Comissão por corretor' abaixo) e parceria externa. Só sobra o que não foi atribuído a ninguém nomeado — o que fica de fato com a casa."
          />
          <KpiCard
            icon={Landmark}
            label="Líquido da imobiliária concluído"
            value={money(comissaoStats?.liquido_imobiliaria_concluida_total ?? 0)}
            info="Mesma regra do líquido previsto (desconta todos os beneficiários internos + parceria externa), mas só das ocorrências já concluídas."
          />
          <ResumoGrupoVendaCards corretorIds="todas" sufixoLabel="da imobiliária" />
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          "Resumo da operação" acima é sempre dos últimos 30 dias fechados. "Comissão em carteira"
          é a posição atual por status da ocorrência, sem janela de tempo — os dois nunca vão bater
          exatamente, e não deveriam: respondem perguntas diferentes.
        </p>
        {((comissaoStats?.comissao_prevista_total ?? 0) > 0 ||
          (comissaoStats?.comissao_concluida_total ?? 0) > 0) && (
          <Card className="mt-3">
            <CardHeader>
              <CardTitle className="text-base">Comissão: prevista x concluída</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={comissaoChartConfig} className="aspect-auto h-[140px] w-full">
                <BarChart
                  data={[
                    {
                      prevista: comissaoStats?.comissao_prevista_total ?? 0,
                      concluida: comissaoStats?.comissao_concluida_total ?? 0,
                    },
                  ]}
                  layout="vertical"
                  margin={{ left: 12 }}
                >
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `R$ ${Number(v).toLocaleString("pt-BR")}`}
                  />
                  <YAxis type="category" hide />
                  <ChartTooltip content={<ChartTooltipContent formatter={(value) => money(Number(value))} />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="prevista" fill="var(--color-prevista)" radius={4} />
                  <Bar dataKey="concluida" fill="var(--color-concluida)" radius={4} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}
        {((comissaoStats?.comissao_parceria_externa_prevista_total ?? 0) > 0 ||
          (comissaoStats?.comissao_parceria_externa_concluida_total ?? 0) > 0) && (
          <Card className="mt-3">
            <CardHeader>
              <CardTitle className="text-base">Parceria externa (controle à parte)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>
                Prevista: {money(comissaoStats?.comissao_parceria_externa_prevista_total ?? 0)}
                {" · "}Concluída: {money(comissaoStats?.comissao_parceria_externa_concluida_total ?? 0)}
              </p>
              <p>
                Comissão de parceiro(s) externo(s) confirmado(s) (sem cadastro no sistema) — já
                descontada de "Comissão prevista"/"Comissão concluída" acima, nunca é receita da
                imobiliária.
              </p>
            </CardContent>
          </Card>
        )}
        {Object.keys(comissaoStats?.comissao_por_corretor ?? {}).length > 0 && (
          <Card className="mt-3">
            <CardHeader>
              <CardTitle className="text-base">Comissão por corretor</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {Object.entries(comissaoStats?.comissao_por_corretor ?? {}).map(([cid, valor]) => (
                <div key={cid} className="flex items-center justify-between rounded-md border p-2">
                  <span>{profileName[cid] ?? `${cid.slice(0, 8)}…`}</span>
                  <span className="font-medium">{money(Number(valor))}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      {isSuperAdmin && stats?.whatsapp && stats.whatsapp.eventos > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Saúde do WhatsApp — últimos 30 dias</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4 sm:grid-cols-4">
            <div>
              <div className="text-2xl font-bold">
                {Math.round(
                  (100 * stats.whatsapp.enviados) /
                    Math.max(1, stats.whatsapp.enviados + stats.whatsapp.falhas),
                )}
                %
              </div>
              <p className="text-xs text-muted-foreground">Taxa de entrega</p>
            </div>
            <div>
              <div className="text-2xl font-bold">{stats.whatsapp.enviados}</div>
              <p className="text-xs text-muted-foreground">Mensagens entregues</p>
            </div>
            <div>
              <div
                className={`text-2xl font-bold ${stats.whatsapp.falhas > 0 ? "text-destructive" : ""}`}
              >
                {stats.whatsapp.falhas}
              </div>
              <p className="text-xs text-muted-foreground">Falharam</p>
            </div>
            <div>
              <div
                className={`text-2xl font-bold ${stats.whatsapp.eventos_com_falha > 0 ? "text-destructive" : ""}`}
              >
                {stats.whatsapp.eventos_com_falha}
              </div>
              <p className="text-xs text-muted-foreground">Mudanças de status com falha</p>
            </div>
          </CardContent>
        </Card>
      )}

      {etapas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tempo médio por etapa do funil</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {etapas.map((e) => (
              <div
                key={e.key}
                className="grid grid-cols-[150px_1fr_70px] items-center gap-3 sm:grid-cols-[190px_1fr_80px]"
              >
                <span className="text-sm font-medium">
                  {e.label}
                  {gargalo?.key === e.key && (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-destructive">
                      Gargalo
                    </span>
                  )}
                </span>
                <div className="h-5 overflow-hidden rounded-md bg-muted">
                  <div
                    className="h-full rounded-md"
                    style={{
                      width: `${Math.max(6, (e.dias / maxDias) * 100)}%`,
                      background:
                        gargalo?.key === e.key ? "var(--destructive)" : "var(--color-chart-1)",
                    }}
                  />
                </div>
                <span className="text-right text-sm font-semibold">
                  {e.dias.toFixed(1)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">dias</span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          {detalheSel ? (
            <DetalheComissao
              selecao={detalheSel}
              onVoltar={() => setDetalheSel(null)}
              profileName={profileName}
            />
          ) : (
            <>
              <CardHeader>
                <CardTitle className="text-base">Ranking — últimos 30 dias</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="corretor">
                  <TabsList className="mb-3">
                    <TabsTrigger value="corretor">Por corretor</TabsTrigger>
                    <TabsTrigger value="equipe">Por equipe</TabsTrigger>
                  </TabsList>
                  <TabsContent value="corretor">
                    <RankingTable
                      rows={(stats?.ranking_corretor ?? []).map((r) => {
                        const meta =
                          metas.corretor.find((m) => m.corretor_id === r.corretor_id) ?? null;
                        return {
                          id: r.corretor_id,
                          nome: profileName[r.corretor_id] ?? `${r.corretor_id.slice(0, 8)}…`,
                          vendas: r.vendas_fechadas,
                          comissao: r.comissao,
                          meta: meta?.meta_comissao ?? null,
                          metaRealizado: meta?.comissao_realizada ?? 0,
                        };
                      })}
                      onSelect={(row) =>
                        setDetalheSel({ tipo: "corretor", id: row.id, nome: row.nome })
                      }
                    />
                  </TabsContent>
                  <TabsContent value="equipe">
                    <RankingTable
                      rows={(stats?.ranking_equipe ?? []).map((r) => {
                        const meta = metas.equipe.find((m) => m.team_id === r.team_id) ?? null;
                        return {
                          id: r.team_id ?? "sem-equipe",
                          nome: r.team_nome ?? "Sem equipe",
                          vendas: r.vendas_fechadas,
                          comissao: r.comissao,
                          meta: meta?.meta_comissao ?? null,
                          metaRealizado: meta?.comissao_realizada ?? 0,
                        };
                      })}
                      onSelect={(row) =>
                        setDetalheSel({
                          tipo: "equipe",
                          teamId: row.id === "sem-equipe" ? null : row.id,
                          nome: row.nome,
                        })
                      }
                    />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evolução mensal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Vendas fechadas</p>
              <ChartContainer config={evoChartConfig} className="aspect-auto h-[110px] w-full">
                <BarChart data={stats?.evolucao_mensal ?? []} margin={{ left: -20 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="mes"
                    tickFormatter={mesLabel}
                    tickLine={false}
                    axisLine={false}
                    fontSize={10}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    fontSize={10}
                    width={24}
                  />
                  <ChartTooltip
                    content={<ChartTooltipContent labelFormatter={(l) => mesLabel(String(l))} />}
                  />
                  <Bar dataKey="vendas_fechadas" fill="var(--color-vendas_fechadas)" radius={3} />
                </BarChart>
              </ChartContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ResumoCard({
  icon: Icon,
  label,
  valor,
  info,
}: {
  icon: any;
  label: string;
  valor: string;
  info?: string;
}) {
  return (
    <Card className="relative">
      {info && <InfoDot text={info} />}
      <CardContent className="space-y-2 p-4">
        <div className="rounded-md bg-primary/10 p-2 text-primary w-fit">
          <Icon className="h-5 w-5" />
        </div>
        <p className="text-xl font-bold leading-none">{valor}</p>
        <p className="text-xs text-muted-foreground pr-4">{label}</p>
      </CardContent>
    </Card>
  );
}

function RankingTable({
  rows,
  onSelect,
}: {
  rows: {
    id: string;
    nome: string;
    vendas: number;
    comissao: number;
    meta: number | null;
    metaRealizado: number;
  }[];
  /** Clique no nome — abre o detalhe das vendas que compõem a comissão dessa linha. */
  onSelect: (row: { id: string; nome: string }) => void;
}) {
  // Ranking por valor de comissão (pedido do usuário) — antes era por vendas fechadas, com
  // comissão só como desempate. `vendas` agora só desempata comissões iguais.
  const sorted = [...rows].sort((a, b) => b.comissao - a.comissao || b.vendas - a.vendas);
  if (sorted.length === 0)
    return <p className="py-8 text-center text-sm text-muted-foreground">Sem dados no período.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nome</TableHead>
          <TableHead className="text-right">Fechadas</TableHead>
          <TableHead className="text-right">Comissão</TableHead>
          <TableHead>Meta do mês</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r, i) => (
          <TableRow key={r.id}>
            <TableCell className="font-medium">
              <button
                type="button"
                onClick={() => onSelect({ id: r.id, nome: r.nome })}
                className="inline-flex items-center gap-2 text-primary hover:underline"
              >
                {i < 3 && (
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ background: i === 0 ? "#c9971f" : i === 1 ? "#9aa0a6" : "#b0703a" }}
                  >
                    {i + 1}
                  </span>
                )}
                {r.nome}
              </button>
            </TableCell>
            <TableCell className="text-right">{r.vendas}</TableCell>
            <TableCell className="text-right">{money(r.comissao)}</TableCell>
            <TableCell>
              {r.meta != null ? (
                <MetaCell realizado={r.metaRealizado} meta={r.meta} />
              ) : (
                <span className="text-xs text-muted-foreground">Sem meta</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Painel de detalhe — substitui o card do ranking quando um nome é clicado (mantém contexto, dá
 * pra voltar fácil, sem cobrir a tela com modal). Busca via visao_executiva_detalhe_comissao(),
 * mesma janela/regra de "fechada" do ranking, pra o total aqui sempre bater com o número de lá. */
function DetalheComissao({
  selecao,
  onVoltar,
  profileName,
}: {
  selecao: DetalheSelecao;
  onVoltar: () => void;
  profileName: Record<string, string>;
}) {
  const [linhas, setLinhas] = useState<DetalheLinha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setLinhas(null);
    setErro(null);
    const params =
      selecao.tipo === "corretor"
        ? { _corretor_id: selecao.id, _team_id: undefined, _sem_equipe: false }
        : {
            _corretor_id: undefined,
            _team_id: selecao.teamId ?? undefined,
            _sem_equipe: selecao.teamId === null,
          };
    supabase.rpc("visao_executiva_detalhe_comissao", params).then(({ data, error }) => {
      if (cancelado) return;
      if (error) {
        console.error("visao_executiva_detalhe_comissao:", error);
        setErro("Não foi possível carregar as vendas.");
        return;
      }
      setLinhas((data ?? []) as unknown as DetalheLinha[]);
    });
    return () => {
      cancelado = true;
    };
    // selecao é um objeto novo a cada clique (nunca é reaproveitado) — comparar pelos campos
    // primitivos evita reabrir a busca em renders que não trocaram de pessoa/equipe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecao.tipo, selecao.tipo === "corretor" ? selecao.id : selecao.teamId]);

  const total = (linhas ?? []).reduce((acc, l) => acc + Number(l.valor_comissao), 0);
  const ehEquipe = selecao.tipo === "equipe";

  return (
    <>
      <CardHeader className="space-y-3">
        <button
          type="button"
          onClick={onVoltar}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar ao ranking
        </button>
        <div>
          <CardTitle className="text-base">{selecao.nome}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {linhas == null ? "Carregando…" : `${linhas.length} vendas nos últimos 30 dias`}
          </p>
        </div>
      </CardHeader>
      <CardContent>
        {erro ? (
          <p className="py-8 text-center text-sm text-destructive">{erro}</p>
        ) : linhas == null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
        ) : linhas.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma venda no período.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Venda</TableHead>
                {ehEquipe && <TableHead>Corretor</TableHead>}
                <TableHead>Modalidade</TableHead>
                <TableHead className="text-right">Fechou em</TableHead>
                <TableHead className="text-right">Comissão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.sale_id}>
                  <TableCell className="font-medium">
                    <Link
                      to="/vendas/$id"
                      params={{ id: l.sale_id }}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      {l.imovel_id || l.codigo_interno || `Venda #${l.sale_id.slice(0, 8)}`}
                      <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </TableCell>
                  {ehEquipe && (
                    <TableCell className="text-muted-foreground">
                      {profileName[l.corretor_id] ?? `${l.corretor_id.slice(0, 8)}…`}
                    </TableCell>
                  )}
                  <TableCell className="text-muted-foreground">
                    {l.modalidade === "lancamento" ? "Lançamento" : "Padrão"}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {new Date(l.fechado_em).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-right">{money(l.valor_comissao)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2">
                <TableCell colSpan={ehEquipe ? 4 : 3} className="font-semibold">
                  Total
                </TableCell>
                <TableCell className="text-right font-semibold">{money(total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </>
  );
}

function MetaCell({ realizado, meta }: { realizado: number; meta: number }) {
  const pct = meta > 0 ? Math.round((realizado / meta) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : "bg-amber-500"}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <span
        className={`whitespace-nowrap text-xs font-medium ${pct >= 100 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}
      >
        {pct}% de {money(meta)}
      </span>
    </div>
  );
}
