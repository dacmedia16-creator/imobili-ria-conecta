import { supabase } from "@/integrations/supabase/client";

/**
 * IDs dos corretores que este usuário lidera: membros da(s) equipe(s) onde ele é lider_id (ou
 * líder auxiliar, via team_co_leaders — mesmas capacidades, só escopadas à equipe), mais membros
 * de sub-equipes cujo pai ele lidera/co-lidera (mesma hierarquia de 1 nível de is_lead_of()).
 */
export async function fetchLedMemberIds(userId: string): Promise<Set<string>> {
  const [{ data: teams }, { data: coLeaderRows }] = await Promise.all([
    supabase.from("teams").select("id, lider_id, parent_team_id"),
    supabase.from("team_co_leaders").select("team_id").eq("user_id", userId),
  ]);
  const byId: Record<string, { lider_id: string; parent_team_id: string | null }> = {};
  (teams ?? []).forEach((t: any) => { byId[t.id] = t; });
  const coLeaderTeamIds = new Set((coLeaderRows ?? []).map((r: any) => r.team_id));
  const myTeamIds = (teams ?? [])
    .filter((t: any) =>
      t.lider_id === userId
      || coLeaderTeamIds.has(t.id)
      || (t.parent_team_id && (byId[t.parent_team_id]?.lider_id === userId || coLeaderTeamIds.has(t.parent_team_id))),
    )
    .map((t: any) => t.id);
  if (myTeamIds.length === 0) return new Set();
  const { data } = await supabase.from("team_members").select("membro_id").in("team_id", myTeamIds);
  return new Set((data ?? []).map((r: any) => r.membro_id));
}
