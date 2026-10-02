import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { CallerRpcClient, OrgAdminClient } from "@/lib/org-scope";
import { ALL_MANAGED_ROLES, type ManagedRole } from "@/lib/user-management-policy";

/**
 * Gestão de usuários da agência (multiempresa, marco 1e). Toda decisão papel × ação × agência vem
 * da regra única `user-management-policy.ts`, aplicada em `user-management.server.ts` ANTES de usar
 * o service_role. Admin e gestor só alcançam usuários da própria agência; gestor não cria/promove
 * administrador; ninguém altera o próprio papel nem move usuário entre agências.
 */

/**
 * Cliente service_role + agência ativa + papéis de quem chama (falha fechada).
 *
 * Super-admin da plataforma no contexto de uma imobiliária (Parte 2/3): LEITURAS usam a agência
 * do contexto com os papéis virtuais de administrador; ESCRITAS com service_role são bloqueadas
 * (elas não passariam pela auditoria do contexto e usariam a agência de origem do ator).
 */
async function callerContext(
  callerId: string,
  user: CallerRpcClient,
  mode: "read" | "write" = "write",
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const scope = await import("@/lib/org-scope");
  const policy = await import("@/lib/user-management.server");
  const admin = supabaseAdmin as unknown as OrgAdminClient;
  if (mode === "write") await scope.assertNotInPlatformContext(user);
  const { orgId, inPlatformContext } = await scope.resolveCallerScope(user, admin, callerId);
  const actor = inPlatformContext
    ? { userId: callerId, orgId, roles: ["super_admin", "admin"] as ManagedRole[] }
    : await policy.loadActor(admin, orgId, callerId);
  return { supabaseAdmin, admin, orgId, actor, scope, policy };
}

async function assertWritable(user: CallerRpcClient) {
  const scope = await import("@/lib/org-scope");
  await scope.assertNotInPlatformContext(user);
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

/** Cadastro de usuário: nasce na agência de quem cadastra. A lógica (regra + Auth + papéis +
 * equipe do gestor) fica em `createAgencyUser`, a mesma usada pelo E2E da homologação. */
export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => {
    await assertWritable(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const policy = await import("@/lib/user-management.server");
    return policy.createAgencyUser(
      supabaseAdmin as unknown as OrgAdminClient,
      context.userId,
      data,
    );
  });

/** Redefine a senha de outro usuário da própria agência. Admin/super admin: qualquer conta da
 * agência; gestor/team leader: somente corretores da própria equipe. */
export const resetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => resetPasswordSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId: callerId } = context;
    if (data.userId === callerId) {
      throw new Error('Use a tela "Meu acesso" para trocar a sua própria senha.');
    }
    const { supabaseAdmin, admin, orgId, actor, policy } = await callerContext(
      callerId,
      context.supabase,
    );
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
  .validator((input: unknown) => updateUserSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId: callerId } = context;
    if (data.userId === callerId) {
      throw new Error('Use a tela "Meu acesso" para editar seus próprios dados.');
    }
    const { supabaseAdmin, admin, orgId, actor, policy } = await callerContext(
      callerId,
      context.supabase,
    );
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
  .validator((input: unknown) => setActiveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId: callerId } = context;
    const { admin, orgId, actor, policy } = await callerContext(callerId, context.supabase);
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
 * papel de administrador; ninguém altera o próprio papel. Lógica em `setAgencyUserRole`. */
export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => setRoleSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertWritable(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const policy = await import("@/lib/user-management.server");
    return policy.setAgencyUserRole(
      supabaseAdmin as unknown as OrgAdminClient,
      context.userId,
      data,
    );
  });

/** Último login (auth.users.last_sign_in_at) dos usuários da própria agência — lido pelo
 * servidor (service role) via RPC por agência; não existe em public.profiles nem é exposto por RLS. */
export const listLastSignIns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { admin, orgId, actor, scope } = await callerContext(userId, context.supabase, "read");
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
