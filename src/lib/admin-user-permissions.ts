export type UserManagementRole =
  | "corretor"
  | "gestor"
  | "team_leader"
  | "juridico"
  | "financeiro"
  | "lancamento"
  | "admin"
  | "super_admin";

export function canResetAnotherUsersPassword(input: {
  callerRoles: UserManagementRole[];
  targetRoles: UserManagementRole[];
  isLeadOfTarget: boolean;
}) {
  if (input.callerRoles.some((role) => role === "admin" || role === "super_admin")) return true;

  const isTeamLead = input.callerRoles.some((role) => role === "gestor" || role === "team_leader");
  const targetIsOnlyCorretor =
    input.targetRoles.length > 0 && input.targetRoles.every((role) => role === "corretor");

  return isTeamLead && input.isLeadOfTarget && targetIsOnlyCorretor;
}
