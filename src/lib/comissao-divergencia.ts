/**
 * Comissão da venda × comissão da ocorrência (t_59cb12e0).
 *
 * A Revisão e o relatório da ocorrência leem o cabeçalho da OCORRÊNCIA (percentual_comissao /
 * valor_comissao). Quando o Financeiro/Admin edita a comissão na VENDA, o banco copia para a ocorrência
 * enquanto ela não foi aceita (migration 20261104160000). Depois do aceite, ou em registros antigos,
 * as duas podem ficar diferentes — esta função detecta isso para mostrar o aviso.
 */

type ComissaoVenda = {
  percentual_comissao?: number | string | null;
  valor_total_comissao?: number | string | null;
  modalidade?: string | null;
};
type ComissaoOcorrencia = {
  percentual_comissao?: number | string | null;
  valor_comissao?: number | string | null;
};

export type ComissaoDivergencia = {
  percentualVenda: number | null;
  percentualOcorrencia: number | null;
  valorVenda: number | null;
  valorOcorrencia: number | null;
  percentualDiferente: boolean;
  valorDiferente: boolean;
};

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Devolve a divergência ou null quando venda e ocorrência batem (ou falta um dos lados).
 * shortcut: o percentual é comparado com 1 casa decimal (5,964% = 6%) para não acusar diferença só de
 * arredondamento quando o valor em reais é o mesmo; o valor é comparado ao centavo.
 */
export function divergenciaComissao(
  sale: ComissaoVenda | null | undefined,
  occ: ComissaoOcorrencia | null | undefined,
): ComissaoDivergencia | null {
  if (!sale || !occ) return null;
  if (sale.modalidade === "lancamento") return null;
  const percentualVenda = num(sale.percentual_comissao);
  const percentualOcorrencia = num(occ.percentual_comissao);
  const valorVenda = num(sale.valor_total_comissao);
  const valorOcorrencia = num(occ.valor_comissao);

  const valorDiferente =
    valorVenda !== null &&
    valorOcorrencia !== null &&
    Math.abs(Math.round(valorVenda * 100) - Math.round(valorOcorrencia * 100)) >= 1;
  const percentualDiferente =
    percentualVenda !== null &&
    percentualOcorrencia !== null &&
    Math.round(percentualVenda * 10) !== Math.round(percentualOcorrencia * 10);

  if (!valorDiferente && !percentualDiferente) return null;
  return {
    percentualVenda,
    percentualOcorrencia,
    valorVenda,
    valorOcorrencia,
    percentualDiferente,
    valorDiferente,
  };
}

/** "Nossa parte (desconta parceria)": comissão total da ocorrência menos o que vai para as parcerias. */
export function nossaParteComissao(
  valorComissao: number | string | null | undefined,
  parcerias: { valor?: number | string | null }[],
): number {
  const total = num(valorComissao) ?? 0;
  const parceria = parcerias.reduce((s, p) => s + (num(p.valor) ?? 0), 0);
  return Math.round((total - parceria) * 100) / 100;
}

/** Texto da linha do lado REMAX na tabela de distribuição: base informativa, não um recebedor. */
export const ROTULO_LADO_REMAX = "Lado REMAX (base)";
export const DESCRICAO_LADO_REMAX = "Base do lado REMAX — já distribuída nas linhas acima";
