import { describe, expect, it } from "vitest";
import {
  TAXAS_PADRAO,
  calcularFunil,
  diasUteisRestantes,
  falta,
  normalizarRealizado,
  periodoAtual,
  projecao,
  taxasEfetivas,
  type TaxasRow,
} from "./minha-carreira";

describe("Meu mês — calculadora de trás para frente", () => {
  it("vendas → ACMs → visitas → ligações com as taxas padrão", () => {
    const f = calcularFunil(TAXAS_PADRAO, { vendas: 2, comissao: null, captacoes: 0 });
    expect(f).toEqual({ vendas: 2, captacoes: 0, acms: 8, visitas: 24, ligacoes: 240 });
  });

  it("captações somam ACMs pela taxa de ACMs por captação", () => {
    const f = calcularFunil(TAXAS_PADRAO, { vendas: 1, comissao: null, captacoes: 3 });
    expect(f.acms).toBe(4 + 6);
    expect(f.visitas).toBe(30);
    expect(f.ligacoes).toBe(300);
  });

  it("usa a falta em comissão ÷ comissão média quando ela pede mais vendas", () => {
    const t = { ...TAXAS_PADRAO, comissao_media: 6000 };
    expect(calcularFunil(t, { vendas: 1, comissao: 13000, captacoes: null }).vendas).toBe(3);
    expect(calcularFunil(t, { vendas: 4, comissao: 13000, captacoes: null }).vendas).toBe(4);
  });

  it("sem comissão média, ignora a meta em R$ (não inventa número)", () => {
    expect(calcularFunil(TAXAS_PADRAO, { vendas: null, comissao: 50000, captacoes: null })).toEqual(
      {
        vendas: 0,
        captacoes: 0,
        acms: 0,
        visitas: 0,
        ligacoes: 0,
      },
    );
  });

  it("taxas fracionadas arredondam para cima", () => {
    const t = {
      ...TAXAS_PADRAO,
      acms_por_venda: 2.5,
      visitas_por_acm: 1.5,
      ligacoes_por_visita: 7,
    };
    const f = calcularFunil(t, { vendas: 1, comissao: null, captacoes: 0 });
    expect(f).toMatchObject({ acms: 3, visitas: 5, ligacoes: 35 });
  });
});

describe("Meu mês — taxas efetivas", () => {
  const org: TaxasRow = {
    user_id: null,
    comissao_media: 7000,
    ligacoes_por_visita: 8,
    visitas_por_acm: 3,
    acms_por_venda: 4,
    acms_por_captacao: 2,
  };
  it("sem nada salvo: padrão do sistema", () => {
    expect(taxasEfetivas([], "u1")).toEqual({ taxas: TAXAS_PADRAO, proprias: false });
  });
  it("padrão da imobiliária quando o corretor não ajustou", () => {
    expect(taxasEfetivas([org], "u1")).toMatchObject({
      taxas: { ligacoes_por_visita: 8, comissao_media: 7000 },
      proprias: false,
    });
  });
  it("ajuste do corretor vence; comissão média vazia herda da imobiliária", () => {
    const minha = { ...org, user_id: "u1", comissao_media: null, ligacoes_por_visita: 12 };
    expect(taxasEfetivas([org, minha], "u1")).toMatchObject({
      taxas: { ligacoes_por_visita: 12, comissao_media: 7000 },
      proprias: true,
    });
  });
});

describe("Meu mês — período, projeção e falta", () => {
  it("período no horário de São Paulo (virada de mês às 01h UTC ainda é o mês anterior)", () => {
    const p = periodoAtual(new Date("2026-11-01T01:00:00Z"));
    expect(p).toMatchObject({
      mes: "2026-10-01",
      fimMes: "2026-10-31",
      ano: "2026-01-01",
      dia: 31,
    });
  });
  it("fevereiro tem o último dia certo", () => {
    expect(periodoAtual(new Date("2028-02-10T15:00:00Z")).fimMes).toBe("2028-02-29");
  });
  it("projeção linear no ritmo atual", () => {
    expect(projecao(7350, 15, 31)).toBe(15190);
    expect(projecao(0, 10, 30)).toBe(0);
  });
  it("falta nunca é negativa e é null sem meta", () => {
    expect(falta(12000, 7350)).toBe(4650);
    expect(falta(1, 5)).toBe(0);
    expect(falta(null, 5)).toBeNull();
  });
  it("dias úteis restantes (inclui hoje, mínimo 1)", () => {
    // 2026-10-16 é sexta: 16, 19–23, 26–30 = 11 dias úteis.
    expect(diasUteisRestantes("2026-10-16", "2026-10-31")).toBe(11);
    expect(diasUteisRestantes("2026-10-31", "2026-10-31")).toBe(1);
  });
  it("realizado vindo do banco como texto vira número; captações null preservado", () => {
    expect(normalizarRealizado({ comissao: "9000.00", vendas: 1, captacoes: null })).toMatchObject({
      comissao: 9000,
      vendas: 1,
      vgv: 0,
      captacoes: null,
    });
  });
});
