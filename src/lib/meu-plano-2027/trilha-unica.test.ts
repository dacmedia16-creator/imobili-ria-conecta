// @vitest-environment jsdom
/**
 * Meu Plano 2027 — caminho único (t_296fc69e, Denis 13/11: "uma trilha só", na ordem da cartilha).
 * Planos antigos fictícios de cada trilha abrem no caminho único sem perder nenhuma resposta.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { calc, type Respostas } from "./regras";
import { PlanoCtx } from "@/components/minha-carreira/meu-plano/campos";
import { CorpoTela } from "@/components/minha-carreira/meu-plano/telas";
import { destinoExercicios } from "@/components/minha-carreira/meu-plano/Leitor";
import { ORDEM, TELAS, inicioNoventaDias, progresso, statusTela, tela, vizinhos } from "./telas";

afterEach(cleanup);

// Plano antigo (fictício) da trilha Ativação: parou em p49, com dia 1 gravado em ativacao_inicio.
const ANTIGO_ATIVACAO = {
  trilha: "ativacao",
  ativacao_inicio: "2026-11-02",
  respostas: {
    "d.ticket": "0",
    "pq.frase": "Comprar minha casa",
    "op.0": "3.000",
    "m.faixa": "60",
    "d90.cre1": "2026-12-10",
    "d90.parceiro": "Carla",
    "sem.0.0": true,
    "mc.c.1": true,
    "ui.ult": "p49",
  } as Respostas,
};
// Plano antigo (fictício) da trilha Planejamento: parou em p38, sem ativacao_inicio.
const ANTIGO_PLANEJAMENTO = {
  trilha: "planejamento",
  ativacao_inicio: null,
  respostas: {
    "d.ticket": "700.000",
    "pq.frase": "Segurança para a família",
    "pos.regiao": "Campolim",
    "sp.0": "10",
    "rv.mes": "4",
    "ui.ult": "p38",
  } as Respostas,
};

function corpo(id: string, S: Respostas, inicio: string | null, ro = false) {
  const ctx = { S, C: calc(S), set: () => undefined, ro, inicio };
  return render(createElement(PlanoCtx.Provider, { value: ctx }, createElement(CorpoTela, { id })));
}

describe("ordem única (cartilha)", () => {
  it("todas as 26 telas, na ordem das páginas do book, sem repetir", () => {
    expect(ORDEM).toEqual([
      "p11",
      "p15",
      "p16",
      "p17",
      "p20",
      "p22",
      "p23",
      "p24",
      "p25",
      "p27",
      "p30",
      "p31",
      "p32",
      "p34",
      "p36",
      "p37",
      "p38",
      "p39",
      "p40",
      "p43",
      "p44",
      "p45",
      "p49",
      "p50",
      "p51",
      "p52",
    ]);
    const pdfs = ORDEM.map((id) => tela(id)!.pdf);
    expect(pdfs).toEqual([...pdfs].sort((a, b) => a - b));
    expect(new Set(ORDEM).size).toBe(TELAS.length);
  });

  it("anterior/próximo atravessam os blocos que antes ficavam fora de uma das trilhas", () => {
    expect(vizinhos("p32").proxima).toBe("p34");
    expect(vizinhos("p45").proxima).toBe("p49");
    expect(vizinhos("p51").proxima).toBe("p52");
    expect(vizinhos("p11").anterior).toBeNull();
    expect(vizinhos("p52").proxima).toBeNull();
    expect(vizinhos("p49")).toMatchObject({ i: 22, total: 26 });
  });

  it("nenhum texto de tela cita trilha", () => {
    for (const t of TELAS) expect(`${t.ev} ${t.t} ${t.intro}`).not.toMatch(/trilha/i);
  });
});

describe("planos antigos abrem sem perder nada", () => {
  for (const p of [ANTIGO_ATIVACAO, ANTIGO_PLANEJAMENTO])
    it(`trilha ${p.trilha}: continua na tela em que parou, respostas e % intactos`, () => {
      const S = p.respostas;
      const copia = structuredClone(S);
      expect(destinoExercicios(S)).toEqual({ v: "tela", id: S["ui.ult"] });
      const pr = progresso(S);
      expect(pr.total).toBe(26);
      expect(pr.pct).toBeGreaterThan(0);
      // Nada é reescrito pela leitura.
      expect(S).toEqual(copia);
    });

  it("Ativação: as telas que já tinham resposta continuam preenchidas no caminho único", () => {
    const S = ANTIGO_ATIVACAO.respostas;
    expect(statusTela("p50", S)).toBe("ok");
    expect(statusTela("p51", S)).toBe("ok");
    expect(statusTela("p34", S)).toBe("vazio"); // tela nova para quem era da Ativação
  });

  it("Planejamento: p34–p38 com resposta seguem preenchidas; p49–p51 aparecem como novas", () => {
    const S = ANTIGO_PLANEJAMENTO.respostas;
    expect(statusTela("p34", S)).toBe("parc");
    expect(statusTela("p49", S)).toBe("vazio");
  });
});

describe("dia 1 dos 90 dias (p49/p50)", () => {
  it("1º ativacao_inicio gravado; 2º a data marcada em p49 (d90.inicio); senão vazio", () => {
    expect(inicioNoventaDias("2026-11-02", { "d90.inicio": "2027-01-05" })).toBe("2026-11-02");
    expect(inicioNoventaDias(null, { "d90.inicio": "2027-01-05" })).toBe("2027-01-05");
    expect(inicioNoventaDias(null, {})).toBeNull();
    expect(inicioNoventaDias(undefined, { "d90.inicio": "lixo" })).toBeNull();
  });

  it("quem era da Ativação vê a data antiga fixa, sem campo para trocar", () => {
    const { container } = corpo("p49", ANTIGO_ATIVACAO.respostas, "2026-11-02");
    expect(container.querySelector('input[data-k="d90.inicio"]')).toBeNull();
    expect(screen.getByTestId("p49-inicio").textContent).toContain("02/11/2026");
    expect(screen.getByTestId("p49-inicio").textContent).toContain("17/12/2026"); // dia 45
  });

  it("quem nunca escolheu Ativação marca o próprio dia 1 em p49", () => {
    const S = ANTIGO_PLANEJAMENTO.respostas;
    const { container, unmount } = corpo("p49", S, inicioNoventaDias(null, S));
    expect(container.querySelector('input[data-k="d90.inicio"]')).toBeTruthy();
    expect(screen.getByTestId("p49-inicio").textContent).toMatch(/Marque a data acima/);
    unmount();
    const S2 = { ...S, "d90.inicio": "2027-01-04" };
    corpo("p49", S2, inicioNoventaDias(null, S2));
    expect(screen.getByTestId("p49-inicio").textContent).toContain("04/01/2027");
  });

  it("o dia 1 é só registro: não muda nenhuma conta nem o %", () => {
    const S = ANTIGO_PLANEJAMENTO.respostas;
    const com = { ...S, "d90.inicio": "2027-01-04" };
    expect(calc(com)).toEqual(calc(S));
    expect(progresso(com)).toEqual(progresso(S));
  });
});
