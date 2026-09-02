import { describe, expect, it } from "vitest";
import { resumirVendas } from "./vendas-resumo";

describe("resumirVendas", () => {
  it("separa quantidade e VGV das vendas padrão que já têm contrato assinado", () => {
    expect(
      resumirVendas([
        { status: "aguardando_assinatura", modalidade: "padrao", valor_negociado: 300_000 },
        { status: "contrato_assinado", modalidade: "padrao", valor_negociado: 500_000 },
        { status: "ocorrencia_concluida", modalidade: "padrao", valor_negociado: 700_000 },
      ]),
    ).toEqual({
      quantidadeTotal: 3,
      valorTotal: 1_500_000,
      quantidadeComContratoAssinado: 2,
      valorComContratoAssinado: 1_200_000,
    });
  });

  it("não trata Lançamento enviado ao financeiro como contrato assinado", () => {
    expect(
      resumirVendas([
        {
          status: "ocorrencia_analise_financeiro",
          modalidade: "lancamento",
          valor_negociado: 900_000,
        },
        { status: "ocorrencia_analise_financeiro", modalidade: "padrao", valor_negociado: 400_000 },
      ]),
    ).toMatchObject({
      quantidadeComContratoAssinado: 1,
      valorComContratoAssinado: 400_000,
    });
  });

  it("normaliza valores ausentes ou inválidos sem quebrar o resumo", () => {
    expect(
      resumirVendas([
        { status: "contrato_assinado", modalidade: "padrao", valor_negociado: null },
        { status: "rascunho", modalidade: "padrao", valor_negociado: "inválido" },
      ]),
    ).toEqual({
      quantidadeTotal: 2,
      valorTotal: 0,
      quantidadeComContratoAssinado: 1,
      valorComContratoAssinado: 0,
    });
  });
});
