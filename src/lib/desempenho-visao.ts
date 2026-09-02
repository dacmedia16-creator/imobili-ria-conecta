import type { AppRole } from "./auth";

export type VisaoDesempenho = "equipe" | "empresa";

const ehLider = (roles: readonly AppRole[]) =>
  roles.some((role) => role === "gestor" || role === "team_leader");

export const visaoInicialDesempenho = (
  roles: readonly AppRole[],
  temEquipe: boolean | null = false,
): VisaoDesempenho => (ehLider(roles) && temEquipe ? "equipe" : "empresa");

export const podeAlternarVisaoDesempenho = (
  roles: readonly AppRole[],
  temEquipe: boolean | null = false,
) => ehLider(roles) && temEquipe === true;
