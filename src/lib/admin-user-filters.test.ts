import { describe, expect, it } from "vitest";
import {
  filterAdminUsers,
  TEAM_FILTER_COM,
  TEAM_FILTER_SEM,
  TEAM_FILTER_TODAS,
  teamIdsByUserFrom,
  type UserStatusFilter,
} from "./admin-user-filters";

const users = [
  { id: "1", nome: "Ana Ativa", email: "ana@example.com", ativo: true },
  { id: "2", nome: "Bruno Inativo", email: "bruno@example.com", ativo: false },
  { id: "3", nome: null, email: "carla@example.com", ativo: null },
];
const rolesByUser = { 1: ["admin"], 2: ["corretor"], 3: ["corretor"] };

function filter(status: UserStatusFilter, search = "", role = "todos") {
  return filterAdminUsers(users, { status, search, role, rolesByUser }).map((user) => user.id);
}

describe("filterAdminUsers", () => {
  it("considera ativo qualquer perfil cujo campo ativo não seja false", () => {
    expect(filter("ativos")).toEqual(["1", "3"]);
  });

  it("retorna somente perfis com ativo false ao selecionar inativos", () => {
    expect(filter("inativos")).toEqual(["2"]);
  });

  it("mantém ativos e inativos ao selecionar todos", () => {
    expect(filter("todos")).toEqual(["1", "2", "3"]);
  });

  it("combina status, busca por nome ou e-mail e papel", () => {
    expect(filter("ativos", "CARLA@", "corretor")).toEqual(["3"]);
    expect(filter("inativos", "bruno", "admin")).toEqual([]);
  });
});

describe("filtro de equipe", () => {
  const team = [
    { id: "u1", nome: "Líder Mãe", email: null, ativo: true },
    { id: "u2", nome: "Membro Sub", email: null, ativo: true },
    { id: "u3", nome: "Auxiliar Sub", email: null, ativo: true },
    { id: "u4", nome: "Solto", email: null, ativo: true },
    { id: "u5", nome: "Membro Inativo", email: null, ativo: false },
  ];
  const teams = [
    { id: "mae", lider_id: "u1" },
    { id: "sub", lider_id: "u1" },
  ];
  const map = teamIdsByUserFrom(
    teams,
    [
      { membro_id: "u2", team_id: "sub" },
      { membro_id: "u5", team_id: "mae" },
      { membro_id: "u4", team_id: "equipe-de-outra-org" },
    ],
    [{ team_id: "sub", user_id: "u3" }],
  );
  const run = (t: string, status: UserStatusFilter = "todos", search = "") =>
    filterAdminUsers(team, {
      search,
      role: "todos",
      status,
      rolesByUser: {},
      team: t,
      teamIdsByUser: map,
    }).map((u) => u.id);

  it("conta membro, líder e líder auxiliar como com equipe (sem duplicar)", () => {
    expect([...map.u1].sort()).toEqual(["mae", "sub"]);
    expect(map.u3).toEqual(["sub"]);
    expect(map.u4).toBeUndefined();
  });

  it("todas, com e sem equipe", () => {
    expect(run(TEAM_FILTER_TODAS)).toEqual(["u1", "u2", "u3", "u4", "u5"]);
    expect(run(TEAM_FILTER_COM)).toEqual(["u1", "u2", "u3", "u5"]);
    expect(run(TEAM_FILTER_SEM)).toEqual(["u4"]);
  });

  it("filtra uma equipe específica pelo id", () => {
    expect(run("sub")).toEqual(["u1", "u2", "u3"]);
    expect(run("mae")).toEqual(["u1", "u5"]);
  });

  it("combina com status e busca", () => {
    expect(run(TEAM_FILTER_COM, "ativos")).toEqual(["u1", "u2", "u3"]);
    expect(run(TEAM_FILTER_COM, "inativos")).toEqual(["u5"]);
    expect(run(TEAM_FILTER_COM, "todos", "sub")).toEqual(["u2", "u3"]);
    expect(run(TEAM_FILTER_SEM, "inativos")).toEqual([]);
  });
});
