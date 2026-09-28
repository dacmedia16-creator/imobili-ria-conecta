import { describe, expect, it } from "vitest";
import {
  decideCreateUser,
  decideOrgAction,
  decideUserAction,
  grantableRoles,
  REASONS,
  type Actor,
  type ManagedRole,
  type Target,
} from "./user-management-policy";
import { PERCENTUAL_COMISSAO_PADRAO, regraComercialVigente } from "./regra-comercial";
import { PERCENTUAL_PADRAO } from "./comparativo-comissao-calc";

const A = "org-a";
const B = "org-b";

const actors: Record<string, Actor> = {
  plataforma: { userId: "denis", orgId: null, roles: [], isPlatformAdmin: true },
  superAdminA: { userId: "sa-a", orgId: A, roles: ["super_admin"] },
  adminA: { userId: "adm-a", orgId: A, roles: ["admin"] },
  gestorA: { userId: "ges-a", orgId: A, roles: ["gestor", "corretor"] },
  corretorA: { userId: "cor-a", orgId: A, roles: ["corretor"] },
  adminB: { userId: "adm-b", orgId: B, roles: ["admin"] },
};

const t = (userId: string, orgId: string, roles: ManagedRole[], ledBy?: string): Target => ({
  userId,
  orgId,
  roles,
  ledByActor: ledBy !== undefined,
});

// Alvos: corretor da equipe do gestor A, corretor fora da equipe, admin A, corretor B.
const corretorEquipeA = (actor: Actor) => ({
  ...t("cor-eq-a", A, ["corretor"]),
  ledByActor: actor.userId === "ges-a",
});
const corretorForaA = t("cor-fora-a", A, ["corretor"]);
const adminAlvoA = t("adm2-a", A, ["admin"]);
const corretorB = t("cor-b", B, ["corretor"]);

type Row = [string, string, Target | ((a: Actor) => Target), string, ManagedRole | undefined, boolean];
const ACTIONS = ["edit_user", "reset_password", "set_active", "change_roles"] as const;

describe("matriz papel × ação × agência (regra única)", () => {
  const rows: Row[] = [];
  for (const action of ACTIONS) {
    const role = action === "change_roles" ? ("gestor" as ManagedRole) : undefined;
    // super admin A / admin A: tudo dentro de A; nada em B.
    rows.push(["superAdminA", action, corretorForaA, "fora da equipe A", role, true]);
    rows.push(["adminA", action, corretorForaA, "fora da equipe A", role, true]);
    rows.push(["adminA", action, corretorB, "corretor B", role, false]);
    rows.push(["superAdminA", action, corretorB, "corretor B", role, false]);
    rows.push(["adminB", action, corretorB, "corretor B", role, true]);
    rows.push(["adminB", action, corretorForaA, "corretor A", role, false]);
    // gestor A: só a própria equipe, nunca papéis, nunca administradores, nunca B.
    rows.push(["gestorA", action, corretorEquipeA, "equipe A", role, action !== "change_roles"]);
    rows.push(["gestorA", action, corretorForaA, "fora da equipe A", role, false]);
    rows.push(["gestorA", action, adminAlvoA, "admin A", role, false]);
    rows.push(["gestorA", action, corretorB, "corretor B", role, false]);
    // corretor A: nada.
    rows.push(["corretorA", action, corretorEquipeA, "equipe A", role, false]);
    rows.push(["corretorA", action, corretorB, "corretor B", role, false]);
  }

  it.each(rows)("%s · %s · %s (%s)", (actorKey, action, target, _label, role, expected) => {
    const actor = actors[actorKey];
    const tgt = typeof target === "function" ? target(actor) : target;
    const d = decideUserAction(actor, action as (typeof ACTIONS)[number], tgt, role);
    expect(d.allowed).toBe(expected);
    if (!d.allowed) expect(d.reason.length).toBeGreaterThan(10);
  });

  it("alvo de outra agência responde 'não encontrado' sem revelar a agência", () => {
    const d = decideUserAction(actors.adminA, "edit_user", corretorB);
    expect(d).toEqual({ allowed: false, reason: REASONS.otherOrg });
  });

  it("ninguém altera o próprio papel nem age sobre a própria conta", () => {
    for (const key of ["superAdminA", "adminA", "gestorA", "adminB"]) {
      const a = actors[key];
      const self = t(a.userId, a.orgId!, a.roles);
      expect(decideUserAction(a, "change_roles", self, "admin")).toEqual({
        allowed: false,
        reason: REASONS.selfRole,
      });
      expect(decideUserAction(a, "set_active", self).allowed).toBe(false);
    }
  });

  it("admin não concede nem retira papel de administrador; super admin da agência sim", () => {
    expect(decideUserAction(actors.adminA, "change_roles", corretorForaA, "admin")).toEqual({
      allowed: false,
      reason: REASONS.adminGrantsAdmin,
    });
    expect(decideUserAction(actors.adminA, "change_roles", adminAlvoA, "admin").allowed).toBe(false);
    expect(decideUserAction(actors.superAdminA, "change_roles", corretorForaA, "admin").allowed).toBe(
      true,
    );
  });

  it("gestor edita dados de membro não-corretor da equipe, mas não senha/ativação", () => {
    const lider = { ...t("tl-a", A, ["team_leader"]), ledByActor: true };
    expect(decideUserAction(actors.gestorA, "edit_user", lider).allowed).toBe(true);
    expect(decideUserAction(actors.gestorA, "reset_password", lider).allowed).toBe(false);
    expect(decideUserAction(actors.gestorA, "set_active", lider).allowed).toBe(false);
  });

  it("ninguém move usuário entre agências", () => {
    for (const a of Object.values(actors)) {
      expect(decideUserAction(a, "move_user_org", corretorForaA)).toEqual({
        allowed: false,
        reason: REASONS.moveOrg,
      });
    }
  });
});

describe("cadastro de usuário por papel", () => {
  it("papéis concedíveis", () => {
    expect(grantableRoles(["super_admin"])).toContain("admin");
    expect(grantableRoles(["admin"])).not.toContain("admin");
    expect(grantableRoles(["admin"])).not.toContain("super_admin");
    expect(grantableRoles(["gestor"])).toEqual(["corretor"]);
    expect(grantableRoles(["team_leader"])).toEqual(["corretor"]);
    expect(grantableRoles(["corretor"])).toEqual([]);
  });

  it.each([
    ["superAdminA", "admin", true],
    ["adminA", "gestor", true],
    ["adminA", "admin", false],
    ["adminA", "super_admin", false],
    ["gestorA", "corretor", true],
    ["gestorA", "admin", false],
    ["gestorA", "gestor", false],
    ["corretorA", "corretor", false],
    ["adminB", "corretor", true],
  ] as const)("%s cadastra %s → %s", (key, role, expected) => {
    expect(decideCreateUser(actors[key], role).allowed).toBe(expected);
  });

  it("gestor recebe o motivo específico ao tentar cadastrar administrador", () => {
    expect(decideCreateUser(actors.gestorA, "admin")).toEqual({
      allowed: false,
      reason: REASONS.leadCreatesOnlyCorretor,
    });
  });

  it("sem agência ativa, ninguém cadastra", () => {
    expect(decideCreateUser({ ...actors.adminA, orgId: null }, "corretor").allowed).toBe(false);
  });
});

describe("imobiliárias: só o super-admin da plataforma", () => {
  it.each(["create_org", "edit_org", "suspend_org"] as const)("%s", (action) => {
    expect(decideOrgAction(actors.plataforma, action).allowed).toBe(true);
    for (const key of ["superAdminA", "adminA", "gestorA", "corretorA", "adminB"]) {
      expect(decideOrgAction(actors[key], action)).toEqual({
        allowed: false,
        reason: REASONS.platformOnly,
      });
    }
  });
});

describe("regra comercial central versionada", () => {
  it("uma única regra vigente para todas as agências (6%) alimenta os comparativos", () => {
    expect(PERCENTUAL_COMISSAO_PADRAO).toBe(6);
    expect(PERCENTUAL_PADRAO).toBe(PERCENTUAL_COMISSAO_PADRAO);
    expect(regraComercialVigente("2026-09-28").versao).toBe(1);
  });

  it("datas anteriores a qualquer versão falham fechado", () => {
    expect(() => regraComercialVigente("1999-12-31")).toThrow();
  });
});
