import { describe, it, expect } from "vitest";
import { agruparVendasPorGrupoComVgv } from "./dashboard-perfil-query";

describe("agruparVendasPorGrupoComVgv", () => {
  it("array vazio retorna os 4 grupos zerados, não undefined", () => {
    expect(agruparVendasPorGrupoComVgv([])).toEqual({
      preparacao: { quantidade: 0, vgv: 0 },
      futura: { quantidade: 0, vgv: 0 },
      confirmada: { quantidade: 0, vgv: 0 },
      encerrada: { quantidade: 0, vgv: 0 },
    });
  });

  it("agrupa quantidade e soma VGV por grupo corretamente", () => {
    const r = agruparVendasPorGrupoComVgv([
      { status: "rascunho", valor_negociado: 100000 },
      { status: "enviada_revisao", valor_negociado: 200000 },
      { status: "devolvida_ajuste", valor_negociado: 150000 },
      { status: "contrato_assinado", valor_negociado: 500000 },
      { status: "ocorrencia_concluida", valor_negociado: 300000 },
      { status: "cancelada", valor_negociado: 90000 },
    ]);
    expect(r.preparacao).toEqual({ quantidade: 1, vgv: 100000 });
    expect(r.futura).toEqual({ quantidade: 2, vgv: 350000 });
    expect(r.confirmada).toEqual({ quantidade: 2, vgv: 800000 });
    expect(r.encerrada).toEqual({ quantidade: 1, vgv: 90000 });
  });

  it("ocorrencia_devolvida_gestor conta como confirmada (mesma regra da Etapa 1)", () => {
    const r = agruparVendasPorGrupoComVgv([
      { status: "ocorrencia_devolvida_gestor", valor_negociado: 400000 },
    ]);
    expect(r.confirmada).toEqual({ quantidade: 1, vgv: 400000 });
    expect(r.futura.quantidade).toBe(0);
  });

  it("valor_negociado null conta como 0, não quebra a soma nem vira NaN", () => {
    const r = agruparVendasPorGrupoComVgv([
      { status: "rascunho", valor_negociado: null },
      { status: "rascunho", valor_negociado: 50000 },
    ]);
    expect(r.preparacao).toEqual({ quantidade: 2, vgv: 50000 });
  });

  it("valor_negociado como string (defensivo) é somado como número", () => {
    const r = agruparVendasPorGrupoComVgv([{ status: "rascunho", valor_negociado: "75000" }]);
    expect(r.preparacao.vgv).toBe(75000);
  });

  it("status fora do enum lança erro em vez de sumir silenciosamente da contagem", () => {
    expect(() =>
      agruparVendasPorGrupoComVgv([{ status: "status_inexistente", valor_negociado: 1000 }]),
    ).toThrow(/status_inexistente/);
  });
});
