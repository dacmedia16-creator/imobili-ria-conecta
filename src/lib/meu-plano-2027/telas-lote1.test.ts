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
import { destinoExercicios } from "@/components/minha-carreira/meu-plano/Leitor";
import { TOTAL_PAGINAS } from "./book";
import { ORDEM, exercicioDaPagina, telaDaPagina, type Trilha } from "./telas";

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
    // a bolinha da folga repete a fórmula do book; aqui é a conta visível
    expect(screen.getByText(/^Conta: .*V1 por mês ÷ 4 semanas/)).toBeTruthy();
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
  it("PDF 11 mostra as duas numerações e o botão grande leva ao quadro de KRIs", async () => {
    const { Leitor } = await import("@/components/minha-carreira/meu-plano/Leitor");
    const ids: string[] = [];
    render(
      createElement(Leitor, {
        pagina: 11,
        S: {},
        trilha: null,
        irPagina: () => undefined,
        preencher: (id: string) => ids.push(id),
        escolherTrilha: () => ids.push("TRILHA"),
      }),
    );
    expect(screen.getAllByText("pág. 10 · PDF 11").length).toBeGreaterThan(0);
    const fixo = screen.getByTestId("preencher-pagina-fixo");
    // t_1bce8b3d: o PDF 11 ganhou o próprio exercício (antes era atalho para as Metas, p32).
    expect(fixo.textContent).toContain("Preencher esta página");
    fixo.click();
    expect(ids).toEqual(["p11"]);
  });
});

describe('t_9887c656: botão fixo "Ir para os exercícios" em todas as páginas do book', () => {
  async function abrir(pagina: number, trilha: Trilha | null, R: Respostas = {}) {
    const { Leitor } = await import("@/components/minha-carreira/meu-plano/Leitor");
    const ids: string[] = [];
    render(
      createElement(Leitor, {
        pagina,
        S: R,
        trilha,
        irPagina: () => undefined,
        preencher: (id: string) => ids.push(id),
        escolherTrilha: () => ids.push("TRILHA"),
      }),
    );
    return ids;
  }
  // PDF 1 (capa) não tem exercício nem atalho.
  const SEM_EX = 1;

  it("todas as 56 páginas têm exatamente um botão fixo para os exercícios", async () => {
    const { Leitor } = await import("@/components/minha-carreira/meu-plano/Leitor");
    for (let p = 1; p <= TOTAL_PAGINAS; p++) {
      const { unmount } = render(
        createElement(Leitor, {
          pagina: p,
          S: {},
          trilha: "planejamento",
          irPagina: () => undefined,
          preencher: () => undefined,
          escolherTrilha: () => undefined,
        }),
      );
      const n =
        screen.queryAllByTestId("preencher-pagina-fixo").length +
        screen.queryAllByTestId("ir-exercicios-fixo").length;
      expect(n, `PDF ${p}`).toBe(1);
      unmount();
    }
  });

  it("página com exercício: só o botão verde do Lote 1, sem duplicar", async () => {
    const ids = await abrir(11, "planejamento");
    expect(screen.queryByTestId("ir-exercicios-fixo")).toBeNull();
    screen.getByTestId("preencher-pagina-fixo").click();
    expect(ids).toEqual(["p11"]);
  });

  it("página sem exercício, com trilha: volta à última tela (ui.ult) ou à primeira da trilha", async () => {
    expect(telaDaPagina(SEM_EX) ?? exercicioDaPagina(SEM_EX)).toBeUndefined();
    const ult = ORDEM.planejamento[3];
    let ids = await abrir(SEM_EX, "planejamento", { "ui.ult": ult });
    expect(screen.queryByTestId("preencher-pagina-fixo")).toBeNull();
    const b = screen.getByTestId("ir-exercicios-fixo");
    expect(b.textContent).toContain("Ir para os exercícios");
    b.click();
    expect(ids).toEqual([ult]);
    cleanup();
    ids = await abrir(SEM_EX, "ativacao");
    screen.getByTestId("ir-exercicios-fixo").click();
    expect(ids).toEqual([ORDEM.ativacao[0]]);
    // ui.ult de outra trilha não vale: vai para a primeira da trilha atual.
    expect(destinoExercicios({ "ui.ult": "nao-existe" }, "planejamento")).toEqual({
      v: "tela",
      id: ORDEM.planejamento[0],
    });
  });

  it("página sem exercício, sem trilha: abre a escolha de trilha", async () => {
    const ids = await abrir(SEM_EX, null, { "ui.ult": ORDEM.planejamento[2] });
    screen.getByTestId("ir-exercicios-fixo").click();
    expect(ids).toEqual(["TRILHA"]);
  });
});
