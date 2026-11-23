import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Building2, Pencil, Save, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import { ANO_PLANO } from "@/lib/meu-plano-2027/telas";
import type { TaxasFunil } from "@/lib/meu-plano-2027/regras";
import {
  FAROL_META_ROTULO,
  larguraBarra,
  lerValorDirecao,
  montarPainelImobiliaria,
  normalizarPlanosRpc,
  normalizarQuebraRpc,
  normalizarRealizadoRpc,
  periodosDoPainel,
  type AnotacaoLida,
  type DirecaoRpc,
  type EstoqueRpc,
  type FarolMeta,
  type Indicador,
  type LinhaRanking,
  type PainelImobiliaria,
  type QuebraVendaRpc,
} from "@/lib/metas-2027";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ListSkeleton, Pill, type Tom } from "@/components/visual/base";
import { lerTaxasPadrao } from "@/components/minha-carreira/Diario";
import type { ChaveExplicacao } from "@/lib/metas-2027/explicacoes";
import { InfoDica, RotuloInfo } from "./InfoDica";
import { ContextoInfo } from "./contexto-info";

// Painéis de metas 2027 — ETAPA 4 (cartão t_69d29df6, Denis 20/11): painel da IMOBILIÁRIA (broker/admin).
// Tela NOVA: não altera o Painel da Equipe, o Farol nem os relatórios financeiros. A tela não faz conta: tudo sai
// de montarPainelImobiliaria() (src/lib/metas-2027). Reaproveita as RPCs da etapa 3 (metas_equipe_planos /
// metas_equipe_realizado) e usa as novas: metas_direcao (leitura), metas_direcao_salvar (só admin),
// metas_comissao_quebra e metas_imobiliaria_estoque (só admin/gestor; o banco recusa os demais).
const db = supabase as unknown as SupabaseClient;

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);
/** Reais SEMPRE com centavos nesta tela (pedido de Denis 20/11, t_57737e80): "R$ 3.989.416,00".
 *  Local de propósito: o brl() de exclusive-captures-dashboard (sem centavos) é usado por outras telas. */
const brl = (n: number) =>
  n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const brlOuTraco = (v: number | null | undefined) => (v == null ? "–" : brl(v));
const inteiro = (v: number | null | undefined) =>
  v == null ? "–" : Math.round(v).toLocaleString("pt-BR");
const TOM_FAROL: Record<FarolMeta, Tom> = {
  verde: "green",
  amarelo: "amber",
  vermelho: "red",
  cinza: "slate",
  aguardando: "slate",
};
const ROTULO: Record<Indicador, string> = {
  comissao: "Comissão",
  vgv: "VGV",
  vendas: "Vendas",
  captacoes: "Captações",
};
const ehDinheiro = (k: Indicador) => k === "comissao" || k === "vgv";
const fmt = (k: Indicador, v: number | null | undefined) =>
  ehDinheiro(k) ? brlOuTraco(v) : inteiro(v);
/** Valor curto para a tabela no celular (R$ 60 mi, R$ 400 mil); o completo vai no title. */
function curto(k: Indicador, v: number | null | undefined) {
  if (v == null || !ehDinheiro(k)) return fmt(k, v);
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  const n = (x: number) => x.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  if (a >= 1e6) return `${s}R$ ${n(a / 1e6)} mi`;
  if (a >= 1e4) return `${s}R$ ${n(a / 1e3)} mil`;
  return fmt(k, v);
}

type Dados = {
  painel: PainelImobiliaria;
  direcaoBruta: DirecaoRpc | null;
};

export function PainelMetasImobiliaria() {
  const { roles } = useAuth();
  const ehAdmin = roles.includes("admin") || roles.includes("super_admin");
  const hoje = useMemo(() => hojeSaoPaulo(), []);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const per = periodosDoPainel(hoje);
    const [pl, ra, r12, dir, qb, est] = await Promise.all([
      db.rpc("metas_equipe_planos", { _ano: ANO_PLANO }),
      db.rpc("metas_equipe_realizado", { _inicio: per.ano.inicio, _fim: per.ano.fim }),
      db.rpc("metas_equipe_realizado", { _inicio: per.ultimos12.inicio, _fim: per.ultimos12.fim }),
      db
        .from("metas_direcao")
        .select("ano,meta_comissao,meta_vgv,meta_vendas,meta_captacoes,updated_at")
        .eq("ano", ANO_PLANO)
        .maybeSingle(),
      db.rpc("metas_comissao_quebra", { _inicio: per.ano.inicio, _fim: per.ano.fim }),
      db.rpc("metas_imobiliaria_estoque"),
    ]);
    const e = pl.error ?? ra.error ?? r12.error ?? dir.error;
    if (e) {
      setErro(
        e.code === "42501"
          ? "Este painel é para o administrador da imobiliária."
          : errorMessage(e, "Não foi possível carregar o painel da imobiliária."),
      );
      return;
    }
    const planos = normalizarPlanosRpc(pl.data);
    if (!planos.todas) {
      setErro("Este painel mostra a imobiliária inteira: é para o administrador.");
      return;
    }
    const ids = planos.pessoas.map((p) => p.user_id);
    let anotacoes: AnotacaoLida[] = [];
    if (ids.length) {
      const an = await db
        .from("carreira_anotacoes")
        .select("id,user_id,texto,proximo_passo,proximo_passo_em,created_at")
        .in("user_id", ids)
        .order("created_at", { ascending: false })
        .limit(300);
      anotacoes = an.error ? [] : ((an.data ?? []) as AnotacaoLida[]);
    }
    let padrao: TaxasFunil | null = null;
    if (planos.modulo_plano) padrao = await lerTaxasPadrao();
    const direcaoBruta = (dir.data ?? null) as DirecaoRpc | null;
    // Quebra/estoque recusados (42501) = quem chama não pode ver a bruta: o bloco some, o resto do painel fica.
    const quebra: QuebraVendaRpc[] | null = qb.error ? null : normalizarQuebraRpc(qb.data);
    const estoque = est.error ? null : ((est.data ?? null) as EstoqueRpc | null);
    setDados({
      direcaoBruta,
      painel: montarPainelImobiliaria({
        hoje,
        planos,
        realizadoAno: normalizarRealizadoRpc(ra.data),
        ultimos12: normalizarRealizadoRpc(r12.data),
        anotacoes,
        padrao,
        direcao: direcaoBruta,
        quebra,
        estoque,
      }),
    });
  }, [hoje]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <Card>
      <CardHeader className="px-3 sm:px-6">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Building2 className="h-5 w-5" aria-hidden /> Painel de metas {ANO_PLANO} · Imobiliária
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Meta oficial = soma dos planos ASSINADOS, comparada com o realizado só de quem assinou. A
          meta da direção é comparada com a imobiliária inteira.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 px-3 sm:px-6" data-testid="painel-metas-imobiliaria">
        {erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : !dados ? (
          <ListSkeleton />
        ) : (
          <ContextoInfo.Provider value={{ ano: dados.painel.base.anoDados, anoPlano: ANO_PLANO }}>
            <Conteudo
              p={dados.painel}
              direcaoBruta={dados.direcaoBruta}
              ehAdmin={ehAdmin}
              recarregar={carregar}
            />
          </ContextoInfo.Provider>
        )}
      </CardContent>
    </Card>
  );
}

function Conteudo({
  p,
  direcaoBruta,
  ehAdmin,
  recarregar,
}: {
  p: PainelImobiliaria;
  direcaoBruta: DirecaoRpc | null;
  ehAdmin: boolean;
  recarregar: () => Promise<void>;
}) {
  const antes = p.base.pos.fase === "antes";
  const c = p.total.avaliacao.indicadores.comissao;
  return (
    <div className="space-y-4">
      {antes ? (
        <p
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          data-testid="antes-vigencia"
        >
          As metas valem a partir de janeiro de {ANO_PLANO}. Até lá, o farol fica ⚪ e o realizado
          mostrado é de {p.base.anoDados}.
        </p>
      ) : null}
      {!p.base.moduloPlano ? (
        <p className="text-sm text-muted-foreground">
          O Meu Plano {ANO_PLANO} não está ligado nesta imobiliária: a soma dos planos fica vazia.
        </p>
      ) : null}

      <TopoMetas p={p} direcaoBruta={direcaoBruta} ehAdmin={ehAdmin} recarregar={recarregar} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Bloco
          titulo={
            antes
              ? `Comissão em ${p.base.anoDados} de quem conta na meta`
              : "Realizado de quem conta na meta × meta oficial"
          }
          info="imob_realizado"
          testid="realizado"
        >
          <p className="text-2xl font-bold">{brl(p.total.realizadoAno.comissao ?? 0)}</p>
          {antes ? (
            <p className="text-xs text-muted-foreground">
              meta oficial {ANO_PLANO}: <b>{brlOuTraco(c.metaAno)}</b>
            </p>
          ) : (
            <>
              <BarraMeta feito={c.realAno} alvo={c.metaAno} esperado={c.esperado} />
              <p className="text-xs text-muted-foreground">
                {pct(c.pctAno)} da meta oficial (soma das metas oficiais)
              </p>
            </>
          )}
          <p className="text-xs text-muted-foreground" data-testid="nao-assinados">
            <RotuloInfo chave="imob_nao_assinados">
              Produção de quem não conta na meta (inclui quem já saiu):
            </RotuloInfo>{" "}
            <b className="text-foreground">{brl(p.total.naoAssinados.realizado.comissao ?? 0)}</b> ·{" "}
            {p.total.naoAssinados.pessoas}{" "}
            {p.total.naoAssinados.pessoas === 1 ? "corretor" : "corretores"}. Fora da meta oficial e
            do farol.
          </p>
          <p className="border-t pt-2 text-xs text-muted-foreground" data-testid="casa-direcao">
            <RotuloInfo chave="imob_realizado_casa">
              Imobiliária inteira × meta da direção:
            </RotuloInfo>{" "}
            <b className="text-foreground">{brl(p.realizadoCasa)}</b>
            {antes ? (
              <>
                {" "}
                em {p.base.anoDados} · meta da direção {ANO_PLANO}:{" "}
                {brlOuTraco(p.direcao?.comissao)}
              </>
            ) : (
              <> · {pct(p.pctDirecao)} da meta da direção</>
            )}
          </p>
        </Bloco>
        <Bloco titulo="Ritmo esperado até hoje" info="imob_ritmo" testid="ritmo">
          {antes || c.diferenca == null ? (
            <p className="text-sm text-muted-foreground">
              {antes ? `Começa em jan/${ANO_PLANO}.` : "Sem meta oficial para medir o ritmo."}
            </p>
          ) : (
            <>
              <p
                className={`text-xl font-bold ${c.diferenca >= 0 ? "text-emerald-600" : "text-rose-600"}`}
              >
                {c.diferenca >= 0 ? "▲ À frente" : "▼ Atrás"} {brl(Math.abs(c.diferenca))}
              </p>
              <p className="text-xs text-muted-foreground">
                Deveria ter {brl(c.esperado ?? 0)} até {p.base.pos.dia}/{MES[p.base.pos.mes - 1]} ·
                tem {brl(c.realAno)} ({pct(c.pctEsperado)} do esperado)
              </p>
            </>
          )}
        </Bloco>
        <Bloco titulo="Cobertura de planos assinados" info="imob_cobertura" testid="cobertura">
          <p className="text-2xl font-bold">
            {p.total.cobertura.assinados} de {p.total.cobertura.elegiveis}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({pct(p.total.cobertura.pct)})
            </span>
          </p>
          <BarraMeta feito={p.total.cobertura.assinados} alvo={p.total.cobertura.elegiveis} />
          <p className="text-xs text-muted-foreground">
            {p.total.cobertura.preenchimento} preenchendo · {p.total.cobertura.semPlano} sem plano.
            Contam corretores ativos e gestores/TL que vendem.
          </p>
        </Bloco>
      </div>

      <Grafico p={p} />
      <Indicadores p={p} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Ranking
          titulo="Ranking por equipe"
          info="imob_ranking_equipes"
          linhas={p.rankingEquipes}
          testid="ranking-equipes"
        />
        <Ranking
          titulo="Ranking por corretor"
          info="imob_ranking_corretores"
          linhas={p.rankingCorretores}
          testid="ranking-corretores"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Farol: 🟢 ≥100% do esperado até hoje · 🟡 80–99% · 🔴 abaixo de 80% · ⚪ sem meta oficial.
        <InfoDica chave="imob_farol" />
      </p>
    </div>
  );
}

function Bloco({
  titulo,
  info,
  testid,
  children,
}: {
  titulo: string;
  info: ChaveExplicacao;
  testid?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-2 break-words rounded-lg border p-3" data-testid={testid}>
      <p className="text-xs font-semibold text-muted-foreground">
        <RotuloInfo chave={info}>{titulo}</RotuloInfo>
      </p>
      {children}
    </div>
  );
}

function BarraMeta(props: { feito: number; alvo: number | null; esperado?: number | null }) {
  const b = larguraBarra(props.feito, props.alvo, props.esperado);
  return (
    <div className="relative h-2.5 rounded-full bg-muted" aria-hidden>
      <div
        className={`h-2.5 rounded-full ${b.pct >= 100 ? "bg-emerald-500" : "bg-primary"}`}
        style={{ width: `${b.pct}%` }}
      />
      {b.marca != null ? (
        <div
          className="absolute -top-1 h-4 w-0.5 bg-slate-700"
          style={{ left: `${b.marca}%` }}
          title="Onde deveria estar hoje"
        />
      ) : null}
    </div>
  );
}

// --- Topo: meta da direção × assinados × em preenchimento ----------------------------------------------------

function TopoMetas({
  p,
  direcaoBruta,
  ehAdmin,
  recarregar,
}: {
  p: PainelImobiliaria;
  direcaoBruta: DirecaoRpc | null;
  ehAdmin: boolean;
  recarregar: () => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const cc = p.comparacao.comissao;
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3" data-testid="topo-metas">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted-foreground">
            <RotuloInfo chave="imob_meta_direcao">Meta da direção {ANO_PLANO}</RotuloInfo>
          </p>
          <p className="text-2xl font-bold" data-testid="meta-direcao">
            {brlOuTraco(p.direcao?.comissao)}
          </p>
          <p
            className="text-xs font-medium text-muted-foreground"
            data-testid="rotulo-vgc-meta-direcao"
          >
            VGC (comissão do ano)
          </p>
          <p className="text-xs text-muted-foreground">Digitada pelo administrador</p>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted-foreground">
            <RotuloInfo chave="imob_soma_assinados">Soma das metas OFICIAIS</RotuloInfo>
          </p>
          <p className="text-2xl font-bold" data-testid="soma-assinados">
            {brlOuTraco(cc.somaAssinados)}
          </p>
          <p
            className="text-xs font-medium text-muted-foreground"
            data-testid="rotulo-vgc-soma-assinados"
          >
            VGC (comissão do ano)
          </p>
          <p className="text-xs text-muted-foreground">
            {p.total.soma.qtdContam} meta(s) oficial(is) · {p.total.soma.qtdAssinados} assinado(s)
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted-foreground">
            <RotuloInfo chave="imob_preenchimento">Sem meta oficial (não conta)</RotuloInfo>
          </p>
          <p className="text-2xl font-bold text-muted-foreground" data-testid="soma-preenchimento">
            {brlOuTraco(p.preenchimento.comissao)}
          </p>
          <p
            className="text-xs font-medium text-muted-foreground"
            data-testid="rotulo-vgc-soma-preenchimento"
          >
            VGC (comissão do ano)
          </p>
          <p className="text-xs text-muted-foreground">
            {p.total.soma.qtdPreenchimento} plano(s) sem meta oficial gravada
          </p>
        </div>
      </div>
      {p.total.aConferir.assinados + p.total.aConferir.preenchimento > 0 ? (
        <p
          className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          data-testid="imob-a-conferir"
        >
          <RotuloInfo chave="plano_a_conferir">⚠ Planos com valor a conferir:</RotuloInfo>{" "}
          <b>{p.total.aConferir.assinados}</b> assinado(s) e{" "}
          <b>{p.total.aConferir.preenchimento}</b> em preenchimento (
          {p.total.aConferir.nomes.join(", ")}). Já incluídos nas somas acima.
        </p>
      ) : null}

      {cc.diferenca == null ? (
        <p className="text-sm text-muted-foreground" data-testid="diferenca">
          {ehAdmin
            ? "Defina a meta da direção para comparar com os planos."
            : "O administrador ainda não definiu a meta da direção."}
        </p>
      ) : (
        <p
          className={`rounded-md px-3 py-2 text-sm font-semibold ${cc.diferenca >= 0 ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" : "bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200"}`}
          data-testid="diferenca"
        >
          {cc.diferenca >= 0
            ? `✅ As metas oficiais passam a meta da direção em ${brl(cc.diferenca)} (${pct(cc.pct)}).`
            : `⚠️ Faltam ${brl(-cc.diferenca)} nas metas oficiais para chegar na meta da direção (${pct(cc.pct)}).`}
          <InfoDica chave="imob_diferenca" />
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[19rem] text-xs" data-testid="tabela-direcao">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-medium">
                <RotuloInfo chave="imob_tabela_direcao">Indicador do ano</RotuloInfo>
              </th>
              <th className="py-1 text-right font-medium">Direção</th>
              <th className="py-1 text-right font-medium">Metas oficiais</th>
              <th className="py-1 text-right font-medium">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {(["comissao", "vgv", "vendas", "captacoes"] as const).map((k) => {
              const x = p.comparacao[k];
              return (
                <tr key={k} className="border-t">
                  <td className="py-1">{ROTULO[k]}</td>
                  {/* Celular: valor curto (R$ 60 mi); computador: valor completo. O completo fica no title. */}
                  <td className="whitespace-nowrap py-1 pl-3 text-right" title={fmt(k, x.direcao)}>
                    <span className="sm:hidden">{curto(k, x.direcao)}</span>
                    <span className="hidden sm:inline">{fmt(k, x.direcao)}</span>
                  </td>
                  <td
                    className="whitespace-nowrap py-1 pl-3 text-right"
                    title={fmt(k, x.somaAssinados)}
                  >
                    <span className="sm:hidden">{curto(k, x.somaAssinados)}</span>
                    <span className="hidden sm:inline">{fmt(k, x.somaAssinados)}</span>
                  </td>
                  <td
                    className={`whitespace-nowrap py-1 pl-3 text-right font-semibold ${x.diferenca == null ? "" : x.diferenca >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                  >
                    {x.diferenca == null ? (
                      "–"
                    ) : (
                      <>
                        <span className="sm:hidden">
                          {x.diferenca >= 0 ? "+" : "−"}
                          {curto(k, Math.abs(x.diferenca))}
                        </span>
                        <span className="hidden sm:inline">
                          {x.diferenca >= 0 ? "+" : "−"}
                          {fmt(k, Math.abs(x.diferenca))}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {ehAdmin ? (
        editando ? (
          <FormDirecao
            atual={direcaoBruta}
            onCancelar={() => setEditando(false)}
            onSalvo={async () => {
              // Recarrega ANTES de fechar: o topo já aparece com a meta nova (sem piscar a antiga).
              await recarregar();
              setEditando(false);
            }}
          />
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditando(true)}
            data-testid="editar-direcao"
          >
            <Pencil className="mr-1 h-4 w-4" aria-hidden /> Editar meta da direção
          </Button>
        )
      ) : null}
    </div>
  );
}

const CAMPOS: {
  k: "meta_comissao" | "meta_vgv" | "meta_vendas" | "meta_captacoes";
  rotulo: string;
  dica: string;
}[] = [
  { k: "meta_comissao", rotulo: "Comissão do ano (R$)", dica: "ex.: 1.400.000" },
  { k: "meta_vgv", rotulo: "VGV do ano (R$)", dica: "ex.: 60.000.000" },
  { k: "meta_vendas", rotulo: "Vendas (transações) no ano", dica: "ex.: 120" },
  { k: "meta_captacoes", rotulo: "Captações no ano", dica: "ex.: 200" },
];

function FormDirecao({
  atual,
  onCancelar,
  onSalvo,
}: {
  atual: DirecaoRpc | null;
  onCancelar: () => void;
  onSalvo: () => Promise<void>;
}) {
  const inicial = (v: unknown) =>
    v == null || v === "" ? "" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const [v, setV] = useState<Record<string, string>>(() =>
    Object.fromEntries(CAMPOS.map((c) => [c.k, inicial(atual?.[c.k])])),
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    const lido = Object.fromEntries(CAMPOS.map((c) => [c.k, lerValorDirecao(v[c.k])]));
    const ruim = CAMPOS.find((c) => Number.isNaN(lido[c.k]));
    if (ruim) {
      setMsg(
        `Confira "${ruim.rotulo}": digite um valor como 1.400.000 (sem letras nem sinal de menos).`,
      );
      return;
    }
    for (const k of ["meta_vendas", "meta_captacoes"])
      if (lido[k] != null && !Number.isInteger(lido[k])) {
        setMsg("Vendas e captações são números inteiros.");
        return;
      }
    setSalvando(true);
    setMsg(null);
    const { error } = await db.rpc("metas_direcao_salvar", {
      _ano: ANO_PLANO,
      _comissao: lido.meta_comissao,
      _vgv: lido.meta_vgv,
      _vendas: lido.meta_vendas,
      _captacoes: lido.meta_captacoes,
    });
    setSalvando(false);
    if (error) {
      setMsg(
        error.code === "42501"
          ? "Só o administrador da imobiliária pode definir a meta da direção."
          : errorMessage(error, "Não foi possível salvar a meta da direção."),
      );
      return;
    }
    await onSalvo();
  };
  return (
    <form
      className="space-y-3 rounded-lg border bg-background p-3"
      data-testid="form-direcao"
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
    >
      <p className="text-sm font-semibold">Meta da direção {ANO_PLANO} (só o ano, sem mês a mês)</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CAMPOS.map((c) => (
          <div key={c.k} className="space-y-1">
            <Label htmlFor={`dir-${c.k}`}>{c.rotulo}</Label>
            <Input
              id={`dir-${c.k}`}
              inputMode="decimal"
              placeholder={c.dica}
              value={v[c.k]}
              onChange={(e) => {
                setMsg(null); // o aviso some quando a pessoa corrige
                setV((s) => ({ ...s, [c.k]: e.target.value }));
              }}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Deixe em branco o indicador sem meta da direção.
      </p>
      {msg ? (
        <p className="text-sm text-destructive" role="alert">
          {msg}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={salvando}>
          <Save className="mr-1 h-4 w-4" aria-hidden /> {salvando ? "Salvando…" : "Salvar"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancelar} disabled={salvando}>
          <X className="mr-1 h-4 w-4" aria-hidden /> Cancelar
        </Button>
      </div>
    </form>
  );
}

// --- Gráfico mês a mês ----------------------------------------------------------------------------------------

function Grafico({ p }: { p: PainelImobiliaria }) {
  const mx = Math.max(1, ...p.meses.map((m) => Math.max(m.meta ?? 0, m.realizado))) * 1.1;
  const H = 140;
  return (
    <Bloco titulo="Mês a mês — meta oficial × realizado" info="imob_grafico" testid="grafico">
      <div
        className="grid h-[164px] grid-cols-12 items-end gap-1"
        role="img"
        aria-label="Gráfico de meta e realizado por mês"
      >
        {p.meses.map((m) => {
          const hm = ((m.meta ?? 0) / mx) * H;
          const hr = m.futuro ? 0 : (m.realizado / mx) * H;
          const bateu = m.meta != null && m.realizado >= m.meta && m.meta > 0;
          return (
            <div
              key={m.mes}
              className="flex min-w-0 flex-col items-center gap-1"
              title={`${MES[m.mes - 1]}: meta ${brlOuTraco(m.meta)} · realizado ${brl(m.realizado)}`}
            >
              <div className="flex h-[140px] w-full items-end justify-center gap-px">
                <div
                  className="w-1/2 rounded-t bg-slate-300 dark:bg-slate-600"
                  style={{ height: hm }}
                />
                <div
                  className={`w-1/2 rounded-t ${bateu ? "bg-emerald-500" : "bg-primary"}`}
                  style={{ height: hr }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground">{MES[m.mes - 1]}</span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-300" /> Meta do mês
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-primary" /> Realizado
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Bateu a meta
        </span>
      </div>
    </Bloco>
  );
}

// --- Indicadores ------------------------------------------------------------------------------------------

function Indicadores({ p }: { p: PainelImobiliaria }) {
  // Indicadores da casa toda (não se comparam com meta): imobiliária inteira, assinados ou não.
  const r = p.total.realizadoTodos;
  const q = p.comissao;
  const e = p.estoque;
  return (
    <div className="min-w-0 space-y-2 break-words rounded-lg border p-3" data-testid="indicadores">
      <p className="text-xs font-semibold text-muted-foreground">
        Indicadores de {p.base.anoDados}
      </p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Mini titulo="VGV" info="imob_vgv" valor={brl(r.vgv ?? 0)} />
        <Mini titulo="Vendas (lados)" info="imob_vendas" valor={inteiro(r.vendas ?? 0)} />
        <Mini
          titulo="Captações"
          info="imob_captacoes"
          valor={r.captacoes == null ? "–" : inteiro(r.captacoes)}
        />
        <Mini
          titulo="Estoque hoje"
          info="imob_estoque"
          valor={e?.exclusivas_ativas == null ? "–" : `${inteiro(e.exclusivas_ativas)} exclusivas`}
          sub={
            e
              ? [
                  e.exclusivas_novas_30d != null
                    ? `${e.exclusivas_novas_30d} novas em 30 dias`
                    : null,
                  e.anuncios_xml != null ? `${e.anuncios_xml} anúncios no XML` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || null
              : null
          }
        />
      </div>
      {q ? (
        <div
          className="space-y-2 rounded-md border bg-background p-3"
          data-testid="quebra-comissao"
        >
          <p className="text-sm font-semibold">
            Comissão de {p.base.anoDados}: bruta → imobiliária → descontos → corretores
          </p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Mini
              titulo={`Bruta (${q.vendas} vendas)`}
              info="imob_quebra_bruta"
              valor={brl(q.bruta + q.premio)}
            />
            <Mini
              titulo="(−) Imobiliária"
              info="imob_quebra_imobiliaria"
              valor={brl(q.imobiliaria)}
            />
            <Mini titulo="(−) Gestores/TL" info="imob_quebra_lideres" valor={brl(q.lideres)} />
            <Mini titulo="(−) Indicador" info="imob_quebra_indicador" valor={brl(q.indicador)} />
            <Mini
              titulo="(−) Parceria e extras"
              info="imob_quebra_parceria"
              valor={brl(q.parceria + q.extras)}
            />
            <Mini
              titulo="= Líquido dos corretores"
              info="imob_quebra_corretores"
              valor={brl(q.corretores)}
              destaque
            />
          </div>
          {q.premio > 0 ? (
            <p className="text-xs text-muted-foreground">
              A bruta inclui {brl(q.premio)} de prêmio de lançamento.
            </p>
          ) : null}
          {q.inconsistentes > 0 || Math.abs(q.diferenca) >= 1 ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              ⚠️ {q.inconsistentes} venda(s) com a divisão da comissão a conferir
              {Math.abs(q.diferenca) >= 1 ? ` (diferença de ${brl(q.diferenca)} sem destino)` : ""}.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Visível só para o administrador. A comissão do realizado e do ranking é o líquido de
            cada corretor.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Mini({
  titulo,
  info,
  valor,
  sub,
  destaque,
}: {
  titulo: string;
  info: ChaveExplicacao;
  valor: string;
  sub?: string | null;
  destaque?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-md border p-2 ${destaque ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-background"}`}
    >
      <p className="text-[11px] text-muted-foreground">
        <RotuloInfo chave={info}>{titulo}</RotuloInfo>
      </p>
      <p className="break-words font-semibold">{valor}</p>
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

// --- Ranking --------------------------------------------------------------------------------------------------

function Ranking({
  titulo,
  info,
  linhas,
  testid,
}: {
  titulo: string;
  info: ChaveExplicacao;
  linhas: LinhaRanking[];
  testid: string;
}) {
  return (
    <Bloco titulo={titulo} info={info} testid={testid}>
      {linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ninguém para mostrar ainda.</p>
      ) : (
        <ol className="space-y-2">
          {linhas.map((l, i) => (
            <li
              key={l.id}
              className="flex items-start justify-between gap-2 border-t pt-2 first:border-t-0 first:pt-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {i + 1}. {l.nome}
                </p>
                {l.sub ? <p className="truncate text-xs text-muted-foreground">{l.sub}</p> : null}
                {l.aConferir > 0 ? (
                  <p
                    className="text-xs text-amber-800 dark:text-amber-200"
                    data-testid="ranking-a-conferir"
                  >
                    ⚠{" "}
                    {l.aConferir === 1
                      ? "plano com valor a conferir"
                      : `${l.aConferir} planos com valor a conferir`}
                  </p>
                ) : null}
                <p className="text-xs">
                  {brl(l.realizado)}{" "}
                  <span className="text-muted-foreground">
                    de {brlOuTraco(l.meta)} · {pct(l.pctAno)} do ano · {pct(l.pctEsperado)} do
                    esperado
                  </span>
                </p>
              </div>
              <Pill tom={TOM_FAROL[l.farol]} className="shrink-0">
                {FAROL_META_ROTULO[l.farol]}
              </Pill>
            </li>
          ))}
        </ol>
      )}
    </Bloco>
  );
}
