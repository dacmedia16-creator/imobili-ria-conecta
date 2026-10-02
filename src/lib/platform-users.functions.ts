import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ALL_MANAGED_ROLES, type ManagedRole } from "@/lib/user-management-policy";

/**
 * Usuários da plataforma (visão global do super-admin). Autorização e auditoria em
 * `platform-users.server.ts`; regras de papel reaproveitadas de `user-management.server.ts`.
 */
async function clients(context: { userId: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const server = await import("@/lib/platform-users.server");
  const policy = await import("@/lib/user-management.server");
  return {
    admin: supabaseAdmin as unknown as SupabaseClient,
    callerId: context.userId,
    server,
    policy,
  };
}

type PolicyAdmin = Parameters<
  (typeof import("@/lib/user-management.server"))["assertUserActionAllowed"]
>[0];

const ROLES = ALL_MANAGED_ROLES as [ManagedRole, ...ManagedRole[]];
const motivo = z.string().trim().min(5, "Informe o motivo (mínimo 5 caracteres).").max(300);
const userId = z.string().uuid();

export const listPlatformUsersFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { admin, callerId, server } = await clients(context);
    return server.listPlatformUsers(admin, callerId);
  });

export const platformResetPasswordFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ userId, password: z.string().min(8).max(72), motivo }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { admin, callerId, server, policy } = await clients(context);
    const actor = await server.platformActorFor(admin, callerId, data.userId);
    const pa = admin as unknown as PolicyAdmin;
    await policy.assertUserActionAllowed(pa, actor, "reset_password", data.userId);
    const { data: existing, error: getErr } = await admin.auth.admin.getUserById(data.userId);
    if (getErr || !existing?.user) throw new Error(getErr?.message ?? "Usuário não encontrado.");
    const { error } = await admin.auth.admin.updateUserById(data.userId, {
      password: data.password,
      user_metadata: { ...existing.user.user_metadata },
    });
    if (error) throw new Error(error.message);
    await server.logPlatformUserAction(
      admin,
      actor,
      "user_password_reset",
      { target_user: data.userId },
      server.assertReason(data.motivo),
    );
    return { ok: true };
  });

export const platformSetActiveFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ userId, ativo: z.boolean(), motivo }).parse(i))
  .handler(async ({ data, context }) => {
    const { admin, callerId, server, policy } = await clients(context);
    const actor = await server.platformActorFor(admin, callerId, data.userId);
    await policy.assertUserActionAllowed(
      admin as unknown as PolicyAdmin,
      actor,
      "set_active",
      data.userId,
    );
    const { error } = await admin
      .from("profiles")
      .update({ ativo: data.ativo })
      .eq("organization_id", actor.orgId as string)
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    await server.logPlatformUserAction(
      admin,
      actor,
      data.ativo ? "user_activated" : "user_deactivated",
      { target_user: data.userId },
      server.assertReason(data.motivo),
    );
    return { ok: true };
  });

export const platformSetRoleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ userId, role: z.enum(ROLES), grant: z.boolean(), motivo }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { admin, callerId, server, policy } = await clients(context);
    const actor = await server.platformActorFor(admin, callerId, data.userId);
    await policy.setAgencyUserRole(
      admin as unknown as PolicyAdmin,
      callerId,
      { userId: data.userId, role: data.role, grant: data.grant },
      actor,
    );
    await server.logPlatformUserAction(
      admin,
      actor,
      data.grant ? "user_role_granted" : "user_role_revoked",
      { target_user: data.userId, role: data.role },
      server.assertReason(data.motivo),
    );
    return { ok: true };
  });

export const platformUpdateUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        userId,
        nome: z.string().trim().min(2).max(120),
        email: z.string().trim().toLowerCase().email().max(255),
        telefone: z.string().trim().max(20).nullable(),
        motivo,
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { admin, callerId, server, policy } = await clients(context);
    const actor = await server.platformActorFor(admin, callerId, data.userId);
    await policy.assertUserActionAllowed(
      admin as unknown as PolicyAdmin,
      actor,
      "edit_user",
      data.userId,
    );
    const { data: existing, error: getErr } = await admin.auth.admin.getUserById(data.userId);
    if (getErr || !existing?.user) throw new Error(getErr?.message ?? "Usuário não encontrado.");
    const emailChanged = existing.user.email !== data.email;
    if (emailChanged) {
      const { error } = await admin.auth.admin.updateUserById(data.userId, {
        email: data.email,
        email_confirm: true,
      });
      if (error) {
        if (/already|registered|exists/i.test(error.message))
          throw new Error("Já existe um usuário com esse e-mail.");
        throw new Error(error.message);
      }
    }
    const { error } = await admin
      .from("profiles")
      .update({ nome: data.nome, email: data.email, telefone: data.telefone || null })
      .eq("organization_id", actor.orgId as string)
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    await server.logPlatformUserAction(
      admin,
      actor,
      "user_updated",
      { target_user: data.userId, email_changed: emailChanged },
      server.assertReason(data.motivo),
    );
    return { ok: true };
  });
