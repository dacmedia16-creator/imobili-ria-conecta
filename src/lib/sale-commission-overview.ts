import type { CommissionExtraRow, SaleRow } from "./database.types";
import { COMISSAO_PAPEIS } from "./status";

export type CommissionLine = { label: string; value: number; percent: number };
type Distribution = {
  comissao_bruta?: number | null;
  parte_remax?: number | null;
  parceria_externa?: number | null;
  liquido_captador?: number | null;
  liquido_vendedor?: number | null;
  indicador_captador?: number | null;
  indicador_vendedor?: number | null;
  saldo_liquido_imobiliaria?: number | null;
  total_distribuido?: number | null;
  diferenca_restante?: number | null;
};

/** Linhas que somam a comissão bruta uma única vez: indicador e extras saem do bruto
 * do respectivo lado, e não podem ser somados a ele novamente. */
export function commissionOverview(
  sale: SaleRow,
  distribution: Distribution | null,
  extras: CommissionExtraRow[],
): { lines: CommissionLine[]; total: number; difference: number } {
  const total = Number(distribution?.comissao_bruta ?? sale.valor_total_comissao ?? 0);
  const lines: CommissionLine[] = [];
  const add = (label: string, value: number | null | undefined) => {
    const amount = Number(value ?? 0);
    if (Math.abs(amount) >= 0.005)
      lines.push({ label, value: amount, percent: total ? 100 * amount / total : 0 });
  };
  // REMAX é base intermediária da distribuição, não pagamento adicional:
  // exibi-la também como linha paga contaria captador/vendedor/imobiliária duas vezes.
  // Uma diferença entre total bruto e parte REMAX + parceria permanece visível no fechamento.
  add(`Captador${sale.corretor_captador ? ` — ${sale.corretor_captador}` : ""} (líquido)`, distribution?.liquido_captador ?? sale.valor_comissao_captador);
  add(`Vendedor${sale.corretor_vendedor ? ` — ${sale.corretor_vendedor}` : ""} (líquido)`, distribution?.liquido_vendedor ?? sale.valor_comissao_vendedor);
  add(`Indicador do captador${sale.indicador_captador ? ` — ${sale.indicador_captador}` : ""}`, distribution?.indicador_captador ?? sale.valor_comissao_indicador_captador);
  add(`Indicador do vendedor${sale.indicador_vendedor ? ` — ${sale.indicador_vendedor}` : ""}`, distribution?.indicador_vendedor ?? sale.valor_comissao_indicador_vendedor);
  add(`Líder do captador${sale.lider_captador_nome ? ` — ${sale.lider_captador_nome}` : ""}`, sale.valor_comissao_lider_captador);
  add(`Líder do vendedor${sale.lider_vendedor_nome ? ` — ${sale.lider_vendedor_nome}` : ""}`, sale.valor_comissao_lider_vendedor);
  extras.forEach((e) => add(`${COMISSAO_PAPEIS.find((p) => p.key === e.papel)?.label ?? e.papel}${e.nome ? ` — ${e.nome}` : ""}`, e.valor));
  add(`Parceria externa${sale.parceria_nome ? ` — ${sale.parceria_nome}` : ""}`, distribution?.parceria_externa ?? sale.parceria_valor);
  add("Imobiliária (saldo líquido)", distribution?.saldo_liquido_imobiliaria ?? sale.valor_comissao_imobiliaria);
  const sum = lines.reduce((value, line) => value + line.value, 0);
  return { lines, total, difference: Math.round((total - sum) * 100) / 100 };
}
