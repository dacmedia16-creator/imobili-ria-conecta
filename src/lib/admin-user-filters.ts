export type UserStatusFilter = "todos" | "ativos" | "inativos";

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
};

export function filterAdminUsers<T extends FilterableUser>(
  users: T[],
  { search, role, status, rolesByUser }: UserFilters,
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

    return matchesSearch && matchesRole && matchesStatus;
  });
}
