import { supabase } from "@/integrations/supabase/client";
import { dataAssinaturaOficial, ultimasAssinaturasPorVenda } from "@/lib/data-assinatura-oficial";

type LinhaRecente = {
  id: string;
  created_at: string;
  modalidade?: string | null;
  data_assinatura?: string | null;
};

/**
 * Data oficial da venda (mesma regra de public.data_assinatura_oficial e da lista Vendas), sem
 * reordenar os itens recentes. Duas consultas em lote (só os IDs exibidos), sob a RLS do usuário.
 */
export async function aplicarDatasRecentes<T extends LinhaRecente>(
  rows: T[],
): Promise<Array<T & { data_venda: string | null }>> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  try {
    const [occRes, histRes] = await Promise.all([
      supabase.from("occurrences").select("sale_id, data_assinatura").in("sale_id", ids),
      supabase
        .from("sale_status_history")
        .select("sale_id, created_at")
        .eq("para", "contrato_assinado")
        .in("sale_id", ids),
    ]);
    if (occRes.error) throw occRes.error;
    if (histRes.error) throw histRes.error;
    const occPorVenda = new Map(
      (occRes.data ?? []).map((occ) => [occ.sale_id, occ.data_assinatura]),
    );
    const ultimaPorVenda = ultimasAssinaturasPorVenda(histRes.data ?? []);
    return rows.map((row) => ({
      ...row,
      data_venda:
        dataAssinaturaOficial({
          modalidade: row.modalidade,
          saleDataAssinatura: row.data_assinatura,
          ultimaAssinatura: ultimaPorVenda.get(row.id),
          occDataAssinatura: occPorVenda.get(row.id),
        }) ?? row.created_at.slice(0, 10),
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
