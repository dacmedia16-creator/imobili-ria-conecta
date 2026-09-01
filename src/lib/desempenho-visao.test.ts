import { describe, expect, it } from "vitest";
import { visaoInicialDesempenho, podeAlternarVisaoDesempenho } from "./desempenho-visao";

describe("visões da tela Desempenho", () => {
  it.each([["gestor"], ["team_leader"]] as const)("abre Minha equipe primeiro para %s", (papel) => {
    expect(visaoInicialDesempenho([papel])).toBe("equipe");
    expect(podeAlternarVisaoDesempenho([papel])).toBe(true);
  });

  it.each([["admin"], ["super_admin"], ["financeiro"]] as const)(
    "mantém Empresa como visão única para %s",
    (papel) => {
      expect(visaoInicialDesempenho([papel])).toBe("empresa");
      expect(podeAlternarVisaoDesempenho([papel])).toBe(false);
    },
  );
});
