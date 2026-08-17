import { describe, it, expect } from "vitest";
import {
  agruparComissaoPorBeneficiario,
  agruparParceriaExternaPorOcorrencia,
} from "./comissao-por-beneficiario";

describe("agruparComissaoPorBeneficiario", () => {
  it("array vazio retorna tudo zerado, não undefined", () => {
    expect(agruparComissaoPorBeneficiario([])).toEqual({
      porBeneficiario: {},
      semVinculo: { quantidade: 0, valor: 0 },
      parceriaExterna: { quantidade: 0, valor: 0 },
    });
  });

  it("soma corretamente quando a mesma pessoa recebe em várias linhas/vendas", () => {
    const r = agruparComissaoPorBeneficiario([
      { user_id: "gustavo", valor: 3060.2 },
      { user_id: "gustavo", valor: 5448.45 },
      { user_id: "virginia", valor: 7335.45 },
    ]);
    expect(r.porBeneficiario).toEqual({ gustavo: 8508.65, virginia: 7335.45 });
    expect(r.semVinculo).toEqual({ quantidade: 0, valor: 0 });
    expect(r.parceriaExterna).toEqual({ quantidade: 0, valor: 0 });
  });

  it("linha sem user_id não entra em porBeneficiario — some do total de ninguém", () => {
    const r = agruparComissaoPorBeneficiario([
      { user_id: null, valor: 765.05 },
      { user_id: "gustavo", valor: 3060.2 },
    ]);
    expect(r.porBeneficiario).toEqual({ gustavo: 3060.2 });
    expect(r.porBeneficiario.null).toBeUndefined();
  });

  it("linha sem user_id e sem sem_cadastro_confirmado vai pra semVinculo (vínculo esquecido/quebrado)", () => {
    const r = agruparComissaoPorBeneficiario([
      { user_id: null, valor: 765.05 },
      { user_id: null, valor: 617.47, sem_cadastro_confirmado: false },
      { user_id: "gustavo", valor: 100 },
    ]);
    expect(r.semVinculo).toEqual({ quantidade: 2, valor: 1382.52 });
    expect(r.parceriaExterna).toEqual({ quantidade: 0, valor: 0 });
  });

  it("linha sem user_id com sem_cadastro_confirmado=true vai pra parceriaExterna, não pra semVinculo (Wilson Grecchi)", () => {
    const r = agruparComissaoPorBeneficiario([
      { user_id: null, valor: 9807.21, sem_cadastro_confirmado: true },
      { user_id: null, valor: 5613.12, sem_cadastro_confirmado: true },
      { user_id: "gustavo", valor: 100 },
    ]);
    expect(r.parceriaExterna.quantidade).toBe(2);
    expect(r.parceriaExterna.valor).toBeCloseTo(15420.33, 2);
    expect(r.semVinculo).toEqual({ quantidade: 0, valor: 0 });
    expect(r.porBeneficiario).toEqual({ gustavo: 100 });
  });

  it("distingue parceiro externo confirmado de vínculo quebrado mesmo com user_id nulo nos dois — nunca pelo nome/papel", () => {
    const r = agruparComissaoPorBeneficiario([
      { user_id: null, valor: 617.47, sem_cadastro_confirmado: false }, // vínculo esquecido (Aline)
      { user_id: null, valor: 9807.21, sem_cadastro_confirmado: true }, // parceiro externo (Wilson)
    ]);
    expect(r.semVinculo).toEqual({ quantidade: 1, valor: 617.47 });
    expect(r.parceriaExterna).toEqual({ quantidade: 1, valor: 9807.21 });
  });

  it("valor total das 3 categorias nunca perde dinheiro — soma de tudo bate com a soma das linhas originais", () => {
    const linhas = [
      { user_id: "gustavo", valor: 3060.2 },
      { user_id: null, valor: 617.47, sem_cadastro_confirmado: false },
      { user_id: null, valor: 9807.21, sem_cadastro_confirmado: true },
    ];
    const r = agruparComissaoPorBeneficiario(linhas);
    const totalOriginal = linhas.reduce((s, l) => s + l.valor, 0);
    const totalAgregado =
      Object.values(r.porBeneficiario).reduce((s, v) => s + v, 0) +
      r.semVinculo.valor +
      r.parceriaExterna.valor;
    expect(totalAgregado).toBeCloseTo(totalOriginal, 2);
  });

  it("valor null ou string é tratado como número (defensivo, mesmo padrão de outros módulos)", () => {
    const r = agruparComissaoPorBeneficiario([
      { user_id: "x", valor: null },
      { user_id: "x", valor: "100.50" },
    ]);
    expect(r.porBeneficiario.x).toBe(100.5);
  });

  it("caso real: reconciliação da venda f0255f67 (Virginia + Gustavo vinculados, Aline sem vínculo)", () => {
    const r = agruparComissaoPorBeneficiario([
      { user_id: "e8f6eb73-510b-404e-bbef-53cd4bc4742e", valor: 7335.45 }, // Virginia Aranha
      { user_id: "12c887f7-dd5c-44f5-91f3-cfd875dc7c50", valor: 3060.2 }, // Gustavo Fuentes
      { user_id: null, valor: 765.05, sem_cadastro_confirmado: false }, // "Aline Rodrigues" digitado, sem user_id
    ]);
    expect(r.porBeneficiario["e8f6eb73-510b-404e-bbef-53cd4bc4742e"]).toBe(7335.45);
    expect(r.porBeneficiario["12c887f7-dd5c-44f5-91f3-cfd875dc7c50"]).toBe(3060.2);
    expect(r.semVinculo).toEqual({ quantidade: 1, valor: 765.05 });
    expect(r.parceriaExterna).toEqual({ quantidade: 0, valor: 0 });
  });

  it("caso real: venda e838b9c6/2afebeaa (Wilson Grecchi, parceiro externo confirmado, 2 parcelas)", () => {
    const r = agruparComissaoPorBeneficiario([
      { user_id: null, valor: 9807.21, sem_cadastro_confirmado: true }, // Wilson Grecchi, venda e838b9c6
      { user_id: null, valor: 5613.12, sem_cadastro_confirmado: true }, // Wilson Grecchi, venda 2afebeaa
    ]);
    expect(r.parceriaExterna.quantidade).toBe(2);
    expect(r.parceriaExterna.valor).toBeCloseTo(15420.33, 2);
    expect(r.semVinculo).toEqual({ quantidade: 0, valor: 0 });
    expect(r.porBeneficiario).toEqual({});
  });
});

describe("agruparParceriaExternaPorOcorrencia", () => {
  it("array vazio retorna objeto vazio", () => {
    expect(agruparParceriaExternaPorOcorrencia([])).toEqual({});
  });

  it("linha sem sem_cadastro_confirmado não entra — só parceiro externo confirmado é descontado do faturamento", () => {
    const r = agruparParceriaExternaPorOcorrencia([
      { occurrence_id: "occ-1", valor: 617.47, sem_cadastro_confirmado: false },
      { occurrence_id: "occ-1", valor: 100, sem_cadastro_confirmado: true },
    ]);
    expect(r).toEqual({ "occ-1": 100 });
  });

  it("soma várias linhas confirmadas da mesma ocorrência", () => {
    const r = agruparParceriaExternaPorOcorrencia([
      { occurrence_id: "occ-1", valor: 9807.21, sem_cadastro_confirmado: true },
      { occurrence_id: "occ-1", valor: 500, sem_cadastro_confirmado: true },
    ]);
    expect(r["occ-1"]).toBeCloseTo(10307.21, 2);
  });

  it("separa corretamente por ocorrência — nunca mistura o total de uma venda com o de outra", () => {
    const r = agruparParceriaExternaPorOcorrencia([
      { occurrence_id: "occ-e838b9c6", valor: 9807.21, sem_cadastro_confirmado: true },
      { occurrence_id: "occ-2afebeaa", valor: 5613.12, sem_cadastro_confirmado: true },
    ]);
    expect(r["occ-e838b9c6"]).toBeCloseTo(9807.21, 2);
    expect(r["occ-2afebeaa"]).toBeCloseTo(5613.12, 2);
  });

  it("valor null ou string é tratado como número, mesmo padrão do resto do módulo", () => {
    const r = agruparParceriaExternaPorOcorrencia([
      { occurrence_id: "occ-1", valor: "100.50", sem_cadastro_confirmado: true },
    ]);
    expect(r["occ-1"]).toBe(100.5);
  });
});
