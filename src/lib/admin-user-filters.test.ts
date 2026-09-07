import { describe, expect, it } from "vitest";
import { filterAdminUsers, type UserStatusFilter } from "./admin-user-filters";

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
