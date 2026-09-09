import type { VendaComercialValida } from "./vendas-comerciais-query";

type VendaComData = {
  id: string;
  modalidade: string | null;
  data_assinatura: string | null;
};
type AssinaturaOcorrencia = { sale_id: string; data_assinatura: string | null };

/** Datas civis permanecem YYYY-MM-DD: converter o fim do dia para UTC invade o mês seguinte. */
export function selecionarVendasComerciais<T extends VendaComData>(
  rows: T[],
  validas: VendaComercialValida[],
  occurrences: AssinaturaOcorrencia[],
  periodo: { desde?: string; ate?: string },
): Array<T & { data_venda: string }> {
  const marcos = new Map(validas.map((venda) => [venda.sale_id, venda.venda_em]));
  const assinaturas = new Map(occurrences.map((occ) => [occ.sale_id, occ.data_assinatura]));
  const unicas = new Map(rows.map((row) => [row.id, row]));
  return [...unicas.values()]
    .flatMap((row) => {
      // A RPC é a única autoridade de elegibilidade (inclui status atual + histórico válido).
      const marco = marcos.get(row.id);
      if (!marco) return [];
      const lancamento = row.modalidade === "lancamento";
      let data = lancamento ? row.data_assinatura : assinaturas.get(row.id);
      // Lançamento não passa por contrato_assinado e pode legitimamente não ter assinatura.
      // Nesse caso apenas, usar entrada canônica no Financeiro no fuso comercial do sistema.
      if (!data && lancamento) {
        data = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Sao_Paulo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(marco));
      }
      if (!data || (periodo.desde && data < periodo.desde) || (periodo.ate && data > periodo.ate)) {
        return [];
      }
      return [{ ...row, data_venda: data }];
    })
    .sort((a, b) => b.data_venda.localeCompare(a.data_venda) || a.id.localeCompare(b.id));
}
