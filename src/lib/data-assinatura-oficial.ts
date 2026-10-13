import { dataCivilSaoPaulo } from "@/lib/hoje-sao-paulo";

// Data oficial da venda no front — espelho de public.data_assinatura_oficial(uuid)
// (migration 20261013130000, regra de Denis 27/09 e 13/10/2026):
//   COALESCE(
//     Lançamento -> sales.data_assinatura,
//     ÚLTIMO contrato_assinado em sale_status_history (data civil de São Paulo),
//     occurrences.data_assinatura,
//     sales.data_assinatura)
// Os chamadores leem o histórico sob a RLS do usuário (history_view = can_view_sale) ou de RPCs já
// existentes; nenhum perfil passa a enxergar vendas que já não enxergava.

export type EntradaDataOficial = {
  modalidade: string | null | undefined;
  saleDataAssinatura: string | null | undefined;
  /** Data civil SP (YYYY-MM-DD) ou timestamptz do último contrato_assinado. */
  ultimaAssinatura: string | null | undefined;
  occDataAssinatura: string | null | undefined;
};

const soData = (v: string | null | undefined): string | null => dataCivilSaoPaulo(v ?? null);

export function dataAssinaturaOficial(e: EntradaDataOficial): string | null {
  return (
    (e.modalidade === "lancamento" ? soData(e.saleDataAssinatura) : null) ??
    soData(e.ultimaAssinatura) ??
    soData(e.occDataAssinatura) ??
    soData(e.saleDataAssinatura)
  );
}

/**
 * Data oficial para quem já tem `venda_em` de vendas_comerciais_validas() (Relatórios). Só vendas
 * elegíveis (com venda_em) têm data; a elegibilidade não muda. Na venda padrão venda_em já é o
 * último contrato_assinado; no Lançamento ele pode ser a entrada no Financeiro, então a regra
 * oficial (sales.data_assinatura → ocorrência) tem prioridade.
 */
export function dataOficialVendaComercial(e: {
  vendaEm: string | null | undefined;
  modalidade: string | null | undefined;
  saleDataAssinatura: string | null | undefined;
  occDataAssinatura: string | null | undefined;
}): string | null {
  if (!e.vendaEm) return null;
  if (e.modalidade !== "lancamento") return soData(e.vendaEm);
  return soData(e.saleDataAssinatura) ?? soData(e.occDataAssinatura) ?? soData(e.vendaEm);
}

/** Reduz linhas do histórico ao ÚLTIMO contrato_assinado por venda (data civil SP). */
export function ultimasAssinaturasPorVenda(
  linhas: ReadonlyArray<{ sale_id: string; created_at: string }>,
): Map<string, string> {
  const maxInstante = new Map<string, number>();
  for (const l of linhas) {
    const t = new Date(l.created_at).getTime();
    if (Number.isNaN(t)) continue;
    const atual = maxInstante.get(l.sale_id);
    if (atual == null || t > atual) maxInstante.set(l.sale_id, t);
  }
  const out = new Map<string, string>();
  for (const [saleId, t] of maxInstante) {
    const d = dataCivilSaoPaulo(new Date(t).toISOString());
    if (d) out.set(saleId, d);
  }
  return out;
}
