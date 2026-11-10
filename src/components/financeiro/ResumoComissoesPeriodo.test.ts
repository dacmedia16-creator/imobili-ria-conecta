import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResumoComissoesPeriodo } from "./ResumoComissoesPeriodo";

// Dados fictícios.
const resumo = {
  total: {
    chave: "total",
    label: "Total geral",
    transacoes: 3,
    calculada: 4500,
    recebida: 1500,
    pendente: 3000,
  },
  porEquipe: [
    {
      chave: "b",
      label: "Equipe Beta",
      transacoes: 1,
      calculada: 2500,
      recebida: 0,
      pendente: 2500,
    },
    {
      chave: "a",
      label: "Equipe Alfa",
      transacoes: 2,
      calculada: 2000,
      recebida: 1500,
      pendente: 500,
    },
  ],
};
const render = (p: Partial<Parameters<typeof ResumoComissoesPeriodo>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ResumoComissoesPeriodo, {
      resumo,
      parceriaExterna: 0,
      periodoLabel: "Período teste",
      onExportar: () => {},
      ...p,
    }),
  ).replace(/\u00a0/g, " ");

describe("ResumoComissoesPeriodo (tela)", () => {
  it("mostra transações, as três colunas, equipes e total geral com rótulo explícito", () => {
    const html = render();
    expect(html).toContain("Transações (vendas)");
    expect(html).toContain("Recebida pela imobiliária");
    expect(html).toContain("Pendente");
    expect(html).toContain("Equipe Alfa");
    expect(html).toContain("Equipe Beta");
    expect(html).toContain("Total geral");
    expect(html).toContain("R$ 4.500,00");
    expect(html).toContain("Não indica pagamento ao corretor");
    expect(html).toContain("Exportar resumo");
  });
  it("parceiro externo: avisa que fica fora e mostra o valor à parte quando houver", () => {
    expect(render()).toContain("Parceiro externo fica fora destes totais");
    expect(render({ parceriaExterna: 1234.5 })).toContain("R$ 1.234,50 de parceria externa");
  });
  it("vazio: mensagem e exportação desabilitada", () => {
    const html = render({
      resumo: {
        total: { ...resumo.total, transacoes: 0, calculada: 0, recebida: 0, pendente: 0 },
        porEquipe: [],
      },
    });
    expect(html).toContain("Nenhuma venda com comissão calculada no filtro atual.");
    expect(html).toMatch(/<button[^>]*disabled/);
  });
});
