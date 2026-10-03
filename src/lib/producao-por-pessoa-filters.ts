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

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

const dataBR = (iso: string) => {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
};

/** Texto do período filtrado para o cabeçalho e a impressão: "setembro de 2026" quando o filtro
 * cobre exatamente um mês; senão "01/09/2026 a 15/09/2026". */
export function descreverPeriodo(filtros: Pick<FiltrosProducao, "dataDe" | "dataAte">): string {
  const { dataDe, dataAte } = filtros;
  if (!dataDe || !dataAte) return "período não definido";
  const mes = dataDe.slice(0, 7);
  const cheio = mesRange(mes);
  if (cheio.de === dataDe && cheio.ate === dataAte) {
    const [ano, numeroMes] = mes.split("-").map(Number);
    return `${MESES[numeroMes - 1]} de ${ano}`;
  }
  return `${dataBR(dataDe)} a ${dataBR(dataAte)}`;
}

export function mesSelecionado(filtros: Pick<FiltrosProducao, "dataDe" | "dataAte">): string {
  return filtros.dataDe.slice(0, 7);
}

/** Filtro inicial da página: mês atual — nunca recalculado depois do primeiro render. */
export function filtrosPadrao(): FiltrosProducao {
  const { de, ate } = mesAtualRange();
  return {
    dataDe: de,
    dataAte: ate,
    pessoaId: null,
    teamId: null,
    modalidade: "todas",
    tipo: "todas",
  };
}
