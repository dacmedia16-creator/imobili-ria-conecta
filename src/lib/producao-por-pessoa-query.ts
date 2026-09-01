/**
 * Busca/agregação de dados do "Produção por Pessoa" — único módulo que fala com o Supabase.
 * Só leitura. A RPC producao_por_pessoa_dados já barra qualquer papel fora de
 * admin/super_admin/financeiro (ver migration), então um erro dela aqui normalmente significa "sem
 * permissão" — tratado como lista vazia pelo chamador.
 */
import { supabase } from "@/integrations/supabase/client";
import { gerarPontas } from "@/lib/producao-por-pessoa-calc";
import type { ProducaoPonta, ProducaoRawRow } from "@/lib/producao-por-pessoa-types";

type TeamRow = { id: string; nome: string; lider_id: string | null };
type TeamMemberRow = { membro_id: string; team_id: string };
type CoLeaderRow = { user_id: string; team_id: string };

/** Pessoa → equipe: membro (team_members) OU líder/líder-auxiliar da própria equipe (teams.lider_id
 * / team_co_leaders) — mesmo cálculo já usado no Comparativo 6%, pra não perder quem sobe venda em
 * nome próprio sendo também líder. */
function resolverEquipePorPessoa(
  teams: TeamRow[],
  members: TeamMemberRow[],
  coLeaders: CoLeaderRow[],
) {
  const teamIdByPessoa = new Map<string, string>();
  for (const m of members)
    if (!teamIdByPessoa.has(m.membro_id)) teamIdByPessoa.set(m.membro_id, m.team_id);
  for (const t of teams)
    if (t.lider_id && !teamIdByPessoa.has(t.lider_id)) teamIdByPessoa.set(t.lider_id, t.id);
  for (const c of coLeaders)
    if (!teamIdByPessoa.has(c.user_id)) teamIdByPessoa.set(c.user_id, c.team_id);
  return teamIdByPessoa;
}

// "as any" só no nome da RPC: producao_por_pessoa_dados existe no banco (20260820100000) mas ainda
// não foi regenerada em src/integrations/supabase/types.ts (arquivo gerado, não editado à mão). O
// cast some sozinho na próxima geração de types.
export async function fetchProducaoPorPessoa(): Promise<ProducaoPonta[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await supabase.rpc("producao_por_pessoa_dados" as any)) as {
    data: ProducaoRawRow[] | null;
    error: { message: string } | null;
  };
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const [{ data: teams }, { data: members }, { data: coLeaders }] = await Promise.all([
    supabase.from("teams").select("id, nome, lider_id"),
    supabase.from("team_members").select("membro_id, team_id"),
    supabase.from("team_co_leaders").select("user_id, team_id"),
  ]);

  const teamsArr = (teams ?? []) as TeamRow[];
  const teamNomeById = new Map(teamsArr.map((t) => [t.id, t.nome]));
  const teamIdByPessoa = resolverEquipePorPessoa(
    teamsArr,
    (members ?? []) as TeamMemberRow[],
    (coLeaders ?? []) as CoLeaderRow[],
  );

  return gerarPontas(rows, teamIdByPessoa, teamNomeById);
}
