/**
 * Regra comercial do produto ADM MAX — configuração central versionada (multiempresa, marco 1e).
 *
 * Decisão de Denis (27/09/2026): a MESMA regra vale para todas as agências (a regra atual da
 * Única Escolha vira o padrão do produto). Não há tela de regra por agência.
 *
 * Vendas antigas NÃO são recalculadas: percentuais e valores efetivos ficam gravados em cada venda
 * (`sales.percentual_*`, `valor_*`, ocorrências). Esta configuração só alimenta referências e
 * comparativos (ex.: "Comparativo 6%"). Para mudar a regra no futuro, adicione uma NOVA versão com
 * `vigenteDesde` e mantenha as anteriores — nunca edite uma versão já publicada.
 */
export type RegraComercialVersao = {
  versao: number;
  /** Data (AAAA-MM-DD) a partir da qual a versão vale. */
  vigenteDesde: string;
  /** Comissão padrão de referência, em % do valor negociado. */
  percentualComissaoPadrao: number;
};

export const REGRAS_COMERCIAIS: readonly RegraComercialVersao[] = Object.freeze([
  Object.freeze({ versao: 1, vigenteDesde: "2000-01-01", percentualComissaoPadrao: 6 }),
]);

/** Versão vigente numa data (padrão: hoje). Ordena por vigência; falha se nada vigorar. */
export function regraComercialVigente(data: string = new Date().toISOString().slice(0, 10)) {
  const vigentes = [...REGRAS_COMERCIAIS]
    .filter((r) => r.vigenteDesde <= data)
    .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde));
  if (vigentes.length === 0) throw new Error(`Nenhuma regra comercial vigente em ${data}.`);
  return vigentes[0];
}

/** Referência estática de 6% (inclusive no carregamento do Worker, quando o relógio pode ser 1970).
 * A seleção por data deve acontecer em funções executadas após a requisição, via regraComercialVigente(). */
export const PERCENTUAL_COMISSAO_PADRAO = REGRAS_COMERCIAIS[0].percentualComissaoPadrao;
