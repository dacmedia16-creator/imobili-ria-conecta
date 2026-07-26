import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/auth";

export type DeletableSale = { id: string; corretor_id: string | null };

export function canDeleteSale(
  userId: string | null | undefined,
  hasAny: (roles: AppRole[]) => boolean,
  sale: DeletableSale,
  teamMemberIds: Set<string>,
): boolean {
  if (!userId) return false;
  if (hasAny(["super_admin", "admin", "financeiro"])) return true;
  if (sale.corretor_id === userId) return true;
  if (hasAny(["gestor"]) && sale.corretor_id && teamMemberIds.has(sale.corretor_id)) return true;
  return false;
}

/**
 * Deleta a venda (sale_documents cai junto via ON DELETE CASCADE) e só depois limpa o storage.
 * Nessa ordem: se a exclusão da venda falhar (RLS, rede), nada foi perdido — os arquivos continuam
 * intactos. Na ordem inversa (storage antes do banco), uma falha no passo do banco deixava a venda
 * viva mas com os documentos já apagados do storage, sem como recuperar.
 */
export async function deleteSaleCascade(saleId: string): Promise<void> {
  const { data: docs } = await supabase
    .from("sale_documents")
    .select("storage_path")
    .eq("sale_id", saleId);
  const paths = (docs ?? []).map((d: any) => d.storage_path).filter(Boolean);

  const { error } = await supabase.from("sales").delete().eq("id", saleId);
  if (error) throw error;

  if (paths.length > 0) {
    await supabase.storage.from("sale-documents").remove(paths);
  }
}
