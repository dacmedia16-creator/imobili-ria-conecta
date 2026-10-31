import { describe, expect, it } from "vitest";
import { estadoCargaPerfil, podeSalvarPerfil } from "./perfil-carga";

describe("Meu acesso — nunca gravar vazio por cima (item 6 t_8730be75)", () => {
  it("leitura com erro ou sem linha trava o Salvar", () => {
    expect(estadoCargaPerfil({ data: null, error: { message: "rede" } })).toBe("erro");
    expect(estadoCargaPerfil({ data: { nome: "x" }, error: { message: "rls" } })).toBe("erro");
    expect(estadoCargaPerfil({ data: null, error: null })).toBe("erro");
    expect(podeSalvarPerfil("erro")).toBe(false);
    expect(podeSalvarPerfil("carregando")).toBe(false);
  });
  it("leitura ok libera o Salvar, mesmo com campos vazios de verdade", () => {
    expect(estadoCargaPerfil({ data: { telefone: null }, error: null })).toBe("ok");
    expect(podeSalvarPerfil("ok")).toBe(true);
  });
});
