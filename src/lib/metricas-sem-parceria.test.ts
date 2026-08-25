import { describe, expect, it } from "vitest";
import { metricasSemParceria } from "./metricas-sem-parceria";

describe("metricasSemParceria", () => {
  it("mantém os valores integrais quando não existe parceria", () => {
    expect(metricasSemParceria({ vgv: 500000, comissaoBruta: 30000, parceriaExterna: 0 })).toEqual({
      vgvProprio: 500000,
      comissaoPropria: 30000,
      parceriaExterna: 0,
      fracaoPropria: 1,
    });
  });

  it("rateia o VGV pela parte própria da comissão", () => {
    expect(metricasSemParceria({ vgv: 500000, comissaoBruta: 30000, parceriaExterna: 15000 })).toEqual({
      vgvProprio: 250000,
      comissaoPropria: 15000,
      parceriaExterna: 15000,
      fracaoPropria: 0.5,
    });
  });

  it("nunca produz valores negativos se a parceria estiver inconsistente", () => {
    expect(metricasSemParceria({ vgv: 500000, comissaoBruta: 30000, parceriaExterna: 40000 })).toEqual({
      vgvProprio: 0,
      comissaoPropria: 0,
      parceriaExterna: 30000,
      fracaoPropria: 0,
    });
  });
});
