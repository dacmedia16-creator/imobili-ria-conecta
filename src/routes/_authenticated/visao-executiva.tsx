import { createFileRoute } from "@tanstack/react-router";
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
  type ChartConfig,
} from "@/components/ui/chart";
import {
  FileSignature,
  Landmark,
  Gavel,
  RotateCcw,
  Banknote,
  Percent,
  Handshake,
  Building2,
  PiggyBank,
  CheckCircle2,
  ClipboardList,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/visao-executiva")({
  head: () => ({ meta: [{ title: "Visão Executiva" }] }),
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

function VisaoExecutiva() {
  const { hasAny, loading: authLoading } = useAuth();
  const allowed = hasAny(["admin", "super_admin"]);
  const isSuperAdmin = hasAny(["super_admin"]);
  const [stats, setStats] = useState<VisaoExecutivaStats | null>(null);
  const [profileName, setProfileName] = useState<Record<string, string>>({});
  const [metas, setMetas] = useState<MetaProgresso>({ corretor: [], equipe: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      const [statsRes, profRes, metasRes] = await Promise.all([
        supabase.rpc("visao_executiva_stats"),
        supabase.from("profiles").select("id, nome"),
        supabase.rpc("metas_progresso", { _mes: mesAtualISO() }),
      ]);
      setStats((statsRes.data as unknown as VisaoExecutivaStats) ?? null);
      const names: Record<string, string> = {};
      for (const p of profRes.data ?? []) names[p.id] = p.nome ?? p.id;
      setProfileName(names);
      setMetas((metasRes.data as unknown as MetaProgresso) ?? { corretor: [], equipe: [] });
      setLoading(false);
    })();
  }, [allowed]);

  if (authLoading || loading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  if (!allowed) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Esta área é restrita a administradores.
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
        <h1 className="text-2xl font-semibold tracking-tight">Visão Executiva</h1>
        <p className="text-sm text-muted-foreground">
          Gargalos, performance de equipe e evolução do negócio.
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Precisa de ação
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AlertaCard
            icon={FileSignature}
            label="Aguardando assinatura há +7 dias"
            alerta={stats?.alertas?.assinatura_pendente}
            critical
          />
          <AlertaCard
            icon={Landmark}
            label="Ocorrência no financeiro parada +5 dias"
            alerta={stats?.alertas?.financeiro_parado}
          />
          <AlertaCard
            icon={Gavel}
            label="Contrato em conferência há +3 dias"
            alerta={stats?.alertas?.contrato_parado}
          />
          <AlertaCard
            icon={RotateCcw}
            label="Vendas devolvidas 2× ou mais"
            alerta={stats?.alertas?.retrabalho}
            critical
            sub="Retrabalho — mesma venda voltou várias vezes"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Resumo da operação — últimos 30 dias
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ResumoCard
            icon={Banknote}
            label="VGV"
            valor={money(stats?.resumo_operacional?.vgv ?? 0)}
          />
          <ResumoCard
            icon={Percent}
            label="Comissão bruta da operação"
            valor={money(stats?.resumo_operacional?.comissao_bruta_operacao ?? 0)}
          />
          <ResumoCard
            icon={Handshake}
            label="Parceria externa"
            valor={money(stats?.resumo_operacional?.parceria_externa ?? 0)}
          />
          <ResumoCard
            icon={Building2}
            label="Parte da unidade"
            valor={money(stats?.resumo_operacional?.parte_unidade ?? 0)}
          />
          <ResumoCard
            icon={PiggyBank}
            label="Receita líquida da imobiliária"
            valor={money(stats?.resumo_operacional?.receita_liquida_imobiliaria ?? 0)}
          />
          <ResumoCard
            icon={CheckCircle2}
            label="Quantidade de vendas"
            valor={String(stats?.resumo_operacional?.quantidade_vendas ?? 0)}
          />
          <ResumoCard
            icon={ClipboardList}
            label="Quantidade de captações"
            valor={String(stats?.resumo_operacional?.quantidade_captacoes ?? 0)}
          />
        </div>
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
                      tempo: r.tempo_medio_dias,
                      devolucao: r.taxa_devolucao,
                      comissao: r.comissao,
                      meta: meta?.meta_comissao ?? null,
                      metaRealizado: meta?.comissao_realizada ?? 0,
                    };
                  })}
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
                      tempo: null,
                      devolucao: r.taxa_devolucao,
                      comissao: r.comissao,
                      meta: meta?.meta_comissao ?? null,
                      metaRealizado: meta?.comissao_realizada ?? 0,
                    };
                  })}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
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
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Comissão</p>
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
                    width={32}
                    tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(l) => mesLabel(String(l))}
                        formatter={(v) => money(Number(v))}
                      />
                    }
                  />
                  <Bar dataKey="comissao" fill="var(--color-comissao)" radius={3} />
                </BarChart>
              </ChartContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AlertaCard({
  icon: Icon,
  label,
  alerta,
  critical,
  sub,
}: {
  icon: any;
  label: string;
  alerta?: Alerta;
  critical?: boolean;
  sub?: string;
}) {
  const n = alerta?.n ?? 0;
  const isZero = n === 0;
  return (
    <Card className={!isZero && critical ? "border-destructive/40" : ""}>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center justify-between">
          <div
            className={`rounded-md p-2 ${isZero ? "bg-muted text-muted-foreground/50" : "bg-primary/10 text-primary"}`}
          >
            <Icon className="h-5 w-5" />
          </div>
          <span
            className={`text-2xl font-bold leading-none ${isZero ? "text-muted-foreground/50" : ""}`}
          >
            {n}
          </span>
        </div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {sub ??
            (alerta?.max_dias
              ? `A mais antiga: ${alerta.max_dias} dias parada`
              : "Nenhuma pendência")}
        </p>
      </CardContent>
    </Card>
  );
}

function ResumoCard({ icon: Icon, label, valor }: { icon: any; label: string; valor: string }) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="rounded-md bg-primary/10 p-2 text-primary w-fit">
          <Icon className="h-5 w-5" />
        </div>
        <p className="text-xl font-bold leading-none">{valor}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function RankingTable({
  rows,
}: {
  rows: {
    id: string;
    nome: string;
    vendas: number;
    tempo: number | null;
    devolucao: number;
    comissao: number;
    meta: number | null;
    metaRealizado: number;
  }[];
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
          <TableHead className="text-right">Tempo médio</TableHead>
          <TableHead className="text-right">Devolução</TableHead>
          <TableHead className="text-right">Comissão</TableHead>
          <TableHead>Meta do mês</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r, i) => (
          <TableRow key={r.id}>
            <TableCell className="font-medium">
              <span className="inline-flex items-center gap-2">
                {i < 3 && (
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ background: i === 0 ? "#c9971f" : i === 1 ? "#9aa0a6" : "#b0703a" }}
                  >
                    {i + 1}
                  </span>
                )}
                {r.nome}
              </span>
            </TableCell>
            <TableCell className="text-right">{r.vendas}</TableCell>
            <TableCell className="text-right text-muted-foreground">
              {r.tempo != null ? `${r.tempo} dias` : "—"}
            </TableCell>
            <TableCell
              className={`text-right ${r.devolucao > 0 ? "font-medium text-destructive" : "text-muted-foreground"}`}
            >
              {r.devolucao}%
            </TableCell>
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
