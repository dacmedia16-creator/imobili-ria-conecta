/**
 * Trava contra valores absurdos do Meu Plano 2027 (t_125c4dd3). Os planos abaixo copiam os NÚMEROS de planos
 * reais de 2027 (sem nome), lidos só para leitura em 20/11: os "bons" não podem gerar aviso de bloqueio e os
 * errados têm de ser pegos. Também confere inteiro × decimal e os limites exatos de aviso e bloqueio.
 */
import { describe, expect, it } from "vitest";
import { conferirPlano, LIMITES, recusaTransacao, textoInteiro } from "./conferencia";
import { calc, metaOficialDoPlano, type Respostas } from "./regras";
import { respostasDaMeta } from "@/lib/metas-2027/painel-gestor";

/** O R$ do toLocaleString vem com espaço não separável. */
const sp = (s: string) => s.replace(/\u00a0/g, " ");
const campos = (r: Respostas) => conferirPlano(r).avisos.map((a) => `${a.nivel}:${a.campo}`);

// Planos bons (números reais, sem nome): alto desempenho legítimo incluído.
const BONS: [string, Respostas][] = [
  [
    "120+60 transações, R$ 24 mil (VGC 4,32 mi)",
    {
      "mt.tCapt": "120",
      "mt.tVenda": "60",
      "mt.comMedia": "24000",
      "m.ticket": "500000",
      "m.pct": "6%",
    },
  ],
  [
    "10+10, comissão R$ 30 mil",
    {
      "mt.tCapt": "10",
      "mt.tVenda": "10",
      "m.ticket": "600000",
      "m.pct": "3",
      "mt.comMedia": "30000",
    },
  ],
  [
    "ticket R$ 135.121 e 3% (157 transações sugeridas)",
    { "m.ticket": "R$ 135.121,00", "m.pct": "3", "mt.tCapt": "94", "mt.tVenda": "63" },
  ],
  [
    "41+15, R$ 8 mil",
    {
      "mt.tCapt": "41",
      "mt.tVenda": "15",
      "mt.novas": "46",
      "m.ticket": "300000",
      "m.pct": "3",
      "mt.comMedia": "8000",
    },
  ],
  [
    "13+20, ticket 700 mil",
    {
      "mt.tCapt": "13",
      "mt.tVenda": "20",
      "mt.novas": "32",
      "m.ticket": "700000",
      "m.pct": "3",
      "mt.comMedia": "15000",
    },
  ],
  [
    "ticket com vírgula decimal",
    { "mt.tCapt": "12", "mt.tVenda": "10", "m.ticket": "235312,5", "m.pct": "6" },
  ],
];

describe("planos reais bons passam sem bloqueio nem marca de painel indevida", () => {
  for (const [nome, r] of BONS)
    it(nome, () => {
      const c = conferirPlano(r);
      expect(c.bloqueiaAssinatura, JSON.stringify(c.avisos)).toBe(false);
      expect(c.avisos.filter((a) => a.campo !== "vgc")).toEqual([]);
    });
  it("VGC até R$ 1 mi não avisa; acima avisa sem bloquear (alto desempenho legítimo)", () => {
    expect(conferirPlano(BONS[1][1]).avisos).toEqual([]);
    const alto = conferirPlano(BONS[0][1]);
    expect(alto.avisos.map((a) => a.nivel)).toEqual(["aviso"]);
    expect(sp(alto.avisos[0].msg)).toContain("R$ 4.320.000");
    expect(alto.bloqueiaAssinatura).toBe(false);
  });
});

describe("planos errados reais são pegos", () => {
  it('42.000,00 transações: bloqueia e explica "valor em reais"', () => {
    const c = conferirPlano({
      "mt.tCapt": "42.000,00",
      "mt.tVenda": "42.000,00",
      "mt.comMedia": "8100,00",
      "m.ticket": "600.000",
      "m.pct": "3",
    });
    expect(c.bloqueiaAssinatura).toBe(true);
    expect(c.aConferir).toBe(true);
    expect(c.avisos[0].msg).toBe(
      'Você digitou 42.000 transações de captação no ano ("42.000,00"). Confira se não digitou um valor em reais. Use só números inteiros, até 500.',
    );
    expect(
      campos({ "mt.tCapt": "42.000,00", "mt.tVenda": "42.000,00", "mt.comMedia": "8100,00" }),
    ).toContain("bloqueio:vgc");
  });
  it('captação "1500000", venda "45..000" e comissão "3"', () => {
    const c = conferirPlano({
      "mt.tCapt": "1500000",
      "mt.tVenda": "45..000",
      "mt.comMedia": "3",
      "m.ticket": "150.000",
      "m.pct": "3",
    });
    expect(c.bloqueiaAssinatura).toBe(true);
    expect(campos({ "mt.tCapt": "1500000", "mt.tVenda": "45..000", "mt.comMedia": "3" })).toEqual([
      "bloqueio:mt.tCapt",
      "bloqueio:mt.tVenda",
      "aviso:mt.comMedia",
      "aviso:vgc",
    ]);
    expect(c.avisos[1].msg).toContain('"45..000" não é um número inteiro');
    expect(sp(c.avisos[2].msg)).toContain("R$ 3 por");
  });
  it("ticket R$ 800 faz a sugestão dar 21 mil transações: bloqueia", () => {
    const r = {
      "m.ticket": "800",
      "m.pct": "3",
      "m.faixa": "60",
      "es.aliq": "10",
      "op.0": "20000",
      "mt.novas": "36",
    };
    const c = conferirPlano(r);
    expect(c.bloqueiaAssinatura).toBe(true);
    expect(c.avisos.find((a) => a.campo === "mt.tCapt")?.msg).toMatch(
      /^A sugestão do plano deu .* transações de captação/,
    );
    expect(sp(c.avisos.find((a) => a.campo === "m.ticket")!.msg)).toContain("R$ 800");
  });
  it("% de 45: avisa e sugere a faixa digitada no lugar errado", () => {
    const c = conferirPlano({
      "mt.tCapt": "1",
      "mt.tVenda": "1",
      "m.ticket": "250000",
      "m.pct": "45",
    });
    const a = c.avisos.find((x) => x.campo === "m.pct")!;
    expect(a.nivel).toBe("aviso");
    expect(a.msg).toContain("45%");
    expect(a.msg).toContain("faixa de comissionamento");
    expect(a.naMeta).toBe(true); // comissão média em branco: o % mexe na meta
    expect(
      conferirPlano({
        "mt.tCapt": "1",
        "mt.tVenda": "1",
        "m.ticket": "250000",
        "m.pct": "45",
        "mt.comMedia": "8000",
      }).aConferir,
    ).toBe(false); // comissão digitada: o % não entra na meta, só avisa na tela
  });
  it("VGC de R$ 5,04 mi (84 × R$ 60 mil) bloqueia a assinatura", () => {
    const c = conferirPlano({
      "mt.tCapt": "44",
      "mt.tVenda": "40",
      "m.ticket": "1.000.000",
      "m.pct": "6",
    });
    expect(c.bloqueiaAssinatura).toBe(true);
    expect(c.avisos.map((a) => a.campo)).toEqual(["vgc"]);
    expect(c.avisos[0].msg).toContain("O plano continua salvo");
  });
});

describe("inteiro × decimal e limites exatos", () => {
  it("textoInteiro", () => {
    for (const v of ["24", " 7 ", "", null, undefined, 24])
      expect(textoInteiro(v), String(v)).toBe(true);
    for (const v of ["2,5", "2.5", "42.000", "42.000,00", "45..000", "10 ", "1e3", 2.5]) {
      if (v === "10 ") continue;
      expect(textoInteiro(v), String(v)).toBe(false);
    }
  });
  it("recusa na digitação: só ponto/vírgula/letra (acima de 500 fica e trava pela conferência)", () => {
    expect(recusaTransacao("", "x")).toBeNull();
    expect(recusaTransacao("500", "vendas")).toBeNull();
    expect(recusaTransacao("42000", "vendas")).toBeNull(); // não grava um pedaço do número
    expect(recusaTransacao("2,5", "vendas")).toBe(
      "Use só números inteiros, sem ponto nem vírgula (ex.: 24).",
    );
    expect(sp(recusaTransacao("42.000", "vendas")!)).toBe(
      "Você digitou 42.000 vendas no ano. Confira se não digitou um valor em reais. Use só números inteiros, sem ponto nem vírgula, até 500.",
    );
    expect(campos({ "mt.tCapt": "42000" })).toEqual(["bloqueio:mt.tCapt"]);
  });
  it("transações: 150 não avisa, 151 avisa, 500 avisa sem bloquear, 501 bloqueia", () => {
    const t = (n: number) =>
      campos({ "mt.tCapt": String(n), "mt.tVenda": "0", "mt.comMedia": "1000" }).filter((x) =>
        x.endsWith("mt.tCapt"),
      );
    expect(t(LIMITES.transAviso)).toEqual([]);
    expect(t(151)).toEqual(["aviso:mt.tCapt"]);
    expect(t(LIMITES.transBloqueio)).toEqual(["aviso:mt.tCapt"]);
    expect(t(501)).toEqual(["bloqueio:mt.tCapt"]);
  });
  it("decimal digitado bloqueia mesmo pequeno", () => {
    expect(campos({ "mt.tCapt": "2,5", "mt.tVenda": "2", "mt.comMedia": "10000" })).toEqual([
      "bloqueio:mt.tCapt",
    ]);
  });
  it("VGC: R$ 1.000.000 não avisa; R$ 1.000.001 avisa; R$ 5.000.000 só avisa; acima bloqueia", () => {
    const v = (com: string) =>
      conferirPlano({ "mt.tCapt": "100", "mt.tVenda": "0", "mt.comMedia": com })
        .avisos.filter((a) => a.campo === "vgc")
        .map((a) => a.nivel);
    expect(v("10000")).toEqual([]);
    expect(v("10000,01")).toEqual(["aviso"]);
    expect(v("50000")).toEqual(["aviso"]);
    expect(v("50000,01")).toEqual(["bloqueio"]);
  });
  it("ticket: R$ 50 mil e R$ 10 mi não avisam; abaixo/acima avisam", () => {
    const t = (tk: string) =>
      campos({
        "mt.tCapt": "10",
        "mt.tVenda": "10",
        "mt.comMedia": "10000",
        "m.ticket": tk,
      }).filter((x) => x.includes("ticket"));
    expect(t("50000")).toEqual([]);
    expect(t("49999")).toEqual(["aviso:m.ticket"]);
    expect(t("10000000")).toEqual([]);
    expect(t("10000001")).toEqual(["aviso:m.ticket"]);
  });
  it("%: 1 e 10 não avisam; 0,9 e 10,5 avisam", () => {
    const p = (pct: string) =>
      campos({ "mt.tCapt": "10", "mt.tVenda": "10", "m.ticket": "500000", "m.pct": pct }).filter(
        (x) => x.includes("pct"),
      );
    expect(p("1")).toEqual([]);
    expect(p("10")).toEqual([]);
    expect(p("0,9")).toEqual(["aviso:m.pct"]);
    expect(p("10,5")).toEqual(["aviso:m.pct"]);
  });
  it("novas CREs SUGERIDAS acima de 500 (conversão baixa) só avisam; digitadas acima de 500 bloqueiam", () => {
    const sug = conferirPlano({
      "mt.tCapt": "30",
      "mt.tVenda": "20",
      "mt.comMedia": "10000",
      "m.ticket": "500000",
      "m.pct": "3",
      "m.conv": "1",
      "m.faixa": "60",
      "es.aliq": "10",
      "op.0": "20000",
    });
    expect(sug.avisos.filter((a) => a.campo === "mt.novas").map((a) => a.nivel)).toEqual(["aviso"]);
    expect(sug.bloqueiaAssinatura).toBe(false);
    expect(campos({ "mt.novas": "600" })).toEqual(["bloqueio:mt.novas"]);
  });
  it("plano vazio não avisa nem marca", () => {
    expect(conferirPlano({})).toEqual({ avisos: [], bloqueiaAssinatura: false, aConferir: false });
    expect(conferirPlano(null).aConferir).toBe(false);
  });
});

describe("mesma regra na tela e nos painéis", () => {
  it("as respostas reduzidas dos painéis (metas_respostas_meta) dão a mesma marca", () => {
    const casos: Respostas[] = [
      ...BONS.map((b) => b[1]),
      { "mt.tCapt": "42.000,00", "mt.tVenda": "42.000,00", "mt.comMedia": "8100,00", "op.0": "1" },
      {
        "m.ticket": "800",
        "m.pct": "3",
        "m.faixa": "60",
        "es.aliq": "10",
        "op.0": "20000",
        "op.1": "500",
        "mt.novas": "36",
      },
      {
        "mt.tCapt": "44",
        "mt.tVenda": "40",
        "m.ticket": "1.000.000",
        "m.pct": "6",
        "pq.frase": "x",
      },
    ];
    for (const r of casos) {
      const a = conferirPlano(r);
      const b = conferirPlano(respostasDaMeta(r));
      expect([b.aConferir, b.bloqueiaAssinatura], JSON.stringify(r)).toEqual([
        a.aConferir,
        a.bloqueiaAssinatura,
      ]);
    }
  });
  it("não muda a conta da meta", () => {
    const r = { "mt.tCapt": "42.000,00", "mt.tVenda": "42.000,00", "mt.comMedia": "8100,00" };
    conferirPlano(r);
    expect(metaOficialDoPlano(calc(r))?.comissao).toBe(680400000);
  });
});
