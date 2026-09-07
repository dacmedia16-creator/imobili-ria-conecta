import { describe, expect, it } from "vitest";
import { paginate } from "./pagination";

describe("paginate", () => {
  const users = Array.from({ length: 23 }, (_, index) => `user-${index + 1}`);

  it("retorna dez registros e os limites da primeira página", () => {
    expect(paginate(users, 1, 10)).toEqual({
      items: users.slice(0, 10),
      currentPage: 1,
      totalPages: 3,
      startIndex: 0,
      endIndex: 10,
    });
  });

  it("retorna somente os registros restantes na última página", () => {
    expect(paginate(users, 3, 10)).toEqual({
      items: users.slice(20),
      currentPage: 3,
      totalPages: 3,
      startIndex: 20,
      endIndex: 23,
    });
  });

  it("recuará para a última página válida quando o filtro reduzir os resultados", () => {
    const filteredUsers = users.slice(0, 4);
    expect(paginate(filteredUsers, 3, 10)).toMatchObject({
      items: filteredUsers,
      currentPage: 1,
      totalPages: 1,
      startIndex: 0,
      endIndex: 4,
    });
  });

  it("mantém uma página vazia válida quando não há registros", () => {
    expect(paginate([], 1, 10)).toEqual({
      items: [],
      currentPage: 1,
      totalPages: 1,
      startIndex: 0,
      endIndex: 0,
    });
  });
});
