import { describe, expect, it } from "vitest";
import { commissionOverview } from "./sale-commission-overview";
import type { CommissionExtraRow, SaleRow } from "./database.types";

const sale = {
  valor_total_comissao: 10000,
  corretor_captador: "Captador",
  corretor_vendedor: "Vendedor",
  indicador_captador: "Indicador",
  lider_captador_nome: "Líder",
  parceria_nome: "Parceiro externo",
  valor_comissao_lider_captador: 500,
} as SaleRow;
const extras = [{ id: "extra", papel: "gestor", nome: "Coordenador", valor: 500 }] as CommissionExtraRow[];

describe("divisão completa da comissão na Visão geral e impressão", () => {
  it("usa líquidos para não duplicar indicador, extras e contas de origem", () => {
    const summary = commissionOverview(sale, {
      comissao_bruta: 10000, liquido_captador: 2000, liquido_vendedor: 2500,
      indicador_captador: 500, parceria_externa: 1000, saldo_liquido_imobiliaria: 3000,
    }, extras);
    expect(summary.difference).toBe(0);
    expect(summary.lines.map(x => x.label).join(" ")).toMatch(/Captador.*Vendedor.*Indicador.*Líder.*Coordenador.*Parceiro externo.*Imobiliária/);
    expect(summary.lines.reduce((sum, x) => sum + x.value, 0)).toBe(10000);
    expect(summary.lines.reduce((sum, x) => sum + x.percent, 0)).toBe(100);
  });
  it("expõe, sem maquiar, diferença para comissão bruta inválida", () => {
    const summary = commissionOverview(sale, { comissao_bruta: 10000, liquido_captador: 2000 }, []);
    expect(summary.difference).toBe(7500);
  });
});
