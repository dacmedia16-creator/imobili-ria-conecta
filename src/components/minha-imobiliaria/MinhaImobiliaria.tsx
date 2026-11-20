import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Banknote,
  Bell,
  CheckCircle2,
  Inbox,
  Info,
  Landmark,
  Star,
  Target,
  Thermometer,
  UsersRound,
  BarChart3,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import { ANO_PLANO } from "@/lib/meu-plano-2027/telas";
import type { TaxasFunil } from "@/lib/meu-plano-2027/regras";
import { normalizarPlanosRpc, normalizarRealizadoRpc } from "@/lib/metas-2027/painel-gestor";
import {
  direcaoMensal,
  LIMITES_RESUMO,
  montarResumo,
  nomeMes,
  normalizarResumoRpc,
  periodosResumo,
  type Aviso,
  type Cartao,
  type Cor,
  type Resumo,
} from "@/lib/minha-imobiliaria/resumo";
import {
  montarBaseMetasMes,
  montarMetasMes,
  normalizarAtividadesRpc,
  ROTULO_LINHA,
  ROTULO_MOTIVO,
  ROTULO_RITMO,
  textoMotivos,
  type BaseMetasMes,
  type Filtro,
  type LinhaMetas,
  type MetasMes,
  type PessoaMetas,
  type TomRitmo,
} from "@/lib/minha-imobiliaria/metas-mes";
import { lerTaxasPadrao } from "@/components/minha-carreira/Diario";
import { InfoDot } from "@/components/dashboard/shared";
import { ListSkeleton, Pill, TOM_ICONE, type Tom } from "@/components/visual/base";
import { cn } from "@/lib/utils";

// RPCs da migration 20261210120000 (ainda fora de types.ts).
const db = supabase as unknown as SupabaseClient;

type Dados = { resumo: Resumo; metas: BaseMetasMes };

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const brl = (v: number | null) =>
  v == null
    ? "—"
    : v >= 1e6
      ? `R$ ${(v / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mi`
      : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const int = (v: number) => v.toLocaleString("pt-BR");
const COR_TOM: Record<Cor, Tom> = {
  verde: "green",
  amarelo: "amber",
  vermelho: "red",
  cinza: "slate",
};
const RITMO_TOM: Record<TomRitmo, Tom> = {
  verde: "green",
  amarelo: "amber",
  vermelho: "red",
  sem_meta: "slate",
};
const BARRA: Record<TomRitmo, string> = {
  verde: "bg-emerald-500",
  amarelo: "bg-amber-500",
  vermelho: "bg-rose-500",
  sem_meta: "bg-slate-300",
};

/** Dados da tela: 7 leituras em paralelo + taxas do funil. Tudo só leitura. */
export function useMinhaImobiliaria() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const hoje = useMemo(() => hojeSaoPaulo(), []);

  const carregar = useCallback(async () => {
    const per = periodosResumo(hoje);
    // Meta da empresa: Metas 2027 Imobiliária (meta anual da direção) ÷ 12 — como na maquete aprovada.
    const anoDirecao = Math.max(Number(hoje.slice(0, 4)), ANO_PLANO);
    const [rs, at, pl, rm, ra, dir] = await Promise.all([
      db.rpc("minha_imobiliaria_resumo"),
      db.rpc("minha_imobiliaria_atividades", { _ano: ANO_PLANO }),
      db.rpc("metas_equipe_planos", { _ano: ANO_PLANO }),
      db.rpc("metas_equipe_realizado", { _inicio: per.mes.inicio, _fim: per.mes.fim }),
      db.rpc("metas_equipe_realizado", { _inicio: per.ant.inicio, _fim: per.ant.fim }),
      db.from("metas_direcao").select("meta_comissao,meta_vgv").eq("ano", anoDirecao).maybeSingle(),
    ]);
    const e = rs.error ?? at.error ?? pl.error ?? rm.error ?? ra.error;
    if (e) {
      setErro(
        e.code === "42501"
          ? "Esta tela é só para o dono e o administrador da imobiliária."
          : errorMessage(e, "Não foi possível carregar Minha imobiliária."),
      );
      return;
    }
    const planos = normalizarPlanosRpc(pl.data);
    let padrao: TaxasFunil | null = null;
    if (planos.modulo_plano) padrao = await lerTaxasPadrao();
    const realMes = normalizarRealizadoRpc(rm.data);
    const resumoRpc = normalizarResumoRpc(rs.data);
    setDados({
      resumo: montarResumo({
        resumo: resumoRpc,
        // Meta da direção ausente (ou recusada) = sem meta: o cartão compara com o mês anterior.
        direcao: direcaoMensal(dir.error ? null : dir.data),
        realMes,
        realAnt: normalizarRealizadoRpc(ra.data),
      }),
      metas: montarBaseMetasMes({
        hoje: resumoRpc.hoje || hoje,
        planos,
        realizadoMes: realMes,
        atividades: normalizarAtividadesRpc(at.data),
        padrao,
      }),
    });
  }, [hoje]);

  useEffect(() => {
    void carregar();
  }, [carregar]);
  return { dados, erro, hoje };
}

export function MinhaImobiliaria({ dados, erro }: { dados: Dados | null; erro: string | null }) {
  if (erro)
    return (
      <p className="rounded-xl border bg-card p-4 text-sm text-destructive" role="alert">
        {erro}
      </p>
    );
  if (!dados) return <ListSkeleton />;
  const r = dados.resumo;
  return (
    <div className="space-y-4" data-testid="minha-imobiliaria">
      <Avisos avisos={r.avisos} />
      <Numeros r={r} />
      <MetasDoMes base={dados.metas} />
      <Termometro r={r} />
      <p className="pb-6 text-xs text-muted-foreground">
        Fora desta tela (de propósito): ranking completo, gráficos e listas longas — ficam nas telas
        de detalhe (Vendas, Metas, Leads, Captações).
      </p>
    </div>
  );
}

function Secao({
  icon: Icon,
  titulo,
  desc,
  info,
  children,
  testid,
}: {
  icon: typeof Bell;
  titulo: string;
  desc: ReactNode;
  info: string;
  children: ReactNode;
  testid: string;
}) {
  return (
    <section
      className="relative rounded-2xl border bg-card p-4 shadow-sm sm:p-5"
      data-testid={testid}
    >
      <InfoDot text={info} label={`Sobre: ${titulo}`} />
      <h2 className="flex items-center gap-2 pr-8 text-base font-semibold sm:text-lg">
        <Icon className="h-5 w-5 text-primary" aria-hidden /> {titulo}
      </h2>
      <p className="mb-3 mt-1 text-sm text-muted-foreground">{desc}</p>
      {children}
    </section>
  );
}

// --- A) Avisos -----------------------------------------------------------------------------------------------

const AVISO_BORDA: Record<Aviso["tom"], string> = {
  red: "border-rose-500/30 bg-rose-500/5",
  amber: "border-amber-500/30 bg-amber-500/5",
  blue: "border-blue-500/30 bg-blue-500/5",
};
const AVISO_NUM: Record<Aviso["tom"], string> = {
  red: "text-rose-600",
  amber: "text-amber-600",
  blue: "text-primary",
};

function Avisos({ avisos }: { avisos: Aviso[] }) {
  return (
    <Secao
      icon={Bell}
      titulo="O que precisa da sua atenção hoje"
      desc="Só aparece o que está fora do normal. Toque no aviso para ver a lista."
      info={`Aparece só quando há problema: no máximo ${LIMITES_RESUMO.maxAvisos} avisos, do mais urgente para o menos urgente. Leads: sem aceite há mais de ${LIMITES_RESUMO.leadHoras}h. Exclusivas: vencem em até ${LIMITES_RESUMO.vencendoDias} dias (data de assinatura + prazo). Vendas: sem mudança de etapa há mais de ${LIMITES_RESUMO.paradaDias} dias. Corretores novos: entraram na imobiliária há menos de ${LIMITES_RESUMO.novoDias} dias e ainda não têm venda.`}
      testid="bloco-avisos"
    >
      {avisos.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="h-7 w-7 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Tudo em dia</p>
            <p className="text-sm">
              Nenhuma exclusiva vencendo, lead esperando, venda parada ou aluguel em atraso.
            </p>
          </div>
        </div>
      ) : (
        <ul className="grid gap-2">
          {avisos.map((a) => (
            <li key={a.chave}>
              <Link
                to={a.para}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-shadow hover:shadow-md",
                  AVISO_BORDA[a.tom],
                )}
                data-testid={`aviso-${a.chave}`}
              >
                <span
                  className={cn(
                    "min-w-[2.25rem] text-center text-xl font-bold tabular-nums",
                    AVISO_NUM[a.tom],
                  )}
                >
                  {int(a.qtd)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{a.titulo}</span>
                  <span className="block text-xs text-muted-foreground">{a.detalhe}</span>
                </span>
                <span className="whitespace-nowrap text-sm font-semibold text-primary">Ver →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

// --- B) Números do mês ---------------------------------------------------------------------------------------

function Variacao({ v, sufixo }: { v: number | null; sufixo: string }) {
  if (v == null) return null;
  const sobe = v >= 0;
  return (
    <span className={cn("font-semibold", sobe ? "text-emerald-700" : "text-rose-700")}>
      {sobe ? "▲" : "▼"} {Math.abs(Math.round(v * 100))}%{" "}
      <span className="font-normal">{sufixo}</span>
    </span>
  );
}

function tomMeta(c: Cartao): Tom {
  const r = c.ritmo;
  if (r == null) return "slate";
  return r >= LIMITES_RESUMO.metaVerde
    ? "green"
    : r >= LIMITES_RESUMO.metaAmarelo
      ? "amber"
      : "red";
}

function Kpi({
  label,
  icon: Icon,
  tom,
  valor,
  barra,
  ritmo,
  para,
  largo,
  destaque,
  children,
  testid,
}: {
  label: string;
  icon: typeof Bell;
  tom: Tom;
  valor: ReactNode;
  barra?: number | null;
  ritmo?: number;
  para: string;
  largo?: boolean;
  destaque?: boolean;
  children: ReactNode;
  testid: string;
}) {
  return (
    <Link
      to={para}
      data-testid={testid}
      className={cn(
        "col-span-1 min-w-0 rounded-xl border bg-card p-3 text-left transition-shadow hover:border-primary/40 hover:shadow-md sm:p-4 lg:col-span-2",
        largo && "lg:col-span-3",
        largo && destaque && "col-span-2",
        destaque && "border-primary/40 ring-1 ring-primary/15",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium leading-tight text-muted-foreground">{label}</span>
        <span className={cn("shrink-0 rounded-lg p-1.5", TOM_ICONE[tom])} aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums tracking-tight sm:text-2xl">
        {valor}
      </div>
      {barra != null ? (
        <div
          className="relative mt-2 h-2 overflow-visible rounded-full bg-muted"
          title={
            ritmo != null ? `Traço = ritmo de hoje (${Math.round(ritmo * 100)}% do mês)` : undefined
          }
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.min(100, barra * 100)}%` }}
          />
          {ritmo != null ? (
            <span
              className="absolute -top-1 h-4 w-0.5 rounded bg-foreground/50"
              style={{ left: `${Math.min(100, ritmo * 100)}%` }}
              aria-hidden
            />
          ) : null}
        </div>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {children}
      </div>
      <div className="mt-2 text-xs font-semibold text-primary">Ver detalhe →</div>
    </Link>
  );
}

function Numeros({ r }: { r: Resumo }) {
  const ant = `vs ${r.mesAnterior.slice(0, 3)}`;
  const comMeta = (c: Cartao, rot: string) =>
    c.meta != null ? (
      <>
        <Pill tom={tomMeta(c)}>{pct(c.pct)} da meta</Pill> meta {brl(c.meta)}
      </>
    ) : (
      <>
        <Pill tom="slate">sem meta da direção</Pill>
        <Variacao v={c.variacao} sufixo={ant} />
        {c.variacao == null ? <span>{rot}</span> : null}
      </>
    );
  return (
    <Secao
      icon={BarChart3}
      titulo="Números do mês"
      desc={`Empresa toda. Comparação com a meta da empresa (Metas ${ANO_PLANO} Imobiliária ÷ 12) ou com o mesmo período de ${r.mesAnterior} (dias 1 a ${r.dia}).`}
      info={`Números do mês corrente da imobiliária inteira, de 1º de ${nomeMes(Number(r.hoje.slice(5, 7)))} até hoje. VGV e comissão contam a venda pela data de assinatura (mesma regra do painel Metas ${ANO_PLANO}); a comissão é a soma da parte de comissão de cada pessoa, a mesma que o painel compara com a meta da direção. A meta do mês é a meta do ano da direção ÷ 12. Toque no cartão para ver o detalhe.`}
      testid="bloco-numeros"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi
          label={`VGV vendido × meta da empresa (anual ÷ 12)`}
          icon={Banknote}
          tom="blue"
          valor={brl(r.vgv.valor)}
          barra={r.vgv.pct}
          ritmo={r.vgv.meta != null ? r.fracMes : undefined}
          para="/painel-metas-imobiliaria"
          largo
          destaque
          testid="kpi-vgv"
        >
          {comMeta(r.vgv, "sem venda no mês anterior")}
        </Kpi>
        <Kpi
          label="Comissão × meta da direção (anual ÷ 12)"
          icon={Landmark}
          tom="green"
          valor={brl(r.comissao.valor)}
          barra={r.comissao.pct}
          ritmo={r.comissao.meta != null ? r.fracMes : undefined}
          para="/painel-metas-imobiliaria"
          largo
          testid="kpi-comissao"
        >
          {comMeta(r.comissao, "sem comissão no mês anterior")}
          {r.comissao.meta != null ? <Variacao v={r.comissao.variacao} sufixo={ant} /> : null}
        </Kpi>
        {r.exclusivas ? (
          <Kpi
            label="Exclusivas (novas no mês / ativas)"
            icon={Star}
            tom="amber"
            valor={
              <>
                {int(r.exclusivas.novas)}{" "}
                <span className="text-sm text-muted-foreground">/ {int(r.exclusivas.ativas)}</span>
              </>
            }
            para="/exclusividades"
            testid="kpi-exclusivas"
          >
            ativas <Variacao v={r.exclusivas.variacao} sufixo="em 30 dias" />
          </Kpi>
        ) : null}
        {r.leads ? (
          <Kpi
            label="Leads recebidos · % aceitos no prazo da imobiliária"
            icon={Inbox}
            tom="blue"
            valor={
              <>
                {int(r.leads.recebidos)}{" "}
                <span className="text-sm text-muted-foreground">· {pct(r.leads.pctNoPrazo)}</span>
              </>
            }
            para="/painel-leads"
            testid="kpi-leads"
          >
            {r.leads.pctNoPrazo != null ? (
              <Pill
                tom={
                  r.leads.pctNoPrazo >= LIMITES_RESUMO.leadsVerde
                    ? "green"
                    : r.leads.pctNoPrazo >= LIMITES_RESUMO.leadsAmarelo
                      ? "amber"
                      : "red"
                }
              >
                {pct(r.leads.pctNoPrazo)} no prazo
              </Pill>
            ) : null}
            <span>
              prazo{" "}
              {r.leads.prazoMin >= 60
                ? `${Math.round(r.leads.prazoMin / 60)}h`
                : `${r.leads.prazoMin} min`}
              {r.leads.pctNoPrazoAnt != null
                ? ` · ${r.mesAnterior.slice(0, 3)}: ${pct(r.leads.pctNoPrazoAnt)}`
                : ""}
            </span>
          </Kpi>
        ) : null}
        {r.produtivos ? (
          <Kpi
            label={`Corretores produtivos (venderam em ${LIMITES_RESUMO.produtivoDias} dias, inclui admin que vende)`}
            icon={UsersRound}
            tom="green"
            valor={
              <>
                {int(r.produtivos.qtd)}{" "}
                <span className="text-sm text-muted-foreground">de {int(r.produtivos.total)}</span>
              </>
            }
            para="/producao-por-pessoa"
            testid="kpi-produtivos"
          >
            {r.produtivos.pct != null ? (
              <Pill
                tom={
                  r.produtivos.pct >= LIMITES_RESUMO.produtivosVerde
                    ? "green"
                    : r.produtivos.pct >= LIMITES_RESUMO.produtivosAmarelo
                      ? "amber"
                      : "red"
                }
              >
                {pct(r.produtivos.pct)}
              </Pill>
            ) : null}
            <Variacao v={r.produtivos.variacao} sufixo="vs 30 dias atrás" />
          </Kpi>
        ) : null}
      </div>
    </Secao>
  );
}

// --- B2) Metas do mês ----------------------------------------------------------------------------------------

const NIVEIS: { k: Filtro["nivel"]; rot: string }[] = [
  { k: "empresa", rot: "Empresa" },
  { k: "equipe", rot: "Equipe" },
  { k: "corretor", rot: "Corretor" },
];
const EQ_SEM = "__sem__";

export function MetasDoMes({ base, inicial }: { base: BaseMetasMes; inicial?: Filtro }) {
  const [filtro, setFiltro] = useState<Filtro>(inicial ?? { nivel: "empresa" });
  const [equipeSel, setEquipeSel] = useState<string | null>(
    inicial?.nivel === "equipe" ? inicial.equipe : (base.equipes[0]?.id ?? null),
  );
  const m = useMemo(() => montarMetasMes(base, filtro), [base, filtro]);
  const trocar = (nivel: Filtro["nivel"]) => {
    if (nivel === "empresa") setFiltro({ nivel });
    else if (nivel === "equipe") setFiltro({ nivel, equipe: equipeSel });
    else {
      const lista = base.pessoas.filter((p) => equipeDe(base, p) === equipeSel);
      const p = (lista[0] ?? base.pessoas[0])?.userId;
      if (p) setFiltro({ nivel, pessoa: p });
    }
  };
  const verPessoa = (p: PessoaMetas) => {
    setEquipeSel(equipeDe(base, p));
    setFiltro({ nivel: "corretor", pessoa: p.userId });
  };
  const listaCorretor =
    filtro.nivel === "corretor"
      ? base.pessoas.filter((p) => equipeSel === "*" || equipeDe(base, p) === equipeSel)
      : [];
  const nomeMesAtual = nomeMes(base.mes);
  return (
    <Secao
      icon={Target}
      titulo="Metas do mês"
      desc={
        <>
          Meta × realizado de V1, V2, Captação e Vendas.{" "}
          <b className="font-semibold text-foreground">O filtro abaixo muda só este bloco</b> —
          avisos, cartões e termômetro continuam mostrando a empresa toda.
        </>
      }
      info={`Meta do mês = soma das metas dos planos ${ANO_PLANO} ASSINADOS (empresa = todos; equipe = membros). V1 e V2: meta do funil do plano (igual todo mês) × Diário de atividades. Captação: exclusivas aprovadas no mês (data de aprovação). Vendas: pontas das vendas assinadas no mês (captou = 1, vendeu = 1), a mesma unidade da meta de transações do plano. Quem não tem meta fica fora da %. O traço na barra é o ritmo esperado para hoje.`}
      testid="bloco-metas"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div
          className="inline-flex w-full overflow-hidden rounded-lg border bg-muted sm:w-auto"
          role="tablist"
          aria-label="Filtro das metas"
        >
          {NIVEIS.map((n) => (
            <button
              key={n.k}
              type="button"
              role="tab"
              aria-selected={filtro.nivel === n.k}
              onClick={() => trocar(n.k)}
              className={cn(
                "flex-1 px-4 py-1.5 text-sm text-muted-foreground sm:flex-none",
                filtro.nivel === n.k &&
                  "bg-card font-semibold text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]",
              )}
              data-testid={`filtro-${n.k}`}
            >
              {n.rot}
            </button>
          ))}
        </div>
        {filtro.nivel !== "empresa" ? (
          <select
            className="min-w-0 flex-1 rounded-md border bg-card px-2 py-1.5 text-sm sm:flex-none"
            aria-label="Equipe"
            value={equipeSel ?? EQ_SEM}
            onChange={(e) => {
              const v = e.target.value === EQ_SEM ? null : e.target.value;
              setEquipeSel(v);
              if (filtro.nivel === "equipe") setFiltro({ nivel: "equipe", equipe: v });
              else {
                const p = base.pessoas.find((x) => v === "*" || equipeDe(base, x) === v);
                if (p) setFiltro({ nivel: "corretor", pessoa: p.userId });
              }
            }}
            data-testid="sel-equipe"
          >
            {filtro.nivel === "corretor" ? <option value="*">Todas as equipes</option> : null}
            {base.equipes.map((t) => (
              <option key={t.id ?? EQ_SEM} value={t.id ?? EQ_SEM}>
                {t.nome}
              </option>
            ))}
          </select>
        ) : null}
        {filtro.nivel === "corretor" ? (
          <select
            className="min-w-0 flex-1 rounded-md border bg-card px-2 py-1.5 text-sm sm:flex-none"
            aria-label="Corretor"
            value={filtro.pessoa}
            onChange={(e) => setFiltro({ nivel: "corretor", pessoa: e.target.value })}
            data-testid="sel-corretor"
          >
            {listaCorretor.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.nome}
                {p.temMeta ? "" : " — sem meta"}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <Contexto m={m} />
      {base.previa ? (
        <p className="mb-2 text-xs text-muted-foreground">
          Prévia: o plano vale a partir de janeiro/{ANO_PLANO}. A meta mostrada é a de{" "}
          {nomeMesAtual} do plano {ANO_PLANO}.
        </p>
      ) : null}
      <SeloConferir m={m} />
      <div className="divide-y" data-testid="metas-linhas">
        {m.linhas.map((l) => (
          <LinhaMeta key={l.linha} l={l} frac={base.fracMes} semMeta={m.comMeta === 0} />
        ))}
      </div>
      <Rodape m={m} />
      {filtro.nivel === "equipe" ? <QuemEntra m={m} abrir={verPessoa} /> : null}
    </Secao>
  );
}

function equipeDe(base: BaseMetasMes, p: PessoaMetas): string | null {
  return p.teamId && base.equipes.some((t) => t.id === p.teamId) ? p.teamId : null;
}

function Contexto({ m }: { m: MetasMes }) {
  if (m.filtro.nivel === "empresa")
    return (
      <p className="mb-2 text-sm text-muted-foreground" data-testid="metas-contexto">
        <b className="text-foreground">Empresa toda</b> · meta = soma das metas de{" "}
        <b className="text-foreground">
          {m.comMeta} de {m.total}
        </b>{" "}
        pessoas
      </p>
    );
  if (m.filtro.nivel === "equipe")
    return (
      <p className="mb-2 text-sm text-muted-foreground" data-testid="metas-contexto">
        <b className="text-foreground">{m.equipe?.nome ?? "Sem equipe"}</b>
        {m.equipe?.liderNome ? ` · líder ${m.equipe.liderNome}` : ""} · meta = soma de{" "}
        <b className="text-foreground">
          {m.comMeta} de {m.total}
        </b>{" "}
        membros
      </p>
    );
  const p = m.pessoas[0];
  if (!p) return null;
  return (
    <p className="mb-2 text-sm text-muted-foreground" data-testid="metas-contexto">
      <b className="text-foreground">{p.nome}</b> · {m.equipe?.nome ?? "Sem equipe"} ·{" "}
      {p.temMeta
        ? `meta do Meu Plano ${ANO_PLANO} (assinado)`
        : ROTULO_MOTIVO[p.motivo ?? "sem_plano"]}
    </p>
  );
}

function SeloConferir({ m }: { m: MetasMes }) {
  if (m.aConferir.length === 0) return null;
  const corretor = m.filtro.nivel === "corretor";
  const primeiro = m.aConferir[0];
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
      data-testid="selo-conferir"
    >
      <Pill tom="amber">⚠ Valor a conferir</Pill>
      <span className="min-w-0 flex-1">
        {corretor
          ? "O plano deste corretor tem valor fora do comum. A meta dele pode estar inflada."
          : `A meta inclui ${m.aConferir.length} ${m.aConferir.length === 1 ? "plano" : "planos"} com valor fora do comum (${m.aConferir
              .map((x) => x.nome)
              .join(", ")}). A soma pode estar inflada.`}
      </span>
      <Link
        to="/minha-carreira/plano"
        search={{ v: "equipe", m: primeiro.userId }}
        className="font-semibold text-primary hover:underline"
      >
        Ver plano →
      </Link>
    </div>
  );
}

function LinhaMeta({ l, frac, semMeta }: { l: LinhaMetas; frac: number; semMeta: boolean }) {
  const rot = ROTULO_LINHA[l.linha];
  const vendas = l.linha === "vendas";
  return (
    <div
      className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 py-3 sm:grid-cols-[minmax(170px,230px)_190px_1fr_120px] sm:gap-4"
      data-testid={`linha-${l.linha}`}
    >
      <div className="min-w-0">
        <p className="text-[15px] font-semibold">{rot.rot}</p>
        <p className="text-xs text-muted-foreground">{rot.sub}</p>
      </div>
      <div className="text-right sm:text-left">
        <p className="tabular-nums">
          <b className="text-xl">{int(l.real)}</b>{" "}
          <span className="text-muted-foreground">
            {semMeta || l.meta == null
              ? vendas
                ? "pontas feitas"
                : "feitos"
              : `de ${int(l.meta)}${vendas ? " pontas" : ""}`}
          </span>
        </p>
        {semMeta || l.meta == null ? (
          <p className="text-[11.5px] text-muted-foreground">sem meta definida</p>
        ) : (
          <p className="text-[11.5px] text-muted-foreground">
            {l.falta && l.falta > 0 ? `faltam ${int(l.falta)}` : "meta batida ✓"}
          </p>
        )}
        {vendas && l.vendasAssinadas != null ? (
          <p className="text-[11.5px] text-muted-foreground">
            ≈ {int(l.vendasAssinadas)}{" "}
            {l.vendasAssinadas === 1 ? "venda assinada" : "vendas assinadas"} (cada venda tem 2
            pontas)
          </p>
        ) : null}
        {l.fora > 0 ? (
          <p className="text-[11.5px] text-slate-700 dark:text-slate-300">
            +{int(l.fora)} de quem não tem meta (fora da %)
          </p>
        ) : null}
      </div>
      <div className="col-span-2 sm:col-span-1">
        <div
          className={cn(
            "relative h-2.5 rounded-full bg-muted",
            (semMeta || l.meta == null) &&
              "bg-[repeating-linear-gradient(45deg,#eef0f4,#eef0f4_6px,#f7f8fa_6px,#f7f8fa_12px)]",
          )}
          title={`Traço = ritmo esperado hoje (${Math.round(frac * 100)}% do mês)`}
        >
          {l.pct != null ? (
            <div
              className={cn("h-full rounded-full", BARRA[l.tom])}
              style={{ width: `${Math.min(100, l.pct * 100)}%` }}
            />
          ) : null}
          {!(semMeta || l.meta == null) ? (
            <span
              className="absolute -top-1 h-[18px] w-0.5 rounded bg-foreground/55"
              style={{ left: `${Math.min(100, frac * 100)}%` }}
              aria-hidden
            />
          ) : null}
        </div>
      </div>
      <div className="col-span-2 flex items-center gap-2 sm:col-span-1 sm:block sm:text-right">
        <Pill tom={RITMO_TOM[l.tom]}>{l.pct != null ? pct(l.pct) : "sem meta"}</Pill>
        {l.pct != null ? (
          <p className="text-[11.5px] text-muted-foreground sm:mt-0.5">{ROTULO_RITMO[l.tom]}</p>
        ) : null}
      </div>
    </div>
  );
}

function Rodape({ m }: { m: MetasMes }) {
  const caixa =
    "mt-3 flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm leading-relaxed";
  if (m.filtro.nivel === "corretor") {
    const p = m.pessoas[0];
    if (!p) return null;
    return p.temMeta ? (
      <div
        className={cn(
          caixa,
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
        )}
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Meta do mês tirada do plano assinado. V1 e V2 vêm do Diário de atividades; captação e
          vendas, das captações aprovadas e das vendas assinadas.
        </p>
      </div>
    ) : (
      <div
        className={cn(
          caixa,
          "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
        )}
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          <b>{p.nome} está sem meta definida</b> ({ROTULO_MOTIVO[p.motivo ?? "sem_plano"]}).
          Mostramos só o que fez. Na soma da equipe e da empresa, a meta não entra e a produção
          aparece separada em “fora da %”.
          {p.admin
            ? " Conta em “Corretores produtivos”, mas não tem plano porque o administrador não usa mais “Minha carreira”."
            : ""}
        </p>
      </div>
    );
  }
  if (m.semMeta.qtd === 0)
    return (
      <div
        className={cn(
          caixa,
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
        )}
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>Todos têm meta definida.</p>
      </div>
    );
  const f = Object.fromEntries(m.linhas.map((l) => [l.linha, l.fora]));
  return (
    <div
      className={cn(
        caixa,
        "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
      )}
      data-testid="metas-fora"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p>
        <b>
          {m.semMeta.qtd} {m.semMeta.qtd === 1 ? "pessoa está" : "pessoas estão"} sem meta definida
        </b>{" "}
        ({textoMotivos(m.semMeta)}). A meta delas não entra na soma e o que elas fizeram aparece
        como “fora da %”, para a comparação ser justa (mesma regra do painel Metas {ANO_PLANO}).
        {m.comMeta > 0
          ? ` Fora da %: V1 ${f.v1 ?? 0} · V2 ${f.v2 ?? 0}${f.captacoes != null ? ` · Captação ${f.captacoes}` : ""} · Vendas ${f.vendas ?? 0} pontas.`
          : ""}
      </p>
    </div>
  );
}

function QuemEntra({ m, abrir }: { m: MetasMes; abrir: (p: PessoaMetas) => void }) {
  return (
    <details className="mt-3 text-sm" data-testid="quem-entra">
      <summary className="cursor-pointer font-semibold text-primary">
        Quem entra nesta soma ({m.total}) — toque no nome para ver a pessoa
      </summary>
      <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {m.pessoas.map((p) => (
          <li key={p.userId}>
            <button
              type="button"
              onClick={() => abrir(p)}
              className="flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left hover:border-primary/40"
            >
              <span className="min-w-0 truncate">{p.nome}</span>
              {p.temMeta && p.aConferir ? (
                <Pill tom="amber">a conferir</Pill>
              ) : p.temMeta ? (
                <Pill tom="green">com meta</Pill>
              ) : (
                <Pill tom="slate">sem meta · {ROTULO_MOTIVO[p.motivo ?? "sem_plano"]}</Pill>
              )}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

// --- C) Termômetro -------------------------------------------------------------------------------------------

const GERAL: Record<Resumo["termometro"]["geral"], [Tom, string]> = {
  verde: ["green", "🟢 Tranquilo"],
  amarelo: ["amber", "🟡 Atenção"],
  vermelho: ["red", "🔴 Risco alto"],
};

function Termometro({ r }: { r: Resumo }) {
  const [tom, rot] = GERAL[r.termometro.geral];
  return (
    <Secao
      icon={Thermometer}
      titulo="Termômetro da empresa"
      desc="Sinais da empresa inteira. Sem ranking e sem lista de pessoas."
      info={`Verde: nenhum sinal aceso. Amarelo: 1 ou 2 sinais amarelos. Vermelho: algum sinal vermelho ou 3 ou mais acesos. Meta: % da meta da direção ÷ % do mês (verde ≥ 100%, amarelo 85–99%). Estoque: exclusivas ativas hoje × 30 dias atrás (amarelo: caiu até 10%). Leads no prazo: verde ≥ 85%, amarelo 70–84%. Produtivos: verde ≥ 70%, amarelo 50–69%. Vendas paradas: até 2 verde, 3 a 5 amarelo. Sinal cinza = módulo desligado ou sem dado.`}
      testid="bloco-termometro"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Pill tom={tom}>{rot}</Pill>
        <span className="text-sm text-muted-foreground">
          {r.termometro.acesos} de {r.termometro.sinais.length} sinais acesos
        </span>
      </div>
      <ul className="mt-3 grid gap-2">
        {r.termometro.sinais.map((s) => (
          <li key={s.chave} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-full text-muted-foreground sm:w-44">{s.nome}</span>
            <Pill tom={COR_TOM[s.cor]} className="whitespace-normal text-left">
              {s.texto}
            </Pill>
          </li>
        ))}
      </ul>
    </Secao>
  );
}
