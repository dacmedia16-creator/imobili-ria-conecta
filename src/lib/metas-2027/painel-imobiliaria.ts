/**
 * Painel de metas 2027 da IMOBILIÁRIA (broker/admin) — cartão t_69d29df6, etapa 4. Puro, sem banco.
 *
 * Monta em cima do painel do gestor (montarPainelGestor, etapa 3: mesmas RPCs metas_equipe_planos e
 * metas_equipe_realizado) e acrescenta:
 * - meta da DIREÇÃO (metas_direcao, digitada pelo admin) × soma dos planos ASSINADOS (oficial) × soma em
 *   preenchimento (fora da meta), com a diferença (compararComDirecao);
 * - meta × realizado mês a mês da imobiliária (gráfico);
 * - ranking por equipe e por corretor com farol de meta;
 * - quebra da comissão (metas_comissao_quebra): bruta → imobiliária → líderes → indicador → parceria/extras →
 *   líquido dos corretores. Só admin/gestor recebem (o banco recusa os demais);
 * - estoque de hoje (metas_imobiliaria_estoque).
 * Regras (Denis, 19–20/11): venda conta na assinatura; cobertura = corretores ativos + gestor/TL que vendem;
 * a meta da direção é só do ANO (sem mês a mês por enquanto).
 */
import { num, ok } from "@/lib/meu-plano-2027/regras";
import { INDICADORES, type FarolMeta, type Indicador, type Valores } from "./regra";
import { compararComDirecao, type ComparacaoDirecao, type MetaDirecao } from "./consolidado";
import {
  montarPainelGestor,
  realizadoDoGrupo,
  type CartaoCorretor,
  type GrupoPainel,
  type PainelGestor,
} from "./painel-gestor";

// --- O que o banco devolve -------------------------------------------------------------------------------

export type DirecaoRpc = {
  ano: number;
  meta_comissao: number | string | null;
  meta_vgv: number | string | null;
  meta_vendas: number | string | null;
  meta_captacoes: number | string | null;
  updated_at?: string | null;
};

export type QuebraVendaRpc = {
  sale_id: string;
  venda_em: string;
  modalidade: "padrao" | "lancamento";
  bruta: number;
  premio: number;
  imobiliaria: number;
  lideres: number;
  indicador: number;
  parceria: number;
  extras: number;
  corretores: number;
  diferenca: number;
  valido: boolean;
};

export type EstoqueRpc = {
  captacoes_ligadas: boolean;
  exclusivas_ativas: number | null;
  exclusivas_novas_30d: number | null;
  anuncios_xml: number | null;
  xml_em: string | null;
};

// --- Saída -----------------------------------------------------------------------------------------------

export type QuebraTotal = {
  vendas: number;
  bruta: number;
  premio: number;
  imobiliaria: number;
  lideres: number;
  indicador: number;
  parceria: number;
  extras: number;
  corretores: number;
  diferenca: number;
  /** Vendas com a distribuição da comissão inconsistente (calculo_valido = false). */
  inconsistentes: number;
};

export type LinhaRanking = {
  id: string;
  nome: string;
  sub: string | null;
  meta: number | null;
  realizado: number;
  pctAno: number | null;
  pctEsperado: number | null;
  farol: FarolMeta;
};

export type PainelImobiliaria = {
  base: PainelGestor;
  total: GrupoPainel;
  direcao: MetaDirecao | null;
  direcaoAtualizadaEm: string | null;
  comparacao: Record<Indicador, ComparacaoDirecao>;
  /** Soma do ano dos planos em preenchimento (fora da meta oficial). */
  preenchimento: Valores;
  /** realizado do ano ÷ meta da direção (comissão). */
  pctDirecao: number | null;
  /** 12 meses: meta (soma dos assinados) e realizado da imobiliária. */
  meses: { mes: number; meta: number | null; realizado: number; futuro: boolean }[];
  rankingEquipes: LinhaRanking[];
  rankingCorretores: LinhaRanking[];
  /** null = quem chama não recebe a bruta (o banco recusou) ou a quebra não carregou. */
  comissao: QuebraTotal | null;
  estoque: EstoqueRpc | null;
};

// --- Contas ----------------------------------------------------------------------------------------------

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Valor digitado no formulário (aceita "1.400.000", "1,5 mi" não). Vazio = null; inválido/negativo = NaN. */
export function lerValorDirecao(txt: string | null | undefined): number | null {
  const s = (txt ?? "").trim();
  if (!s) return null;
  const v = num(s);
  return ok(v) && v >= 0 ? v : NaN;
}

export function direcaoDeRpc(x: DirecaoRpc | null | undefined): MetaDirecao | null {
  if (!x) return null;
  const v = (y: unknown) =>
    y == null || y === "" || !Number.isFinite(Number(y)) ? null : Number(y);
  const d: MetaDirecao = {
    comissao: v(x.meta_comissao),
    vgv: v(x.meta_vgv),
    vendas: v(x.meta_vendas),
    captacoes: v(x.meta_captacoes),
  };
  return INDICADORES.some((k) => d[k] != null) ? d : null;
}

export function somarQuebra(vendas: readonly QuebraVendaRpc[]): QuebraTotal {
  const t: QuebraTotal = {
    vendas: 0,
    bruta: 0,
    premio: 0,
    imobiliaria: 0,
    lideres: 0,
    indicador: 0,
    parceria: 0,
    extras: 0,
    corretores: 0,
    diferenca: 0,
    inconsistentes: 0,
  };
  const vistos = new Set<string>();
  for (const v of vendas) {
    if (vistos.has(v.sale_id)) continue;
    vistos.add(v.sale_id);
    t.vendas++;
    for (const k of [
      "bruta",
      "premio",
      "imobiliaria",
      "lideres",
      "indicador",
      "parceria",
      "extras",
      "corretores",
      "diferenca",
    ] as const)
      t[k] = r2(t[k] + n(v[k]));
    if (v.valido === false) t.inconsistentes++;
  }
  return t;
}

const ordemRanking = (a: LinhaRanking, b: LinhaRanking) =>
  (b.pctEsperado ?? -1) - (a.pctEsperado ?? -1) ||
  b.realizado - a.realizado ||
  a.nome.localeCompare(b.nome, "pt-BR");

function linhaGrupo(g: GrupoPainel): LinhaRanking {
  const c = g.avaliacao.indicadores.comissao;
  return {
    id: g.id ?? "sem",
    nome: g.nome,
    sub: `${g.cobertura.assinados}/${g.cobertura.elegiveis} planos assinados`,
    meta: c.metaAno,
    realizado: c.realAno,
    pctAno: c.pctAno,
    pctEsperado: c.pctEsperado,
    farol: g.avaliacao.farol,
  };
}

function linhaPessoa(p: CartaoCorretor, equipe: string): LinhaRanking {
  const c = p.avaliacao.indicadores.comissao;
  return {
    id: p.userId,
    nome: p.nome,
    sub: equipe,
    meta: c.metaAno,
    realizado: p.realizadoAno.comissao ?? 0,
    pctAno: c.pctAno,
    pctEsperado: c.pctEsperado,
    farol: p.avaliacao.farol,
  };
}

export function montarPainelImobiliaria(
  e: Parameters<typeof montarPainelGestor>[0] & {
    direcao: DirecaoRpc | null;
    quebra: readonly QuebraVendaRpc[] | null;
    estoque: EstoqueRpc | null;
  },
): PainelImobiliaria {
  const base = montarPainelGestor(e);
  const total = base.total;
  const direcao = direcaoDeRpc(e.direcao);
  const comparacao = compararComDirecao(total.soma, direcao);
  const realMeses = realizadoDoGrupo(
    e.realizadoAno,
    base.todas ? null : new Set(total.pessoas.map((p) => p.userId)),
    base.anoDados,
    true,
  );
  const metaMeses = total.soma.assinados?.meses ?? null;
  const ate = base.pos.fase === "antes" ? Number(e.hoje.slice(5, 7)) : base.pos.mes;
  const meses = realMeses.map((m, i) => ({
    mes: i + 1,
    meta: metaMeses ? (metaMeses[i]?.comissao ?? null) : null,
    realizado: m.comissao ?? 0,
    futuro: i + 1 > ate,
  }));
  const realAno = total.avaliacao.indicadores.comissao.realAno;
  const dComissao = direcao?.comissao ?? null;
  const nomeEquipe = new Map(base.grupos.map((g) => [g.id, g.nome] as const));
  return {
    base,
    total,
    direcao,
    direcaoAtualizadaEm: e.direcao?.updated_at ?? null,
    comparacao,
    preenchimento: total.soma.preenchimentoAno,
    pctDirecao:
      dComissao != null && dComissao > 0 ? Math.round((realAno / dComissao) * 10000) / 10000 : null,
    meses,
    rankingEquipes: base.grupos
      .filter((g) => g.pessoas.length > 0)
      .map(linhaGrupo)
      .sort(ordemRanking),
    rankingCorretores: total.pessoas
      .filter((p) => p.elegivel || (p.realizadoAno.comissao ?? 0) > 0)
      .map((p) => linhaPessoa(p, (p.teamId && nomeEquipe.get(p.teamId)) || "Sem equipe"))
      .sort(ordemRanking),
    comissao: e.quebra ? somarQuebra(e.quebra) : null,
    estoque: e.estoque,
  };
}

export function normalizarQuebraRpc(x: unknown): QuebraVendaRpc[] {
  const o = (x ?? {}) as { vendas?: QuebraVendaRpc[] };
  return (o.vendas ?? []).map((v) => ({
    ...v,
    bruta: n(v.bruta),
    premio: n(v.premio),
    imobiliaria: n(v.imobiliaria),
    lideres: n(v.lideres),
    indicador: n(v.indicador),
    parceria: n(v.parceria),
    extras: n(v.extras),
    corretores: n(v.corretores),
    diferenca: n(v.diferenca),
    valido: v.valido !== false,
  }));
}
