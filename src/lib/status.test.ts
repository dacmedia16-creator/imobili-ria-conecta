import { describe, it, expect } from "vitest";
import { fatorComissaoPropria } from "./status";

describe("fatorComissaoPropria — regra 15: parcelas de recebimento descontam a parceria externa", () => {
  it("sem parceria, a parcela inteira é da imobiliária (fator 1)", () => {
    expect(fatorComissaoPropria(43800, 0)).toBe(1);
  });

  it("comissão total zero ou não informada, fator neutro (1) — evita divisão por zero", () => {
    expect(fatorComissaoPropria(0, 0)).toBe(1);
    expect(fatorComissaoPropria(null, 0)).toBe(1);
    expect(fatorComissaoPropria(undefined, 0)).toBe(1);
  });

  it("cenário base (comissão R$43.800, parceria R$21.900): fator 0,5 — metade da parcela é nossa", () => {
    const fator = fatorComissaoPropria(43800, 21900);
    expect(fator).toBe(0.5);
    // Uma parcela prevista de R$10.000 brutos vira R$5.000 na coluna "nossa".
    expect(Number((10000 * fator).toFixed(2))).toBe(5000);
  });

  it("parceria igual à comissão inteira: fator 0 — nada sobra pra imobiliária", () => {
    expect(fatorComissaoPropria(43800, 43800)).toBe(0);
  });

  it("parceria maior que a comissão (dado inconsistente, regra 16): fator nunca fica negativo", () => {
    const fator = fatorComissaoPropria(43800, 60000);
    expect(fator).toBe(0);
    expect(fator).toBeGreaterThanOrEqual(0);
  });
});
