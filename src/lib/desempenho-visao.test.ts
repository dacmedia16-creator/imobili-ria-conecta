import { describe, expect, it } from "vitest";
import { visaoInicialDesempenho, podeAlternarVisaoDesempenho } from "./desempenho-visao";

describe("visões da tela Desempenho", () => {
  it.each([["gestor"], ["team_leader"]] as const)("abre Minha equipe primeiro para %s", (papel) => {
    expect(visaoInicialDesempenho([papel], true)).toBe("equipe");
    expect(podeAlternarVisaoDesempenho([papel], true)).toBe(true);
  });

  it.each([["gestor"], ["team_leader"]] as const)(
    "abre somente Empresa quando %s não possui equipe",
    (papel) => {
      expect(visaoInicialDesempenho([papel], false)).toBe("empresa");
      expect(podeAlternarVisaoDesempenho([papel], false)).toBe(false);
    },
  );

  it("não libera Minha equipe enquanto o vínculo ainda não foi verificado", () => {
    expect(visaoInicialDesempenho(["gestor"], null)).toBe("empresa");
    expect(podeAlternarVisaoDesempenho(["gestor"], null)).toBe(false);
  });

  it.each([["admin"], ["super_admin"], ["financeiro"]] as const)(
    "mantém Empresa como visão única para %s",
    (papel) => {
      expect(visaoInicialDesempenho([papel])).toBe("empresa");
      expect(podeAlternarVisaoDesempenho([papel])).toBe(false);
    },
  );
});
