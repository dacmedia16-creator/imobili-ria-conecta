import { describe, expect, it } from "vitest";
import {
  ATIVIDADES,
  agruparPorDia,
  diaMinimo,
  diaPermitido,
  inicioSemana,
  nomeAtividade,
  normalizarContagens,
  normalizarEquipe,
  normalizarRegistro,
  resumoDia,
  somarDias,
} from "./minha-carreira-diario";

const reg = (id: string, dia: string, tipo: string, quantidade: number) =>
  normalizarRegistro({ id, user_id: "u", dia, tipo, quantidade, created_at: "" });

describe("diário: atividades", () => {
  it("botões da maquete: ligação, visita e ACM, sem pontos", () => {
    expect(ATIVIDADES.map((a) => a.tipo)).toEqual(["ligacao", "visita", "acm"]);
    expect(ATIVIDADES.some((a) => "pontos" in a)).toBe(false);
  });

  it("nome no singular e no plural", () => {
    expect(nomeAtividade("ligacao", 1)).toBe("ligação");
    expect(nomeAtividade("ligacao", 6)).toBe("ligações");
    expect(nomeAtividade("acm", 1)).toBe("ACM");
    expect(nomeAtividade("acm", 2)).toBe("ACMs");
    expect(nomeAtividade("outro", 2)).toBe("outro");
  });
});

describe("diário: datas", () => {
  it("soma dias atravessando mês e ano", () => {
    expect(somarDias("2026-10-01", -1)).toBe("2026-09-30");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("aceita de hoje até 31 dias atrás, como o banco", () => {
    expect(diaMinimo("2026-10-16")).toBe("2026-09-15");
    expect(diaPermitido("2026-10-16", "2026-10-16")).toBe(true);
    expect(diaPermitido("2026-09-15", "2026-10-16")).toBe(true);
    expect(diaPermitido("2026-09-14", "2026-10-16")).toBe(false);
    expect(diaPermitido("2026-10-17", "2026-10-16")).toBe(false);
    expect(diaPermitido("16/10/2026", "2026-10-16")).toBe(false);
  });

  it("semana começa na segunda", () => {
    expect(inicioSemana("2026-10-16")).toBe("2026-10-12"); // sexta
    expect(inicioSemana("2026-10-12")).toBe("2026-10-12"); // segunda
    expect(inicioSemana("2026-10-18")).toBe("2026-10-12"); // domingo
  });
});

describe("diário: dados do banco", () => {
  it("contagens sempre trazem as 3 atividades, na ordem, com zero quando faltam", () => {
    expect(normalizarContagens([{ tipo: "acm", hoje: "1", semana: 2, mes: 3 }])).toEqual([
      { tipo: "ligacao", hoje: 0, semana: 0, mes: 0 },
      { tipo: "visita", hoje: 0, semana: 0, mes: 0 },
      { tipo: "acm", hoje: 1, semana: 2, mes: 3 },
    ]);
    expect(normalizarContagens(null)).toHaveLength(3);
  });

  it("normaliza a equipe com nome padrão e números", () => {
    expect(
      normalizarEquipe([
        {
          user_id: "u1",
          nome: null,
          ligacoes: "6",
          visitas: 1,
          acms: null,
          ultimo_dia: "2026-10-16",
        },
      ]),
    ).toEqual([
      {
        user_id: "u1",
        nome: "Corretor",
        ligacoes: 6,
        visitas: 1,
        acms: 0,
        ultimo_dia: "2026-10-16",
      },
    ]);
  });

  it("registro corta a data em aaaa-mm-dd", () => {
    expect(reg("a", "2026-10-16T00:00:00", "ligacao", 2).dia).toBe("2026-10-16");
  });
});

describe("diário: histórico", () => {
  it("agrupa por dia (mais recente primeiro) e soma cada atividade", () => {
    const dias = agruparPorDia([
      reg("1", "2026-10-15", "acm", 1),
      reg("2", "2026-10-16", "visita", 1),
      reg("3", "2026-10-16", "ligacao", 4),
      reg("4", "2026-10-16", "ligacao", 2),
    ]);
    expect(dias.map((d) => d.dia)).toEqual(["2026-10-16", "2026-10-15"]);
    expect(dias[0].itens).toEqual([
      { tipo: "ligacao", quantidade: 6, ids: ["3", "4"] },
      { tipo: "visita", quantidade: 1, ids: ["2"] },
    ]);
    expect(resumoDia(dias[0])).toBe("6 ligações · 1 visita");
  });

  it("dia sem registro", () => {
    expect(resumoDia(undefined)).toBe("nenhuma atividade registrada");
    expect(agruparPorDia([])).toEqual([]);
  });
});
