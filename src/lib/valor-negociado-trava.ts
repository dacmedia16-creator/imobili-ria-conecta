import { formatBRL } from "@/lib/formato-moeda";

/**
 * Trava de valor negociado absurdo (t_9f5f3ae2, aprovada por Denis em 17/11).
 *
 * Premissa do MAX, fácil de ajustar: mude só os números abaixo.
 * - Com valor anunciado: o negociado precisa ficar entre METADE e o DOBRO do anunciado.
 * - Sem valor anunciado: vale só o teto absoluto.
 * O teto absoluto também existe no banco (CHECK sales_valor_negociado_teto). Se mudar o teto aqui,
 * mude também a migration, senão a tela aceita e o banco recusa (ou o contrário).
 */
export const VALOR_NEGOCIADO_LIMITES = {
  /** Negociado acima de (anunciado × este número) é bloqueado. */
  multiploMaximoDoAnunciado: 2,
  /** Negociado abaixo de (anunciado × este número) é bloqueado. */
  fracaoMinimaDoAnunciado: 0.5,
  /** Teto absoluto em reais, com ou sem anunciado. Igual ao CHECK do banco. */
  tetoAbsoluto: 100_000_000,
} as const;

/** Nome do CHECK no banco, para traduzir o erro 23514 numa mensagem clara. */
export const VALOR_NEGOCIADO_TETO_CONSTRAINT = "sales_valor_negociado_teto";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Devolve a mensagem de bloqueio, ou null se o valor pode ser salvo. Valor vazio ou zero não é
 * bloqueado aqui (a obrigatoriedade continua com as regras de envio que já existem).
 */
export function erroValorNegociado(
  valorNegociado: unknown,
  valorAnunciado: unknown,
  limites = VALOR_NEGOCIADO_LIMITES,
): string | null {
  const negociado = num(valorNegociado);
  if (negociado === null || negociado <= 0) return null;
  // Com anunciado, a comparação vem primeiro: a mensagem mostra o valor de referência.
  const anunciado = num(valorAnunciado);
  if (
    anunciado !== null &&
    anunciado > 0 &&
    (negociado > anunciado * limites.multiploMaximoDoAnunciado ||
      negociado < anunciado * limites.fracaoMinimaDoAnunciado)
  )
    return `O valor negociado está muito diferente do anunciado (${formatBRL(anunciado)}). Confira os zeros.`;
  if (negociado > limites.tetoAbsoluto)
    return `O valor negociado passa do limite de ${formatBRL(limites.tetoAbsoluto)}. Confira os zeros.`;
  return null;
}

/**
 * Só confere quando o valor negociado ou o anunciado está sendo alterado. Assim uma venda antiga
 * fora da faixa (ex.: anunciado digitado errado numa venda já concluída) não trava a edição de
 * outros campos.
 */
export function erroValorNegociadoNoPatch(
  patch: Record<string, unknown>,
  atual: { valor_negociado?: unknown; valor_anunciado?: unknown },
): string | null {
  if (!("valor_negociado" in patch) && !("valor_anunciado" in patch)) return null;
  const negociado = "valor_negociado" in patch ? patch.valor_negociado : atual.valor_negociado;
  const anunciado = "valor_anunciado" in patch ? patch.valor_anunciado : atual.valor_anunciado;
  return erroValorNegociado(negociado, anunciado);
}

/** Erro do banco vindo do CHECK de teto → mensagem clara; senão null. */
export function mensagemErroTetoBanco(error: unknown): string | null {
  const msg =
    error && typeof error === "object" && "message" in error ? String(error.message ?? "") : "";
  if (!msg.includes(VALOR_NEGOCIADO_TETO_CONSTRAINT)) return null;
  return `O valor negociado passa do limite de ${formatBRL(VALOR_NEGOCIADO_LIMITES.tetoAbsoluto)}. Confira os zeros.`;
}
