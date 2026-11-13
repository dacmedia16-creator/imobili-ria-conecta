/**
 * Distribuição mês a mês das metas de 2027 (só planejamento).
 *
 * O corretor pode digitar o valor de cada mês (chaves `mt.mes.<linha>.<1..12>` nas respostas do plano).
 * Mês vazio usa a sugestão (meta anual ÷ 12). A soma dos 12 meses é só conferência: se não bater com a
 * meta anual, a tela/PDF mostram um aviso, sem bloquear nada. NADA aqui altera calc() — a meta anual,
 * o VGC, o estoque, o clube e os KRIs continuam vindo só de calc().
 */
import { MESES } from "./listas";
import { num, ok, type Calc, type Respostas } from "./regras";

export type IdLinhaMes = "novas" | "canc" | "vendidas" | "trans" | "vgc";

/** Linhas da tabela (mesma ordem e rótulos da tabela anterior). VGC fica em R$ mil, como antes. */
export const LINHAS_MES: { id: IdLinhaMes; rot: string; anual: (C: Calc) => number }[] = [
  { id: "novas", rot: "Novas CREs", anual: (C) => C.novas },
  { id: "canc", rot: "Canceladas/expiradas", anual: (C) => C.canc },
  { id: "vendidas", rot: "CREs vendidas", anual: (C) => C.vendidas },
  { id: "trans", rot: "Transações", anual: (C) => C.transMeta },
  { id: "vgc", rot: "VGC (R$ mil)", anual: (C) => C.vgc / 1000 },
];

/** Chave da resposta de um mês (mes = 1..12). */
export const chaveMes = (linha: IdLinhaMes, mes: number) => `mt.mes.${linha}.${mes}`;

export type MesDist = { digitado: number; usado: number; temValor: boolean };
export type LinhaDist = {
  id: IdLinhaMes;
  rot: string;
  anual: number;
  sugestao: number;
  meses: MesDist[];
  /** Soma dos 12 meses (sugestão nos vazios). Sem nenhum mês digitado = a própria meta anual. */
  total: number;
  algumDigitado: boolean;
  /** Soma ≠ meta anual (comparado com 1 casa decimal, a precisão exibida). */
  diverge: boolean;
};

const r1 = (v: number) => Math.round(v * 10);

export function distribuicaoMes(S: Respostas, C: Calc): LinhaDist[] {
  return LINHAS_MES.map(({ id, rot, anual: f }) => {
    const anual = f(C);
    const sugestao = ok(anual) ? anual / 12 : NaN;
    const meses = MESES.map((_, i) => {
      const digitado = num(S[chaveMes(id, i + 1)]);
      const temValor = ok(digitado);
      return { digitado, usado: temValor ? digitado : sugestao, temValor };
    });
    const algumDigitado = meses.some((m) => m.temValor);
    const total = algumDigitado
      ? meses.reduce((t, m) => t + (ok(m.usado) ? m.usado : 0), 0)
      : anual;
    const diverge = algumDigitado && ok(anual) && r1(total) !== r1(anual);
    return { id, rot, anual, sugestao, meses, total, algumDigitado, diverge };
  });
}

/** Algum mês digitado em qualquer linha (o título deixa de dizer "÷ 12"). */
export const temMesDigitado = (L: LinhaDist[]) => L.some((l) => l.algumDigitado);
