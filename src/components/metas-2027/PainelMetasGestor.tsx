import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlarmClock, ChevronRight, NotebookPen, Target, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import { brl } from "@/lib/exclusive-captures-dashboard";
import { ANO_PLANO } from "@/lib/meu-plano-2027/telas";
import type { TaxasFunil } from "@/lib/meu-plano-2027/regras";
import {
  FAROL_META_ROTULO,
  larguraBarra,
  montarPainelGestor,
  normalizarPlanosRpc,
  normalizarRealizadoRpc,
  periodosDoPainel,
  type AlertaParado,
  type AnotacaoLida,
  type AvaliacaoIndicador,
  type CartaoCorretor,
  type FarolMeta,
  type GrupoPainel,
  type PainelGestor,
} from "@/lib/metas-2027";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ListSkeleton, Pill, type Tom } from "@/components/visual/base";
import { lerTaxasPadrao } from "@/components/minha-carreira/Diario";

// Painéis de metas 2027 — ETAPA 3 (cartão t_863b7590, Denis 20/11): painel do gestor/broker/Team Leader.
// Tela NOVA: não altera o Painel da Equipe nem o Farol. A tela não faz conta: tudo sai de montarPainelGestor()
// (src/lib/metas-2027). O banco decide o escopo: metas_equipe_planos/metas_equipe_realizado devolvem só as
// equipes que quem chama pode ver (broker/gestor/admin = imobiliária inteira; TL = a dele) e recusam o corretor.
// Anotações: carreira_anotacoes, só leitura (RLS: líder da equipe e admin leem).
const db = supabase as unknown as SupabaseClient;

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${MES[Number(iso.slice(5, 7)) - 1]}`;
const TOM_FAROL: Record<FarolMeta, Tom> = {
  verde: "green",
  amarelo: "amber",
  vermelho: "red",
  cinza: "slate",
  aguardando: "slate",
};
const ROTULO_PLANO = {
  assinado: "✅ assinado",
  preenchimento: "📝 em preenchimento",
  sem_plano: "— sem plano",
} as const;
const TODAS = "__todas__";

export function PainelMetasGestor() {
  const hoje = useMemo(() => hojeSaoPaulo(), []);
  const [painel, setPainel] = useState<PainelGestor | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sel, setSel] = useState<string>(TODAS);

  const carregar = useCallback(async () => {
    const per = periodosDoPainel(hoje);
    const [pl, ra, r12] = await Promise.all([
      db.rpc("metas_equipe_planos", { _ano: ANO_PLANO }),
      db.rpc("metas_equipe_realizado", { _inicio: per.ano.inicio, _fim: per.ano.fim }),
      db.rpc("metas_equipe_realizado", {
        _inicio: per.ultimos12.inicio,
        _fim: per.ultimos12.fim,
      }),
    ]);
    const e = pl.error ?? ra.error ?? r12.error;
    if (e) {
      setErro(
        e.code === "42501"
          ? "Este painel é para gestor, administrador e Team Leader."
          : errorMessage(e, "Não foi possível carregar o painel de metas."),
      );
      return;
    }
    const planos = normalizarPlanosRpc(pl.data);
    const ids = planos.pessoas.map((p) => p.user_id);
    let anotacoes: AnotacaoLida[] = [];
    if (ids.length) {
      const an = await db
        .from("carreira_anotacoes")
        .select("id,user_id,texto,proximo_passo,proximo_passo_em,created_at")
        .in("user_id", ids)
        .order("created_at", { ascending: false })
        .limit(300);
      // Sem anotações não impede o painel: só avisa no cartão.
      anotacoes = an.error ? [] : ((an.data ?? []) as AnotacaoLida[]);
    }
    let padrao: TaxasFunil | null = null;
    if (planos.modulo_plano) padrao = await lerTaxasPadrao();
    const p = montarPainelGestor({
      hoje,
      planos,
      realizadoAno: normalizarRealizadoRpc(ra.data),
      ultimos12: normalizarRealizadoRpc(r12.data),
      anotacoes,
      padrao,
    });
    setPainel(p);
    // Team Leader com 1 equipe: abre direto nela.
    if (!p.todas && p.grupos.filter((g) => g.id).length === 1) setSel(p.grupos[0].id ?? TODAS);
  }, [hoje]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <Card>
      <CardHeader className="px-3 sm:px-6">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Target className="h-5 w-5" aria-hidden /> Painel de metas {ANO_PLANO} · Equipes
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          A meta vem só dos planos ASSINADOS (Meu Plano {ANO_PLANO}). O realizado entra sozinho
          pelas vendas assinadas e captações aprovadas.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 px-3 sm:px-6" data-testid="painel-metas-gestor">
        {erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : !painel ? (
          <ListSkeleton />
        ) : (
          <Conteudo painel={painel} sel={sel} setSel={setSel} />
        )}
      </CardContent>
    </Card>
  );
}

function Conteudo({
  painel,
  sel,
  setSel,
}: {
  painel: PainelGestor;
  sel: string;
  setSel: (s: string) => void;
}) {
  const grupo = sel === TODAS ? null : painel.grupos.find((g) => (g.id ?? "") === sel);
  const equipesSel = painel.grupos.length > 1 || painel.todas;
  const alertas = grupo
    ? painel.alertas.filter((a) => grupo.pessoas.some((p) => p.userId === a.userId))
    : painel.alertas;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground" data-testid="escopo">
        🔒{" "}
        {painel.todas
          ? "Você vê todas as equipes da imobiliária."
          : "Você vê só a(s) equipe(s) que lidera."}
      </p>
      {painel.pos.fase === "antes" ? (
        <p
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          data-testid="antes-vigencia"
        >
          As metas valem a partir de janeiro de {ANO_PLANO}. Até lá, o farol fica ⚪ e o realizado
          mostrado é de {painel.anoDados}.
        </p>
      ) : null}
      {!painel.moduloPlano ? (
        <p className="text-sm text-muted-foreground">
          O Meu Plano {ANO_PLANO} não está ligado nesta imobiliária: aparecem só os realizados.
        </p>
      ) : null}

      {equipesSel ? (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Equipe">
          {[
            { id: TODAS, nome: painel.todas ? "Todas" : "Todas as minhas" },
            ...painel.grupos.map((g) => ({ id: g.id ?? "", nome: g.nome })),
          ].map((o) => (
            <Button
              key={o.id || "sem"}
              size="sm"
              variant={sel === o.id ? "default" : "outline"}
              role="tab"
              aria-selected={sel === o.id}
              className="shrink-0"
              onClick={() => setSel(o.id)}
            >
              {o.nome}
            </Button>
          ))}
        </div>
      ) : null}

      {grupo ? (
        <>
          <ResumoGrupo grupo={grupo} painel={painel} destaque />
          <Alertas alertas={alertas} />
          <div className="space-y-3" data-testid="cartoes-corretores">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Users className="h-4 w-4" aria-hidden /> Corretores ({grupo.pessoas.length})
            </h3>
            {grupo.pessoas.length === 0 ? (
              <EmptyState icon={Users}>Ninguém nesta equipe ainda.</EmptyState>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {grupo.pessoas.map((c) => (
                  <CartaoPessoa key={c.userId} c={c} painel={painel} />
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <ResumoGrupo grupo={painel.total} painel={painel} destaque />
          <Alertas alertas={alertas} />
          <div className="space-y-3" data-testid="equipes">
            <h3 className="text-sm font-semibold">Equipes</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {painel.grupos.map((g) => (
                <ResumoGrupo
                  key={g.id ?? "sem"}
                  grupo={g}
                  painel={painel}
                  onAbrir={() => setSel(g.id ?? "")}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ResumoGrupo({
  grupo,
  painel,
  destaque,
  onAbrir,
}: {
  grupo: GrupoPainel;
  painel: PainelGestor;
  destaque?: boolean;
  onAbrir?: () => void;
}) {
  const c = grupo.avaliacao.indicadores.comissao;
  const mesNome = MES[painel.pos.mes - 1];
  const antes = painel.pos.fase === "antes";
  return (
    <div
      className={`min-w-0 space-y-3 break-words rounded-lg border p-3 ${destaque ? "bg-muted/30" : ""}`}
      data-testid={`grupo-${grupo.id ?? "total"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{grupo.nome}</p>
          {grupo.liderNome ? (
            <p className="text-xs text-muted-foreground">Líder: {grupo.liderNome}</p>
          ) : null}
        </div>
        <Pill tom={TOM_FAROL[grupo.avaliacao.farol]}>
          {grupo.avaliacao.farol === "cinza"
            ? "⚪ Sem plano assinado"
            : FAROL_META_ROTULO[grupo.avaliacao.farol]}
        </Pill>
      </div>

      {antes ? (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Mini titulo={`Meta ${ANO_PLANO} (assinados)`} valor={brlOuTraco(c.metaAno)} />
          <Mini
            titulo={`Comissão em ${painel.anoDados}`}
            valor={brl(grupo.realizadoAno.comissao ?? 0)}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Barra
            titulo="Meta do ANO (planos assinados)"
            a={c}
            feito={c.realAno}
            alvo={c.metaAno}
            esperado={c.esperado}
            rodape={
              c.diferenca == null ? null : (
                <>
                  {pct(c.pctAno)} da meta · ritmo{" "}
                  <b className={c.diferenca >= 0 ? "text-emerald-600" : "text-rose-600"}>
                    {c.diferenca >= 0
                      ? `${brl(c.diferenca)} à frente`
                      : `${brl(-c.diferenca)} atrás`}
                  </b>{" "}
                  ({pct(c.pctEsperado)} do esperado até hoje)
                </>
              )
            }
          />
          <Barra
            titulo={`Meta do MÊS (${mesNome})`}
            a={c}
            feito={c.realMes}
            alvo={c.metaMes}
            rodape={
              c.metaMes == null ? null : (
                <>
                  {pct(c.pctMes)} · falta <b>{brl(c.faltaMes ?? 0)}</b>
                </>
              )
            }
          />
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-xs">
        <Mini
          titulo="Vendas"
          valor={`${grupo.realizadoAno.vendas ?? 0}${metaTxt(grupo.avaliacao.indicadores.vendas, String)}`}
        />
        <Mini
          titulo="Captações"
          valor={
            grupo.realizadoAno.captacoes == null
              ? "–"
              : `${grupo.realizadoAno.captacoes}${metaTxt(grupo.avaliacao.indicadores.captacoes, String)}`
          }
        />
        <Mini titulo="VGV" valor={brl(grupo.realizadoAno.vgv ?? 0)} />
      </div>

      <p className="text-xs text-muted-foreground" data-testid="cobertura">
        Planos assinados: <b>{grupo.cobertura.assinados}</b> de {grupo.cobertura.elegiveis} (
        {pct(grupo.cobertura.pct)})
        {grupo.soma.qtdPreenchimento > 0 ? (
          <>
            {" "}
            · em preenchimento: {grupo.soma.qtdPreenchimento}
            {grupo.soma.preenchimentoAno.comissao != null ? (
              <> (somam {brl(grupo.soma.preenchimentoAno.comissao)}, fora da meta oficial)</>
            ) : null}
          </>
        ) : null}
      </p>

      {onAbrir ? (
        <Button size="sm" variant="ghost" className="px-0" onClick={onAbrir}>
          Ver corretores <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

function Barra(props: {
  titulo: string;
  a: AvaliacaoIndicador;
  feito: number;
  alvo: number | null;
  esperado?: number | null;
  rodape: React.ReactNode;
}) {
  const b = larguraBarra(props.feito, props.alvo, props.esperado);
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-muted-foreground">{props.titulo}</p>
      <p className="text-lg font-bold">
        {brl(props.feito)}{" "}
        <span className="text-xs font-normal text-muted-foreground">
          de {brlOuTraco(props.alvo)}
        </span>
      </p>
      <div
        className="relative h-3 rounded-full bg-muted"
        role="progressbar"
        aria-label={props.titulo}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(b.pct)}
      >
        <div
          className={`h-3 rounded-full ${b.pct >= 100 ? "bg-emerald-500" : "bg-primary"}`}
          style={{ width: `${b.pct}%` }}
        />
        {b.marca != null ? (
          <div
            className="absolute -top-1 h-5 w-0.5 bg-slate-700"
            style={{ left: `${b.marca}%` }}
            title="Onde deveria estar hoje"
          />
        ) : null}
      </div>
      {props.rodape ? <p className="text-xs text-muted-foreground">{props.rodape}</p> : null}
    </div>
  );
}

function CartaoPessoa({ c, painel }: { c: CartaoCorretor; painel: PainelGestor }) {
  const k = c.avaliacao.indicadores.comissao;
  const b = larguraBarra(k.realAno, k.metaAno, k.esperado);
  const assinado = c.situacao === "assinado";
  return (
    <div
      className="min-w-0 space-y-2 break-words rounded-lg border p-3"
      data-testid="cartao-corretor"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-semibold">{c.nome}</p>
        <Pill tom={TOM_FAROL[c.avaliacao.farol]} className="shrink-0">
          {FAROL_META_ROTULO[c.avaliacao.farol]}
        </Pill>
      </div>
      <p className="text-xs text-muted-foreground">Plano: {ROTULO_PLANO[c.situacao]}</p>
      {assinado && painel.pos.fase !== "antes" ? (
        <>
          <p className="text-sm">
            Ano: <b>{brl(k.realAno)}</b> de {brlOuTraco(k.metaAno)}
          </p>
          <div className="relative h-2 rounded-full bg-muted" aria-hidden>
            <div className="h-2 rounded-full bg-primary" style={{ width: `${b.pct}%` }} />
            {b.marca != null ? (
              <div
                className="absolute -top-1 h-4 w-0.5 bg-slate-700"
                style={{ left: `${b.marca}%` }}
              />
            ) : null}
          </div>
          <p className="text-xs" data-testid="falta">
            Falta no mês: <b>{brl(k.faltaMes ?? 0)}</b> · no ano: <b>{brl(k.faltaAno ?? 0)}</b>
          </p>
        </>
      ) : assinado ? (
        <p className="text-sm">
          Meta {ANO_PLANO}: <b>{brlOuTraco(k.metaAno)}</b> · comissão em {painel.anoDados}:{" "}
          {brl(c.realizadoAno.comissao ?? 0)}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Sem meta oficial até assinar o plano. Comissão no ano:{" "}
          <b className="text-foreground">{brl(c.realizadoAno.comissao ?? 0)}</b>
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Vendas no ano: {c.realizadoAno.vendas ?? 0}
        {c.realizadoAno.captacoes != null ? ` · Captações: ${c.realizadoAno.captacoes}` : ""}
      </p>
      {c.anotacoes.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sem anotações recentes.</p>
      ) : (
        <ul className="space-y-1" data-testid="anotacoes">
          {c.anotacoes.map((n) => (
            <li key={n.id} className="rounded border bg-muted/40 px-2 py-1 text-xs">
              <NotebookPen className="mr-1 inline h-3 w-3" aria-hidden />
              <b>{dataCurta(n.created_at.slice(0, 10))}</b> {n.texto}
              {n.proximo_passo ? (
                <span className="block text-muted-foreground">
                  ➡️ {n.proximo_passo}
                  {n.proximo_passo_em ? ` · ${dataCurta(n.proximo_passo_em)}` : ""}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Alertas({ alertas }: { alertas: AlertaParado[] }) {
  const top = alertas.filter((a) => a.diasParado == null || a.diasParado > 14).slice(0, 5);
  if (top.length === 0) return null;
  const txt = (d: number | null) => (d == null ? "nada em 12 meses" : `${d} dias`);
  return (
    <div
      className="space-y-1 rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/30"
      data-testid="alerta-parados"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-rose-800 dark:text-rose-200">
        <AlarmClock className="h-4 w-4" aria-hidden /> Há mais tempo sem vender ou captar
      </p>
      <ul className="space-y-0.5 text-xs">
        {top.map((a) => (
          <li key={a.userId}>
            <b>{a.nome}</b> <span className="text-muted-foreground">({a.equipe})</span> — sem venda:{" "}
            {txt(a.diasSemVender)} · sem captação: {txt(a.diasSemCaptar)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Mini({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-md border bg-background p-2">
      <p className="text-[11px] text-muted-foreground">{titulo}</p>
      <p className="font-semibold">{valor}</p>
    </div>
  );
}

const brlOuTraco = (v: number | null) => (v == null ? "–" : brl(v));
const metaTxt = (a: AvaliacaoIndicador, f: (n: number) => string) =>
  a.metaAno == null ? "" : ` / ${f(a.metaAno)}`;
