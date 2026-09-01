/**
 * Filtros e atalhos de período do "Produção Gerada por Pessoa" — separado de
 * producao-por-pessoa-calc.ts porque não são fórmula financeira, é recorte/exibição da lista já
 * calculada. Mesmos atalhos de período do Comparativo 6%.
 */
import type { FiltrosProducao } from "@/lib/producao-por-pessoa-types";

const pad2 = (n: number) => String(n).padStart(2, "0");

export function mesRange(mes: string): { de: string; ate: string } {
  const [ano, numeroMes] = mes.split("-").map(Number);
  const ultimoDia = new Date(ano, numeroMes, 0).getDate();
  return { de: `${mes}-01`, ate: `${mes}-${pad2(ultimoDia)}` };
}

export function mesAtualRange(): { de: string; ate: string } {
  const d = new Date();
  return mesRange(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
}

export function mesAnteriorRange(): { de: string; ate: string } {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return mesRange(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
}

export function mesSelecionado(filtros: Pick<FiltrosProducao, "dataDe" | "dataAte">): string {
  return filtros.dataDe.slice(0, 7);
}

/** Filtro inicial da página: mês atual — nunca recalculado depois do primeiro render. */
export function filtrosPadrao(): FiltrosProducao {
  const { de, ate } = mesAtualRange();
  return { dataDe: de, dataAte: ate, pessoaId: null, teamId: null, tipo: "todas" };
}
