import type { Database } from "@/integrations/supabase/types";
import type { OrgAdminClient } from "./org-scope";

export type ProfileOption = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "nome" | "email"
>;

async function listProfiles(
  admin: OrgAdminClient,
  orgId: string,
  ids: string[],
): Promise<ProfileOption[]> {
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from("profiles")
    .select("id, nome, email")
    .eq("organization_id", orgId)
    .in("id", ids);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ProfileOption[]).sort((a, b) =>
    (a.nome ?? "").localeCompare(b.nome ?? ""),
  );
}

/** Corretores da agência ainda sem equipe (service_role; filtro de agência explícito). */
export async function listAvailableCorretores(
  admin: OrgAdminClient,
  orgId: string,
): Promise<ProfileOption[]> {
  const [{ data: roles, error: rErr }, { data: linked, error: tErr }] = await Promise.all([
    admin.from("user_roles").select("user_id").eq("organization_id", orgId).eq("role", "corretor"),
    admin.from("team_members").select("membro_id").eq("organization_id", orgId),
  ]);
  if (rErr) throw new Error(rErr.message);
  if (tErr) throw new Error(tErr.message);
  const linkedIds = new Set((linked ?? []).map((r: { membro_id: string }) => r.membro_id));
  const ids = Array.from(new Set((roles ?? []).map((r: { user_id: string }) => r.user_id))).filter(
    (id) => !linkedIds.has(id),
  );
  return listProfiles(admin, orgId, ids);
}

/** Candidatos a líder (gestor/team_leader) da agência. */
export async function listLeaderCandidates(
  admin: OrgAdminClient,
  orgId: string,
): Promise<ProfileOption[]> {
  const { data, error } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("organization_id", orgId)
    .in("role", ["gestor", "team_leader"]);
  if (error) throw new Error(error.message);
  const ids = Array.from(new Set((data ?? []).map((r: { user_id: string }) => r.user_id)));
  return listProfiles(admin, orgId, ids);
}
