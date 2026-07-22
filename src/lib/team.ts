import { supabase } from "@/integrations/supabase/client";

/**
 * IDs dos corretores que este usuário lidera: membros da(s) equipe(s) onde ele é lider_id,
 * mais membros de sub-equipes cujo pai ele lidera (mesma hierarquia de 1 nível de is_lead_of()).
 */
export async function fetchLedMemberIds(userId: string): Promise<Set<string>> {
  const { data: teams } = await supabase.from("teams").select("id, lider_id, parent_team_id");
  const byId: Record<string, { lider_id: string; parent_team_id: string | null }> = {};
  (teams ?? []).forEach((t: any) => { byId[t.id] = t; });
  const myTeamIds = (teams ?? [])
    .filter((t: any) => t.lider_id === userId || (t.parent_team_id && byId[t.parent_team_id]?.lider_id === userId))
    .map((t: any) => t.id);
  if (myTeamIds.length === 0) return new Set();
  const { data } = await supabase.from("team_members").select("membro_id").in("team_id", myTeamIds);
  return new Set((data ?? []).map((r: any) => r.membro_id));
}
