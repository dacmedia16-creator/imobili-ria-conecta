export type UserStatusFilter = "todos" | "ativos" | "inativos";

/** Filtro de equipe da lista de usuários (t_736d19de): todas, com equipe, sem equipe ou o id
 * de uma equipe específica. */
export const TEAM_FILTER_TODAS = "__todas_equipes__";
export const TEAM_FILTER_COM = "__com_equipe__";
export const TEAM_FILTER_SEM = "__sem_equipe_filtro__";
export type UserTeamFilter = string;

type FilterableUser = {
  id: string;
  nome: string | null;
  email: string | null;
  ativo: boolean | null;
};

type UserFilters = {
  search: string;
  role: string | "todos";
  status: UserStatusFilter;
  rolesByUser: Record<string, string[]>;
  /** Padrão: todas as equipes. */
  team?: UserTeamFilter;
  /** Equipes de cada usuário (membro, líder ou líder auxiliar). Ver teamIdsByUserFrom. */
  teamIdsByUser?: Record<string, string[]>;
};

/** Conta como "na equipe" quem é membro (team_members), líder (teams.lider_id) ou líder
 * auxiliar (team_co_leaders) de qualquer equipe ou subequipe. Só usa dados já carregados. */
export function teamIdsByUserFrom(
  teams: { id: string; lider_id: string | null }[],
  members: { membro_id: string; team_id: string }[],
  coLeaders: { team_id: string; user_id: string }[],
): Record<string, string[]> {
  const known = new Set(teams.map((t) => t.id));
  const out: Record<string, Set<string>> = {};
  const add = (userId: string | null | undefined, teamId: string) => {
    if (!userId || !known.has(teamId)) return;
    (out[userId] ??= new Set()).add(teamId);
  };
  teams.forEach((t) => add(t.lider_id, t.id));
  members.forEach((m) => add(m.membro_id, m.team_id));
  coLeaders.forEach((c) => add(c.user_id, c.team_id));
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

export function filterAdminUsers<T extends FilterableUser>(
  users: T[],
  { search, role, status, rolesByUser, team = TEAM_FILTER_TODAS, teamIdsByUser = {} }: UserFilters,
): T[] {
  const searchQuery = search.trim().toLowerCase();

  return users.filter((user) => {
    const matchesSearch =
      !searchQuery ||
      (user.nome ?? "").toLowerCase().includes(searchQuery) ||
      (user.email ?? "").toLowerCase().includes(searchQuery);
    const matchesRole = role === "todos" || (rolesByUser[user.id] ?? []).includes(role);
    const isActive = user.ativo !== false;
    const matchesStatus = status === "todos" || (status === "ativos" ? isActive : !isActive);
    const userTeams = teamIdsByUser[user.id] ?? [];
    const matchesTeam =
      team === TEAM_FILTER_TODAS ||
      (team === TEAM_FILTER_COM
        ? userTeams.length > 0
        : team === TEAM_FILTER_SEM
          ? userTeams.length === 0
          : userTeams.includes(team));

    return matchesSearch && matchesRole && matchesStatus && matchesTeam;
  });
}
