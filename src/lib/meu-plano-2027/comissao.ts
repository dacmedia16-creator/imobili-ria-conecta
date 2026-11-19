/**
 * Trava do campo "Comissão média por transação" (tela Metas, p32) — Denis, 19/11, t_c14dccfe.
 * O campo é em REAIS. Quem digita "40%" (comissão em porcentagem) fazia o VGC cair para R$ 1.960.
 * - "%" não é aceito: a digitação é recusada e aparece MSG_COMISSAO_PCT.
 * - Valor abaixo de R$ 1.000 só gera aviso (não bloqueia, ainda grava). Vale também para planos
 *   antigos já gravados: nada é alterado no banco, o aviso só aparece ao abrir a tela.
 */
import { num, ok, type Valor } from "./regras";

export const COMISSAO_MINIMA_REAIS = 1000;
export const MSG_COMISSAO_PCT = "Digite o valor em reais, ex.: 12000";
export const MSG_COMISSAO_BAIXA = "Esse valor parece baixo. A comissão é em reais, não em %.";

/** O texto digitado tem "%" (deve ser recusado no campo em reais). */
export const temPorcento = (txt: string) => txt.includes("%");

/** Valor preenchido (digitado ou já gravado) abaixo de R$ 1.000. Vazio não avisa. */
export function comissaoBaixa(v: Valor): boolean {
  const n = num(v);
  return ok(n) && n < COMISSAO_MINIMA_REAIS;
}
