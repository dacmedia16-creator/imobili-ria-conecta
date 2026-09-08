import { supabase } from "@/integrations/supabase/client";

/** Mesma data da lista Vendas, sem reordenar os itens recentes. */
export async function aplicarDatasRecentes<T extends { id: string; created_at: string }>(
  rows: T[],
): Promise<Array<T & { data_venda: string | null }>> {
  if (!rows.length) return [];
  try {
    const { data, error } = await supabase
      .from("occurrences")
      .select("sale_id, data_assinatura")
      .in(
        "sale_id",
        rows.map((row) => row.id),
      );
    if (error) throw error;
    const assinaturaPorVenda = new Map(
      (data ?? []).map((occ) => [occ.sale_id, occ.data_assinatura]),
    );
    return rows.map((row) => ({
      ...row,
      data_venda: assinaturaPorVenda.get(row.id) ?? row.created_at.slice(0, 10),
    }));
  } catch {
    // Falha de leitura não confirma ausência de assinatura. Preserva a venda, sem inventar data.
    return rows.map((row) => ({ ...row, data_venda: null }));
  }
}

export function formatarDataRecente(data: string | null): string {
  if (!data) return "Data indisponível";
  const [ano, mes, dia] = data.split("-");
  return `Data: ${dia}/${mes}/${ano}`;
}
