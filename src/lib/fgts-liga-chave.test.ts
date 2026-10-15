import { describe, it, expect } from "vitest";
import { aplicarValorFgts, calcularComposicaoPagamento } from "@/lib/status";

describe("FGTS — digitar valor liga a chave Sim", () => {
  it("valor > 0 com chave desligada → fgts=true e a composição soma o valor", () => {
    const antes = { tipo_pagamento: "vista", entrada_valor: 150000, fgts: false };
    const depois = aplicarValorFgts(antes, 49000);
    expect(depois.fgts).toBe(true);
    expect(depois.fgts_valor).toBe(49000);
    const c = calcularComposicaoPagamento({ valor_negociado: 199000 }, depois);
    expect(c.total).toBe(199000);
    expect(c.diferenca).toBe(0);
  });

  it("valor 0 ou vazio não mexe na chave", () => {
    expect(aplicarValorFgts({ fgts: false }, 0).fgts).toBe(false);
    expect(aplicarValorFgts({ fgts: true }, 0).fgts).toBe(true);
    expect(aplicarValorFgts({ fgts: false }, null).fgts).toBe(false);
    expect(aplicarValorFgts({}, null).fgts).toBeUndefined();
  });

  it("preserva os demais campos do pagamento", () => {
    const depois = aplicarValorFgts({ entrada_valor: 10, observacoes: "x" }, 5);
    expect(depois).toEqual({ entrada_valor: 10, observacoes: "x", fgts_valor: 5, fgts: true });
  });
});
