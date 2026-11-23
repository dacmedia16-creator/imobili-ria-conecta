/**
 * Painel de metas 2027 do CORRETOR (cartão t_2fa76ce2, etapa 2; substitui o "Meu mês"). Puro, sem banco.
 *
 * Só junta os dados que a tela carrega e chama a regra única (regra.ts / realizado.ts). A tela NÃO faz conta:
 * mostra o que sai de montarPainelCorretor().
 *
 * Fontes (todas do próprio corretor, na imobiliária ativa):
 * - meta: carreira_plano (respostas + assinado_corretor_em + meta_oficial gravada) → planoComSelo (consolidado.ts),
 *   a mesma regra do selo da Equipe e da soma da equipe/imobiliária: vale a meta oficial GRAVADA (t_91ec7aa3);
 * - vendas: RPC minha_comissao_vendas (venda na ASSINATURA; só a parte dele + o descontado DELE);
 * - captações: meu_realizado (contagem oficial do ano e do mês) + lista de captações aprovadas (data e imóvel).
 */
import { dataCivilSaoPaulo } from "@/lib/hoje-sao-paulo";
import { ANO_PLANO } from "@/lib/meu-plano-2027/telas";
import type { Respostas, TaxasFunil } from "@/lib/meu-plano-2027/regras";
import { conferirPlano, type AvisoPlano } from "@/lib/meu-plano-2027/conferencia";
import {
  posicaoNoAno,
  type Avaliacao,
  type MetaPlano,
  type Posicao,
  type SituacaoPlano,
  type Valores,
} from "./regra";
import {
  avaliarPessoa,
  contaNaMeta,
  planoComSelo,
  type MetaOficialGravada,
  type SeloMeta,
} from "./consolidado";
import { mesNoAno, realizadoMensal, type ParticipacaoVenda } from "./realizado";
import type { VisaoCorretorComissao } from "./comissao";

/** Linha de minha_comissao_vendas (o banco nunca manda a bruta da venda nem a parte da imobiliária). */
export type ComissaoVendaCorretor = {
  sale_id: string;
  venda_em: string;
  imovel: string | null;
  codigo: string | null;
  papel: string | null;
  /** Lados da venda que são dele: captou = 1, vendeu = 1 (0 = só indicador/líder/extra). */
  lados: number;
  vgv: number;
  minha_parte: number;
  indicador: number;
  extras: number;
  descontado: number;
};

/** Captação aprovada do corretor (lida da tabela com RLS) + datas de aprovação do histórico. */
export type CaptacaoCorretor = {
  id: string;
  imovel: string | null;
  signedOn: string | null;
  /** created_at das linhas \"aprovar\" de exclusive_history desta captação. */
  aprovacoes: string[];
};

export type Cumprida =
  | {
      tipo: "venda";
      data: string;
      imovel: string;
      codigo: string | null;
      papel: string | null;
      comissao: VisaoCorretorComissao;
    }
  | { tipo: "captacao"; data: string; imovel: string };

export type PainelCorretor = {
  situacao: SituacaoPlano;
  /** Conta na meta? Mesma regra do selo da Equipe (meta oficial gravada dentro do limite, t_91ec7aa3). */
  selo: SeloMeta;
  /** Meta gravada fora do limite de bloqueio: motivo (não conta); null = dentro ou sem meta gravada. */
  motivoMetaAConferir: string | null;
  pos: Posicao;
  meta: MetaPlano | null;
  avaliacao: Avaliacao;
  cumpridas: Cumprida[];
  /** Total da comissão do corretor no ano e do que foi descontado dele (só para o rodapé da lista). */
  totalAno: { suaParte: number; descontado: number };
  /** Avisos do plano que mexem na meta (t_125c4dd3); vazio = nada a conferir. Só mostra: a meta não muda. */
  aConferir: AvisoPlano[];
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Mesma regra de exclusive_aprovada_em: última aprovação (dia de SP); sem histórico, a data do contrato. */
export function dataAprovacao(c: Pick<CaptacaoCorretor, "signedOn" | "aprovacoes">): string | null {
  const dias = c.aprovacoes.map((x) => dataCivilSaoPaulo(x)).filter((x): x is string => !!x);
  if (dias.length) return dias.sort().at(-1)!;
  return dataCivilSaoPaulo(c.signedOn);
}

/** Visão do corretor de uma venda: só a parte dele e o descontado dele. */
export function visaoDaVenda(v: ComissaoVendaCorretor): VisaoCorretorComissao {
  const indicador = r2(n(v.indicador));
  const extras = r2(n(v.extras));
  return {
    suaParte: r2(n(v.minha_parte)),
    descontadoDeVoce: { indicador, extras, total: r2(indicador + extras) },
  };
}

/**
 * Realizado mês a mês do corretor.
 * - comissão e VGV: venda a venda (realizadoMensal), pela data da assinatura;
 * - vendas: LADOS do corretor (captou = 1, vendeu = 1), a mesma unidade da meta "transações" do plano.
 *   Quem capta e vende a mesma venda faz 2; quem só indicou ou liderou faz 0 (mas a comissão conta);
 * - captações: contagem OFICIAL de meu_realizado (ano e mês). shortcut: só o total até o mês atual e o do mês
 *   são conhecidos; o que veio antes do mês atual fica em janeiro. avaliarIndicador só usa "soma até o mês" e
 *   "o mês", então o resultado é o mesmo; não use estes meses para gráfico mês a mês.
 */
export function realizadoDoCorretor(
  userId: string,
  vendas: readonly ComissaoVendaCorretor[],
  captacoes: { ano: number | null; mes: number | null },
  pos: Posicao,
  ano: number = ANO_PLANO,
): Valores[] {
  const linhas: ParticipacaoVenda[] = vendas.map((v) => ({
    saleId: v.sale_id,
    userId,
    assinadaEm: v.venda_em,
    comissao: n(v.minha_parte),
    vgv: n(v.vgv),
  }));
  const meses = realizadoMensal(linhas, [], ano, null);
  for (const m of meses) m.vendas = 0;
  for (const v of vendas) {
    const mes = mesNoAno(v.venda_em, ano);
    if (mes != null) meses[mes - 1].vendas = (meses[mes - 1].vendas ?? 0) + Math.max(0, n(v.lados));
  }
  const ligadas = captacoes.ano != null;
  for (const m of meses) m.captacoes = ligadas ? 0 : null;
  if (ligadas && pos.fase !== "antes") {
    const mesAtual = Math.max(0, n(captacoes.mes));
    const antes = Math.max(0, n(captacoes.ano) - mesAtual);
    meses[pos.mes - 1].captacoes = mesAtual;
    if (pos.mes > 1) meses[0].captacoes = antes;
    else meses[0].captacoes = mesAtual + antes;
  }
  return meses;
}

/** Lista "cumpridas": vendas e captações do ano do plano, da mais recente para a mais antiga. */
export function listaCumpridas(
  vendas: readonly ComissaoVendaCorretor[],
  captacoes: readonly CaptacaoCorretor[],
  ano: number = ANO_PLANO,
): Cumprida[] {
  const xs: Cumprida[] = [];
  for (const v of vendas) {
    const data = dataCivilSaoPaulo(v.venda_em);
    if (!data || mesNoAno(data, ano) == null) continue;
    xs.push({
      tipo: "venda",
      data,
      imovel: v.imovel?.trim() || "Imóvel sem descrição",
      codigo: v.codigo,
      papel: v.papel,
      comissao: visaoDaVenda(v),
    });
  }
  for (const c of captacoes) {
    const data = dataAprovacao(c);
    if (!data || mesNoAno(data, ano) == null) continue;
    xs.push({ tipo: "captacao", data, imovel: c.imovel?.trim() || "Imóvel sem descrição" });
  }
  return xs.sort((a, b) =>
    a.data === b.data ? a.tipo.localeCompare(b.tipo) : a.data < b.data ? 1 : -1,
  );
}

export function montarPainelCorretor(e: {
  userId: string;
  hoje: string;
  plano: {
    respostas?: Respostas | null;
    assinadoEm?: string | null;
    metaOficial?: MetaOficialGravada | null;
    metaOficialEm?: string | null;
  } | null;
  padrao?: Partial<TaxasFunil> | null;
  vendas: readonly ComissaoVendaCorretor[];
  captacoesContagem: { ano: number | null; mes: number | null };
  captacoes: readonly CaptacaoCorretor[];
}): PainelCorretor {
  const pos = posicaoNoAno(e.hoje);
  // Regra ÚNICA do selo (consolidado.ts): a mesma que soma a meta da equipe e da imobiliária (t_bd480fee).
  const { situacao, meta, selo, motivoAConferir } = planoComSelo(e.plano, e.padrao);
  const real = realizadoDoCorretor(e.userId, e.vendas, e.captacoesContagem, pos);
  const avaliacao = avaliarPessoa({ situacao, meta, selo }, real, pos);
  // Antes de jan/2027 a lista mostra o ano corrente (a tela carrega as vendas desse ano).
  const anoLista = pos.fase === "antes" ? Number(e.hoje.slice(0, 4)) : ANO_PLANO;
  const cumpridas = listaCumpridas(e.vendas, e.captacoes, anoLista);
  const vendasDoAno = cumpridas.filter((c) => c.tipo === "venda");
  const totalAno = {
    suaParte: r2(
      vendasDoAno.reduce((t, c) => t + (c.tipo === "venda" ? c.comissao.suaParte : 0), 0),
    ),
    descontado: r2(
      vendasDoAno.reduce(
        (t, c) => t + (c.tipo === "venda" ? c.comissao.descontadoDeVoce.total : 0),
        0,
      ),
    ),
  };
  return {
    situacao,
    selo,
    motivoMetaAConferir: motivoAConferir,
    pos,
    meta: contaNaMeta(selo) ? meta : null,
    avaliacao,
    cumpridas,
    totalAno,
    aConferir: (() => {
      const c = conferirPlano(e.plano?.respostas, e.padrao);
      return c.aConferir ? c.avisos.filter((a) => a.naMeta) : [];
    })(),
  };
}

/** Largura da barra (0–100) e posição da marca "onde deveria estar hoje" (0–100 ou null). Só exibição. */
export function larguraBarra(feito: number, alvo: number | null, esperado?: number | null) {
  if (alvo == null || !(alvo > 0)) return { pct: 0, marca: null as number | null };
  const lim = (x: number) => Math.max(0, Math.min(100, x));
  return {
    pct: lim((feito / alvo) * 100),
    marca: esperado == null ? null : lim((esperado / alvo) * 100),
  };
}
