import { supabase } from "@/integrations/supabase/client";
import { dataAssinaturaOficial, ultimasAssinaturasPorVenda } from "@/lib/data-assinatura-oficial";
import { dataCivilSaoPaulo } from "@/lib/hoje-sao-paulo";

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
): Promise<Array<T & { data_venda: string | null; assinada: boolean }>> {
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
    return rows.map((row) => {
      const oficial = dataAssinaturaOficial({
        modalidade: row.modalidade,
        saleDataAssinatura: row.data_assinatura,
        ultimaAssinatura: ultimaPorVenda.get(row.id),
        occDataAssinatura: occPorVenda.get(row.id),
      });
      // `assinada` só diz se data_venda veio de uma assinatura (legenda na tela); a data não muda.
      return { ...row, data_venda: oficial ?? row.created_at.slice(0, 10), assinada: oficial != null };
    });
  } catch {
    // Falha de leitura não confirma ausência de assinatura. Preserva a venda, sem inventar data.
    return rows.map((row) => ({ ...row, data_venda: null, assinada: false }));
  }
}

const dd_mm_aaaa = (data: string) => {
  const [ano, mes, dia] = data.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
};

/**
 * Legenda das datas da venda recente (mesmo vocabulário da lista de Vendas):
 * "Criada em dd/mm/aaaa" + "Assinada em dd/mm/aaaa" / "Ainda não assinada".
 */
export function legendasDataRecente(v: {
  created_at: string;
  data_venda: string | null;
  assinada?: boolean;
}): string[] {
  const criada = dataCivilSaoPaulo(v.created_at);
  const linhas = [`Criada em ${criada ? dd_mm_aaaa(criada) : "—"}`];
  if (!v.data_venda) linhas.push("Data da assinatura indisponível");
  else linhas.push(v.assinada ? `Assinada em ${dd_mm_aaaa(v.data_venda)}` : "Ainda não assinada");
  return linhas;
}
