import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { CheckCircle2, NotebookPen, Target, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import { dataCivilSaoPaulo } from "@/lib/hoje-sao-paulo";
import { brl } from "@/lib/exclusive-captures-dashboard";
import { normalizarRealizado, periodoAtual, type Realizado } from "@/lib/minha-carreira";
import { meuPlanoEnabled, planoDb } from "@/lib/meu-plano-2027/modulo";
import { ANO_PLANO } from "@/lib/meu-plano-2027/telas";
import type { Respostas, TaxasFunil } from "@/lib/meu-plano-2027/regras";
import {
  FAROL_META_ROTULO,
  larguraBarra,
  montarPainelCorretor,
  type AvaliacaoIndicador,
  type CaptacaoCorretor,
  type ComissaoVendaCorretor,
  type FarolMeta,
  type PainelCorretor,
} from "@/lib/metas-2027";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ListSkeleton, Pill, type Tom } from "@/components/visual/base";
import { lerTaxasPadrao } from "./Diario";
import type { ChaveExplicacao } from "@/lib/metas-2027/explicacoes";
import { InfoDica, RotuloInfo } from "@/components/metas-2027/InfoDica";
import { ContextoInfo } from "@/components/metas-2027/contexto-info";
import { contaNaMeta, type MetaOficialGravada } from "@/lib/metas-2027/consolidado";

// Painéis de metas 2027 — ETAPA 2 (cartão t_2fa76ce2, Denis 19/11): painel do corretor. SUBSTITUI o "Meu mês".
// A tela não faz conta: tudo sai de montarPainelCorretor() (src/lib/metas-2027). O banco garante que só vêm
// dados do próprio corretor na imobiliária ativa: carreira_plano (RLS), meu_realizado e minha_comissao_vendas
// (auth.uid() + current_org_id()), exclusive_captures (RLS) e carreira_anotacoes (RLS: dono grava).
// minha_comissao_vendas devolve só a parte do corretor e o que foi descontado DELE (nunca a bruta da venda).
const db = supabase as unknown as SupabaseClient;

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MES_LONGO = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${MES[Number(iso.slice(5, 7)) - 1]}`;
const dataBR = (iso: string) => iso.split("-").reverse().join("/");
const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const TOM_FAROL: Record<FarolMeta, Tom> = {
  verde: "green",
  amarelo: "amber",
  vermelho: "red",
  cinza: "slate",
  aguardando: "slate",
};

type Anotacao = {
  id: string;
  texto: string;
  proximo_passo: string | null;
  proximo_passo_em: string | null;
  created_at: string;
};

type Dados = {
  painel: PainelCorretor;
  /** Realizado do ano/mês corrente (meu_realizado) — usado só antes de jan/2027. */
  agora: { ano: Realizado; mes: Realizado };
};

export function PainelMetasCorretor({ userId }: { userId: string }) {
  const p = useMemo(() => periodoAtual(), []);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    // userId vai no filtro da consulta: só aceita formato de uuid (a RLS continua valendo de qualquer jeito).
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
      setErro("Não foi possível carregar o seu painel de metas.");
      return;
    }
    const antes = p.hoje < `${ANO_PLANO}-01-01`;
    // Antes de jan/2027 a lista e os números são do ano corrente; depois, do ano do plano.
    const iniAno = antes ? p.ano : `${ANO_PLANO}-01-01`;
    const fimAno = antes ? p.fimAno : `${ANO_PLANO}-12-31`;
    const [ra, rm, vs, caps] = await Promise.all([
      db.rpc("meu_realizado", { _inicio: iniAno, _fim: fimAno }),
      db.rpc("meu_realizado", { _inicio: p.mes, _fim: p.fimMes }),
      db.rpc("minha_comissao_vendas", { _inicio: iniAno, _fim: fimAno }),
      db
        .from("exclusive_captures")
        .select(
          "id,signed_on,captor_id,captador_original_id,tipo:form_data->imovel->>tipo_imovel,bairro:form_data->imovel->>bairro",
        )
        .eq("status", "aprovada")
        .is("discarded_at", null)
        .or(`captor_id.eq.${userId},captador_original_id.eq.${userId}`),
    ]);
    const e = ra.error ?? rm.error ?? vs.error ?? caps.error;
    if (e) {
      setErro(errorMessage(e, "Não foi possível carregar o seu painel de metas."));
      return;
    }
    // Captação conta para o captador original (mesma regra de meu_realizado).
    type CapRow = {
      id: string;
      signed_on: string | null;
      captor_id: string;
      captador_original_id: string | null;
      tipo: string | null;
      bairro: string | null;
    };
    const minhas = ((caps.data ?? []) as CapRow[]).filter(
      (c) => (c.captador_original_id ?? c.captor_id) === userId,
    );
    const hist = minhas.length
      ? await db
          .from("exclusive_history")
          .select("capture_id,created_at")
          .eq("action", "aprovar")
          .in(
            "capture_id",
            minhas.map((c) => c.id),
          )
      : { data: [], error: null };
    if (hist.error) {
      setErro(errorMessage(hist.error, "Não foi possível carregar as suas captações."));
      return;
    }
    const aprov = new Map<string, string[]>();
    for (const h of (hist.data ?? []) as { capture_id: string; created_at: string }[])
      aprov.set(h.capture_id, [...(aprov.get(h.capture_id) ?? []), h.created_at]);
    const captacoes: CaptacaoCorretor[] = minhas.map((c) => ({
      id: c.id,
      signedOn: c.signed_on,
      aprovacoes: aprov.get(c.id) ?? [],
      imovel:
        [c.tipo, c.bairro]
          .map((x) => x?.trim())
          .filter(Boolean)
          .join(" · ") || null,
    }));

    let plano: Parameters<typeof montarPainelCorretor>[0]["plano"] = null;
    let padrao: TaxasFunil | null = null;
    if (await meuPlanoEnabled()) {
      const [pl, tx] = await Promise.all([
        planoDb
          .from("carreira_plano")
          .select("respostas,assinado_corretor_em,meta_oficial,meta_oficial_em")
          .eq("user_id", userId)
          .eq("ano", ANO_PLANO)
          .maybeSingle(),
        lerTaxasPadrao(),
      ]);
      // Erro ao ler o plano não pode virar "sem plano" em silêncio.
      if (pl.error) {
        setErro(errorMessage(pl.error, "Não foi possível carregar o seu Meu Plano 2027."));
        return;
      }
      const row = pl.data as {
        respostas?: Respostas;
        assinado_corretor_em?: string | null;
        meta_oficial?: MetaOficialGravada | null;
        meta_oficial_em?: string | null;
      } | null;
      plano = row
        ? {
            respostas: row.respostas,
            assinadoEm: row.assinado_corretor_em,
            metaOficial: row.meta_oficial,
            metaOficialEm: row.meta_oficial_em,
          }
        : null;
      padrao = tx;
    }
    const first = (x: unknown) => (Array.isArray(x) ? x[0] : x) as Record<string, unknown>;
    const ano = normalizarRealizado(first(ra.data));
    const mes = normalizarRealizado(first(rm.data));
    const painel = montarPainelCorretor({
      userId,
      hoje: p.hoje,
      plano,
      padrao,
      vendas: ((vs.data ?? []) as ComissaoVendaCorretor[]).map((v) => ({
        ...v,
        lados: Number(v.lados),
        vgv: Number(v.vgv),
        minha_parte: Number(v.minha_parte),
        indicador: Number(v.indicador),
        extras: Number(v.extras),
        descontado: Number(v.descontado),
      })),
      captacoesContagem: { ano: ano.captacoes, mes: mes.captacoes },
      captacoes,
    });
    setDados({ painel, agora: { ano, mes } });
  }, [p, userId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Target className="h-5 w-5" aria-hidden /> Meu painel de metas {ANO_PLANO}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          A meta vem da meta oficial do seu Meu Plano {ANO_PLANO}. O realizado entra sozinho pelas
          suas vendas e captações no sistema.
        </p>
      </CardHeader>
      <CardContent className="space-y-4" data-testid="painel-metas-corretor">
        {erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : !dados ? (
          <ListSkeleton />
        ) : (
          <ContextoInfo.Provider
            value={{
              ano: dados.painel.pos.fase === "antes" ? Number(p.hoje.slice(0, 4)) : ANO_PLANO,
              anoPlano: ANO_PLANO,
            }}
          >
            <Conteudo dados={dados} />
          </ContextoInfo.Provider>
        )}
        <Anotacoes userId={userId} />
      </CardContent>
    </Card>
  );
}

function Conteudo({ dados }: { dados: Dados }) {
  const { painel, agora } = dados;
  const { avaliacao, pos, situacao, selo } = painel;
  // Conta na meta (t_bd480fee): assinado OU meta oficial gravada em "Usar como minha meta oficial".
  const temMeta = contaNaMeta(selo);
  const c = avaliacao.indicadores.comissao;
  const mesNome = MES_LONGO[pos.mes - 1];
  const farol = (
    <Pill tom={TOM_FAROL[avaliacao.farol]} className="text-sm">
      {FAROL_META_ROTULO[avaliacao.farol]}
    </Pill>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" data-testid="farol-meta">
        <span className="inline-flex items-center gap-0.5">
          {farol}
          <InfoDica chave="corretor_farol" />
        </span>
        {avaliacao.farol === "verde" ||
        avaliacao.farol === "amarelo" ||
        avaliacao.farol === "vermelho" ? (
          <span className="text-xs text-muted-foreground">
            comparado ao que deveria estar feito até hoje ({pct(c.pctEsperado)})
          </span>
        ) : null}
      </div>

      {painel.aConferir.length ? (
        <div
          className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          data-testid="corretor-a-conferir"
        >
          <RotuloInfo chave="corretor_a_conferir">⚠ Seu plano tem valor a conferir:</RotuloInfo>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {painel.aConferir.map((a) => (
              <li key={a.campo + a.msg}>{a.msg}</li>
            ))}
          </ul>
          <Link to="/minha-carreira/plano" className="font-semibold underline">
            Abrir o plano
          </Link>
        </div>
      ) : null}

      {selo === "conta_falta_assinar" ? (
        <p
          className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          data-testid="falta-assinar"
        >
          Sua meta oficial já conta na meta da equipe. Falta assinar o pacto no Meu Plano.{" "}
          <Link to="/minha-carreira/plano" className="font-semibold underline">
            Abrir o plano
          </Link>
        </p>
      ) : null}

      {!temMeta ? (
        <EmptyState icon={Target}>
          {selo === "meta_a_conferir"
            ? `Sua meta oficial gravada está fora do limite (${painel.motivoMetaAConferir}) e não conta na meta da equipe. Corrija o plano e clique de novo em "Usar como minha meta oficial".`
            : situacao === "assinado"
              ? 'Seu plano está assinado, mas a meta oficial não foi gravada. Peça ao seu gestor para reabrir o plano e grave a meta em "Usar como minha meta oficial".'
              : situacao === "preenchimento"
                ? 'Seu Meu Plano 2027 ainda está em preenchimento. A meta entra aqui quando você clicar em "Usar como minha meta oficial" ou assinar.'
                : 'Você ainda não tem o Meu Plano 2027. A meta entra aqui quando você gravar a meta oficial ("Usar como minha meta oficial") ou assinar.'}{" "}
          <Link to="/minha-carreira/plano" className="underline">
            Abrir o plano
          </Link>
        </EmptyState>
      ) : null}

      {pos.fase === "antes" ? (
        <div className="space-y-2 rounded-lg border p-3" data-testid="antes-vigencia">
          <p className="text-sm">
            {temMeta
              ? `Sua meta de ${ANO_PLANO} é ${brl(c.metaAno ?? 0)} de comissão. A contagem começa em 1º de janeiro.`
              : `As metas valem a partir de janeiro de ${ANO_PLANO}.`}
            {temMeta ? <InfoDica chave="corretor_meta_ano_antes" /> : null}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi
              label="Comissão no mês"
              info="corretor_antes_comissao_mes"
              value={brl(agora.mes.comissao)}
            />
            <Kpi
              label="Vendas no mês"
              info="corretor_antes_vendas_mes"
              value={String(agora.mes.vendas)}
            />
            <Kpi
              label="Comissão no ano"
              info="corretor_antes_comissao_ano"
              value={brl(agora.ano.comissao)}
            />
            <Kpi
              label="Vendas no ano"
              info="corretor_antes_vendas_ano"
              value={String(agora.ano.vendas)}
            />
          </div>
        </div>
      ) : temMeta ? (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <BarraGrande
              testid="barra-ano"
              titulo={`🎯 Meta do ano ${ANO_PLANO}`}
              info="corretor_barra_ano"
              feito={c.realAno}
              alvo={c.metaAno}
              esperado={c.esperado}
              rodape={
                c.diferenca == null ? null : (
                  <>
                    Hoje deveria estar em <b>{brl(c.esperado ?? 0)}</b> ·{" "}
                    <b className={c.diferenca >= 0 ? "text-emerald-700" : "text-rose-700"}>
                      {c.diferenca >= 0
                        ? `${brl(c.diferenca)} à frente`
                        : `${brl(-c.diferenca)} atrás`}
                    </b>
                    <InfoDica chave="corretor_ritmo" />
                  </>
                )
              }
            />
            <BarraGrande
              testid="barra-mes"
              titulo={`📅 Meta de ${mesNome}`}
              info="corretor_barra_mes"
              feito={c.realMes}
              alvo={c.metaMes}
              rodape={
                c.faltaMes == null ? null : (
                  <span data-testid="falta-mes">
                    Falta no mês: <b>{brl(c.faltaMes)}</b> · por semana:{" "}
                    <b>{brl(c.faltaSemana ?? 0)}</b> ({pos.semanasRestantes}{" "}
                    {pos.semanasRestantes === 1 ? "semana restante" : "semanas restantes"})
                    <InfoDica chave="corretor_falta_mes" />
                  </span>
                )
              }
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="barras-menores">
            <BarraMenor
              titulo="Vendas no ano"
              info="corretor_vendas_ano"
              a={avaliacao.indicadores.vendas}
              fmt={String}
            />
            <BarraMenor
              titulo="Captações no ano"
              info="corretor_captacoes_ano"
              a={avaliacao.indicadores.captacoes}
              fmt={String}
            />
            <BarraMenor
              titulo="VGV no ano"
              info="corretor_vgv_ano"
              a={avaliacao.indicadores.vgv}
              fmt={brl}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            A meta do mês segue a distribuição que você fez no plano. Vendas conta captação + venda,
            como no plano.
          </p>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Comissão no ano" info="corretor_comissao_ano" value={brl(c.realAno)} />
          <Kpi label="Comissão no mês" info="corretor_comissao_mes" value={brl(c.realMes)} />
          <Kpi
            label="Vendas no ano"
            info="corretor_vendas_ano"
            value={String(avaliacao.indicadores.vendas.realAno)}
          />
          <Kpi
            label="Captações no ano"
            info="corretor_captacoes_ano"
            value={
              avaliacao.indicadores.captacoes.realAno == null
                ? "–"
                : String(avaliacao.indicadores.captacoes.realAno)
            }
          />
        </div>
      )}

      <Cumpridas painel={painel} />
    </div>
  );
}

function BarraGrande(props: {
  testid: string;
  titulo: string;
  info: ChaveExplicacao;
  feito: number;
  alvo: number | null;
  esperado?: number | null;
  rodape: React.ReactNode;
}) {
  const b = larguraBarra(props.feito, props.alvo, props.esperado);
  return (
    <div className="space-y-2 rounded-lg border p-3" data-testid={props.testid}>
      <p className="text-sm font-semibold text-muted-foreground">
        <RotuloInfo chave={props.info}>{props.titulo}</RotuloInfo>
      </p>
      <p className="text-2xl font-bold">
        {brl(props.feito)}{" "}
        <span className="text-sm font-normal text-muted-foreground">
          de {props.alvo == null ? "–" : brl(props.alvo)}
        </span>
      </p>
      <div
        className="relative h-4 rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(b.pct)}
        aria-label={props.titulo}
      >
        <div
          className={`h-4 rounded-full ${b.pct >= 100 ? "bg-emerald-500" : "bg-primary"}`}
          style={{ width: `${b.pct}%` }}
        />
        {b.marca != null ? (
          <div
            className="absolute -top-1 h-6 w-0.5 bg-slate-700"
            style={{ left: `${b.marca}%` }}
            title="Onde deveria estar hoje"
          />
        ) : null}
      </div>
      {props.rodape ? <p className="text-xs text-muted-foreground">{props.rodape}</p> : null}
    </div>
  );
}

function BarraMenor(props: {
  titulo: string;
  info: ChaveExplicacao;
  a: AvaliacaoIndicador;
  fmt: (n: number) => string;
}) {
  const { a } = props;
  const b = larguraBarra(a.realAno, a.metaAno, a.esperado);
  return (
    <div className="space-y-1 rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">
        <RotuloInfo chave={props.info}>{props.titulo}</RotuloInfo>
      </p>
      <p className="text-base font-semibold">
        {props.fmt(a.realAno)}
        <span className="text-xs font-normal text-muted-foreground">
          {" "}
          / {a.metaAno == null ? "sem meta" : props.fmt(a.metaAno)}
        </span>
      </p>
      <div className="h-2 rounded-full bg-muted" aria-hidden>
        <div className="h-2 rounded-full bg-blue-500" style={{ width: `${b.pct}%` }} />
      </div>
    </div>
  );
}

function Kpi({ label, value, info }: { label: string; value: string; info: ChaveExplicacao }) {
  return (
    <div className="min-w-0 rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">
        <RotuloInfo chave={info}>{label}</RotuloInfo>
      </p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function Cumpridas({ painel }: { painel: PainelCorretor }) {
  const { cumpridas, totalAno } = painel;
  return (
    <div className="space-y-2 border-t pt-3" data-testid="cumpridas">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> Cumpridas (entram
        sozinhas)
      </h3>
      {cumpridas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma venda assinada ou captação aprovada neste ano ainda. Quando houver, ela aparece
          aqui com a data e o imóvel.
        </p>
      ) : (
        <ul className="divide-y">
          {cumpridas.map((x, i) => (
            <li key={`${x.tipo}-${x.data}-${i}`} className="flex gap-3 py-2 text-sm">
              <span className="w-12 shrink-0 text-xs text-muted-foreground">
                {dataCurta(x.data)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {x.tipo === "venda" ? "🏠 Venda" : "📌 Captação"}
                  {x.tipo === "venda" && x.papel ? (
                    <span className="font-normal text-muted-foreground"> · {x.papel}</span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {x.imovel}
                  {x.tipo === "venda" && x.codigo ? ` · ${x.codigo}` : ""}
                </p>
                {x.tipo === "venda" ? (
                  <p className="text-xs" data-testid="comissao-venda">
                    <RotuloInfo chave="corretor_sua_parte">Sua parte:</RotuloInfo>{" "}
                    <b>{brl(x.comissao.suaParte)}</b>
                    {x.comissao.descontadoDeVoce.total > 0 ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · descontado de você: {brl(x.comissao.descontadoDeVoce.total)}
                        {x.comissao.descontadoDeVoce.indicador > 0
                          ? ` (indicador ${brl(x.comissao.descontadoDeVoce.indicador)}`
                          : " ("}
                        {x.comissao.descontadoDeVoce.extras > 0
                          ? `${x.comissao.descontadoDeVoce.indicador > 0 ? ", " : ""}extras ${brl(x.comissao.descontadoDeVoce.extras)}`
                          : ""}
                        )
                        <InfoDica chave="corretor_descontado" />
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {totalAno.suaParte > 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="total-comissao">
          Sua comissão no ano: <b>{brl(totalAno.suaParte)}</b>
          {totalAno.descontado > 0
            ? ` · descontado de você (indicador/extras): ${brl(totalAno.descontado)}`
            : ""}
          <InfoDica chave="corretor_total_ano" />
        </p>
      ) : null}
    </div>
  );
}

function Anotacoes({ userId }: { userId: string }) {
  const [lista, setLista] = useState<Anotacao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [passo, setPasso] = useState("");
  const [quando, setQuando] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const r = await db
      .from("carreira_anotacoes")
      .select("id,texto,proximo_passo,proximo_passo_em,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (r.error) {
      setErro(errorMessage(r.error, "Não foi possível carregar as suas anotações."));
      return;
    }
    setErro(null);
    setLista((r.data ?? []) as Anotacao[]);
  }, [userId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar() {
    const t = texto.trim();
    if (!t) {
      toast.error("Escreva a anotação.");
      return;
    }
    if (t.length > 2000 || passo.trim().length > 300) {
      toast.error("Texto muito longo (anotação até 2000 letras; próximo passo até 300).");
      return;
    }
    setSalvando(true);
    const r = await db.from("carreira_anotacoes").insert({
      texto: t,
      proximo_passo: passo.trim() || null,
      proximo_passo_em: quando || null,
    });
    setSalvando(false);
    if (r.error) {
      toast.error(errorMessage(r.error, "Não foi possível salvar a anotação."));
      return;
    }
    setTexto("");
    setPasso("");
    setQuando("");
    toast.success("Anotação salva");
    await carregar();
  }

  async function apagar(id: string) {
    const r = await db.from("carreira_anotacoes").delete().eq("id", id);
    if (r.error) {
      toast.error(errorMessage(r.error, "Não foi possível apagar a anotação."));
      return;
    }
    await carregar();
  }

  return (
    <div className="space-y-3 border-t pt-3" data-testid="anotacoes">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <NotebookPen className="h-4 w-4" aria-hidden /> Minhas anotações (não alteram a meta)
      </h3>
      <p className="text-xs text-muted-foreground">
        Só você escreve. O seu gestor ou Team Leader e o administrador conseguem ler.
      </p>
      <div className="space-y-2">
        <div className="space-y-1">
          <Label htmlFor="an-texto">O que fiz / com quem falei</Label>
          <Textarea
            id="an-texto"
            value={texto}
            maxLength={2000}
            onChange={(e) => setTexto(e.target.value)}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
          <div className="space-y-1">
            <Label htmlFor="an-passo">Próximo passo</Label>
            <Input
              id="an-passo"
              value={passo}
              maxLength={300}
              onChange={(e) => setPasso(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="an-quando">Data do próximo passo</Label>
            <Input
              id="an-quando"
              type="date"
              value={quando}
              onChange={(e) => setQuando(e.target.value)}
            />
          </div>
        </div>
        <Button size="sm" disabled={salvando} onClick={salvar}>
          {salvando ? "Salvando…" : "Salvar anotação"}
        </Button>
      </div>
      {erro ? (
        <p className="text-sm text-destructive">{erro}</p>
      ) : !lista ? (
        <ListSkeleton rows={2} />
      ) : lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma anotação ainda.</p>
      ) : (
        <ul className="space-y-2">
          {lista.map((a) => (
            <li key={a.id} className="rounded-md border p-2 text-sm" data-testid="anotacao">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    {dataBR(dataCivilSaoPaulo(a.created_at) ?? a.created_at.slice(0, 10))}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{a.texto}</p>
                  {a.proximo_passo || a.proximo_passo_em ? (
                    <p className="mt-1 text-xs">
                      ➡️ {a.proximo_passo ?? "Próximo passo"}
                      {a.proximo_passo_em ? ` · ${dataBR(a.proximo_passo_em)}` : ""}
                    </p>
                  ) : null}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Apagar anotação"
                  onClick={() => apagar(a.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
