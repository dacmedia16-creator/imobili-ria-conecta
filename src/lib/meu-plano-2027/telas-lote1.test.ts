// @vitest-environment jsdom
/**
 * Meu Plano 2027, Lote 1 (cartão t_9daf1a42): só exibição. Renderiza o corpo das telas com respostas
 * fictícias, sem banco, e confere os textos e a ordem que mudaram.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { calc, type Respostas } from "./regras";
import { PlanoCtx } from "@/components/minha-carreira/meu-plano/campos";
import { CorpoTela } from "@/components/minha-carreira/meu-plano/telas";

const S: Respostas = {
  "d.conv": "42",
  "d.ticket": "700.000",
  "d.ativos": "15",
  "op.0": "3.000",
  "es.aliq": "10",
  "m.faixa": "60",
  "m.pct": "3",
};

function tela(id: string, R: Respostas = S) {
  const ctx = {
    S: R,
    C: calc(R),
    set: () => undefined,
    ro: true,
    inicio: null,
    trilha: "planejamento" as const,
  };
  return render(createElement(PlanoCtx.Provider, { value: ctx }, createElement(CorpoTela, { id })));
}

window.scrollTo = () => undefined;
afterEach(cleanup);

describe("Lote 1: telas", () => {
  it("item 3: canceladas/expiradas vem antes de vendidas nas Metas, como no book", () => {
    const { container } = tela("p32");
    const txt = container.textContent ?? "";
    expect(txt.indexOf("Meta de CREs canceladas/expiradas")).toBeGreaterThan(-1);
    expect(txt.indexOf("Meta de CREs canceladas/expiradas")).toBeLessThan(
      txt.indexOf("Meta de CREs vendidas"),
    );
    expect(txt.indexOf("Canceladas/expiradas")).toBeLessThan(
      txt.indexOf("CREs vendidas", txt.indexOf("Anual")),
    );
    expect(screen.getByText("De onde vem cada número")).toBeTruthy();
  });

  it("item 6: o clube também aparece na tela da faixa, gravando no mesmo campo mt.clube", () => {
    const { container } = tela("p27");
    expect(screen.getByText("Clube de Corretores que quero conquistar em 2027")).toBeTruthy();
    expect(container.querySelector('select[data-k="mt.clube"]')).toBeTruthy();
  });

  it("item 13: avisa que a conversão em branco usa o diagnóstico, ou pede o diagnóstico", () => {
    tela("p30");
    expect(screen.getByText(/a conta está usando/)).toBeTruthy();
    cleanup();
    tela("p30", { "m.faixa": "60" });
    expect(screen.getByText(/As captações ficam em branco até ter a conversão/)).toBeTruthy();
  });

  it("item 2: folga é a taxa e o resultado vem logo abaixo, com a conta", () => {
    tela("p37");
    expect(screen.getByText("Taxa de folga para quem desmarca (%)")).toBeTruthy();
    expect(screen.getByText("RESULTADO · CONTATOS COM AGENDAMENTO POR SEMANA")).toBeTruthy();
    expect(screen.getByText(/V1 por mês ÷ 4 semanas/)).toBeTruthy();
  });

  it("item 15: 6 em 10 é dado fixo da rede", () => {
    tela("p38");
    expect(screen.getByText(/Dado fixo da rede REMAX/)).toBeTruthy();
  });

  it("item 5: origens vazias orientam a preencher a tabela", () => {
    tela("p16");
    expect(screen.getByText(/as 3 maiores origens aparecem aqui sozinhas/)).toBeTruthy();
  });

  it("item 14: mostra o valor digitado e o do orçamento separados", () => {
    tela("p39", { "mk.invest": "30.000", "on.1": "665", "on.2": "988", "on.3": "771" });
    expect(screen.getByText(/o que digitou acima/)).toBeTruthy();
    expect(screen.getByText(/esse segundo número só muda lá/)).toBeTruthy();
  });
});

describe("Lote 1: leitor do book (itens 1, 10 e 12)", () => {
  it("PDF 11 mostra as duas numerações e o atalho grande para as Metas", async () => {
    const { Leitor } = await import("@/components/minha-carreira/meu-plano/Leitor");
    const ids: string[] = [];
    render(
      createElement(Leitor, {
        pagina: 11,
        S: {},
        trilha: null,
        irPagina: () => undefined,
        preencher: (id: string) => ids.push(id),
      }),
    );
    expect(screen.getAllByText("pág. 10 · PDF 11").length).toBeGreaterThan(0);
    const fixo = screen.getByTestId("preencher-pagina-fixo");
    expect(fixo.textContent).toContain("Ir ao exercício: Minhas metas para 2027");
    fixo.click();
    expect(ids).toEqual(["p32"]);
  });
});
