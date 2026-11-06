import { describe, expect, it } from "vitest";
import { calc, clubePorValor, metaOficialDoPlano, num, regua, type Respostas } from "./regras";

// Números de exemplo impressos no próprio book Agent Summit 2027 (a "Ana Exemplo" da maquete v3).
// As 12 contas abaixo foram conferidas com o papel na maquete (t_20caacaf / t_6c76e001).
const ANA: Respostas = {
  "d.comissao": "210000",
  "d.trans": "11",
  "d.conv": "22",
  "d.ticket": "700000",
  "d.dias": "118",
  "d.ativos": "14",
  "op.0": "3450",
  "op.1": "760",
  "op.2": "1080",
  "op.3": "1600",
  "op.4": "600",
  "op.5": "940",
  "op.6": "110",
  "op.7": "30",
  "on.0": "980",
  "on.1": "200",
  "on.2": "1350",
  "on.3": "59,99",
  "on.4": "570",
  "on.5": "200",
  "so.0.v": "40000",
  "so.1.v": "30000",
  "so.2.v": "5000",
  "es.aliq": "15",
  "m.faixa": "45",
  "m.ticket": "700000",
  "m.pct": "3",
  "m.conv": "22",
  "fu.v2cre": "50",
  "fu.v1v2": "60",
  "fu.folga": "25",
};

describe("as 12 contas do book (exemplo impresso)", () => {
  const C = calc(ANA);
  it("1-2 · orçamento pessoal (p.21): R$ 8.570/mês → R$ 102.840/ano", () => {
    expect(C.pessoalMes).toBe(8570);
    expect(C.pessoalAno).toBe(102840);
  });
  it("3-4 · orçamento do negócio (p.22): R$ 3.359,99/mês → R$ 40.319,88/ano", () => {
    expect(C.negocioMes).toBeCloseTo(3359.99, 2);
    expect(C.negocioAno).toBeCloseTo(40319.88, 2);
  });
  it("5 · sonhos (p.23): R$ 75.000", () => {
    expect(C.sonhos).toBe(75000);
  });
  it("6 · estilo de vida (p.24) = (pessoal + negócio + sonhos) ÷ (1 − alíquota) = R$ 256.658,68", () => {
    expect(C.estiloAno).toBeCloseTo(256658.68, 2);
  });
  it("7 · comissão bruta (p.26) = estilo ÷ faixa = R$ 570.352,62", () => {
    // 570.352,6275…: o book imprime truncado (,62); a tela arredonda (,63) — diferença de 1 centavo.
    expect(Math.floor(C.bruta * 100) / 100).toBe(570352.62);
  });
  it("8 · comissão por transação = ticket × % = R$ 21.000", () => {
    expect(C.comTrans).toBe(21000);
  });
  it("9 · transações = 28 (arredonda para cima)", () => {
    expect(C.trans).toBe(28);
  });
  it("10-11 · captações (p.29) = transações ÷ conversão = 127 no ano, 11 por mês", () => {
    expect(C.captAno).toBe(127);
    expect(C.captMes).toBe(11);
  });
  it("12 · VGC (p.31) = transações × comissão média = 28 × R$ 21.000 = R$ 588.000", () => {
    expect(C.transMeta).toBe(28);
    expect(C.vgc).toBe(588000);
    expect(C.clubeSug?.n).toBe("100% Club");
  });
});

describe("demais regras do plano", () => {
  it("funil (p.36): V2 = 11 ÷ 50% = 22; V1 = 22 ÷ 60% = 37; contatos/semana = 37 ÷ 4 × 1,25 = 12", () => {
    const C = calc(ANA);
    expect(C.v2Mes).toBe(22);
    expect(C.v1Mes).toBe(37);
    expect(C.contSem).toBe(12);
  });
  it("funil: sem resposta do corretor usa o padrão da imobiliária; sem padrão, o exemplo do book", () => {
    const sem = { ...ANA, "fu.v2cre": "", "fu.v1v2": "", "fu.folga": "" };
    expect(calc(sem).txV2Cre).toBe(50);
    const C = calc(sem, { v2cre: 40, v1v2: 50, folga: 0 });
    expect(C.txV2Cre).toBe(40);
    expect(C.v2Mes).toBe(28); // 11 ÷ 40%
    expect(C.v1Mes).toBe(56); // 28 ÷ 50%
    expect(C.contSem).toBe(14);
  });
  it("carteira (p.30): captações/mês × meses ≈ CREs ativas; dias medianos 118 → 3,9 meses → 43", () => {
    const C = calc(ANA);
    expect(C.mesesCarteira).toBe(3.9);
    expect(C.creEstimada).toBe(43);
    expect(C.creEstimadaRegua).toMatch(/Perda de eficácia/);
    expect(regua(17)).toMatch(/Negócio feliz/);
  });
  it("metas (p.31): estoque = início + novas − canceladas − vendidas", () => {
    const C = calc({
      ...ANA,
      "mt.creIni": "14",
      "mt.novas": "127",
      "mt.vendidas": "28",
      "mt.canc": "96",
    });
    expect(C.estoqueFim).toBe(17);
    expect(C.creFim).toBe(17);
  });
  it("aviso dos três caminhos: transações muito acima do ano passado", () => {
    expect(calc(ANA).transAcima).toBe(true); // 28 > 11 × 1,5
  });
  it("estilo de vida não calcula sem alíquota nem com alíquota ≥ 100%", () => {
    expect(calc({ ...ANA, "es.aliq": "" }).estiloAno).toBeNaN();
    expect(calc({ ...ANA, "es.aliq": "100" }).estiloAno).toBeNaN();
  });
  it("número digitado no padrão brasileiro", () => {
    expect(num("3.450")).toBe(3450);
    expect(num("59,99")).toBe(59.99);
    expect(num("R$ 1.234,50")).toBe(1234.5);
    expect(num("15%")).toBe(15);
    expect(num("")).toBeNaN();
    expect(num("abc")).toBeNaN();
  });
  it("clube pela faixa da p.27", () => {
    expect(clubePorValor(100000)).toBeNull();
    expect(clubePorValor(865052)?.n).toBe("Platinum Club");
  });
  it("autoavaliação (p.16): total e faixa só com as 6 notas", () => {
    const S = { "av.0": "4", "av.1": "2", "av.2": "5", "av.3": "3", "av.4": "4", "av.5": "2" };
    const C = calc(S);
    expect(C.notaTotal).toBe(20);
    expect(C.notaFaixa).toMatch(/executa em partes/);
    expect(C.armadilhas).toHaveLength(2);
    expect(calc({ "av.0": "5" }).notaFaixa).toBe("");
  });
  it("meta oficial: VGC, transações, captações e VGV = transações × ticket", () => {
    const m = metaOficialDoPlano(calc(ANA));
    expect(m).toEqual({ comissao: 588000, vgv: 19600000, vendas: 28, captacoes: 127 });
    expect(metaOficialDoPlano(calc({}))).toBeNull();
  });
});
