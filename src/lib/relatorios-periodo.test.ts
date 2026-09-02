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
});
