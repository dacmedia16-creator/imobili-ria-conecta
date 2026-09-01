import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  intervaloInicialDesempenho,
  intervaloValido,
  periodoDesempenhoLabel,
} from "./desempenho-periodo";

describe("período da tela Desempenho", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 15, 10));
  });

  afterEach(() => vi.useRealTimers());

  it("abre no mês atual completo", () => {
    expect(intervaloInicialDesempenho()).toEqual({ de: "2026-09-01", ate: "2026-09-30" });
  });

  it("aceita intervalo inclusivo e rejeita data final anterior à inicial", () => {
    expect(intervaloValido({ de: "2026-08-15", ate: "2026-09-01" })).toBe(true);
    expect(intervaloValido({ de: "2026-09-02", ate: "2026-09-01" })).toBe(false);
    expect(intervaloValido({ de: "", ate: "2026-09-01" })).toBe(false);
  });

  it("descreve mês completo e período personalizado", () => {
    expect(periodoDesempenhoLabel({ de: "2026-09-01", ate: "2026-09-30" })).toBe(
      "setembro de 2026",
    );
    expect(periodoDesempenhoLabel({ de: "2026-08-15", ate: "2026-09-01" })).toBe(
      "15/08/2026 a 01/09/2026",
    );
  });
});
