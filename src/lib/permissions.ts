import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/auth";

export type DeletableSale = { id: string; corretor_id: string | null; status?: string };

// Espelha a policy delete_sales_por_papel do banco (fonte da verdade — isto aqui só evita mostrar
// o botão "Excluir venda" pra quem a policy vai recusar mesmo). Regra final de Denis (28/09/2026,
// fase 2f): excluir SOMENTE em rascunho, e só por quem CRIOU a venda (sales.corretor_id), pelo
// gestor/team leader da equipe de quem criou, ou por admin/super_admin da agência. Participante que
// não criou, financeiro, jurídico, lançamento (salvo criador) e staff não excluem. Em qualquer outra
// etapa ninguém exclui. Sem status conhecido, falha fechada (não mostra o botão).
const STATUS_EXCLUIVEIS = ["rascunho"];

export function canDeleteSale(
  userId: string | null | undefined,
  hasAny: (roles: AppRole[]) => boolean,
  sale: DeletableSale,
  teamMemberIds: Set<string>,
): boolean {
  if (!userId) return false;
  if (!sale.status || !STATUS_EXCLUIVEIS.includes(sale.status)) return false;
  if (sale.corretor_id === userId) return true;
  if (hasAny(["super_admin", "admin"])) return true;
  if (hasAny(["gestor", "team_leader"]) && sale.corretor_id && teamMemberIds.has(sale.corretor_id))
    return true;
  return false;
}

// Espelha platform_cancel_sale + trigger validate_sale_status_transition (fase 2f): cancelar venda
// é só do dono da plataforma (platform_admins / is_platform_super_admin), em qualquer etapa depois
// do rascunho. O super_admin/admin da agência, gestor e team leader não cancelam. Falha fechada:
// sem confirmação do banco (isPlatformAdmin !== true) ou sem status conhecido, não mostra.
const STATUS_NAO_CANCELAVEIS = ["rascunho", "cancelada"];

export function canCancelSale(isPlatformAdmin: boolean | null | undefined, status?: string | null): boolean {
  if (isPlatformAdmin !== true) return false;
  if (!status || STATUS_NAO_CANCELAVEIS.includes(status)) return false;
  return true;
}

/** Cancela pela RPC da plataforma (motivo obrigatório; auditoria gravada no banco). */
export async function cancelSaleAsPlatform(saleId: string, motivo: string): Promise<void> {
  const { error } = await supabase.rpc("platform_cancel_sale", {
    _sale_id: saleId,
    _motivo: motivo,
  });
  if (error) throw error;
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
  const paths = (docs ?? [])
    .map((d) => d.storage_path)
    .filter((path): path is string => Boolean(path));

  const { error } = await supabase.from("sales").delete().eq("id", saleId);
  if (error) throw error;

  if (paths.length === 0) return { orphanedFiles: [] };

  const { error: storageError } = await supabase.storage.from("sale-documents").remove(paths);
  if (storageError) {
    console.error(
      `Falha ao remover ${paths.length} arquivo(s) do storage da venda ${saleId} (venda já excluída):`,
      storageError,
    );
    return { orphanedFiles: paths };
  }
  return { orphanedFiles: [] };
}
