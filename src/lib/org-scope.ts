import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Escopo de agência (organização) para rotinas que rodam com service_role.
 *
 * O service_role ignora RLS: toda consulta/escrita feita com ele precisa filtrar ou gravar o
 * `organization_id` explicitamente. As colunas/tabelas multiempresa (organizations,
 * organization_members, organization_id) ainda não estão no `types.ts` gerado, por isso estas
 * rotinas usam um cliente sem tipagem de schema.
 */
export type OrgAdminClient = SupabaseClient;

export class OrgScopeError extends Error {}

/** Agência ativa do usuário (vínculo ativo + organização com status "ativa"). Falha fechada. */
export async function resolveActiveOrg(admin: OrgAdminClient, userId: string): Promise<string> {
  const { data: member, error } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("ativo", true)
    .maybeSingle();
  if (error || !member?.organization_id) throw new OrgScopeError("Usuário sem agência ativa.");
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id")
    .eq("id", member.organization_id)
    .eq("status", "ativa")
    .maybeSingle();
  if (orgError || !org) throw new OrgScopeError("Usuário sem agência ativa.");
  return member.organization_id as string;
}

/** Garante que o usuário-alvo pertence à agência; não revela se existe em outra. */
export async function assertUserInOrg(
  admin: OrgAdminClient,
  orgId: string,
  targetUserId: string,
): Promise<void> {
  const { data, error } = await admin
    .from("profiles")
    .select("id")
    .eq("id", targetUserId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error || !data) throw new OrgScopeError("Usuário não encontrado.");
}

/** IDs de perfis da agência (para filtrar dados globais, como auth.users). */
export async function listOrgUserIds(admin: OrgAdminClient, orgId: string): Promise<Set<string>> {
  const { data, error } = await admin.from("profiles").select("id").eq("organization_id", orgId);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row: { id: string }) => row.id));
}

/** Confirma que o registro (por id) pertence à agência. */
export async function rowBelongsToOrg(
  admin: OrgAdminClient,
  table: string,
  id: string,
  orgId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  return !error && Boolean(data);
}
