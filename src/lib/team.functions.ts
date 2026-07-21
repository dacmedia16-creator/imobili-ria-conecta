import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Gestor consegue montar/ajustar a própria equipe sem depender do admin — só pode se vincular
 * a si mesmo como líder (lider_id sempre é o próprio caller) e só a usuários com papel corretor.
 * Passa pelo service role porque team_members e user_roles de outras pessoas não são visíveis
 * via RLS para um gestor comum.
 */
async function assertGestor(supabase: any, userId: string) {
  const { data: myRoles, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error(error.message);
  const roles = (myRoles ?? []).map((r: any) => r.role);
  if (!roles.some((r: string) => r === "gestor" || r === "admin" || r === "super_admin")) {
    throw new Error("Só gestor, admin ou super admin podem gerenciar equipe.");
  }
}

export const listCorretoresDisponiveis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertGestor(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: corretorRoles, error: rErr }, { data: jaVinculados, error: tErr }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id").eq("role", "corretor"),
      supabaseAdmin.from("team_members").select("membro_id").eq("lider_id", userId),
    ]);
    if (rErr) throw new Error(rErr.message);
    if (tErr) throw new Error(tErr.message);

    const jaIds = new Set((jaVinculados ?? []).map((r: any) => r.membro_id));
    const candidatoIds = Array.from(new Set((corretorRoles ?? []).map((r: any) => r.user_id))).filter((id) => !jaIds.has(id));
    if (candidatoIds.length === 0) return [];

    const { data: profs, error: pErr } = await supabaseAdmin.from("profiles").select("id, nome, email").in("id", candidatoIds);
    if (pErr) throw new Error(pErr.message);
    return (profs ?? []).sort((a: any, b: any) => (a.nome ?? "").localeCompare(b.nome ?? ""));
  });

const idSchema = z.object({ corretorId: z.string().uuid() });

export const addCorretorToTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertGestor(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roleRow } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", data.corretorId).eq("role", "corretor").maybeSingle();
    if (!roleRow) throw new Error("Esse usuário não tem papel de corretor.");

    const { data: existing } = await supabaseAdmin.from("team_members").select("id").eq("lider_id", userId).eq("membro_id", data.corretorId).maybeSingle();
    if (existing) return { ok: true };

    const { error } = await supabaseAdmin.from("team_members").insert({ lider_id: userId, membro_id: data.corretorId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeCorretorFromTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertGestor(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Só remove o próprio vínculo (lider_id = o gestor chamando) — não mexe em vínculos de outros líderes.
    const { error } = await supabaseAdmin.from("team_members").delete().eq("lider_id", userId).eq("membro_id", data.corretorId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
