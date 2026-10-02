import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRpc } from "@/lib/rpc-errors";

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

/** Cliente com o JWT de quem chama (só para RPCs que dependem de auth.uid()/session_id). */
// Aceita o cliente tipado (Database) ou não tipado; a RPC nova ainda não está no types.ts gerado.
export type CallerRpcClient = object;
type RpcFn = (fn: string) => PromiseLike<{ data: unknown; error: unknown }>;
const currentOrgRpc = (user: CallerRpcClient) =>
  ((user as { rpc: RpcFn }).rpc as RpcFn).call(user, "platform_current_org");

export const PLATFORM_CONTEXT_CHECK_FAILED =
  "Não foi possível confirmar a imobiliária do acesso. Tente novamente em instantes.";

/**
 * Org destino do contexto ativo, ou null. Falha fechada: só a RPC inexistente (banco sem a
 * migration) conta como "sem contexto"; qualquer outro erro (rede, timeout, 5xx) lança, para
 * nunca cair na imobiliária de origem do ator enquanto a faixa mostra outra.
 */
export async function currentContextOrg(user: CallerRpcClient): Promise<string | null> {
  const { data, error } = await currentOrgRpc(user);
  if (error) {
    if (isMissingRpc(error as { code?: string; message?: string })) return null;
    throw new OrgScopeError(PLATFORM_CONTEXT_CHECK_FAILED);
  }
  if (!data || typeof data !== "object") return null;
  const org = (data as { organization_id?: unknown }).organization_id;
  return typeof org === "string" && org ? org : null;
}

export type CallerScope = { orgId: string; inPlatformContext: boolean };

export const PLATFORM_CONTEXT_WRITE_BLOCKED =
  "Na visão da plataforma esta alteração não é permitida (ela não ficaria na auditoria do acesso). " +
  "Peça ao administrador da imobiliária ou saia da visão da plataforma.";

/**
 * Agência de quem chama, considerando o contexto do super-admin da plataforma (Parte 2/3).
 * `platform_current_org` roda com o JWT do usuário (o banco valida platform_admins + sessão de
 * login + validade); para usuários comuns devolve null e vale o vínculo normal. Falha fechada.
 */
export async function resolveCallerScope(
  user: CallerRpcClient,
  admin: OrgAdminClient,
  userId: string,
): Promise<CallerScope> {
  const ctxOrg = await currentContextOrg(user);
  if (ctxOrg) return { orgId: ctxOrg, inPlatformContext: true };
  return { orgId: await resolveActiveOrg(admin, userId), inPlatformContext: false };
}

/** Gravações com service_role ficam fora da auditoria do contexto: bloqueia dentro dele. */
export async function assertNotInPlatformContext(user: CallerRpcClient): Promise<void> {
  if (await currentContextOrg(user)) throw new OrgScopeError(PLATFORM_CONTEXT_WRITE_BLOCKED);
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

/**
 * Último acesso (auth.users.last_sign_in_at) SÓ dos usuários da agência. Usa a RPC
 * `mt_2b_org_auth_users` (EXECUTE só para service_role), que junta organization_members com
 * auth.users no banco — o servidor nunca pagina o auth.users global de todas as agências.
 */
export async function listOrgLastSignIns(
  admin: OrgAdminClient,
  orgId: string,
): Promise<Record<string, string | null>> {
  const { data, error } = await admin.rpc("mt_2b_org_auth_users", { _org: orgId });
  if (error) throw new Error(error.message);
  const map: Record<string, string | null> = {};
  for (const row of (data ?? []) as { user_id: string; last_sign_in_at: string | null }[]) {
    map[row.user_id] = row.last_sign_in_at ?? null;
  }
  return map;
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
