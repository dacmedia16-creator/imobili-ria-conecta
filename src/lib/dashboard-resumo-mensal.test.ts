import { describe, expect, it } from "vitest";
import { intervaloResumoMensal } from "./dashboard-resumo-mensal";

describe("intervaloResumoMensal", () => {
  const agora = new Date("2026-09-02T00:30:00Z"); // ainda é 1º de setembro em São Paulo

  it("monta o mês atual pelo calendário de São Paulo", () => {
    expect(intervaloResumoMensal(0, agora)).toEqual({
      de: "2026-09-01",
      ate: "2026-09-30",
      hoje: "2026-09-01",
      label: "setembro de 2026",
    });
  });

  it("monta o mês anterior completo", () => {
    expect(intervaloResumoMensal(-1, agora)).toEqual({
      de: "2026-08-01",
      ate: "2026-08-31",
      hoje: "2026-08-31",
      label: "agosto de 2026",
    });
  });

  it("trata a virada de janeiro para dezembro do ano anterior", () => {
    expect(intervaloResumoMensal(-1, new Date("2026-01-15T15:00:00Z"))).toMatchObject({
      de: "2025-12-01",
      ate: "2025-12-31",
      label: "dezembro de 2025",
    });
  });
});
