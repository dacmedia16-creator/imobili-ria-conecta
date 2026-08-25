import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const startSchema = z.object({ targetUserId: z.string().uuid() });
const auditSchema = z.object({ auditId: z.string().uuid() });

async function requireSuperAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (error || !data) throw new Error("Apenas Super Admin pode entrar como outro usuário.");
}

export const startOperationalImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => startSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId: actorUserId } = context;
    await requireSuperAdmin(supabase, actorUserId);
    if (data.targetUserId === actorUserId) throw new Error("Escolha outro usuário.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, nome, email, ativo")
      .eq("id", data.targetUserId)
      .maybeSingle();
    if (profileError || !profile) throw new Error("Usuário não encontrado.");
    if (profile.ativo === false) throw new Error("Não é possível entrar como um usuário inativo.");

    const { data: targetAuth, error: targetError } = await admin.auth.admin.getUserById(data.targetUserId);
    if (targetError || !targetAuth?.user?.email) throw new Error("O usuário não possui um acesso válido.");

    const { data: generated, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: targetAuth.user.email,
    });
    if (linkError || !generated?.properties?.hashed_token) {
      throw new Error(linkError?.message ?? "Não foi possível criar a sessão operacional.");
    }

    const { data: audit, error: auditError } = await admin
      .from("operational_impersonation_sessions")
      .insert({ actor_user_id: actorUserId, target_user_id: data.targetUserId, status: "pending" })
      .select("id")
      .single();
    if (auditError || !audit) throw new Error(auditError?.message ?? "Falha ao iniciar auditoria.");

    return {
      auditId: audit.id as string,
      tokenHash: generated.properties.hashed_token as string,
      target: { id: profile.id, name: profile.nome ?? profile.email, email: targetAuth.user.email },
    };
  });

export const finalizeOperationalImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => auditSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId: targetUserId, claims } = context;
    const authSessionId = typeof claims.session_id === "string" ? claims.session_id : null;
    if (!authSessionId) throw new Error("Sessão autenticada sem identificador de auditoria.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { data: row } = await admin
      .from("operational_impersonation_sessions")
      .select("id, target_user_id, status")
      .eq("id", data.auditId)
      .maybeSingle();
    if (!row || row.target_user_id !== targetUserId || row.status !== "pending") {
      throw new Error("Solicitação de acesso operacional inválida ou expirada.");
    }
    const { error } = await admin
      .from("operational_impersonation_sessions")
      .update({ status: "active", auth_session_id: authSessionId, started_at: new Date().toISOString() })
      .eq("id", data.auditId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const endOperationalImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => auditSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId: targetUserId, claims } = context;
    const authSessionId = typeof claims.session_id === "string" ? claims.session_id : null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { error } = await admin
      .from("operational_impersonation_sessions")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", data.auditId)
      .eq("target_user_id", targetUserId)
      .eq("auth_session_id", authSessionId)
      .eq("status", "active");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

