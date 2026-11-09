// Filtro "Minhas vendas / Do time" do bloco "Meu dinheiro" (t_31729652). Só LEITURA, com a RLS de
// sempre (occ_view / occ_comm_view = vendas visíveis ao usuário): busca as linhas de comissão do
// PRÓPRIO usuário nas vendas que a RPC minhas_comissoes já devolveu, para separar a parte pessoal da
// parte de time. Não grava nada e não muda valor nenhum: se algo falhar, a tela fica como antes.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinhaParte } from "@/lib/meu-dinheiro";

// shortcut: lotes de 100 vendas para a URL do filtro `in` não estourar; cada lote fica bem abaixo do
// limite de linhas do PostgREST (uma venda tem 1 ocorrência e poucas linhas do mesmo usuário).
const LOTE = 100;

export async function buscarPartesMinhas(
  db: SupabaseClient,
  userId: string,
  saleIds: string[],
): Promise<LinhaParte[]> {
  const out: LinhaParte[] = [];
  for (let i = 0; i < saleIds.length; i += LOTE) {
    const lote = saleIds.slice(i, i + LOTE);
    const { data: occs, error: e1 } = await db
      .from("occurrences")
      .select("id, sale_id")
      .in("sale_id", lote);
    if (e1) throw e1;
    const venda = new Map(
      ((occs ?? []) as { id: string; sale_id: string }[]).map((o) => [o.id, o.sale_id]),
    );
    if (venda.size === 0) continue;
    const { data, error } = await db
      .from("occurrence_commissions")
      .select("occurrence_id, papel, valor, sem_cadastro_confirmado")
      .eq("user_id", userId)
      .in("occurrence_id", [...venda.keys()]);
    if (error) throw error;
    for (const r of (data ?? []) as {
      occurrence_id: string;
      papel: string | null;
      valor: unknown;
      sem_cadastro_confirmado: boolean | null;
    }[]) {
      const sale_id = venda.get(r.occurrence_id);
      if (sale_id)
        out.push({
          sale_id,
          papel: r.papel,
          valor: r.valor,
          sem_cadastro_confirmado: r.sem_cadastro_confirmado,
        });
    }
  }
  return out;
}
