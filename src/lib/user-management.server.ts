import type { OrgAdminClient } from "./org-scope";
import { OrgScopeError } from "./org-scope";
import {
  decideCreateUser,
  decideUserAction,
  type Actor,
  type ManagedRole,
  type UserAction,
} from "./user-management-policy";

/**
 * Aplicação no servidor da regra única de gestão de usuários (user-management-policy.ts).
 * Roda com service_role (ignora RLS), por isso toda leitura filtra a agência explicitamente e a
 * decisão é tomada ANTES de qualquer escrita. Alvo de outra agência responde "não encontrado".
 */

async function rolesOf(admin: OrgAdminClient, orgId: string, userId: string) {
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { role: ManagedRole }[]).map((r) => r.role);
}

/** Ator com papéis lidos só da agência ativa dele. */
export async function loadActor(
  admin: OrgAdminClient,
  orgId: string,
  userId: string,
): Promise<Actor> {
  return { userId, orgId, roles: await rolesOf(admin, orgId, userId) };
}

export function assertCreateAllowed(actor: Actor, role: ManagedRole) {
  const d = decideCreateUser(actor, role);
  if (!d.allowed) throw new OrgScopeError(d.reason);
}

export async function assertUserActionAllowed(
  admin: OrgAdminClient,
  actor: Actor,
  action: Exclude<UserAction, "create_user">,
  targetUserId: string,
  role?: ManagedRole,
) {
  const { data: prof, error } = await admin
    .from("profiles")
    .select("id, organization_id")
    .eq("id", targetUserId)
    .eq("organization_id", actor.orgId ?? "")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const targetOrg = (prof as { organization_id: string } | null)?.organization_id ?? null;
  let targetRoles: ManagedRole[] = [];
  let ledByActor = false;
  if (targetOrg) {
    targetRoles = await rolesOf(admin, targetOrg, targetUserId);
    const { data: leads, error: leadErr } = await admin.rpc("is_lead_of", {
      _lider: actor.userId,
      _membro: targetUserId,
    });
    if (leadErr) throw new Error(leadErr.message);
    ledByActor = Boolean(leads);
  }
  const d = decideUserAction(
    actor,
    action,
    { userId: targetUserId, orgId: targetOrg, roles: targetRoles, ledByActor },
    role,
  );
  if (!d.allowed) throw new OrgScopeError(d.reason);
}
