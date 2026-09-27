import { describe, expect, it } from "vitest";
import { periodoMensalRelatorios } from "./relatorios-periodo";

describe("periodoMensalRelatorios", () => {
  it("retorna o primeiro e o ultimo dia do mes atual", () => {
    expect(periodoMensalRelatorios("mes_atual", new Date(2026, 8, 2, 10))).toEqual({
      de: "2026-09-01",
      ate: "2026-09-30",
    });
  });

  it("retorna o mes anterior completo", () => {
    expect(periodoMensalRelatorios("mes_anterior", new Date(2026, 8, 2, 10))).toEqual({
      de: "2026-08-01",
      ate: "2026-08-31",
    });
  });

  it("trata corretamente a virada de janeiro para dezembro do ano anterior", () => {
    expect(periodoMensalRelatorios("mes_anterior", new Date(2026, 0, 10, 10))).toEqual({
      de: "2025-12-01",
      ate: "2025-12-31",
    });
  });
  it("usa o mês de São Paulo na virada, mesmo em instante UTC do mês seguinte", () => {
    expect(periodoMensalRelatorios("mes_atual", new Date("2026-10-01T02:30:00Z"))).toEqual({
      de: "2026-09-01",
      ate: "2026-09-30",
    });
    expect(periodoMensalRelatorios("mes_anterior", new Date("2026-01-01T02:30:00Z"))).toEqual({
      de: "2025-11-01",
      ate: "2025-11-30",
    });
  });
  it("avança somente após a virada de São Paulo, inclusive em fevereiro bissexto", () => {
    expect(periodoMensalRelatorios("mes_anterior", new Date("2024-03-01T03:01:00Z"))).toEqual({
      de: "2024-02-01",
      ate: "2024-02-29",
    });
  });
});
