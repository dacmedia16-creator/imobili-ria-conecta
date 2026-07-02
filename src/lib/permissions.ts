import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/auth";

export type DeletableSale = { id: string; corretor_id: string | null };

export function canDeleteSale(
  userId: string | null | undefined,
  hasAny: (roles: string[]) => boolean,
  sale: DeletableSale,
  teamMemberIds: Set<string>,
): boolean {
  if (!userId) return false;
  if (hasAny(["super_admin", "admin", "financeiro"])) return true;
  if (sale.corretor_id === userId) return true;
  if (hasAny(["gestor"]) && sale.corretor_id && teamMemberIds.has(sale.corretor_id)) return true;
  return false;
}

/** Remove os arquivos do storage e depois deleta a venda. RLS decide o acesso. */
export async function deleteSaleCascade(saleId: string): Promise<void> {
  const { data: docs } = await supabase
    .from("sale_documents")
    .select("storage_path")
    .eq("sale_id", saleId);
  const paths = (docs ?? []).map((d: any) => d.storage_path).filter(Boolean);
  if (paths.length > 0) {
    await supabase.storage.from("sale-documents").remove(paths);
  }
  const { error } = await supabase.from("sales").delete().eq("id", saleId);
  if (error) throw error;
}
