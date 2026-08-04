import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/auth";

export type DeletableSale = { id: string; corretor_id: string | null; status?: string };

// Espelha a policy delete_sales_por_papel do banco (fonte da verdade — isto aqui só evita mostrar
// o botão "Excluir venda" pra quem a policy vai recusar mesmo). Passado esses três status, a venda
// já pode ter contrato/certidão/ocorrência produzido — exclusão definitiva não é mais permitida
// pra NINGUÉM, nem admin/super_admin/financeiro; o caminho vira Arquivar/Cancelar.
const STATUS_EXCLUIVEIS = ["rascunho", "devolvida_ajuste", "enviada_revisao"];

export function canDeleteSale(
  userId: string | null | undefined,
  hasAny: (roles: AppRole[]) => boolean,
  sale: DeletableSale,
  teamMemberIds: Set<string>,
): boolean {
  if (!userId) return false;
  if (sale.status && !STATUS_EXCLUIVEIS.includes(sale.status)) return false;
  if (hasAny(["super_admin", "admin", "financeiro"])) return true;
  if (sale.corretor_id === userId) return true;
  if (hasAny(["gestor", "team_leader"]) && sale.corretor_id && teamMemberIds.has(sale.corretor_id)) return true;
  return false;
}

/**
 * Deleta a venda (sale_documents cai junto via ON DELETE CASCADE) e só depois limpa o storage.
 * Nessa ordem: se a exclusão da venda falhar (RLS, rede), nada foi perdido — os arquivos continuam
 * intactos. Na ordem inversa (storage antes do banco), uma falha no passo do banco deixava a venda
 * viva mas com os documentos já apagados do storage, sem como recuperar.
 *
 * `orphanedFiles` vem preenchido quando a venda já foi apagada do banco mas a limpeza do storage
 * falhou (rede, permissão) — os arquivos ficam órfãos (nada mais referencia esse sale_id). Antes
 * esse erro era simplesmente ignorado; agora quem chamar sabe disso e pode avisar o usuário em vez
 * de mostrar "Venda excluída" como se estivesse tudo certo.
 */
export async function deleteSaleCascade(saleId: string): Promise<{ orphanedFiles: string[] }> {
  const { data: docs } = await supabase
    .from("sale_documents")
    .select("storage_path")
    .eq("sale_id", saleId);
  const paths = (docs ?? []).map((d: any) => d.storage_path).filter(Boolean);

  const { error } = await supabase.from("sales").delete().eq("id", saleId);
  if (error) throw error;

  if (paths.length === 0) return { orphanedFiles: [] };

  const { error: storageError } = await supabase.storage.from("sale-documents").remove(paths);
  if (storageError) {
    console.error(`Falha ao remover ${paths.length} arquivo(s) do storage da venda ${saleId} (venda já excluída):`, storageError);
    return { orphanedFiles: paths };
  }
  return { orphanedFiles: [] };
}
