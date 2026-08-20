/**
 * Filtros e atalhos de período do "Produção Gerada por Pessoa" — separado de
 * producao-por-pessoa-calc.ts porque não são fórmula financeira, é recorte/exibição da lista já
 * calculada. Mesmos atalhos de período do Comparativo 6%.
 */
import type { FiltrosProducao } from "@/lib/producao-por-pessoa-types";

const hojeISO = () => new Date().toISOString().slice(0, 10);
const pad2 = (n: number) => String(n).padStart(2, "0");
const isoDe = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export function anoAtualRange(): { de: string; ate: string } {
  const ano = new Date().getFullYear();
  return { de: `${ano}-01-01`, ate: hojeISO() };
}

export function mesAtualRange(): { de: string; ate: string } {
  const d = new Date();
  return { de: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`, ate: hojeISO() };
}

export function ultimosNDiasRange(n: number): { de: string; ate: string } {
  const ate = new Date();
  const de = new Date();
  de.setDate(de.getDate() - n);
  return { de: isoDe(de), ate: isoDe(ate) };
}

/** Filtro inicial da página: ano atual — nunca recalculado depois do primeiro render. */
export function filtrosPadrao(): FiltrosProducao {
  const { de, ate } = anoAtualRange();
  return { dataDe: de, dataAte: ate, pessoaId: null, teamId: null, tipo: "todas" };
}
