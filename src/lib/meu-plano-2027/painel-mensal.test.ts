import { describe, expect, it } from "vitest";
import { metaIgual } from "@/components/minha-carreira/meu-plano/usePlano";
import { calc, metaOficialDoPlano, type Calc, type Respostas } from "./regras";
import { CAMPO_VALIDO } from "./telas";
import { COLUNAS_PAINEL, chavePainel, fmtPctMeta, metaPainel, painelMensal } from "./painel-mensal";

// Mesmos números da maquete t_88a3e82e (meses.test.ts): 56 novas, 37 + 37 transações, R$ 5.625.
const BASE: Respostas = {
  "mt.creIni": "15",
  "mt.novas": "56",
  "mt.canc": "19",
  "mt.vendidas": "37",
  "mt.tCapt": "37",
  "mt.tVenda": "37",
  "mt.comMedia": "5.625",
};

const META = [100, 20, 120, 40, 400000];
// Calc mínima só com o que a META DO ANO usa (C.revisarMes × 12 = 120).
const calcFake = (m: number[] = META) =>
  ({ novas: m[0], creFim: m[1], revisarMes: m[2] / 12, transMeta: m[3], vgc: m[4] }) as Calc;

const mes = (n: number, v: Partial<Record<(typeof COLUNAS_PAINEL)[number], string>>) =>
  Object.fromEntries(Object.entries(v).map(([c, x]) => [chavePainel(n, c as never), x]));

describe("painel mensal (p43): meses editáveis, TOTAL e % da meta", () => {
  it("chaves pm.<mes>.<coluna> passam na validação do banco (carreira_plano_salvar)", () => {
    for (let n = 1; n <= 12; n++)
      for (const c of COLUNAS_PAINEL) expect(CAMPO_VALIDO.test(chavePainel(n, c))).toBe(true);
    expect(chavePainel(3, "comissao")).toBe("pm.3.comissao");
  });

  it("META DO ANO continua a mesma conta (novas, creFim, revisarMes × 12, transMeta, VGC)", () => {
    const C = calc(BASE);
    expect(painelMensal({}, C).meta).toEqual(metaPainel(C));
    expect(metaPainel(C)[3]).toBe(C.transMeta);
    expect(metaPainel(C)[4]).toBe(C.vgc);
  });

  it("soma: Novas, Revisadas, Transações e Comissão somam só os meses preenchidos", () => {
    const S = {
      ...mes(1, { novas: "5", revisadas: "8", trans: "2", comissao: "R$ 12.000" }),
      ...mes(2, { novas: "4", trans: "1", comissao: "6.500,50" }),
      ...mes(5, { novas: "3", revisadas: "10" }),
    };
    const P = painelMensal(S, calcFake());
    expect(P.total[0]).toBe(12);
    expect(P.total[2]).toBe(18);
    expect(P.total[3]).toBe(3);
    expect(P.total[4]).toBeCloseTo(18500.5, 2);
  });

  it("estoque: CREs ativas mostra o último mês preenchido (não soma)", () => {
    const S = {
      ...mes(1, { ativas: "10" }),
      ...mes(2, { ativas: "14" }),
      ...mes(4, { ativas: "12" }),
      ...mes(6, { novas: "3" }), // mês 6 sem ativas: não conta
    };
    expect(painelMensal(S, calcFake()).total[1]).toBe(12);
    expect(painelMensal({}, calcFake()).total[1]).toBeNaN();
  });

  it("% da meta = realizado ÷ META DO ANO, por coluna", () => {
    const S = {
      ...mes(1, { novas: "25", ativas: "15", revisadas: "30", trans: "10", comissao: "100.000" }),
      ...mes(2, { novas: "25", ativas: "10" }),
    };
    const P = painelMensal(S, calcFake());
    expect(P.pct.map(fmtPctMeta)).toEqual(["50%", "50%", "25%", "25%", "25%"]);
  });

  it('meta 0 ou vazia → "–"; coluna sem realizado → "–"', () => {
    const S = mes(1, { novas: "5", ativas: "3", revisadas: "2", trans: "1", comissao: "1000" });
    const P = painelMensal(S, calcFake([0, NaN, 0, NaN, 0]));
    expect(P.pct.map(fmtPctMeta)).toEqual(["–", "–", "–", "–", "–"]);
    expect(painelMensal({}, calcFake()).pct.map(fmtPctMeta)).toEqual(["–", "–", "–", "–", "–"]);
    // Plano sem nada preenchido: a META DO ANO não existe, então também "–".
    expect(painelMensal(S, calc({})).pct.map(fmtPctMeta)).toEqual(["–", "–", "–", "–", "–"]);
  });

  it("destaque rosa: transações ou comissão preenchidas e comissão = 0; mês vazio não destaca", () => {
    const S = {
      ...mes(1, { trans: "2" }), // transação sem comissão → rosa
      ...mes(2, { comissao: "0" }), // comissão 0 digitada → rosa
      ...mes(3, { trans: "1", comissao: "5.000" }), // com comissão → normal
      ...mes(4, { novas: "4", ativas: "9" }), // só CREs → normal
      ...mes(5, { trans: "0", comissao: "0" }), // zerado → rosa
    };
    const r = painelMensal(S, calcFake()).meses.map((m) => m.semComissao);
    expect(r).toEqual([
      true,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("preencher os meses NÃO muda a meta oficial nem a deixa diferente da gravada", () => {
    const antes = calc(BASE);
    const m0 = metaOficialDoPlano(antes)!;
    const S: Respostas = { ...BASE };
    for (let n = 1; n <= 12; n++)
      Object.assign(
        S,
        mes(n, { novas: "7", ativas: "20", revisadas: "9", trans: "3", comissao: "16.875" }),
      );
    const depois = calc(S);
    expect(depois).toEqual(antes);
    expect(metaOficialDoPlano(depois)).toEqual(m0);
    const gravada = {
      meta_comissao: m0.comissao,
      meta_vgv: m0.vgv,
      meta_vendas: m0.vendas,
      meta_captacoes: m0.captacoes,
    };
    expect(metaIgual(gravada as never, metaOficialDoPlano(depois)!)).toBe(true);
  });
});
