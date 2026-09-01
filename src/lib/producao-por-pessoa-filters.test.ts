import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  filtrosPadrao,
  mesAnteriorRange,
  mesRange,
  mesSelecionado,
} from "./producao-por-pessoa-filters";

describe("filtros mensais de produção por pessoa", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 1, 10));
  });

  afterEach(() => vi.useRealTimers());

  it("abre o relatório no mês atual", () => {
    expect(filtrosPadrao()).toMatchObject({ dataDe: "2026-09-01", dataAte: "2026-09-30" });
  });

  it("calcula o mês anterior inclusive na virada do ano", () => {
    vi.setSystemTime(new Date(2026, 0, 15, 10));
    expect(mesAnteriorRange()).toEqual({ de: "2025-12-01", ate: "2025-12-31" });
  });

  it("converte o mês escolhido no intervalo completo e respeita ano bissexto", () => {
    expect(mesRange("2024-02")).toEqual({ de: "2024-02-01", ate: "2024-02-29" });
    expect(mesSelecionado({ dataDe: "2024-02-01", dataAte: "2024-02-29" })).toBe("2024-02");
  });
});
