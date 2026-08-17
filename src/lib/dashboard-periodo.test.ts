import { describe, it, expect } from "vitest";
import {
  dataUtcDeSaoPaulo,
  ehDataIsoValida,
  resolverPeriodo,
  validarPeriodoSearch,
  type PeriodoSearch,
} from "./dashboard-periodo";

describe("ehDataIsoValida — validação estrita de calendário", () => {
  it("aceita datas válidas comuns", () => {
    expect(ehDataIsoValida("2026-08-16")).toBe(true);
    expect(ehDataIsoValida("2026-01-01")).toBe(true);
    expect(ehDataIsoValida("2026-12-31")).toBe(true);
  });

  it("rejeita dia inexistente no mês (não normaliza silenciosamente pro mês seguinte)", () => {
    expect(ehDataIsoValida("2026-02-31")).toBe(false); // fevereiro não tem dia 31
    expect(ehDataIsoValida("2026-04-31")).toBe(false); // abril tem 30 dias
    expect(ehDataIsoValida("2026-02-30")).toBe(false); // fevereiro não tem dia 30
  });

  it("rejeita mês fora de 1-12 e dia 0/32", () => {
    expect(ehDataIsoValida("2026-13-01")).toBe(false);
    expect(ehDataIsoValida("2026-00-10")).toBe(false);
    expect(ehDataIsoValida("2026-08-00")).toBe(false);
    expect(ehDataIsoValida("2026-08-32")).toBe(false);
  });

  it("ano bissexto: 29/fev existe em 2024 e 2000, não existe em 2025 e 1900", () => {
    expect(ehDataIsoValida("2024-02-29")).toBe(true); // bissexto (divisível por 4)
    expect(ehDataIsoValida("2000-02-29")).toBe(true); // bissexto (divisível por 400)
    expect(ehDataIsoValida("2025-02-29")).toBe(false); // não bissexto
    expect(ehDataIsoValida("1900-02-29")).toBe(false); // divisível por 100, não por 400
  });

  it("rejeita formato errado, tipo errado e string vazia", () => {
    expect(ehDataIsoValida("16/08/2026")).toBe(false);
    expect(ehDataIsoValida("2026-8-16")).toBe(false); // precisa de 2 dígitos
    expect(ehDataIsoValida("")).toBe(false);
    expect(ehDataIsoValida(null)).toBe(false);
    expect(ehDataIsoValida(undefined)).toBe(false);
    expect(ehDataIsoValida(20260816)).toBe(false);
  });
});

describe("dataUtcDeSaoPaulo — datas de São Paulo convertidas para UTC", () => {
  it("meia-noite de 1º de agosto/2026 em SP é 03:00 UTC", () => {
    expect(dataUtcDeSaoPaulo(2026, 7, 1).toISOString()).toBe("2026-08-01T03:00:00.000Z");
  });

  it("meia-noite de 1º de setembro/2026 em SP é 03:00 UTC (limite exclusivo do exemplo)", () => {
    expect(dataUtcDeSaoPaulo(2026, 8, 1).toISOString()).toBe("2026-09-01T03:00:00.000Z");
  });

  it("dia fora do range (32 de agosto) normaliza sozinho pra 1º de setembro", () => {
    expect(dataUtcDeSaoPaulo(2026, 7, 32).toISOString()).toBe(
      dataUtcDeSaoPaulo(2026, 8, 1).toISOString(),
    );
  });
});

describe("resolverPeriodo — mês atual", () => {
  it("agosto/2026 (agora = 16/ago 12:00 em SP)", () => {
    const r = resolverPeriodo(
      { periodo: "mes_atual", de: null, ate: null },
      new Date("2026-08-16T15:00:00Z"),
    );
    expect(r).toEqual({
      incompleto: false,
      inicioUtc: "2026-08-01T03:00:00.000Z",
      fimExclusivoUtc: "2026-09-01T03:00:00.000Z",
      label: "Agosto/2026",
    });
  });
});

describe("resolverPeriodo — mês anterior", () => {
  it("julho/2026 quando agora é agosto/2026", () => {
    const r = resolverPeriodo(
      { periodo: "mes_anterior", de: null, ate: null },
      new Date("2026-08-16T15:00:00Z"),
    );
    expect(r).toEqual({
      incompleto: false,
      inicioUtc: "2026-07-01T03:00:00.000Z",
      fimExclusivoUtc: "2026-08-01T03:00:00.000Z",
      label: "Julho/2026",
    });
  });

  it("virada de ano: dezembro/2025 quando agora é janeiro/2026", () => {
    const r = resolverPeriodo(
      { periodo: "mes_anterior", de: null, ate: null },
      new Date("2026-01-10T12:00:00Z"),
    );
    expect(r).toEqual({
      incompleto: false,
      inicioUtc: "2025-12-01T03:00:00.000Z",
      fimExclusivoUtc: "2026-01-01T03:00:00.000Z",
      label: "Dezembro/2025",
    });
  });
});

describe("resolverPeriodo — este ano", () => {
  it("2026 inteiro (1º/jan a 1º/jan seguinte, limite exclusivo)", () => {
    const r = resolverPeriodo(
      { periodo: "ano_atual", de: null, ate: null },
      new Date("2026-08-16T15:00:00Z"),
    );
    expect(r).toEqual({
      incompleto: false,
      inicioUtc: "2026-01-01T03:00:00.000Z",
      fimExclusivoUtc: "2027-01-01T03:00:00.000Z",
      label: "2026",
    });
  });

  it("virada de ano: 02:00 UTC de 1º/jan/2027 ainda é 31/dez/2026 às 23h em SP — não pode contar como 2027", () => {
    const r = resolverPeriodo(
      { periodo: "ano_atual", de: null, ate: null },
      new Date("2027-01-01T02:00:00Z"),
    );
    expect(r.label).toBe("2026");
  });
});

describe("resolverPeriodo — personalizado", () => {
  it("05/08/2026 a 15/08/2026 — fim exclusivo é 16/08 00:00 SP", () => {
    const r = resolverPeriodo(
      { periodo: "personalizado", de: "2026-08-05", ate: "2026-08-15" },
      new Date("2026-08-16T15:00:00Z"),
    );
    expect(r).toEqual({
      incompleto: false,
      inicioUtc: "2026-08-05T03:00:00.000Z",
      fimExclusivoUtc: "2026-08-16T03:00:00.000Z",
      label: "05/08/2026 – 15/08/2026",
    });
  });

  it("intervalo final exclusivo na virada de mês: até 31/08 vira início de 01/09 (não duplica o dia 1º)", () => {
    const r = resolverPeriodo(
      { periodo: "personalizado", de: "2026-08-25", ate: "2026-08-31" },
      new Date("2026-08-16T15:00:00Z"),
    );
    expect(r.incompleto).toBe(false);
    if (!r.incompleto) expect(r.fimExclusivoUtc).toBe("2026-09-01T03:00:00.000Z");
  });

  it("faltando data final: incompleto, não resolve intervalo", () => {
    const r = resolverPeriodo(
      { periodo: "personalizado", de: "2026-08-05", ate: null },
      new Date(),
    );
    expect(r.incompleto).toBe(true);
    expect(r.inicioUtc).toBeNull();
  });

  it("faltando as duas datas: incompleto", () => {
    const r = resolverPeriodo({ periodo: "personalizado", de: null, ate: null }, new Date());
    expect(r.incompleto).toBe(true);
  });

  it("data final antes da inicial: incompleto, não inventa um intervalo invertido", () => {
    const r = resolverPeriodo(
      { periodo: "personalizado", de: "2026-08-20", ate: "2026-08-10" },
      new Date("2026-08-16T15:00:00Z"),
    );
    expect(r.incompleto).toBe(true);
  });

  it("data impossível (29/fev de ano não bissexto) não normaliza pro início de março — fica incompleto", () => {
    const r = resolverPeriodo(
      { periodo: "personalizado", de: "2025-02-29", ate: "2025-03-10" },
      new Date("2025-08-16T15:00:00Z"),
    );
    expect(r.incompleto).toBe(true);
  });

  it("29/fev de ano bissexto é aceito normalmente", () => {
    const r = resolverPeriodo(
      { periodo: "personalizado", de: "2024-02-29", ate: "2024-02-29" },
      new Date("2024-08-16T15:00:00Z"),
    );
    expect(r.incompleto).toBe(false);
    if (!r.incompleto) {
      expect(r.inicioUtc).toBe("2024-02-29T03:00:00.000Z");
      expect(r.fimExclusivoUtc).toBe("2024-03-01T03:00:00.000Z");
    }
  });
});

describe("validarPeriodoSearch — search params inválidos retornam ao padrão mes_atual", () => {
  it("periodo ausente cai em mes_atual", () => {
    expect(validarPeriodoSearch({})).toEqual({ periodo: "mes_atual", de: null, ate: null });
  });

  it("periodo com valor desconhecido cai em mes_atual", () => {
    expect(validarPeriodoSearch({ periodo: "semana_passada" })).toEqual({
      periodo: "mes_atual",
      de: null,
      ate: null,
    });
  });

  it("periodo válido não-personalizado descarta de/ate mesmo se vierem na URL", () => {
    expect(
      validarPeriodoSearch({ periodo: "ano_atual", de: "2026-01-01", ate: "2026-12-31" }),
    ).toEqual({
      periodo: "ano_atual",
      de: null,
      ate: null,
    });
  });

  it("personalizado com datas válidas preserva de/ate", () => {
    const r: PeriodoSearch = validarPeriodoSearch({
      periodo: "personalizado",
      de: "2026-08-01",
      ate: "2026-08-31",
    });
    expect(r).toEqual({ periodo: "personalizado", de: "2026-08-01", ate: "2026-08-31" });
  });

  it("personalizado com data malformada vira null em vez de propagar lixo", () => {
    expect(
      validarPeriodoSearch({ periodo: "personalizado", de: "não-é-data", ate: "2026-13-40" }),
    ).toEqual({
      periodo: "personalizado",
      de: null,
      ate: null,
    });
  });

  it("2026-02-31 na URL não normaliza silenciosamente pra março — vira null", () => {
    expect(
      validarPeriodoSearch({ periodo: "personalizado", de: "2026-02-31", ate: "2026-03-10" }),
    ).toEqual({
      periodo: "personalizado",
      de: null,
      ate: "2026-03-10",
    });
  });
});
