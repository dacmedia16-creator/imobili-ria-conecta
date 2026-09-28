import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { OrgAdminClient } from "@/lib/org-scope";

/** Service_role limitado à agência de quem chama (as listas abaixo ignorariam a RLS). */
async function adminInCallerOrg(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { resolveActiveOrg } = await import("@/lib/org-scope");
  const admin = supabaseAdmin as unknown as OrgAdminClient;
  return { admin, orgId: await resolveActiveOrg(admin, userId) };
}

/**
 * team_id/lider_id de outras pessoas não são visíveis via RLS pra um gestor comum quando o
 * lookup depende de user_roles de terceiros (RLS só libera user_roles pra si mesmo/admin) —
 * por isso essas duas consultas passam pelo service role, igual antes, agora sempre filtradas
 * pela agência de quem chama.
 */
async function assertCanManageTeams(supabase: SupabaseClient<Database>, userId: string) {
  const { data: myRoles, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const roles = (myRoles ?? []).map((r) => r.role);
  if (
    !roles.some(
      (r: string) => r === "gestor" || r === "team_leader" || r === "admin" || r === "super_admin",
    )
  ) {
    throw new Error("Só gestor, team leader, admin ou super admin podem gerenciar equipes.");
  }
}

export const listCorretoresDisponiveis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertCanManageTeams(supabase, userId);
    const { admin, orgId } = await adminInCallerOrg(userId);
    const { listAvailableCorretores } = await import("@/lib/team.server");
    return listAvailableCorretores(admin, orgId);
  });

export const listGestores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertCanManageTeams(supabase, userId);
    const { admin, orgId } = await adminInCallerOrg(userId);
    // Candidatos a "Team Leader" de uma equipe: quem já tem papel gestor OU team_leader
    // (enforce_team_leader_role no banco só aceita um desses dois pra teams.lider_id).
    const { listLeaderCandidates } = await import("@/lib/team.server");
    return listLeaderCandidates(admin, orgId);
  });
