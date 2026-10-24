import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Auditoria de ações do super-admin da PLATAFORMA sobre usuários de uma imobiliária
 * (tela "Usuários da plataforma" e modo "Entrar como administrador").
 *
 * Por que não grava `autor_id` (t_2cd53d1e): o gatilho `mt_1b_set_org` de `activity_logs` herda a
 * imobiliária do autor (`profiles.organization_id`). O perfil do super-admin fica na imobiliária
 * de origem dele, então, com service_role, a linha na imobiliária do alvo era recusada com
 * "organization_id divergente do registro pai" (e `mt_pc_author_scope` recusaria em seguida com
 * "Autor de outra organizacao"). O gatilho de isolamento continua intacto para todo o resto: aqui a
 * linha nasce sem pai, na imobiliária do alvo (lida do banco pelo chamador), e o ator real fica em
 * `payload.ator_plataforma_id` — o mesmo padrão das 400+ linhas de sistema com `autor_id` nulo.
 */
export type PlatformAuditInput = {
  /** Imobiliária do usuário-alvo, SEMPRE lida do banco (nunca do navegador). */
  orgId: string;
  /** Super-admin da plataforma que executou a ação (auth.uid() validado no servidor). */
  actorId: string;
  acao: string;
  payload: Record<string, unknown>;
};

export function platformAuditRow({ orgId, actorId, acao, payload }: PlatformAuditInput) {
  if (!orgId) throw new Error("Auditoria da plataforma sem imobiliária do alvo.");
  if (!actorId) throw new Error("Auditoria da plataforma sem o autor da ação.");
  return {
    organization_id: orgId,
    autor_id: null,
    sale_id: null,
    acao,
    payload: { ...payload, ator_plataforma_id: actorId },
  };
}

export async function insertPlatformAudit(
  admin: SupabaseClient,
  input: PlatformAuditInput,
): Promise<void> {
  const { error } = await admin.from("activity_logs").insert(platformAuditRow(input));
  if (error) throw new Error(`Alteração feita, mas a auditoria falhou: ${error.message}`);
}
