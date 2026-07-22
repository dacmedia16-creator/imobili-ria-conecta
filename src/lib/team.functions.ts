import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * team_id/lider_id de outras pessoas não são visíveis via RLS pra um gestor comum quando o
 * lookup depende de user_roles de terceiros (RLS só libera user_roles pra si mesmo/admin) —
 * por isso essas duas consultas passam pelo service role, igual antes.
 */
async function assertCanManageTeams(supabase: any, userId: string) {
  const { data: myRoles, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error(error.message);
  const roles = (myRoles ?? []).map((r: any) => r.role);
  if (!roles.some((r: string) => r === "gestor" || r === "admin" || r === "super_admin")) {
    throw new Error("Só gestor, admin ou super admin podem gerenciar equipes.");
  }
}

export const listCorretoresDisponiveis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertCanManageTeams(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: corretorRoles, error: rErr }, { data: jaVinculados, error: tErr }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id").eq("role", "corretor"),
      supabaseAdmin.from("team_members").select("membro_id"),
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

export const listGestores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertCanManageTeams(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: gestorRoles, error: rErr } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "gestor");
    if (rErr) throw new Error(rErr.message);

    const ids = Array.from(new Set((gestorRoles ?? []).map((r: any) => r.user_id)));
    if (ids.length === 0) return [];

    const { data: profs, error: pErr } = await supabaseAdmin.from("profiles").select("id, nome, email").in("id", ids);
    if (pErr) throw new Error(pErr.message);
    return (profs ?? []).sort((a: any, b: any) => (a.nome ?? "").localeCompare(b.nome ?? ""));
  });
