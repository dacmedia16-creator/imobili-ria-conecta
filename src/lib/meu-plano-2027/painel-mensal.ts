/**
 * Meu painel mensal (p43): o corretor digita, no fim de cada mês, os 5 números REALIZADOS.
 *
 * Chaves nas respostas do plano (carreira_plano.respostas): `pm.<mes>.<coluna>`, mes = 1..12
 * (ex.: `pm.3.comissao`). Só leitura de respostas: NADA aqui altera calc(), a META DO ANO, o VGC,
 * o VGV, a meta oficial ou a assinatura.
 *
 * - TOTAL: Novas CREs, CREs revisadas, Transações e Comissão somam os meses preenchidos.
 *   CREs ativas é estoque: vale o último mês preenchido (não soma).
 * - % da meta = realizado ÷ META DO ANO; meta vazia ou 0 → sem porcentagem (NaN).
 * - Mês sem comissão (regra do primeiro mês): transações OU comissão preenchidas e comissão = 0.
 */
import { MESES } from "./listas";
import { num, ok, type Calc, type Respostas } from "./regras";

export const COLUNAS_PAINEL = ["novas", "ativas", "revisadas", "trans", "comissao"] as const;
export type ColunaPainel = (typeof COLUNAS_PAINEL)[number];

/** Chave da resposta (mes = 1..12). */
export const chavePainel = (mes: number, col: ColunaPainel) => `pm.${mes}.${col}`;

/** META DO ANO, na ordem das colunas (mesma conta que a tela já mostrava). */
export const metaPainel = (C: Calc): number[] => [
  C.novas,
  C.creFim,
  ok(C.revisarMes) ? C.revisarMes * 12 : NaN,
  C.transMeta,
  C.vgc,
];

export type MesPainel = {
  /** Valores digitados por coluna (NaN = vazio). */
  valores: number[];
  /** Destaque rosa: transações ou comissão preenchidas e comissão = 0. */
  semComissao: boolean;
};

export type Painel = {
  meta: number[];
  meses: MesPainel[];
  /** Realizado até agora por coluna (NaN = nenhum mês preenchido naquela coluna). */
  total: number[];
  /** Realizado ÷ meta (fração, 0.5 = 50%); NaN quando a meta está vazia/0 ou não há realizado. */
  pct: number[];
};

const ESTOQUE = COLUNAS_PAINEL.indexOf("ativas");
const TRANS = COLUNAS_PAINEL.indexOf("trans");
const COMISSAO = COLUNAS_PAINEL.indexOf("comissao");

export function painelMensal(S: Respostas, C: Calc): Painel {
  const meta = metaPainel(C);
  const meses: MesPainel[] = MESES.map((_, i) => {
    const valores = COLUNAS_PAINEL.map((c) => num(S[chavePainel(i + 1, c)]));
    const temTransOuCom = ok(valores[TRANS]) || ok(valores[COMISSAO]);
    const com = ok(valores[COMISSAO]) ? valores[COMISSAO] : 0;
    return { valores, semComissao: temTransOuCom && com === 0 };
  });
  const total = COLUNAS_PAINEL.map((_, j) => {
    const preenchidos = meses.map((m) => m.valores[j]).filter(ok);
    if (!preenchidos.length) return NaN;
    return j === ESTOQUE
      ? preenchidos[preenchidos.length - 1]
      : preenchidos.reduce((t, x) => t + x, 0);
  });
  const pct = total.map((t, j) => (ok(meta[j]) && meta[j] !== 0 && ok(t) ? t / meta[j] : NaN));
  return { meta, meses, total, pct };
}

/** "37%" (arredondado) ou "–" quando não há porcentagem. */
export const fmtPctMeta = (p: number) =>
  ok(p) ? `${Math.round(p * 100).toLocaleString("pt-BR")}%` : "–";
