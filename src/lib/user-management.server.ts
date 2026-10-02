import type { OrgAdminClient } from "./org-scope";
import { OrgScopeError, resolveActiveOrg } from "./org-scope";
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

/** Agência ativa + papéis de quem chama (falha fechada). */
export async function loadCallerActor(admin: OrgAdminClient, callerId: string): Promise<Actor> {
  return loadActor(admin, await resolveActiveOrg(admin, callerId), callerId);
}

export type CreateAgencyUserInput = {
  nome: string;
  email: string;
  telefone: string;
  password: string;
  role: ManagedRole;
};

/**
 * Cadastro de usuário pela tela de Usuários (server fn `createUser`). O novo usuário nasce SEMPRE na
 * agência de quem cadastra: a organização vai em app_metadata (só o servidor grava) e o gatilho
 * handle_new_user cria perfil/vínculo nessa agência. A regra é aplicada antes do service_role.
 */
export async function createAgencyUser(
  admin: OrgAdminClient,
  callerId: string,
  data: CreateAgencyUserInput,
  actorOverride?: Actor,
): Promise<{ id: string; email: string }> {
  // actorOverride: super-admin da plataforma na visão de uma imobiliária (agência do contexto,
  // validada no banco por platform_current_org); senão, agência ativa de quem chama.
  const actor = actorOverride ?? (await loadCallerActor(admin, callerId));
  assertCreateAllowed(actor, data.role);
  const orgId = actor.orgId as string;
  const callerRoles = actor.roles;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    user_metadata: { nome: data.nome },
    app_metadata: { organization_id: orgId },
  });
  if (createErr || !created?.user) {
    const msg = createErr?.message ?? "Falha ao criar usuário";
    if (/already|registered|exists/i.test(msg))
      throw new Error("Já existe um usuário com esse e-mail.");
    throw new Error(msg);
  }
  const newId = created.user.id;

  // Trigger handle_new_user já criou profile + role 'corretor'.
  if (data.role !== "corretor") {
    await admin
      .from("user_roles")
      .delete()
      .eq("organization_id", orgId)
      .eq("user_id", newId)
      .eq("role", "corretor");
    const { error: insErr } = await admin.from("user_roles").insert({
      organization_id: orgId,
      user_id: newId,
      role: data.role,
      // Jurídico/financeiro não têm "dono" de venda como corretor/gestor — "a cada atualização"
      // pra eles nasce desligado (senão financeiro, que vê toda venda do sistema, já começa
      // recebendo aviso de tudo sem ter escolhido isso).
      ...(data.role === "juridico" || data.role === "financeiro"
        ? { notificar_toda_atualizacao: false }
        : {}),
    });
    if (insErr) throw new Error(insErr.message);
  }

  // Gestor/team leader criando corretor: vincula automaticamente à equipe principal dele
  // (a de nível 1 que ele já lidera; cria uma se ainda não existir nenhuma).
  if (
    (callerRoles.includes("gestor") || callerRoles.includes("team_leader")) &&
    !callerRoles.includes("admin") &&
    !callerRoles.includes("super_admin") &&
    data.role === "corretor"
  ) {
    const { data: existingTeam } = await admin
      .from("teams")
      .select("id")
      .eq("organization_id", orgId)
      .eq("lider_id", callerId)
      .is("parent_team_id", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    let teamId = (existingTeam as { id: string } | null)?.id;
    if (!teamId) {
      const { data: callerProfile } = await admin
        .from("profiles")
        .select("nome")
        .eq("organization_id", orgId)
        .eq("id", callerId)
        .maybeSingle();
      const { data: newTeam, error: teamErr } = await admin
        .from("teams")
        .insert({
          organization_id: orgId,
          lider_id: callerId,
          nome: `Equipe de ${(callerProfile as { nome: string } | null)?.nome ?? "gestor"}`,
        })
        .select("id")
        .single();
      if (teamErr) throw new Error(teamErr.message);
      teamId = (newTeam as { id: string }).id;
    }
    await admin
      .from("team_members")
      .insert({ organization_id: orgId, team_id: teamId, membro_id: newId });
  }

  // Garante nome/telefone atualizados no profile (handle_new_user só preenche nome/email)
  await admin
    .from("profiles")
    .update({ nome: data.nome, telefone: data.telefone })
    .eq("organization_id", orgId)
    .eq("id", newId);

  return { id: newId, email: data.email };
}

/** Concede/retira papel (server fn `setUserRole`), só dentro da agência de quem chama. */
export async function setAgencyUserRole(
  admin: OrgAdminClient,
  callerId: string,
  data: { userId: string; role: ManagedRole; grant: boolean },
  actorOverride?: Actor,
) {
  // actorOverride: super-admin da plataforma no contexto (agência validada no banco).
  const actor = actorOverride ?? (await loadCallerActor(admin, callerId));
  const orgId = actor.orgId as string;
  await assertUserActionAllowed(admin, actor, "change_roles", data.userId, data.role);
  if (data.grant) {
    const { error } = await admin.from("user_roles").insert({
      organization_id: orgId,
      user_id: data.userId,
      role: data.role,
      ...(data.role === "juridico" || data.role === "financeiro"
        ? { notificar_toda_atualizacao: false }
        : {}),
    });
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  } else {
    const { error } = await admin
      .from("user_roles")
      .delete()
      .eq("organization_id", orgId)
      .eq("user_id", data.userId)
      .eq("role", data.role);
    if (error) throw new Error(error.message);
  }
  return { ok: true };
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
