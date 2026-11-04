import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Medal, Target, TrendingUp, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import { brl } from "@/lib/exclusive-captures-dashboard";
import { periodoAtual } from "@/lib/minha-carreira";
import {
  PERIODOS,
  PORTES,
  aplicarFiltro,
  clubeDe,
  faltaParaProximo,
  fmtTransacoes,
  intervaloPeriodo,
  normalizarRankingClubes,
  porteDoTime,
  previsaoAno,
  progressoAteProximo,
  proximoClube,
  resumoEmpresa,
  rotuloIntervalo,
  rotuloPorte,
  type FaixaClube,
  type PeriodoRanking,
  type Porte,
  type RankingClubes,
} from "@/lib/ranking-clubes";
import { ListSkeleton, EmptyState } from "@/components/visual/base";
import { cn } from "@/lib/utils";
import { SeloClube } from "@/components/ranking/SeloClube";

export { SeloClube };

// Ranking e Clubes REMAX (card t_481a3f26). Usado em Minha Carreira › Conquistas (corretor) e em
// Visão Executiva › Empresa (gestor/TL/admin). A RPC carreira_ranking_clubes filtra pela imobiliária
// ativa e esconde a comissão de colegas de quem não pode vê-la.
const db = supabase as unknown as SupabaseClient;

type Estado = { data: RankingClubes | null; error: string | null };
const CARREGANDO: Estado = { data: null, error: null };

function Barra({ pct, fina }: { pct: number; fina?: boolean }) {
  return (
    <div
      className={cn("overflow-hidden rounded-full bg-muted", fina ? "h-1.5" : "h-2.5")}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Segmentado<T extends string>({
  rotulo,
  valor,
  opcoes,
  onChange,
}: {
  rotulo: string;
  valor: T;
  opcoes: { valor: T; rotulo: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </p>
      <div
        role="group"
        aria-label={rotulo}
        className="inline-flex flex-wrap gap-0.5 rounded-lg border bg-muted/40 p-0.5"
      >
        {opcoes.map((o) => (
          <button
            key={o.valor}
            type="button"
            aria-pressed={valor === o.valor}
            onClick={() => onChange(o.valor)}
            className={cn(
              "min-h-8 rounded-md px-2.5 text-sm transition-colors",
              valor === o.valor
                ? "bg-background font-semibold text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}

function useRanking(inicio: string, fim: string, chave: string, ligado = true) {
  const [estado, setEstado] = useState<Estado>(CARREGANDO);
  useEffect(() => {
    let vivo = true;
    setEstado(CARREGANDO);
    if (!ligado) return;
    db.rpc("carreira_ranking_clubes", { _inicio: inicio, _fim: fim }).then(({ data, error }) => {
      if (!vivo) return;
      setEstado(
        error
          ? { data: null, error: errorMessage(error, "Não foi possível carregar o ranking.") }
          : { data: normalizarRankingClubes(data), error: null },
      );
    });
    return () => {
      vivo = false;
    };
  }, [inicio, fim, chave, ligado]);
  return estado;
}

export function RankingClubesPainel({
  modo,
  userId,
}: {
  modo: "corretor" | "gestor";
  userId?: string;
}) {
  const hoje = useMemo(() => periodoAtual().hoje, []);
  const [periodo, setPeriodo] = useState<PeriodoRanking>("ytd");
  const [porte, setPorte] = useState<Porte | "todos">("todos");
  const [aba, setAba] = useState<"corretores" | "times">("corretores");

  const ytdInt = intervaloPeriodo("ytd", hoje);
  const perInt = intervaloPeriodo(periodo, hoje);
  const chave = userId ?? modo;
  const ytd = useRanking(ytdInt.inicio, ytdInt.fim, chave);
  const doPeriodo = useRanking(perInt.inicio, perInt.fim, `${chave}:${periodo}`, periodo !== "ytd");
  const per = periodo === "ytd" ? ytd : doPeriodo;

  const faixas = ytd.data?.faixas ?? [];
  const anoMap = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const c of ytd.data?.corretores ?? []) m.set(c.user_id, c.comissao_ano);
    return m;
  }, [ytd.data]);
  const anoTimes = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const t of ytd.data?.times ?? []) m.set(t.team_id, t.comissao_ano);
    return m;
  }, [ytd.data]);

  const erro = ytd.error ?? per.error;

  return (
    <div className="space-y-4" data-testid={`ranking-clubes-${modo}`}>
      {erro ? <p className="text-sm text-destructive">{erro}</p> : null}
      {!erro && !ytd.data ? <ListSkeleton /> : null}

      {ytd.data && modo === "corretor" ? <CartaoVoce dados={ytd.data} hoje={hoje} /> : null}
      {ytd.data && modo === "gestor" ? <ResumoGestor dados={ytd.data} /> : null}

      {ytd.data ? (
        <section className="space-y-3 rounded-lg border p-3 sm:p-4" data-testid="ranking-completo">
          <div className="flex gap-1 border-b" role="tablist" aria-label="Ranking">
            {(["corretores", "times"] as const).map((a) => (
              <button
                key={a}
                type="button"
                role="tab"
                aria-selected={aba === a}
                onClick={() => setAba(a)}
                className={cn(
                  "-mb-px min-h-9 border-b-2 px-3 text-sm",
                  aba === a
                    ? "border-primary font-semibold text-primary"
                    : "border-transparent text-muted-foreground",
                )}
              >
                {a === "corretores" ? "Corretores" : "Times"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <Segmentado rotulo="Período" valor={periodo} opcoes={PERIODOS} onChange={setPeriodo} />
            <Segmentado
              rotulo="Porte do time"
              valor={porte}
              opcoes={[
                { valor: "todos" as const, rotulo: "Todos" },
                ...PORTES.filter((p) => aba === "corretores" || p.valor !== "sem_time"),
              ]}
              onChange={setPorte}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Período: <b>{rotuloIntervalo(perInt.inicio, perInt.fim)}</b>
            {periodo === "ytd" ? " (ano até o mês)" : ""}. O clube é sempre o do ano até o mês.
          </p>
          {!per.data ? (
            per.error ? null : (
              <ListSkeleton />
            )
          ) : aba === "corretores" ? (
            <TabelaCorretores dados={per.data} faixas={faixas} anoMap={anoMap} porte={porte} />
          ) : (
            <TabelaTimes dados={per.data} faixas={faixas} anoMap={anoTimes} porte={porte} />
          )}
          <ComoContamos />
        </section>
      ) : null}
    </div>
  );
}

function CartaoVoce({ dados, hoje }: { dados: RankingClubes; hoje: string }) {
  const lista = dados.corretores;
  const i = lista.findIndex((c) => c.eu);
  const eu = i >= 0 ? lista[i] : null;
  const valor = eu?.comissao_ano ?? 0;
  const faixas = dados.faixas;
  const clube = clubeDe(valor, faixas);
  const prox = proximoClube(valor, faixas);
  const falta = faltaParaProximo(valor, faixas);
  const prev = previsaoAno(valor, hoje, dados.primeira_venda);
  const transacoes = eu ? eu.capt + eu.venda : 0;

  return (
    <section className="space-y-3 rounded-lg border bg-primary/5 p-4" data-testid="cartao-voce">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Você · Clube RE/MAX {dados.ano}</p>
        <SeloClube nome={clube?.nome ?? null} />
      </div>
      {faixas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          A imobiliária ainda não cadastrou as faixas do Clube RE/MAX.
        </p>
      ) : prox ? (
        <>
          <Barra pct={progressoAteProximo(valor, faixas)} />
          <p className="text-sm" data-testid="falta-proximo">
            Faltam <b className="text-primary">{brl(falta ?? 0)}</b> de comissão para o{" "}
            <b>{prox.nome}</b>
          </p>
        </>
      ) : (
        <p className="text-sm font-medium">Você está no clube mais alto. Parabéns!</p>
      )}
      {prev ? (
        <p className="text-xs text-muted-foreground" data-testid="previsao-ano">
          <TrendingUp className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          No ritmo atual, você fecha {dados.ano} com <b>{brl(prev.valor)}</b>
          {(() => {
            const c = clubeDe(prev.valor, faixas);
            return c && c.nome !== clube?.nome ? ` e chega no ${c.nome}.` : ".";
          })()}
          {prev.desde !== `${dados.ano}-01-01`
            ? ` (ritmo desde ${prev.desde.split("-").reverse().join("/")}, 1ª venda registrada no sistema)`
            : ""}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Dado rotulo="Comissão no ano até o mês" valor={brl(valor)} />
        <Dado
          rotulo="Posição geral"
          valor={eu ? `${i + 1}º de ${lista.length}` : "Sem vendas no ano"}
        />
        <Dado
          rotulo="Transações (capt. + venda)"
          valor={fmtTransacoes(transacoes)}
          detalhe={
            eu ? `Capt. ${fmtTransacoes(eu.capt)} · Venda ${fmtTransacoes(eu.venda)}` : undefined
          }
        />
      </div>
    </section>
  );
}

function Dado({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="min-w-0 rounded-md bg-background p-2.5">
      <p className="text-[11px] text-muted-foreground">{rotulo}</p>
      <p className="text-base font-semibold tabular-nums">{valor}</p>
      {detalhe ? <p className="text-[11px] text-muted-foreground">{detalhe}</p> : null}
    </div>
  );
}

function ResumoGestor({ dados }: { dados: RankingClubes }) {
  const r = resumoEmpresa(dados.corretores, dados.faixas);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="resumo-clubes">
      <div className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">Comissão da empresa (ano até o mês)</p>
        <p className="text-xl font-bold tabular-nums">{brl(r.total)}</p>
      </div>
      <div className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">Corretores em algum clube</p>
        <p className="text-xl font-bold">
          {r.comClube} de {r.corretores}
        </p>
      </div>
      <div className="rounded-lg border p-3" data-testid="perto-de-subir">
        <p className="text-xs text-muted-foreground">Perto de subir de clube (falta &lt; 12%)</p>
        <p className="text-xl font-bold">{r.perto.length}</p>
        <p className="text-xs text-muted-foreground">
          {r.perto.map((c) => c.nome.split(" ")[0]).join(", ") || "—"}
        </p>
      </div>
      <div className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">Por clube</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {r.porClube.length ? (
            r.porClube.map((x) => (
              <SeloClube key={x.clube.nome} nome={x.clube.nome} extra={String(x.n)} />
            ))
          ) : (
            <span className="text-sm text-muted-foreground">Ninguém em clube ainda</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Posicao({ geral, filtro }: { geral: number; filtro: number | null }) {
  return filtro != null ? (
    <span className="whitespace-nowrap">
      <b className="text-base">{filtro}º</b>{" "}
      <span className="text-xs text-muted-foreground">no filtro · {geral}º geral</span>
    </span>
  ) : (
    <b className="text-base">{geral}º</b>
  );
}

function ProximoMini({ valor, faixas }: { valor: number | null; faixas: FaixaClube[] }) {
  if (valor == null || faixas.length === 0)
    return <span className="text-xs text-muted-foreground">—</span>;
  const prox = proximoClube(valor, faixas);
  if (!prox) return <span className="text-xs text-muted-foreground">Clube mais alto</span>;
  return (
    <div className="min-w-[8.5rem] space-y-1">
      <Barra fina pct={progressoAteProximo(valor, faixas)} />
      <p className="text-[11px] text-muted-foreground">
        faltam {brl(faltaParaProximo(valor, faixas) ?? 0)} p/ {prox.nome}
      </p>
    </div>
  );
}

function TabelaCorretores({
  dados,
  faixas,
  anoMap,
  porte,
}: {
  dados: RankingClubes;
  faixas: FaixaClube[];
  anoMap: Map<string, number | null>;
  porte: Porte | "todos";
}) {
  const { linhas, total } = aplicarFiltro(
    dados.corretores,
    porte === "todos" ? null : (c) => porteDoTime(c.tamanho_time) === porte,
  );
  if (dados.corretores.length === 0)
    return <EmptyState icon={Medal}>Ninguém tem venda assinada neste período.</EmptyState>;
  if (linhas.length === 0)
    return <EmptyState icon={Users}>Nenhum corretor nesse porte de time.</EmptyState>;
  return (
    <div data-testid="tabela-corretores">
      <p className="mb-2 text-xs text-muted-foreground">
        {porte === "todos"
          ? `${total} corretor(es)`
          : `${linhas.length} no filtro · ${total} no geral`}
        {!dados.valores_visiveis ? " · nesta imobiliária você vê só a sua comissão" : ""}
      </p>
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
              <th className="py-2 pr-2 font-semibold">Posição</th>
              <th className="py-2 pr-2 font-semibold">Corretor</th>
              <th className="py-2 pr-2 font-semibold">Clube (ano até o mês)</th>
              <th className="py-2 pr-2 text-right font-semibold">Comissão do período</th>
              <th className="py-2 pr-2 text-right font-semibold">Transações</th>
              <th className="py-2 pl-4 font-semibold">Próximo clube</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((c) => {
              const ano = anoMap.get(c.user_id) ?? c.comissao_ano;
              const clube = ano == null ? undefined : (clubeDe(ano, faixas)?.nome ?? null);
              return (
                <tr
                  key={c.user_id}
                  data-testid="linha-corretor"
                  className={cn("border-b last:border-0", c.eu && "bg-primary/5")}
                >
                  <td className="py-2 pr-2">
                    <Posicao geral={c.posicao} filtro={c.posicaoFiltro} />
                  </td>
                  <td className="py-2 pr-2">
                    <p className="font-medium">
                      {c.nome}
                      {c.eu ? <span className="text-muted-foreground"> (você)</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {c.team_nome ?? "Sem time"} · {rotuloPorte(porteDoTime(c.tamanho_time))}
                    </p>
                  </td>
                  <td className="py-2 pr-2">
                    {clube === undefined ? "—" : <SeloClube nome={clube} />}
                  </td>
                  <td className="py-2 pr-2 text-right font-semibold tabular-nums">
                    {c.comissao == null ? "—" : brl(c.comissao)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    <b>{fmtTransacoes(c.capt + c.venda)}</b>
                    <p className="text-[11px] text-muted-foreground">
                      Capt. {fmtTransacoes(c.capt)} · Venda {fmtTransacoes(c.venda)}
                    </p>
                  </td>
                  <td className="py-2 pl-4">
                    <ProximoMini valor={ano} faixas={faixas} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden">
        {linhas.map((c) => {
          const ano = anoMap.get(c.user_id) ?? c.comissao_ano;
          const clube = ano == null ? undefined : (clubeDe(ano, faixas)?.nome ?? null);
          return (
            <li
              key={c.user_id}
              data-testid="cartao-corretor"
              className={cn("space-y-2 rounded-lg border p-3", c.eu && "bg-primary/5")}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Posicao geral={c.posicao} filtro={c.posicaoFiltro} />
                  <p className="truncate font-medium">
                    {c.nome}
                    {c.eu ? <span className="text-muted-foreground"> (você)</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.team_nome ?? "Sem time"} · {rotuloPorte(porteDoTime(c.tamanho_time))}
                  </p>
                </div>
                {clube === undefined ? null : <SeloClube nome={clube} />}
              </div>
              <div className="flex justify-between text-sm">
                <span>
                  Comissão: <b>{c.comissao == null ? "—" : brl(c.comissao)}</b>
                </span>
                <span className="text-right">
                  <b>{fmtTransacoes(c.capt + c.venda)}</b> transações
                  <span className="block text-[11px] text-muted-foreground">
                    Capt. {fmtTransacoes(c.capt)} · Venda {fmtTransacoes(c.venda)}
                  </span>
                </span>
              </div>
              <ProximoMini valor={ano} faixas={faixas} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TabelaTimes({
  dados,
  faixas,
  anoMap,
  porte,
}: {
  dados: RankingClubes;
  faixas: FaixaClube[];
  anoMap: Map<string, number | null>;
  porte: Porte | "todos";
}) {
  const { linhas, total } = aplicarFiltro(
    dados.times,
    porte === "todos" ? null : (t) => porteDoTime(t.tamanho_time) === porte,
  );
  if (dados.times.length === 0)
    return <EmptyState icon={Users}>Nenhum time com venda neste período.</EmptyState>;
  if (linhas.length === 0) return <EmptyState icon={Users}>Nenhum time nesse porte.</EmptyState>;
  return (
    <div data-testid="tabela-times">
      <p className="mb-2 text-xs text-muted-foreground">
        {porte === "todos" ? `${total} time(s)` : `${linhas.length} no filtro · ${total} no geral`}
        {" · "}tamanho no fim do período, líder incluído
      </p>
      <ul className="divide-y">
        {linhas.map((t) => {
          const ano = anoMap.get(t.team_id) ?? t.comissao_ano;
          return (
            <li
              key={t.team_id}
              data-testid="linha-time"
              className="grid gap-2 py-2 sm:grid-cols-[minmax(0,1.4fr)_auto_auto_minmax(8.5rem,1fr)] sm:items-center"
            >
              <div className="min-w-0">
                <Posicao geral={t.posicao} filtro={t.posicaoFiltro} />{" "}
                <span className="font-medium">{t.nome}</span>
                <p className="text-xs text-muted-foreground">
                  {rotuloPorte(porteDoTime(t.tamanho_time))} · {t.tamanho_time} pessoa(s)
                </p>
              </div>
              <div>
                {ano == null ? "—" : <SeloClube nome={clubeDe(ano, faixas)?.nome ?? null} />}
              </div>
              <div className="text-sm tabular-nums sm:text-right">
                <b>{t.comissao == null ? "—" : brl(t.comissao)}</b>
                <p className="text-[11px] text-muted-foreground">
                  {fmtTransacoes(t.capt + t.venda)} transações
                </p>
              </div>
              <ProximoMini valor={ano} faixas={faixas} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ComoContamos() {
  return (
    <details
      className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground"
      data-testid="como-contamos"
    >
      <summary className="cursor-pointer font-semibold text-foreground">
        <Target className="mr-1 inline h-3.5 w-3.5" aria-hidden />
        Como contamos (regra REMAX Brasil)
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        <li>
          <b>Comissão</b>: sua comissão como corretor (captação e venda) nas vendas válidas, pelo
          mês da assinatura. Não entra o que você ganhou como líder, gestor ou indicação.
        </li>
        <li>
          <b>Clube</b>: comissão de janeiro até o mês atual (ano até o mês). Executive R$ 167.224 ·
          100% R$ 334.448 · Platinum R$ 836.120 · Chairman&apos;s R$ 1.672.241 · Titan R$ 2.508.361
          · Diamond R$ 3.344.482 · Pinnacle R$ 6.688.963.
        </li>
        <li>
          <b>Transações</b>: no máximo 2 por negócio (1 lado captação + 1 lado venda), divididas
          igualmente entre os corretores do lado. Ex.: Ana captou sozinha e Bruno e Carla venderam →
          Ana 1 · Bruno 0,5 · Carla 0,5.
        </li>
        <li>
          <b>Porte do time</b> (tamanho no fim do período, líder incluído): Micro até 2 · Pequeno
          3–5 · Médio 6–10 · Grande 11+. O time soma cada venda no time em que a pessoa estava na
          data da venda.
        </li>
      </ul>
      <p className="mt-2">
        Fonte: ranking.minharemax.com/conceitos (Comitê de Dados REMAX Brasil).
      </p>
    </details>
  );
}
