import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { OrgAdminClient } from "@/lib/org-scope";
import { ALL_MANAGED_ROLES, type ManagedRole } from "@/lib/user-management-policy";

/**
 * Gestão de usuários da agência (multiempresa, marco 1e). Toda decisão papel × ação × agência vem
 * da regra única `user-management-policy.ts`, aplicada em `user-management.server.ts` ANTES de usar
 * o service_role. Admin e gestor só alcançam usuários da própria agência; gestor não cria/promove
 * administrador; ninguém altera o próprio papel nem move usuário entre agências.
 */

/** Cliente service_role + agência ativa + papéis de quem chama (falha fechada). */
async function callerContext(callerId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const scope = await import("@/lib/org-scope");
  const policy = await import("@/lib/user-management.server");
  const admin = supabaseAdmin as unknown as OrgAdminClient;
  const orgId = await scope.resolveActiveOrg(admin, callerId);
  const actor = await policy.loadActor(admin, orgId, callerId);
  return { supabaseAdmin, admin, orgId, actor, scope, policy };
}

const ROLES = ALL_MANAGED_ROLES as [ManagedRole, ...ManagedRole[]];

const fullName = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .refine(
    (v) => v.trim().split(/\s+/).filter(Boolean).length >= 2,
    "Digite o nome completo (nome e sobrenome).",
  );

const schema = z.object({
  nome: fullName,
  email: z.string().trim().email().max(255),
  telefone: z.string().trim().min(10, "Telefone inválido.").max(20),
  password: z.string().min(8).max(72),
  role: z.enum(ROLES),
});

const resetPasswordSchema = z.object({
  userId: z.string().uuid(),
  password: z.string().min(8).max(72),
});

const updateUserSchema = z.object({
  userId: z.string().uuid(),
  cpf: z.string().trim().max(30).nullable(),
  creci: z.string().trim().max(50).nullable(),
  nome: fullName,
  email: z.string().trim().email().max(255),
  telefone: z.string().trim().min(10, "Telefone inválido.").max(20),
});

const setActiveSchema = z.object({ userId: z.string().uuid(), ativo: z.boolean() });
const setRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ROLES),
  grant: z.boolean(),
});

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin, admin, orgId, actor, policy } = await callerContext(userId);
    policy.assertCreateAllowed(actor, data.role);
    const callerRoles = actor.roles;

    // O novo usuário nasce na agência de quem cadastra. A organização vai em app_metadata
    // (só o servidor grava) e handle_new_user cria perfil/vínculo nessa agência.
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
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
        .eq("lider_id", userId)
        .is("parent_team_id", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      let teamId = existingTeam?.id as string | undefined;
      if (!teamId) {
        const { data: callerProfile } = await admin
          .from("profiles")
          .select("nome")
          .eq("organization_id", orgId)
          .eq("id", userId)
          .maybeSingle();
        const { data: newTeam, error: teamErr } = await admin
          .from("teams")
          .insert({
            organization_id: orgId,
            lider_id: userId,
            nome: `Equipe de ${callerProfile?.nome ?? "gestor"}`,
          })
          .select("id")
          .single();
        if (teamErr) throw new Error(teamErr.message);
        teamId = newTeam.id;
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
  });

/** Redefine a senha de outro usuário da própria agência. Admin/super admin: qualquer conta da
 * agência; gestor/team leader: somente corretores da própria equipe. */
export const resetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => resetPasswordSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId: callerId } = context;
    if (data.userId === callerId) {
      throw new Error('Use a tela "Meu acesso" para trocar a sua própria senha.');
    }
    const { supabaseAdmin, admin, orgId, actor, policy } = await callerContext(callerId);
    await policy.assertUserActionAllowed(admin, actor, "reset_password", data.userId);

    // updateUserById substitui user_metadata inteiro — busca o atual pra não perder o que já tem lá.
    const { data: existing, error: getErr } = await supabaseAdmin.auth.admin.getUserById(
      data.userId,
    );
    if (getErr || !existing?.user) throw new Error(getErr?.message ?? "Usuário não encontrado.");

    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
      user_metadata: { ...existing.user.user_metadata },
    });
    if (updErr) throw new Error(updErr.message);

    // Auditoria sem armazenar ou expor a senha temporária.
    await admin.from("activity_logs").insert({
      organization_id: orgId,
      autor_id: callerId,
      sale_id: null,
      acao: "user_password_reset",
      payload: { target_user: data.userId },
    });

    return { ok: true };
  });

/** Corrige nome/e-mail/telefone de outro usuário da própria agência. Admin/super admin: qualquer
 * um da agência; gestor/team leader: só quem está na própria equipe (is_lead_of). E-mail muda
 * tanto o profile quanto o login em auth.users. */
export const updateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateUserSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId: callerId } = context;
    if (data.userId === callerId) {
      throw new Error('Use a tela "Meu acesso" para editar seus próprios dados.');
    }
    const { supabaseAdmin, admin, orgId, actor, policy } = await callerContext(callerId);
    await policy.assertUserActionAllowed(admin, actor, "edit_user", data.userId);

    const { data: existing, error: getErr } = await supabaseAdmin.auth.admin.getUserById(
      data.userId,
    );
    if (getErr || !existing?.user) throw new Error(getErr?.message ?? "Usuário não encontrado.");

    if (existing.user.email !== data.email) {
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
        email: data.email,
        email_confirm: true,
      });
      if (updErr) {
        const msg = updErr.message ?? "Falha ao atualizar e-mail";
        if (/already|registered|exists/i.test(msg))
          throw new Error("Já existe um usuário com esse e-mail.");
        throw new Error(msg);
      }
    }

    const { error: profErr } = await admin
      .from("profiles")
      .update({
        nome: data.nome,
        email: data.email,
        telefone: data.telefone,
        cpf: data.cpf || null,
        creci: data.creci || null,
      })
      .eq("organization_id", orgId)
      .eq("id", data.userId);
    if (profErr) throw new Error(profErr.message);

    return { ok: true };
  });

/** Ativa/desativa usuário da própria agência. Admin: qualquer um da agência (exceto a si mesmo);
 * gestor/team leader: só corretores da própria equipe. */
export const setUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => setActiveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId: callerId } = context;
    const { admin, orgId, actor, policy } = await callerContext(callerId);
    await policy.assertUserActionAllowed(admin, actor, "set_active", data.userId);
    const { error } = await admin
      .from("profiles")
      .update({ ativo: data.ativo })
      .eq("organization_id", orgId)
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    await admin.from("activity_logs").insert({
      organization_id: orgId,
      autor_id: callerId,
      sale_id: null,
      acao: data.ativo ? "user_activated" : "user_deactivated",
      payload: { target_user: data.userId },
    });
    return { ok: true };
  });

/** Concede/retira papel de usuário da própria agência. Só admin/super admin; admin não mexe em
 * papel de administrador; ninguém altera o próprio papel. */
export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => setRoleSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId: callerId } = context;
    const { admin, orgId, actor, policy } = await callerContext(callerId);
    await policy.assertUserActionAllowed(admin, actor, "change_roles", data.userId, data.role);
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
  });

/** Último login (auth.users.last_sign_in_at) dos usuários da própria agência — lido pelo
 * servidor (service role) via RPC por agência; não existe em public.profiles nem é exposto por RLS. */
export const listLastSignIns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { admin, orgId, actor, scope } = await callerContext(userId);
    if (
      !actor.roles.some((r) =>
        (["admin", "super_admin", "gestor", "team_leader"] as ManagedRole[]).includes(r),
      )
    ) {
      throw new Error("Você não tem permissão para ver essa informação.");
    }

    // auth.users é global: a RPC do banco devolve só os usuários da agência de quem pergunta.
    return scope.listOrgLastSignIns(admin, orgId);
  });
