import { describe, expect, it } from "vitest";
import { periodoInicialVendas, periodoMesAnterior, periodoMesAtual } from "./vendas-periodo";

describe("atalhos mensais da lista de vendas", () => {
  it("abre a lista de vendas com o mês atual aplicado", () => {
    expect(periodoInicialVendas(new Date(2026, 8, 2))).toEqual({
      de: "2026-09-01",
      ate: "2026-09-30",
    });
  });

  it("preenche o mês atual completo", () => {
    expect(periodoMesAtual(new Date(2026, 8, 2))).toEqual({
      de: "2026-09-01",
      ate: "2026-09-30",
    });
  });

  it("preenche o mês anterior completo inclusive na virada do ano", () => {
    expect(periodoMesAnterior(new Date(2026, 0, 10))).toEqual({
      de: "2025-12-01",
      ate: "2025-12-31",
    });
  });
});
