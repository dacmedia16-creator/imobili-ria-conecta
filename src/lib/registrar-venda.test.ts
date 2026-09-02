import { describe, expect, it } from "vitest";
import { registrarVendaAction } from "@/lib/registrar-venda";

describe("registrarVendaAction", () => {
  it("pede a escolha para quem pode criar venda padrão e lançamento", () => {
    expect(registrarVendaAction(["gestor", "lancamento"])).toBe("escolher");
    expect(registrarVendaAction(["corretor", "lancamento"])).toBe("escolher");
  });

  it("abre diretamente venda padrão para quem tem apenas esse fluxo", () => {
    expect(registrarVendaAction(["gestor"])).toBe("venda_padrao");
    expect(registrarVendaAction(["team_leader"])).toBe("venda_padrao");
  });

  it("abre diretamente lançamento para quem tem apenas esse fluxo", () => {
    expect(registrarVendaAction(["lancamento"])).toBe("lancamento");
  });

  it("não oferece registro a perfis sem permissão", () => {
    expect(registrarVendaAction(["juridico"])).toBe("nenhuma");
    expect(registrarVendaAction([])).toBe("nenhuma");
  });
});
