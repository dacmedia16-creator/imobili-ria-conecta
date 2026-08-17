import { describe, it, expect } from "vitest";
import {
  mapearMovimentacaoPeriodo,
  type MovimentacaoPeriodoRaw,
} from "./dashboard-movimentacao-query";

describe("mapearMovimentacaoPeriodo", () => {
  it("converte snake_case pra camelCase e number pra todos os campos", () => {
    const raw: MovimentacaoPeriodoRaw = {
      futuras_quantidade: 5,
      futuras_vgv: 1250000.5,
      confirmadas_quantidade: 3,
      confirmadas_vgv: 890000,
      encerradas_quantidade: 1,
      sem_data_futura: 2,
      sem_data_confirmada: 1,
      sem_data_encerrada: 0,
    };
    expect(mapearMovimentacaoPeriodo(raw)).toEqual({
      futurasQuantidade: 5,
      futurasVgv: 1250000.5,
      confirmadasQuantidade: 3,
      confirmadasVgv: 890000,
      encerradasQuantidade: 1,
      semDataFutura: 2,
      semDataConfirmada: 1,
      semDataEncerrada: 0,
    });
  });

  it("VGV vindo como string (jsonb->numeric) é convertido pra number", () => {
    const raw: MovimentacaoPeriodoRaw = {
      futuras_quantidade: 2,
      futuras_vgv: "450000.75",
      confirmadas_quantidade: 0,
      confirmadas_vgv: "0",
      encerradas_quantidade: 0,
      sem_data_futura: 0,
      sem_data_confirmada: 0,
      sem_data_encerrada: 0,
    };
    const r = mapearMovimentacaoPeriodo(raw);
    expect(r.futurasVgv).toBe(450000.75);
    expect(r.confirmadasVgv).toBe(0);
    expect(typeof r.futurasVgv).toBe("number");
  });

  it("zero em todos os campos não quebra (período sem nenhuma movimentação)", () => {
    const raw: MovimentacaoPeriodoRaw = {
      futuras_quantidade: 0,
      futuras_vgv: 0,
      confirmadas_quantidade: 0,
      confirmadas_vgv: 0,
      encerradas_quantidade: 0,
      sem_data_futura: 0,
      sem_data_confirmada: 0,
      sem_data_encerrada: 0,
    };
    expect(mapearMovimentacaoPeriodo(raw).futurasQuantidade).toBe(0);
  });

  it("VGV arredonda pra exatamente 2 casas decimais, sem ruído de ponto flutuante", () => {
    const raw: MovimentacaoPeriodoRaw = {
      futuras_quantidade: 1,
      futuras_vgv: 1234.566 + 0.001, // ruído de ponto flutuante (não é 1234.567 exato em IEEE754)
      confirmadas_quantidade: 1,
      confirmadas_vgv: "890000.126",
      encerradas_quantidade: 0,
      sem_data_futura: 0,
      sem_data_confirmada: 0,
      sem_data_encerrada: 0,
    };
    const r = mapearMovimentacaoPeriodo(raw);
    expect(r.futurasVgv).toBe(1234.57);
    expect(r.confirmadasVgv).toBe(890000.13);
  });

  it("resposta null lança erro em vez de virar NaN silenciosamente", () => {
    expect(() => mapearMovimentacaoPeriodo(null)).toThrow(/não é um objeto/);
  });

  it("resposta que não é objeto (string, número, array) lança erro", () => {
    expect(() => mapearMovimentacaoPeriodo("erro")).toThrow(/não é um objeto/);
    expect(() => mapearMovimentacaoPeriodo(42)).toThrow(/não é um objeto/);
    expect(() => mapearMovimentacaoPeriodo([1, 2, 3])).toThrow(/não é um objeto/);
  });

  it("campo ausente lança erro nomeando o campo, em vez de virar NaN", () => {
    const raw = {
      futuras_quantidade: 5,
      futuras_vgv: 1000,
      confirmadas_quantidade: 3,
      confirmadas_vgv: 500,
      encerradas_quantidade: 1,
      sem_data_futura: 0,
      sem_data_confirmada: 0,
      // sem_data_encerrada ausente — resposta incompleta da RPC
    };
    expect(() => mapearMovimentacaoPeriodo(raw)).toThrow(/sem_data_encerrada/);
  });

  it("campo não numérico (string arbitrária, null, boolean) lança erro", () => {
    const base: MovimentacaoPeriodoRaw = {
      futuras_quantidade: 5,
      futuras_vgv: 1000,
      confirmadas_quantidade: 3,
      confirmadas_vgv: 500,
      encerradas_quantidade: 1,
      sem_data_futura: 0,
      sem_data_confirmada: 0,
      sem_data_encerrada: 0,
    };
    expect(() =>
      mapearMovimentacaoPeriodo({ ...base, futuras_quantidade: "não é número" }),
    ).toThrow(/futuras_quantidade/);
    expect(() => mapearMovimentacaoPeriodo({ ...base, confirmadas_vgv: null })).toThrow(
      /confirmadas_vgv/,
    );
    expect(() => mapearMovimentacaoPeriodo({ ...base, encerradas_quantidade: true })).toThrow(
      /encerradas_quantidade/,
    );
  });
});
