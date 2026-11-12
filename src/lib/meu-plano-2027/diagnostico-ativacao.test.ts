// @vitest-environment jsdom
/**
 * Meu Plano 2027 (t_8a8eb930, Denis 12/11): a pág. 14 do book (“Meu ano em números”, PDF 15, tela p15)
 * e as págs. 15 e 16 (PDF 16 e 17) também na trilha Ativação, na ordem do book, e o ticket médio da
 * pág. 26 (tela p27) puxando o valor da pág. 14.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { calc, type Respostas } from "./regras";
import { PlanoCtx } from "@/components/minha-carreira/meu-plano/campos";
import { CorpoTela } from "@/components/minha-carreira/meu-plano/telas";
import { destinoExercicios } from "@/components/minha-carreira/meu-plano/Leitor";
import { ORDEM, progresso, rotuloPagina, tela, vizinhos, type Trilha } from "./telas";

window.scrollTo = () => undefined;
afterEach(cleanup);

function corpo(id: string, S: Respostas, trilha: Trilha, irPara?: (id: string) => void) {
  const ctx = { S, C: calc(S), set: () => undefined, ro: true, inicio: null, trilha };
  return render(
    createElement(
      PlanoCtx.Provider,
      { value: ctx },
      createElement(CorpoTela, { id, extras: { irPara } }),
    ),
  );
}

describe("trilha Ativação com o Diagnóstico (pág. 14 a 16 do book)", () => {
  it("ordem do book: p11 do book (KRIs) fica no fim; p15 → p16 → p17 → p20 no começo", () => {
    expect(ORDEM.ativacao.slice(0, 4)).toEqual(["p15", "p16", "p17", "p20"]);
    for (const id of ["p15", "p16", "p17"]) expect(tela(id)!.trilhas).toContain("ativacao");
    // as telas da Ativação seguem a ordem das páginas do book, exceto o bloco Ativação/pacto/fechamento
    const diag = ORDEM.ativacao.slice(0, ORDEM.ativacao.indexOf("p32") + 1);
    const pdfs = diag.map((id) => tela(id)!.pdf);
    expect(pdfs).toEqual([...pdfs].sort((a, b) => a - b));
  });

  it("“Meu ano em números” é a pág. 14 impressa do book, com os 5 campos da gravação", () => {
    expect(rotuloPagina(tela("p15")!.pdf)).toBe("pág. 14 · PDF 15");
    corpo("p15", {}, "ativacao");
    for (const l of [
      "Comissão recebida",
      "Transações fechadas*",
      "Captações com representação exclusiva (CREs)",
      "Conversão das CREs (vendidas ÷ total)",
      "Ticket médio das transações vendidas",
    ])
      expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    expect(screen.getByTestId("p15-sem-historico")).toBeTruthy();
  });

  it("Planejamento continua igual (mesma ordem e sem a dica de quem está começando)", () => {
    expect(ORDEM.planejamento.slice(0, 4)).toEqual(["p15", "p16", "p17", "p20"]);
    corpo("p15", {}, "planejamento");
    expect(screen.queryByTestId("p15-sem-historico")).toBeNull();
  });

  it("plano já salvo na Ativação: nenhum dado some, o “continuar” segue na tela em que parou", () => {
    const S: Respostas = { "pq.frase": "Família", "op.0": "3.000", "ui.ult": "p24" };
    expect(destinoExercicios(S, "ativacao")).toEqual({ v: "tela", id: "p24" });
    expect(vizinhos("p24", "ativacao").anterior).toBe("p23");
    expect(vizinhos("p17", "ativacao").proxima).toBe("p20");
    expect(vizinhos("p20", "ativacao").anterior).toBe("p17");
    const p = progresso(S, "ativacao");
    expect(p.total).toBe(ORDEM.ativacao.length);
    expect(p.pct).toBeGreaterThan(0);
    // ui.ult vazio: começa pela pág. 14 (Meu ano em números)
    expect(destinoExercicios({}, "ativacao")).toEqual({ v: "tela", id: "p15" });
  });
});

describe("ticket médio da pág. 26 (p27) puxando a pág. 14 (p15)", () => {
  const base: Respostas = { "op.0": "3.000", "es.aliq": "10", "m.faixa": "60", "m.pct": "3" };

  it("vazio: na Ativação pede o ticket e leva à pág. 14", () => {
    const ir: string[] = [];
    corpo("p27", base, "ativacao", (id) => ir.push(id));
    expect(screen.getByText(/Preencha o “Ticket médio das transações vendidas” em/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /Meu ano em números \(pág\. 14 · PDF 15\)/ }),
    );
    expect(ir).toEqual(["p15"]);
    expect(calc(base).trans).toBeNaN();
  });

  it("preenchido na pág. 14: a conta usa o valor e o corretor ainda pode digitar outro", () => {
    const S = { ...base, "d.ticket": "500.000" };
    corpo("p27", S, "ativacao");
    expect(screen.getByText(/a conta está usando/)).toBeTruthy();
    expect(calc(S).ticket).toBe(500000);
    expect(calc({ ...S, "m.ticket": "800.000" }).ticket).toBe(800000);
  });

  it("ticket ou conversão 0 na pág. 14 (sem histórico) não vira R$ 0 nem conta quebrada", () => {
    const S = { ...base, "d.ticket": "0", "d.conv": "0" };
    expect(calc(S).ticket).toBeNaN();
    expect(calc(S).conv).toBeNaN();
    corpo("p27", S, "ativacao");
    expect(screen.queryByText(/a conta está usando/)).toBeNull();
    expect(screen.getByText(/Preencha o “Ticket médio das transações vendidas” em/)).toBeTruthy();
  });
});
