/**
 * Filtros, ordenação e atalhos de período do Comparativo 6% — separado de
 * comparativo-comissao-calc.ts porque não são fórmulas financeiras, são regras de recorte/exibição
 * da lista já calculada.
 */
import type { ComparativoFiltros, ComparativoRowComCalculo, OrdenacaoCampo, OrdenacaoDirecao } from "@/lib/comparativo-comissao-types";

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

/** Filtro inicial da página: ano atual, como pedido — nunca recalculado depois do primeiro render
 * (senão o período mudaria sozinho se a aba ficasse aberta virando o ano). */
export function filtrosPadrao(): ComparativoFiltros {
  const { de, ate } = anoAtualRange();
  return { dataDe: de, dataAte: ate, modalidade: "todas", situacao: "todas", corretorId: null, teamId: null, busca: "" };
}

export function aplicarFiltros(rows: ComparativoRowComCalculo[], filtros: ComparativoFiltros): ComparativoRowComCalculo[] {
  const buscaLower = filtros.busca.trim().toLowerCase();
  return rows.filter((r) => {
    if (filtros.dataDe && r.data_fechamento < filtros.dataDe) return false;
    if (filtros.dataAte && r.data_fechamento > filtros.dataAte) return false;
    if (filtros.modalidade !== "todas" && r.modalidade !== filtros.modalidade) return false;
    if (filtros.situacao !== "todas" && r.situacao !== filtros.situacao) return false;
    if (filtros.corretorId && r.corretor_id !== filtros.corretorId) return false;
    if (filtros.teamId && r.teamId !== filtros.teamId) return false;
    if (buscaLower) {
      const alvo = `${r.codigo_interno ?? ""} ${r.imovel_id ?? ""}`.toLowerCase();
      if (!alvo.includes(buscaLower)) return false;
    }
    return true;
  });
}

const CAMPO_VALOR: Record<OrdenacaoCampo, (r: ComparativoRowComCalculo) => number> = {
  data: (r) => new Date(r.data_fechamento).getTime(),
  valor_negociado: (r) => Number(r.valor_negociado ?? 0),
  valor_comissao: (r) => Number(r.valor_total_comissao ?? 0),
  percentual_real: (r) => r.percentualReal ?? -Infinity,
  vgv_equivalente: (r) => r.vgvEquivalente6 ?? -Infinity,
  // "Maior diferença" ordena pela magnitude do desvio (positivo ou negativo), não pelo valor com
  // sinal — uma venda 7% acima e outra 3% abaixo são igualmente "diferentes" do padrão de 6%.
  diferenca: (r) => Math.abs(r.diferencaVgv ?? 0),
};

export function ordenar(rows: ComparativoRowComCalculo[], campo: OrdenacaoCampo, direcao: OrdenacaoDirecao): ComparativoRowComCalculo[] {
  const valor = CAMPO_VALOR[campo];
  const sinal = direcao === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sinal * (valor(a) - valor(b)));
}
