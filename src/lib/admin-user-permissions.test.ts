import { describe, expect, it } from "vitest";
import { canResetAnotherUsersPassword } from "./admin-user-permissions";

describe("permissão para redefinir senha de outro usuário", () => {
  it("permite gestor e team leader redefinirem senha de corretor da própria equipe", () => {
    expect(
      canResetAnotherUsersPassword({
        callerRoles: ["gestor"],
        targetRoles: ["corretor"],
        isLeadOfTarget: true,
      }),
    ).toBe(true);
    expect(
      canResetAnotherUsersPassword({
        callerRoles: ["team_leader"],
        targetRoles: ["corretor"],
        isLeadOfTarget: true,
      }),
    ).toBe(true);
  });

  it("bloqueia corretor de outra equipe", () => {
    expect(
      canResetAnotherUsersPassword({
        callerRoles: ["gestor"],
        targetRoles: ["corretor"],
        isLeadOfTarget: false,
      }),
    ).toBe(false);
  });

  it("bloqueia gestor, team leader e contas administrativas como alvo", () => {
    expect(
      canResetAnotherUsersPassword({
        callerRoles: ["gestor"],
        targetRoles: ["gestor"],
        isLeadOfTarget: true,
      }),
    ).toBe(false);
    expect(
      canResetAnotherUsersPassword({
        callerRoles: ["gestor"],
        targetRoles: ["team_leader"],
        isLeadOfTarget: true,
      }),
    ).toBe(false);
    expect(
      canResetAnotherUsersPassword({
        callerRoles: ["gestor"],
        targetRoles: ["corretor", "admin"],
        isLeadOfTarget: true,
      }),
    ).toBe(false);
  });

  it("mantém admin e super admin autorizados", () => {
    expect(
      canResetAnotherUsersPassword({
        callerRoles: ["admin"],
        targetRoles: ["gestor"],
        isLeadOfTarget: false,
      }),
    ).toBe(true);
    expect(
      canResetAnotherUsersPassword({
        callerRoles: ["super_admin"],
        targetRoles: ["admin"],
        isLeadOfTarget: false,
      }),
    ).toBe(true);
  });
});
