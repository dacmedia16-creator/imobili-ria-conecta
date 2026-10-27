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

// Espelha platform_cancel_sale / org_admin_cancel_sale + trigger validate_sale_status_transition:
// cancelar venda é do dono da plataforma (platform_admins) e, desde 27/10/2026 (t_3c10bab8), do
// Administrador e do Administrador principal DA IMOBILIÁRIA — em qualquer etapa depois do rascunho.
// Gestor, team leader, jurídico, financeiro e corretor não cancelam. Falha fechada: sem status
// conhecido não mostra; o admin da plataforma só vale com confirmação do banco (=== true).
const STATUS_NAO_CANCELAVEIS = ["rascunho", "cancelada"];

export function canCancelSale(
  isPlatformAdmin: boolean | null | undefined,
  status?: string | null,
  isOrgAdmin = false,
): boolean {
  if (isPlatformAdmin !== true && isOrgAdmin !== true) return false;
  if (!status || STATUS_NAO_CANCELAVEIS.includes(status)) return false;
  return true;
}

/** Qual RPC cancela: o dono da plataforma usa a dele (auditoria em platform_sale_cancellations);
 * o administrador da imobiliária usa org_admin_cancel_sale (histórico com o nome dele). */
export function rpcDeCancelamento(isPlatformAdmin: boolean | null | undefined) {
  return isPlatformAdmin === true ? "platform_cancel_sale" : "org_admin_cancel_sale";
}

/** Cancela a venda (motivo obrigatório; o banco confere o papel e a imobiliária e grava o histórico). */
export async function cancelSale(
  saleId: string,
  motivo: string,
  isPlatformAdmin: boolean | null | undefined,
): Promise<void> {
  const { error } = await supabase.rpc(rpcDeCancelamento(isPlatformAdmin), {
    _sale_id: saleId,
    _motivo: motivo,
  });
  if (error) throw error;
}

// Excluir venda (com os arquivos do storage): ver src/lib/excluir-venda.ts — roda no servidor,
// apaga os arquivos ANTES da venda e confere a quantidade (t_42d1f0bb).
