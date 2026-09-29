import { describe, expect, it } from "vitest";
import { dataCivilSaoPaulo, hojeSaoPaulo } from "./hoje-sao-paulo";

describe("dataCivilSaoPaulo", () => {
  it("converte timestamptz UTC para o dia civil de São Paulo (virada de mês)", () => {
    expect(dataCivilSaoPaulo("2026-09-01T00:10:00+00:00")).toBe("2026-08-31");
    expect(dataCivilSaoPaulo("2026-09-01T03:00:00+00:00")).toBe("2026-09-01");
    expect(dataCivilSaoPaulo("2026-09-09T01:02:00.123Z")).toBe("2026-09-08");
  });

  it("mantém colunas date intactas e rejeita vazio/inválido", () => {
    expect(dataCivilSaoPaulo("2026-08-31")).toBe("2026-08-31");
    expect(dataCivilSaoPaulo(null)).toBeNull();
    expect(dataCivilSaoPaulo("")).toBeNull();
    expect(dataCivilSaoPaulo("nao-e-data")).toBeNull();
  });

  it("hojeSaoPaulo segue o mesmo fuso", () => {
    expect(hojeSaoPaulo(new Date("2026-09-01T00:10:00Z"))).toBe("2026-08-31");
  });
});
