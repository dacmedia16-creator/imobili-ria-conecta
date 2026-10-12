import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CalendarDays,
  ChevronRight,
  CircleCheck,
  Clock,
  HandCoins,
  Handshake,
  House,
  Inbox,
  Info,
  Receipt,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  TriangleAlert,
  Users,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadMyAccess } from "@/lib/platform-context";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import { STATUS_LABEL } from "@/lib/status";
import {
  COLUNAS_FUNIL,
  colunaDoStatus,
  diasEntre,
  diasSemVender,
  ganhoDoLider,
  mesAnterior,
  mesDaData,
  nivelSemVender,
  PAPEIS_PAINEL_EQUIPE,
  pendenciasAndamento,
  podeAcessarPainelEquipe,
  pontasDoPainel,
  rankingEquipe,
  recebimentosDoMes,
  resumoMes,
  variacao,
  vencimentoExclusiva,
  vezDoStatus,
  type ColunaFunil,
  type PainelEquipeDados,
  type PainelEquipeOpcao,
  type VezFunil,
} from "@/lib/painel-equipe-calc";

// painel_equipe_* ainda não consta do types.ts gerado.
const db = supabase as unknown as SupabaseClient;

export const Route = createFileRoute("/_authenticated/painel-equipe")({
  head: () => ({ meta: [{ title: "Painel da Equipe" }] }),
  // Três camadas: rota (aqui), componente (useAuth) e RPC (painel_equipe_permitido no banco).
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/auth" });
    const { roles } = await loadMyAccess(session.user.id);
    if (!podeAcessarPainelEquipe(roles)) {
      toast.error("Acesso não autorizado.");
      throw redirect({ to: "/dashboard" });
    }
  },
  component: PainelEquipePage,
});

const R = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const Q = (n: number) => (Math.round(n * 10) / 10).toLocaleString("pt-BR");
const dt = (d: string | null | undefined) =>
  d ? d.slice(0, 10).split("-").reverse().join("/") : "—";
const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const nomeMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(0, 4)}`;

// ---------- Peças visuais (t_46428363; mesmo padrão do Painel da Plataforma, inspiração 21st.dev:
// KPI cards, leaderboard com barras e quadro por etapa). Só apresentação: os números vêm do calc. ----------

type Tom = "blue" | "green" | "amber" | "red" | "violet" | "slate";
const TOM_ICONE: Record<Tom, string> = {
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  red: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  slate: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
};
const TOM_PILL: Record<Tom, string> = {
  blue: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  red: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  slate: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
};
const TOM_PONTO: Record<Tom, string> = {
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
  violet: "bg-violet-500",
  slate: "bg-slate-500",
};
const TOM_BORDA: Record<Tom, string> = {
  blue: "border-l-blue-500",
  green: "border-l-emerald-500",
  amber: "border-l-amber-500",
  red: "border-l-rose-500",
  violet: "border-l-violet-500",
  slate: "border-l-slate-400",
};

/** Etiqueta de status: sempre cor + texto (regra de Denis). */
function Pill({
  tom,
  children,
  className,
}: {
  tom: Tom;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        TOM_PILL[tom],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TOM_PONTO[tom])} aria-hidden />
      {children}
    </span>
  );
}

const VEZ_ESTILO: Record<VezFunil, { tom: Tom; texto: string }> = {
  corretor: { tom: "amber", texto: "Vez do corretor" },
  gestor: { tom: "blue", texto: "Vez do gestor/TL" },
  juridico: { tom: "slate", texto: "Vez do jurídico/cliente" },
  financeiro: { tom: "violet", texto: "Vez do financeiro" },
  concluida: { tom: "green", texto: "Concluída" },
};
const COLUNA_ESTILO: Record<ColunaFunil, { tom: Tom; dica: string }> = {
  rascunho: { tom: "amber", dica: "corretor precisa completar ou corrigir" },
  andamento: { tom: "blue", dica: "contrato e assinatura em curso" },
  financeiro: { tom: "violet", dica: "financeiro confere a ocorrência" },
  concluida: { tom: "green", dica: "assinadas no mês escolhido" },
};

function ultimosMeses(hoje: string, n = 12): string[] {
  const out: string[] = [];
  let m = hoje.slice(0, 7);
  for (let i = 0; i < n; i++) {
    out.push(m);
    m = mesAnterior(m);
  }
  return out;
}

function Comparacao({
  atual,
  anterior,
  mesAnt,
}: {
  atual: number;
  anterior: number;
  mesAnt: string;
}) {
  const d = variacao(atual, anterior);
  const mesNome = nomeMes(mesAnt).split("/")[0].toLowerCase();
  if (d == null)
    return <span className="text-xs text-muted-foreground">sem base em {mesNome}</span>;
  const sobe = d >= 0;
  const Icone = sobe ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold",
        sobe ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400",
      )}
    >
      <Icone className="h-3.5 w-3.5" aria-hidden />
      {sobe ? "+" : "−"}
      {Math.abs(d).toFixed(0)}% vs {mesNome}
    </span>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tom,
  children,
  destaque,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tom: Tom;
  children?: React.ReactNode;
  destaque?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-3 shadow-sm transition-shadow hover:shadow-md sm:p-4",
        destaque && "border-emerald-500/40 ring-1 ring-emerald-500/20",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <dt className="text-xs font-medium leading-tight text-muted-foreground">{label}</dt>
        <span className={cn("shrink-0 rounded-lg p-1.5", TOM_ICONE[tom])} aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <dd className="mt-1 truncate text-lg font-semibold tabular-nums tracking-tight sm:text-2xl">
        {value}
      </dd>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function SecaoTitulo({
  icon: Icon,
  titulo,
  dica,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  titulo: string;
  dica?: string;
  children?: React.ReactNode;
}) {
  return (
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 rounded-lg bg-primary/10 p-1.5 text-primary" aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <CardTitle className="text-base leading-tight">{titulo}</CardTitle>
          {dica && <p className="mt-0.5 text-xs text-muted-foreground">{dica}</p>}
        </div>
      </div>
      {children}
    </CardHeader>
  );
}

function Vazio({
  icon: Icon = Inbox,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
      <Icon className="h-6 w-6 opacity-60" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

function Nota({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? (p[p.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

function Avatar({ nome }: { nome: string }) {
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
      aria-hidden
    >
      {iniciais(nome) || "?"}
    </span>
  );
}

function Posicao({ i }: { i: number }) {
  const medalha = [
    "bg-amber-400/20 text-amber-700 ring-amber-400/50 dark:text-amber-300",
    "bg-slate-300/30 text-slate-700 ring-slate-400/50 dark:text-slate-200",
    "bg-orange-400/20 text-orange-800 ring-orange-400/50 dark:text-orange-300",
  ][i];
  return (
    <span
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums",
        medalha ? `ring-1 ${medalha}` : "text-muted-foreground",
      )}
      aria-label={`${i + 1}º lugar`}
    >
      {i + 1}
    </span>
  );
}

function PainelSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Carregando o painel">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-xl border bg-card p-4">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-7 w-4/5" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-48 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

const SELECT_CLS =
  "h-9 w-full rounded-md border bg-background px-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring sm:w-auto";

function PainelEquipePage() {
  const { hasAny, loading: authLoading } = useAuth();
  const allowed = hasAny([...PAPEIS_PAINEL_EQUIPE]);
  const isAdmin = hasAny(["admin", "super_admin"]);
  const hoje = hojeSaoPaulo();
  const meses = useMemo(() => ultimosMeses(hoje), [hoje]);

  const [equipes, setEquipes] = useState<PainelEquipeOpcao[] | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [mes, setMes] = useState(meses[0]);
  const [dados, setDados] = useState<PainelEquipeDados | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    let cancelado = false;
    void db.rpc("painel_equipe_equipes").then(({ data, error }) => {
      if (cancelado) return;
      if (error) {
        toast.error("Não foi possível carregar as equipes.");
        setEquipes([]);
        return;
      }
      const lista = (data ?? []) as PainelEquipeOpcao[];
      setEquipes(lista);
      setTeamId((atual) => atual ?? lista[0]?.id ?? null);
    });
    return () => {
      cancelado = true;
    };
  }, [allowed]);

  useEffect(() => {
    if (!teamId) return;
    let cancelado = false;
    setCarregando(true);
    void db
      .rpc("painel_equipe_dados", { _team_id: teamId, _mes: `${mes}-01` })
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) {
          toast.error("Não foi possível carregar o painel desta equipe.");
          setDados(null);
        } else setDados(data as PainelEquipeDados);
        setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [teamId, mes]);

  if (authLoading) return <PainelSkeleton />;
  if (!allowed)
    return (
      <Card>
        <CardContent className="pt-6">
          <Vazio icon={Users}>
            Esta área é restrita a gestores, team leaders e administradores.
          </Vazio>
        </CardContent>
      </Card>
    );
  if (equipes && equipes.length === 0)
    return (
      <Card>
        <CardContent className="pt-6">
          <Vazio icon={Users}>Você não lidera nenhuma equipe nesta imobiliária.</Vazio>
        </CardContent>
      </Card>
    );

  const equipeAtual = equipes?.find((e) => e.id === teamId) ?? null;

  return (
    <div className="space-y-6">
      {/* Topo */}
      <header className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-sm sm:p-6">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="rounded-xl bg-primary p-2.5 text-primary-foreground shadow-sm"
              aria-hidden
            >
              <Users className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                Painel da Equipe
                {equipeAtual && (
                  <span className="block text-base font-medium text-muted-foreground sm:inline sm:text-2xl sm:font-semibold sm:text-foreground">
                    <span className="hidden sm:inline"> — </span>
                    {equipeAtual.nome}
                  </span>
                )}
              </h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Vendas contadas pelo <b>mês da assinatura do contrato</b> (horário de Brasília).
                Recebimentos contados pela <b>data da parcela</b>.
              </p>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-end gap-3 text-sm sm:w-auto">
            <label className="flex w-full flex-col gap-1 sm:w-auto">
              <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Mês
              </span>
              <select className={SELECT_CLS} value={mes} onChange={(e) => setMes(e.target.value)}>
                {meses.map((m) => (
                  <option key={m} value={m}>
                    {nomeMes(m)}
                  </option>
                ))}
              </select>
            </label>
            {isAdmin && (equipes?.length ?? 0) > 1 && (
              <label className="flex w-full flex-col gap-1 sm:w-auto">
                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Users className="h-3.5 w-3.5" aria-hidden /> Equipe
                </span>
                <select
                  className={SELECT_CLS}
                  value={teamId ?? ""}
                  onChange={(e) => setTeamId(e.target.value)}
                >
                  {equipes?.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      </header>

      {carregando || !dados ? (
        <PainelSkeleton />
      ) : (
        <PainelEquipeConteudo dados={dados} mes={mes} hoje={hoje} />
      )}
    </div>
  );
}

/** Blocos 1 (números) a 7 do painel, a partir dos dados já carregados da RPC. */
export function PainelEquipeConteudo({
  dados,
  mes,
  hoje,
}: {
  dados: PainelEquipeDados;
  mes: string;
  hoje: string;
}) {
  const [pessoaAberta, setPessoaAberta] = useState<string | null>(null);
  const pontas = useMemo(() => pontasDoPainel(dados), [dados]);
  const mesAnt = mesAnterior(mes);
  const r = useMemo(() => resumoMes(dados, pontas, mes), [dados, pontas, mes]);
  const a = useMemo(() => resumoMes(dados, pontas, mesAnt), [dados, pontas, mesAnt]);
  const ganho = useMemo(() => ganhoDoLider(dados, mes), [dados, mes]);
  const ranking = useMemo(() => rankingEquipe(dados, pontas, mes), [dados, pontas, mes]);
  const receb = useMemo(() => recebimentosDoMes(dados, pontas, mes), [dados, pontas, mes]);
  const semVender = useMemo(() => diasSemVender(dados, hoje), [dados, hoje]);
  const nomePorId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pontas) if (p.pessoaId) m.set(p.pessoaId, p.pessoaNome);
    for (const x of dados.membros) m.set(x.user_id, x.nome);
    return m;
  }, [pontas, dados]);
  const primeiroNome = (id: string) => (nomePorId.get(id) ?? "—").split(" ")[0];
  const metaValor = Number(dados.meta?.meta_comissao ?? 0);
  const pct = metaValor > 0 ? Math.min(100, (r.comissaoPessoal / metaValor) * 100) : 0;
  const exclusivas = dados.exclusivas;
  // Só para a largura da barra visual do ranking (não é número exibido nem cálculo de negócio).
  const maiorGanho = Math.max(0, ...ranking.map((x) => x.ganho));
  const situacao = (x: { recebido_em: string | null; data: string | null }) =>
    x.recebido_em
      ? ({ tom: "green", texto: "Recebida" } as const)
      : (x.data ?? "") < hoje
        ? ({ tom: "red", texto: "Atrasada" } as const)
        : ({ tom: "amber", texto: "A receber" } as const);
  const contagemReceb = receb.reduce(
    (s, x) => {
      const t = situacao(x).texto;
      s[t] = (s[t] ?? 0) + 1;
      return s;
    },
    {} as Record<string, number>,
  );

  return (
    <>
      {/* BLOCO 1: números do mês */}
      <section aria-label="Números do mês">
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="VGV da equipe" value={R(r.vgv)} icon={House} tom="blue">
            <Comparacao atual={r.vgv} anterior={a.vgv} mesAnt={mesAnt} />
          </KpiCard>
          <KpiCard label="VGC da equipe" value={R(r.vgc)} icon={HandCoins} tom="violet">
            <Comparacao atual={r.vgc} anterior={a.vgc} mesAnt={mesAnt} />
          </KpiCard>
          <KpiCard label="Imóveis vendidos" value={Q(r.qtd)} icon={Trophy} tom="amber">
            <Comparacao atual={r.qtd} anterior={a.qtd} mesAnt={mesAnt} />
          </KpiCard>
          <KpiCard label="Ticket médio" value={R(r.ticket)} icon={Receipt} tom="slate">
            <Comparacao atual={r.ticket} anterior={a.ticket} mesAnt={mesAnt} />
          </KpiCard>
          <KpiCard label="Equipe recebe no mês" value={R(r.recebeEquipe)} icon={Wallet} tom="green">
            <Comparacao atual={r.recebeEquipe} anterior={a.recebeEquipe} mesAnt={mesAnt} />
          </KpiCard>
          <KpiCard
            label="Comissão do pessoal no mês"
            value={R(r.comissaoPessoal)}
            icon={Target}
            tom="green"
            destaque={metaValor > 0}
          >
            <Comparacao atual={r.comissaoPessoal} anterior={a.comissaoPessoal} mesAnt={mesAnt} />
            {metaValor > 0 && (
              <div className="mt-2" title={`${pct.toFixed(0)}% da meta de ${R(metaValor)}`}>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      pct >= 100 ? "bg-emerald-500" : "bg-primary",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {pct.toFixed(0)}% da meta
                </div>
              </div>
            )}
          </KpiCard>
        </dl>
        <details className="group mt-2 rounded-lg text-xs text-muted-foreground">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 font-medium hover:text-foreground">
            <Info className="h-3.5 w-3.5" aria-hidden />
            Como VGV e VGC são contados
            <ChevronRight
              className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
              aria-hidden
            />
          </summary>
          <p className="mt-1 max-w-3xl rounded-lg border bg-muted/30 p-3 leading-relaxed">
            VGV e VGC contam só a <b>parte dos membros desta equipe</b> (mesma regra da Produção por
            pessoa): venda comum = captação 50% + venda 50%; parceria com outra imobiliária = a
            venda inteira fica com o lado da casa; Lançamento = rateio pela comissão de cada
            vendedor.
          </p>
        </details>
      </section>

      {/* BLOCO 2: quanto eu vou ganhar */}
      <Card className="overflow-hidden">
        <SecaoTitulo
          icon={Wallet}
          titulo={`Quanto EU vou ganhar no mês — ${nomePorId.get(dados.eu_id ?? "") ?? "líder da equipe"}`}
          dica="Comissão das vendas assinadas no mês."
        />
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="text-xs font-medium text-muted-foreground">Só as vendas pessoais</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{R(ganho.a)}</div>
              <ul className="mt-3 divide-y text-sm">
                {ganho.pessoais.length ? (
                  ganho.pessoais.map((x) => (
                    <li key={x.saleId} className="flex justify-between gap-2 py-1.5">
                      <span>{x.codigo ?? "—"}</span>
                      <span className="tabular-nums">{R(x.valor)}</span>
                    </li>
                  ))
                ) : (
                  <li className="py-1.5 text-muted-foreground">
                    Nenhuma venda pessoal assinada no mês
                  </li>
                )}
              </ul>
            </div>
            <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/5 p-4 ring-1 ring-emerald-500/20">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-medium text-muted-foreground">
                  Vendas pessoais + comissão de líder já lançada nas vendas
                </div>
                <Pill tom="green">
                  <CircleCheck className="h-3 w-3" aria-hidden /> É o valor que vale
                </Pill>
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                {R(ganho.b)}
              </div>
              <ul className="mt-3 divide-y text-sm">
                <li className="flex justify-between gap-2 py-1.5">
                  <span>Vendas pessoais</span>
                  <span className="tabular-nums">{R(ganho.a)}</span>
                </li>
                {ganho.lider.map((x) => (
                  <li key={x.saleId} className="flex justify-between gap-2 py-1.5">
                    <span>Líder em {x.codigo ?? "—"}</span>
                    <span className="tabular-nums">+ {R(x.valor)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-950 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Não há percentual automático do líder sobre a produção da equipe. Entra só a comissão
              de líder lançada venda a venda (campo “Líder” do lado captador/vendedor e “+ Gestor /
              + Team Leader” na divisão de comissão).
            </span>
          </p>
        </CardContent>
      </Card>

      {/* BLOCO 3: ranking */}
      <Card>
        <SecaoTitulo
          icon={Trophy}
          titulo="Ranking da equipe"
          dica="Ordenado por quanto cada um vai ganhar no mês. Toque num corretor para ver as vendas dele."
        />
        <CardContent>
          {ranking.length === 0 ? (
            <Vazio icon={Users}>Nenhum membro nesta equipe.</Vazio>
          ) : (
            <>
              {/* Celular: lista em cartões, sem rolagem lateral */}
              <ul className="space-y-2 md:hidden">
                {ranking.map((x, i) => (
                  <li key={x.userId}>
                    <button
                      type="button"
                      onClick={() => setPessoaAberta(x.userId)}
                      className="w-full rounded-xl border bg-card p-3 text-left shadow-sm transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex items-center gap-2.5">
                        <Posicao i={i} />
                        <Avatar nome={x.nome} />
                        <div className="min-w-0 flex-1">
                          <div className="break-words text-sm font-semibold leading-tight">
                            {x.nome}
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {x.papel === "lider" && <Pill tom="blue">Líder</Pill>}
                            {x.papel === "co_lider" && <Pill tom="blue">Líder auxiliar</Pill>}
                            {x.parceria && (
                              <Pill tom="violet">
                                <Handshake className="h-3 w-3" aria-hidden /> parceria
                              </Pill>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] text-muted-foreground">Vai ganhar</div>
                          <div className="text-sm font-semibold tabular-nums">{R(x.ganho)}</div>
                        </div>
                        <ChevronRight
                          className="h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{ width: maiorGanho > 0 ? `${(x.ganho / maiorGanho) * 100}%` : 0 }}
                        />
                      </div>
                      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <dt className="text-muted-foreground">VGV dele</dt>
                          <dd className="font-medium tabular-nums">{R(x.vgv)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">VGC dele</dt>
                          <dd className="font-medium tabular-nums">{R(x.vgc)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Vendas</dt>
                          <dd className="font-medium tabular-nums">{Q(x.qtd)}</dd>
                        </div>
                      </dl>
                    </button>
                  </li>
                ))}
              </ul>

              {/* Computador: tabela */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="w-12 p-2 font-medium">#</th>
                      <th className="p-2 font-medium">Corretor</th>
                      <th className="p-2 text-right font-medium">VGV (parte dele)</th>
                      <th className="p-2 text-right font-medium">VGC (parte dele)</th>
                      <th className="p-2 text-right font-medium">Vendas</th>
                      <th className="w-56 p-2 text-right font-medium">Vai ganhar no mês</th>
                      <th className="w-8 p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((x, i) => (
                      <tr
                        key={x.userId}
                        tabIndex={0}
                        className="group cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50 focus:outline-none focus-visible:bg-muted"
                        onClick={() => setPessoaAberta(x.userId)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setPessoaAberta(x.userId);
                          }
                        }}
                      >
                        <td className="p-2">
                          <Posicao i={i} />
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-2.5">
                            <Avatar nome={x.nome} />
                            <div className="min-w-0">
                              <div className="font-semibold">{x.nome}</div>
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                {x.papel === "lider" && <Pill tom="blue">Líder</Pill>}
                                {x.papel === "co_lider" && <Pill tom="blue">Líder auxiliar</Pill>}
                                {x.parceria && (
                                  <Pill tom="violet">
                                    <Handshake className="h-3 w-3" aria-hidden /> parceria
                                  </Pill>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="p-2 text-right tabular-nums">{R(x.vgv)}</td>
                        <td className="p-2 text-right tabular-nums">{R(x.vgc)}</td>
                        <td className="p-2 text-right tabular-nums">{Q(x.qtd)}</td>
                        <td className="p-2">
                          <div className="flex items-center justify-end gap-3">
                            <div
                              className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-muted lg:block"
                              aria-hidden
                            >
                              <div
                                className="ml-auto h-full rounded-full bg-primary/70"
                                style={{
                                  width: maiorGanho > 0 ? `${(x.ganho / maiorGanho) * 100}%` : 0,
                                }}
                              />
                            </div>
                            <span className="font-semibold tabular-nums">{R(x.ganho)}</span>
                          </div>
                        </td>
                        <td className="p-2 text-muted-foreground">
                          <ChevronRight
                            className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100"
                            aria-hidden
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <Nota>
            “Vai ganhar no mês” = comissão de cada pessoa nas vendas assinadas no mês. Parceria = a
            venda é dividida com corretor de outra equipe ou de fora; só a fração desta equipe
            entra.
          </Nota>
        </CardContent>
      </Card>

      {/* BLOCO 4: funil */}
      <Card>
        <SecaoTitulo
          icon={Clock}
          titulo="Andamento das vendas da equipe — de quem é a vez"
          dica="Todas as vendas abertas da equipe, de qualquer mês, e as concluídas assinadas no mês escolhido."
        />
        <CardContent>
          <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Legenda das cores">
            {(["corretor", "gestor", "juridico", "financeiro", "concluida"] as const).map((k) => (
              <Pill key={k} tom={VEZ_ESTILO[k].tom}>
                {VEZ_ESTILO[k].texto}
              </Pill>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {COLUNAS_FUNIL.map((c) => {
              const vs = dados.andamento.filter((x) => colunaDoStatus(x.status) === c.k);
              const est = COLUNA_ESTILO[c.k];
              return (
                <div key={c.k} className="flex flex-col rounded-xl border bg-muted/30 p-2.5">
                  <div className="mb-2 px-0.5">
                    <h3 className="flex items-center justify-between gap-2 text-sm font-semibold">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn("h-2 w-2 rounded-full", TOM_PONTO[est.tom])}
                          aria-hidden
                        />
                        {c.titulo}
                      </span>
                      <span className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold tabular-nums shadow-sm">
                        {vs.length}
                      </span>
                    </h3>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{est.dica}</p>
                  </div>
                  {vs.length === 0 && (
                    <div className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                      Nenhuma venda nesta etapa
                    </div>
                  )}
                  <div className="space-y-2">
                    {vs.map((v) => {
                      const vez = VEZ_ESTILO[vezDoStatus(v.status)];
                      const pend = pendenciasAndamento(v);
                      const dias = v.etapa_desde
                        ? Math.max(0, diasEntre(v.etapa_desde.slice(0, 10), hoje))
                        : null;
                      return (
                        <a
                          key={v.sale_id}
                          href={`/vendas/${v.sale_id}`}
                          className={cn(
                            "block rounded-lg border border-l-4 bg-card p-2.5 text-xs shadow-sm transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            TOM_BORDA[vez.tom],
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="font-semibold">{v.codigo ?? "—"}</span>
                              {v.bairro && (
                                <span className="text-muted-foreground"> · {v.bairro}</span>
                              )}
                            </div>
                            <span className="shrink-0 font-semibold tabular-nums">
                              {R(Number(v.valor_negociado ?? 0))}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-muted-foreground">
                            {v.membros.map(primeiroNome).join(", ")}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            <Pill tom={vez.tom}>{vez.texto}</Pill>
                            {v.parceria && <Pill tom="violet">parceria</Pill>}
                            {v.modalidade === "lancamento" && (
                              <Badge variant="outline" className="text-[11px]">
                                Lançamento
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1.5 text-muted-foreground">
                            {STATUS_LABEL[v.status] ?? v.status}
                            {dias != null && <span> · há {dias} dias nesta etapa</span>}
                          </div>
                          {pend.map((p) => (
                            <div
                              key={p}
                              className="mt-1.5 flex items-center gap-1 rounded-md bg-rose-500/10 px-1.5 py-1 font-medium text-rose-700 dark:text-rose-300"
                            >
                              <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden /> {p}
                            </div>
                          ))}
                        </a>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* BLOCO 5: recebimentos */}
      <Card>
        <SecaoTitulo
          icon={Wallet}
          titulo="Previsão de recebimentos do mês"
          dica="Parcelas com data neste mês. Só a fração desta equipe entra no total."
        >
          <div className="text-right">
            <div className="text-[11px] text-muted-foreground">Total do mês</div>
            <div className="text-lg font-semibold tabular-nums">{R(r.recebeEquipe)}</div>
          </div>
        </SecaoTitulo>
        <CardContent>
          {receb.length === 0 ? (
            <Vazio icon={Receipt}>Nenhuma parcela com data neste mês.</Vazio>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {(["Recebida", "Atrasada", "A receber"] as const).map((t) =>
                  contagemReceb[t] ? (
                    <Pill
                      key={t}
                      tom={t === "Recebida" ? "green" : t === "Atrasada" ? "red" : "amber"}
                    >
                      {contagemReceb[t]} {t.toLowerCase()}
                      {contagemReceb[t] > 1 ? "s" : ""}
                    </Pill>
                  ) : null,
                )}
              </div>
              {/* Celular */}
              <ul className="space-y-2 md:hidden">
                {receb.map((x) => {
                  const s = situacao(x);
                  return (
                    <li key={`${x.sale_id}-${x.n}`} className="rounded-xl border p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold">
                            {x.codigo ?? "—"}{" "}
                            <span className="font-normal text-muted-foreground">
                              · {dt(x.data)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {x.membros.map((n) => n.split(" ")[0]).join(", ") || "—"}
                          </div>
                        </div>
                        <Pill tom={s.tom}>{s.texto}</Pill>
                      </div>
                      <div className="mt-2 flex items-end justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">
                          Parcela {R(Number(x.valor ?? 0))} · {Math.round(x.fracao * 100)}% da
                          equipe
                        </span>
                        <span className="text-sm font-semibold tabular-nums">
                          {R(x.parteEquipe)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {/* Computador */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="p-2 font-medium">Data</th>
                      <th className="p-2 font-medium">Venda</th>
                      <th className="p-2 font-medium">Corretores da equipe</th>
                      <th className="p-2 text-right font-medium">Parcela</th>
                      <th className="p-2 text-right font-medium">Fração da equipe</th>
                      <th className="p-2 text-right font-medium">Parte da equipe</th>
                      <th className="p-2 font-medium">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receb.map((x) => {
                      const s = situacao(x);
                      return (
                        <tr key={`${x.sale_id}-${x.n}`} className="border-b hover:bg-muted/40">
                          <td className="p-2 tabular-nums">{dt(x.data)}</td>
                          <td className="p-2 font-medium">{x.codigo ?? "—"}</td>
                          <td className="p-2">
                            {x.membros.map((n) => n.split(" ")[0]).join(", ")}
                          </td>
                          <td className="p-2 text-right tabular-nums">{R(Number(x.valor ?? 0))}</td>
                          <td className="p-2 text-right tabular-nums">
                            {Math.round(x.fracao * 100)}%
                          </td>
                          <td className="p-2 text-right font-semibold tabular-nums">
                            {R(x.parteEquipe)}
                          </td>
                          <td className="p-2">
                            <Pill tom={s.tom}>{s.texto}</Pill>
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-muted/30">
                      <td colSpan={5} className="p-2 font-semibold">
                        Total do mês
                      </td>
                      <td className="p-2 text-right font-semibold tabular-nums">
                        {R(r.recebeEquipe)}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* BLOCO 7: meta, dias sem vender, exclusivas */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <SecaoTitulo icon={Target} titulo="Meta do mês" dica={nomeMes(mes)} />
          <CardContent className="text-sm">
            {metaValor > 0 ? (
              <div>
                <div className="flex items-end justify-between gap-2">
                  <span className="text-3xl font-semibold tabular-nums">{pct.toFixed(0)}%</span>
                  {pct >= 100 ? (
                    <Pill tom="green">
                      <CircleCheck className="h-3 w-3" aria-hidden /> Meta batida
                    </Pill>
                  ) : (
                    <Pill tom="amber">Faltam {R(Math.max(0, metaValor - r.comissaoPessoal))}</Pill>
                  )}
                </div>
                <div
                  className="my-3 h-3 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(pct)}
                  aria-label="Progresso da meta"
                >
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      pct >= 100 ? "bg-emerald-500" : "bg-primary",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-muted-foreground">
                  Comissão do pessoal: <b className="text-foreground">{R(r.comissaoPessoal)}</b> de{" "}
                  {R(metaValor)}
                </div>
              </div>
            ) : (
              <Vazio icon={Target}>
                Nenhuma meta de comissão cadastrada para esta equipe em {nomeMes(mes)}. A meta é
                cadastrada na tela Equipes.
              </Vazio>
            )}
          </CardContent>
        </Card>
        <Card>
          <SecaoTitulo
            icon={Clock}
            titulo="Há quantos dias sem vender"
            dica="Pela última assinatura. Amarelo acima de 14 dias, vermelho acima de 30."
          />
          <CardContent>
            {semVender.length === 0 ? (
              <Vazio icon={Users}>Nenhum membro nesta equipe.</Vazio>
            ) : (
              <ul className="divide-y text-sm">
                {semVender.map((x) => {
                  const nivel = nivelSemVender(x.dias);
                  const tom: Tom =
                    nivel === "alerta" ? "red" : nivel === "atencao" ? "amber" : "green";
                  const rotulo =
                    nivel === "alerta" ? "alerta" : nivel === "atencao" ? "atenção" : "em dia";
                  return (
                    <li key={x.userId} className="flex items-center justify-between gap-2 py-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar nome={x.nome} />
                        <span className="break-words leading-tight">{x.nome}</span>
                      </span>
                      <Pill tom={tom} className="shrink-0">
                        {x.dias == null ? "nunca vendeu" : `${x.dias} dias`} · {rotulo}
                      </Pill>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <SecaoTitulo
            icon={House}
            titulo={`Captações exclusivas da equipe${exclusivas ? ` (${exclusivas.length})` : ""}`}
          >
            {exclusivas != null && (
              <a
                href={`/exclusividades/painel?aba=por-corretor&equipe=${dados.equipe.id}`}
                className="text-sm font-medium text-primary hover:underline"
              >
                Ver por corretor →
              </a>
            )}
          </SecaoTitulo>
          <CardContent>
            {exclusivas == null ? (
              <Vazio>O módulo de captação exclusiva está desligado nesta imobiliária.</Vazio>
            ) : exclusivas.length === 0 ? (
              <Vazio icon={House}>Nenhuma captação exclusiva ativa.</Vazio>
            ) : (
              <ul className="divide-y text-sm">
                {exclusivas.map((e) => {
                  const vence = vencimentoExclusiva(e);
                  const d = vence ? diasEntre(hoje, vence) : null;
                  return (
                    <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <a href={`/exclusividades/${e.id}`} className="font-medium hover:underline">
                          {[e.tipo, e.bairro].filter(Boolean).join(" — ") || "Captação"}
                        </a>
                        <div className="truncate text-xs text-muted-foreground">
                          {nomePorId.get(e.captor_id) ?? "—"}
                        </div>
                      </div>
                      {d != null && d <= 15 ? (
                        <Pill tom="red" className="shrink-0">
                          {d < 0 ? `venceu há ${-d} d` : `vence em ${d} d`}
                        </Pill>
                      ) : (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          vence {dt(vence)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <DetalhePessoa
        dados={dados}
        mes={mes}
        userId={pessoaAberta}
        onClose={() => setPessoaAberta(null)}
      />
    </>
  );
}

/** BLOCO 6: detalhe das vendas de um corretor no mês. */
function DetalhePessoa({
  dados,
  mes,
  userId,
  onClose,
}: {
  dados: PainelEquipeDados;
  mes: string;
  userId: string | null;
  onClose: () => void;
}) {
  const pontas = useMemo(() => pontasDoPainel(dados), [dados]);
  if (!userId) return null;
  const minhas = pontas.filter((p) => p.pessoaId === userId && mesDaData(p.concluidaEm) === mes);
  const membro = dados.membros.find((m) => m.user_id === userId);
  const nome = membro?.nome ?? minhas[0]?.pessoaNome ?? "—";
  const ganhoPorVenda = new Map(
    dados.ganhos
      .filter((g) => g.user_id === userId)
      .map((g) => [g.sale_id, Number(g.pessoal) || 0]),
  );
  const vistos = new Set<string>();
  const tot = minhas.reduce(
    (s, p) => {
      const g = vistos.has(p.saleId) ? 0 : (ganhoPorVenda.get(p.saleId) ?? 0);
      vistos.add(p.saleId);
      return { vgv: s.vgv + p.vgv, vgc: s.vgc + p.comissao, q: s.q + p.qtd, g: s.g + g };
    },
    { vgv: 0, vgc: 0, q: 0, g: 0 },
  );
  const abertas = dados.andamento.filter(
    (a) => a.status !== "ocorrencia_concluida" && a.membros.includes(userId),
  );
  const linhas = minhas.map((p) => {
    const outros = pontas.filter((o) => o.saleId === p.saleId && o.pessoaId !== userId);
    const venda = dados.vendas.find((v) => v.sale_id === p.saleId);
    const externa = venda?.parceria_externa_captacao || venda?.parceria_externa_venda;
    return { p, outros, externa };
  });
  const comQuem = ({ outros, externa }: (typeof linhas)[number]) => (
    <>
      {externa && <Pill tom="violet">imobiliária parceira</Pill>}
      {outros.map((o) => (
        <div key={`${o.pessoaId}-${o.tipo}`} className="flex flex-wrap items-center gap-1">
          {o.pessoaNome}
          {o.teamId !== dados.equipe.id && (
            <Pill tom="violet">{o.teamNome ?? "outra equipe / individual"}</Pill>
          )}
        </div>
      ))}
      {!externa && outros.length === 0 && "—"}
    </>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-left">
            <Avatar nome={nome} />
            <span className="min-w-0">
              <span className="block">{nome}</span>
              <span className="block text-sm font-normal text-muted-foreground">
                {dados.equipe.nome} · {nomeMes(mes)}
              </span>
            </span>
          </DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="VGV (parte dele)" value={R(tot.vgv)} icon={House} tom="blue" />
          <KpiCard label="VGC (parte dele)" value={R(tot.vgc)} icon={HandCoins} tom="violet" />
          <KpiCard label="Vendas" value={Q(tot.q)} icon={Trophy} tom="amber" />
          <KpiCard label="Vai ganhar" value={R(tot.g)} icon={Wallet} tom="green" destaque />
        </dl>
        <h3 className="mt-2 font-semibold">Vendas assinadas no mês</h3>
        {linhas.length === 0 ? (
          <Vazio icon={Receipt}>Nenhuma venda assinada no mês.</Vazio>
        ) : (
          <>
            <ul className="space-y-2 md:hidden">
              {linhas.map((l) => (
                <li key={`${l.p.saleId}-${l.p.tipo}`} className="rounded-xl border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <a href={`/vendas/${l.p.saleId}`} className="font-semibold hover:underline">
                        {l.p.codigoInterno || l.p.imovelId || "—"}
                      </a>{" "}
                      <span className="text-xs text-muted-foreground">
                        · {dt(l.p.concluidaEm ? l.p.concluidaEm.slice(0, 10) : null)}
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Pill tom={l.p.tipo === "captacao" ? "blue" : "green"}>
                          {l.p.tipo === "captacao" ? "captação" : "venda"} ·{" "}
                          {Math.round(l.p.qtd * 100)}%
                        </Pill>
                        {l.p.modalidade === "lancamento" && (
                          <Badge variant="outline">Lançamento</Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="font-semibold tabular-nums">{R(l.p.vgv)}</div>
                      <div className="text-muted-foreground tabular-nums">
                        VGC {R(l.p.comissao)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    <span className="font-medium">Com quem dividiu: </span>
                    {comQuem(l)}
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="p-2 font-medium">Assinatura</th>
                    <th className="p-2 font-medium">Venda</th>
                    <th className="p-2 font-medium">Papel dele</th>
                    <th className="p-2 font-medium">Com quem dividiu</th>
                    <th className="p-2 text-right font-medium">Parte dele</th>
                    <th className="p-2 text-right font-medium">VGV dele</th>
                    <th className="p-2 text-right font-medium">VGC dele</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={`${l.p.saleId}-${l.p.tipo}`} className="border-b">
                      <td className="p-2 tabular-nums">
                        {dt(l.p.concluidaEm ? l.p.concluidaEm.slice(0, 10) : null)}
                      </td>
                      <td className="p-2">
                        <a href={`/vendas/${l.p.saleId}`} className="font-semibold hover:underline">
                          {l.p.codigoInterno || l.p.imovelId || "—"}
                        </a>{" "}
                        {l.p.modalidade === "lancamento" && (
                          <Badge variant="outline">Lançamento</Badge>
                        )}
                      </td>
                      <td className="p-2">
                        <Pill tom={l.p.tipo === "captacao" ? "blue" : "green"}>
                          {l.p.tipo === "captacao" ? "captação" : "venda"}
                        </Pill>
                      </td>
                      <td className="p-2">{comQuem(l)}</td>
                      <td className="p-2 text-right font-semibold tabular-nums">
                        {Math.round(l.p.qtd * 100)}%
                      </td>
                      <td className="p-2 text-right tabular-nums">{R(l.p.vgv)}</td>
                      <td className="p-2 text-right tabular-nums">{R(l.p.comissao)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {abertas.length > 0 && (
          <>
            <h3 className="mt-2 font-semibold">Em andamento (não entram nos números do mês)</h3>
            <ul className="space-y-2">
              {abertas.map((v) => {
                const vez = VEZ_ESTILO[vezDoStatus(v.status)];
                return (
                  <li
                    key={v.sale_id}
                    className={cn("rounded-lg border border-l-4 p-2.5 text-sm", TOM_BORDA[vez.tom])}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={`/vendas/${v.sale_id}`} className="font-semibold hover:underline">
                        {v.codigo ?? "—"}
                      </a>
                      <Pill tom={vez.tom}>{vez.texto}</Pill>
                      <span className="text-xs text-muted-foreground">
                        {STATUS_LABEL[v.status] ?? v.status}
                      </span>
                    </div>
                    {pendenciasAndamento(v).map((x) => (
                      <div
                        key={x}
                        className="mt-1 flex items-center gap-1 text-xs font-medium text-rose-700 dark:text-rose-300"
                      >
                        <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> {x}
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
