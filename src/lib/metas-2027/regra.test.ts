import { describe, expect, it } from "vitest";
import type { Respostas } from "@/lib/meu-plano-2027/regras";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import {
  avaliar,
  avaliarIndicador,
  farolMeta,
  metaDoPlano,
  posicaoNoAno,
  situacaoPlano,
  somaMeses,
  valoresZero,
  type Valores,
} from "./regra";
import { realizadoDeMeuRealizadoPorMes, realizadoMensal, mesNoAno } from "./realizado";
import {
  avaliarGrupo,
  coberturaPlanos,
  compararComDirecao,
  contaNaCobertura,
  somarPlanos,
  type PlanoPessoa,
} from "./consolidado";
import { quebrarComissao, visaoCorretor } from "./comissao";

// Plano fictício: 12 captações + 12 vendas = 24 transações × R$ 5.000 = VGC R$ 120.000;
// 24 novas CREs; ticket R$ 400.000 → VGV = 24 ÷ 2 × 400.000 = R$ 4,8 mi.
// Sem mês digitado: 1 + 1 transações/mês → R$ 10.000/mês, 2 captações/mês.
const PLANO: Respostas = {
  "mt.creIni": "10",
  "mt.novas": "24",
  "mt.canc": "6",
  "mt.vendidas": "12",
  "mt.tCapt": "12",
  "mt.tVenda": "12",
  "mt.comMedia": "5000",
  "m.ticket": "400000",
};
// Mesmo plano, com sazonalidade: janeiro 0 transações e dezembro 4 + 4.
const PLANO_SAZONAL: Respostas = {
  ...PLANO,
  "mt.mes.tcapt.1": "0",
  "mt.mes.tvenda.1": "0",
  "mt.mes.tcapt.12": "2",
  "mt.mes.tvenda.12": "2",
};

const vazio = (): Valores[] => Array.from({ length: 12 }, valoresZero);
const comissaoNoMes = (mes: number, v: number) => {
  const r = vazio();
  r[mes - 1].comissao = v;
  return r;
};

describe("meta do plano (ano e mês pela distribuição)", () => {
  it("ano = meta oficial; mês sem distribuição usa a sugestão do plano (anual ÷ 12)", () => {
    const m = metaDoPlano(PLANO)!;
    expect(m.ano).toEqual({ comissao: 120000, vendas: 24, vgv: 4800000, captacoes: 24 });
    expect(m.meses[0]).toEqual({ comissao: 10000, vendas: 2, vgv: 400000, captacoes: 2 });
    expect(somaMeses(m.meses, "comissao", 12)).toBe(120000);
    expect(m.diverge.comissao).toBe(false);
  });

  it("mês com distribuição do corretor vale o que ele digitou (não anual ÷ 12)", () => {
    const m = metaDoPlano(PLANO_SAZONAL)!;
    expect(m.meses[0].comissao).toBe(0);
    expect(m.meses[11].comissao).toBe(20000);
    expect(m.meses[5].comissao).toBe(10000);
    // 0 + 10×10.000 + 20.000 = 120.000 → fecha com o ano
    expect(m.diverge.comissao).toBe(false);
  });

  it("meses que não fecham com o ano são avisados (diverge), sem mudar a meta do ano", () => {
    const m = metaDoPlano({ ...PLANO, "mt.mes.tcapt.3": "5" })!;
    expect(m.ano.comissao).toBe(120000);
    expect(m.meses[2].comissao).toBe(30000);
    expect(m.diverge.comissao).toBe(true);
  });

  it("plano vazio ou incompleto não tem meta", () => {
    expect(metaDoPlano(null)).toBeNull();
    expect(metaDoPlano({})).toBeNull();
    expect(metaDoPlano({ "mt.novas": "10" })).toBeNull();
  });

  it("sem ticket: sem meta de VGV no ano e nos meses", () => {
    const { ["m.ticket"]: _t, ...semTicket } = PLANO;
    const m = metaDoPlano(semTicket)!;
    expect(m.ano.vgv).toBeNull();
    expect(m.meses.every((x) => x.vgv === null)).toBe(true);
  });
});

describe("situação do plano: assinado × não assinado", () => {
  it("classifica", () => {
    expect(situacaoPlano({ assinadoEm: "2026-12-01T12:00:00Z", respostas: PLANO })).toBe(
      "assinado",
    );
    expect(situacaoPlano({ assinadoEm: null, respostas: PLANO })).toBe("preenchimento");
    expect(situacaoPlano({ assinadoEm: null, respostas: {} })).toBe("sem_plano");
    expect(situacaoPlano(null)).toBe("sem_plano");
  });

  it("plano não assinado mostra o realizado, mas sem meta, sem % e com farol ⚪", () => {
    const pos = posicaoNoAno("2027-03-15");
    const real = comissaoNoMes(2, 50000);
    const a = avaliar("preenchimento", metaDoPlano(PLANO), real, pos);
    expect(a.farol).toBe("cinza");
    expect(a.indicadores.comissao.realAno).toBe(50000);
    expect(a.indicadores.comissao.metaAno).toBeNull();
    expect(a.indicadores.comissao.pctAno).toBeNull();
    expect(a.indicadores.comissao.ritmo).toBe("sem_meta");
  });

  it("plano assinado: esperado até hoje pela distribuição, ritmo e quanto falta", () => {
    // 15/03 (março tem 31 dias): esperado = jan 10.000 + fev 10.000 + 15/31 × 10.000
    const pos = posicaoNoAno("2027-03-15");
    const real = vazio();
    real[0].comissao = 10000;
    real[2].comissao = 4000;
    const c = avaliar("assinado", metaDoPlano(PLANO), real, pos).indicadores.comissao;
    expect(c.metaMes).toBe(10000);
    expect(c.esperado).toBe(24838.71);
    expect(c.realAno).toBe(14000);
    expect(c.ritmo).toBe("atras");
    expect(c.diferenca).toBe(-10838.71);
    expect(c.faltaMes).toBe(6000);
    // 15 a 31/03 = 17 dias → 3 semanas
    expect(pos.semanasRestantes).toBe(3);
    expect(c.faltaSemana).toBe(2000);
    expect(c.faltaAno).toBe(106000);
    expect(c.pctAno).toBeCloseTo(0.1167, 4);
  });

  it("esperado segue a sazonalidade: em janeiro sem meta no mês nada é esperado ainda", () => {
    const a = avaliar("assinado", metaDoPlano(PLANO_SAZONAL), vazio(), posicaoNoAno("2027-01-20"));
    expect(a.indicadores.comissao.esperado).toBe(0);
    expect(a.indicadores.comissao.pctEsperado).toBe(1);
    expect(a.indicadores.comissao.metaMes).toBe(0);
    expect(a.indicadores.comissao.pctMes).toBeNull();
    expect(a.farol).toBe("verde");
  });

  it("antes de 2027 o farol fica aguardando e nada é cobrado", () => {
    const a = avaliar("assinado", metaDoPlano(PLANO), vazio(), posicaoNoAno("2026-11-19"));
    expect(a.farol).toBe("aguardando");
    expect(a.indicadores.comissao.esperado).toBe(0);
    expect(a.indicadores.comissao.metaMes).toBeNull();
  });
});

describe("meta 0 ou vazia", () => {
  it("meta 0 não divide por zero: sem %, sem ritmo, farol ⚪", () => {
    const zero: Respostas = { ...PLANO, "mt.comMedia": "0" };
    const m = metaDoPlano(zero)!;
    expect(m.ano.comissao).toBe(0);
    const a = avaliar("assinado", m, comissaoNoMes(1, 1000), posicaoNoAno("2027-02-10"));
    expect(a.indicadores.comissao.pctAno).toBeNull();
    expect(a.indicadores.comissao.pctEsperado).toBeNull();
    expect(a.farol).toBe("cinza");
  });

  it("indicador sem meta (VGV sem ticket) fica sem meta e não quebra os outros", () => {
    const { ["m.ticket"]: _t, ...semTicket } = PLANO;
    const a = avaliar("assinado", metaDoPlano(semTicket), vazio(), posicaoNoAno("2027-05-05"));
    expect(a.indicadores.vgv.metaAno).toBeNull();
    expect(a.indicadores.vgv.faltaMes).toBeNull();
    expect(a.indicadores.comissao.metaAno).toBe(120000);
  });
});

describe("farol de meta nas bordas", () => {
  it("100% verde, 99,99% amarelo, 80% amarelo, 79,99% vermelho", () => {
    expect(farolMeta(1, "assinado")).toBe("verde");
    expect(farolMeta(0.99995, "assinado")).toBe("amarelo"); // não arredonda para 100%
    expect(farolMeta(0.1 + 0.2 + 0.7, "assinado")).toBe("verde"); // só ruído de ponto flutuante
    expect(farolMeta(0.9999, "assinado")).toBe("amarelo");
    expect(farolMeta(0.8, "assinado")).toBe("amarelo");
    expect(farolMeta(0.7999, "assinado")).toBe("vermelho");
    expect(farolMeta(1.5, "preenchimento")).toBe("cinza");
    expect(farolMeta(null, "assinado")).toBe("cinza");
  });

  it("bordas com números reais (sem erro de ponto flutuante)", () => {
    // 28/02/2027: esperado = 20.000. 16.000 = 80% exato; 20.000 = 100% exato.
    const pos = posicaoNoAno("2027-02-28");
    const meta = metaDoPlano(PLANO)!;
    const com = (v: number) => avaliar("assinado", meta, comissaoNoMes(1, v), pos);
    expect(com(20000).farol).toBe("verde");
    expect(com(19999).farol).toBe("amarelo");
    expect(com(16000).farol).toBe("amarelo");
    expect(com(15999).farol).toBe("vermelho");
    // 0,1 + 0,2: soma "quebrada" que precisa bater 100%
    const ind = avaliarIndicador(
      {
        ano: { ...valoresZero(), comissao: 0.3 },
        meses: Array.from({ length: 12 }, (_, i) => ({
          ...valoresZero(),
          comissao: i === 0 ? 0.3 : 0,
        })),
        diverge: { comissao: false, vendas: false, vgv: false, captacoes: false },
      },
      "comissao",
      (() => {
        const r = vazio();
        r[0].comissao = 0.1 + 0.2;
        return r;
      })(),
      posicaoNoAno("2027-01-31"),
    );
    expect(farolMeta(ind.pctEsperado, "assinado")).toBe("verde");
  });
});

describe("fuso de São Paulo: virada de mês e de ano", () => {
  it("venda assinada 31/12/2026 às 22h em SP (01/01 01h UTC) é de 2026, não de 2027", () => {
    expect(mesNoAno("2027-01-01T01:00:00+00:00", 2027)).toBeNull();
    expect(mesNoAno("2027-01-01T01:00:00+00:00", 2026)).toBe(12);
    expect(mesNoAno("2027-01-01T03:00:00+00:00", 2027)).toBe(1);
  });

  it("assinada 31/03 às 22h em SP conta em março", () => {
    const r = realizadoMensal(
      [
        {
          saleId: "v1",
          userId: "a",
          assinadaEm: "2027-04-01T01:00:00Z",
          comissao: 5000,
          vgv: 300000,
        },
      ],
      [],
      2027,
    );
    expect(r[2].vendas).toBe(1);
    expect(r[3].vendas).toBe(0);
  });

  it("hoje: 31/12/2026 23h em SP ainda é antes do plano; 01/01/2027 00h30 já é janeiro", () => {
    const fimDe2026 = hojeSaoPaulo(new Date("2027-01-01T02:00:00Z"));
    expect(fimDe2026).toBe("2026-12-31");
    expect(posicaoNoAno(fimDe2026).fase).toBe("antes");
    const p = posicaoNoAno(hojeSaoPaulo(new Date("2027-01-01T03:30:00Z")));
    expect(p).toMatchObject({ fase: "durante", mes: 1, dia: 1 });
    expect(posicaoNoAno("2028-01-01").fase).toBe("depois");
  });

  it("último dia do mês: esperado = meta acumulada inteira do mês", () => {
    const c = avaliar("assinado", metaDoPlano(PLANO), vazio(), posicaoNoAno("2027-12-31"))
      .indicadores.comissao;
    expect(c.esperado).toBe(120000);
    expect(posicaoNoAno("2027-12-31").semanasRestantes).toBe(1);
  });
});

describe("soma de equipe/imobiliária sem venda em dobro", () => {
  const vendas = [
    // mesma venda: captador A e vendedor B, os dois na equipe
    { saleId: "v1", userId: "A", assinadaEm: "2027-02-10", comissao: 6000, vgv: 500000 },
    { saleId: "v1", userId: "B", assinadaEm: "2027-02-10", comissao: 4000, vgv: 500000 },
    // venda só de C (outra equipe)
    { saleId: "v2", userId: "C", assinadaEm: "2027-02-12", comissao: 3000, vgv: 200000 },
  ];
  const caps = [
    { captureId: "c1", userId: "A", aprovadaEm: "2027-02-01" },
    { captureId: "c1", userId: "A", aprovadaEm: "2027-02-01" }, // linha repetida
  ];

  it("equipe A+B: 1 venda, 1 VGV, comissão = parte de cada um", () => {
    const r = realizadoMensal(vendas, caps, 2027, new Set(["A", "B"]));
    expect(r[1]).toEqual({ comissao: 10000, vendas: 1, vgv: 500000, captacoes: 1 });
  });

  it("imobiliária toda: 2 vendas, VGV 700 mil", () => {
    const r = realizadoMensal(vendas, caps, 2027);
    expect(r[1]).toEqual({ comissao: 13000, vendas: 2, vgv: 700000, captacoes: 1 });
  });

  it("pessoa sozinha: a venda conta 1 para ela (regra de meu_realizado)", () => {
    expect(realizadoMensal(vendas, caps, 2027, new Set(["B"]))[1]).toEqual({
      comissao: 4000,
      vendas: 1,
      vgv: 500000,
      captacoes: 0,
    });
  });

  it("módulo de captação desligado: captações null", () => {
    expect(realizadoMensal(vendas, caps, 2027, null, false)[1].captacoes).toBeNull();
  });

  it("formato de meu_realizado por mês vira os 12 meses", () => {
    const r = realizadoDeMeuRealizadoPorMes({
      2: {
        comissao: 4000,
        vendas: 1,
        vgv: 500000,
        captacoes: null,
        como_captador: 0,
        vgv_captador: 0,
        como_vendedor: 1,
        vgv_vendedor: 500000,
      },
    });
    expect(r[1]).toEqual({ comissao: 4000, vendas: 1, vgv: 500000, captacoes: null });
    expect(r[0]).toEqual(valoresZero());
  });
});

describe("soma dos planos, meta da direção e cobertura", () => {
  const meta = metaDoPlano(PLANO)!;
  const planos: PlanoPessoa[] = [
    // oficial = a assinatura gravou a meta oficial (fonte única, t_91ec7aa3).
    { userId: "A", situacao: "assinado", meta, oficial: true },
    { userId: "A", situacao: "assinado", meta, oficial: true }, // repetido: soma 1 vez
    { userId: "B", situacao: "assinado", meta: metaDoPlano(PLANO_SAZONAL), oficial: true },
    { userId: "C", situacao: "preenchimento", meta },
    { userId: "D", situacao: "sem_plano", meta: null },
  ];

  it("oficial = só assinados; em preenchimento separado", () => {
    const s = somarPlanos(planos);
    expect(s.qtdAssinados).toBe(2);
    expect(s.qtdPreenchimento).toBe(1);
    expect(s.qtdSemPlano).toBe(1);
    expect(s.assinados!.ano.comissao).toBe(240000);
    expect(s.assinados!.meses[0].comissao).toBe(10000); // A 10.000 + B 0
    expect(s.assinados!.meses[11].comissao).toBe(30000);
    expect(s.preenchimentoAno.comissao).toBe(120000);
  });

  it("grupo sem nenhum assinado: farol ⚪", () => {
    const s = somarPlanos([{ userId: "C", situacao: "preenchimento", meta }]);
    expect(s.assinados).toBeNull();
    expect(avaliarGrupo(s, vazio(), posicaoNoAno("2027-06-10")).farol).toBe("cinza");
  });

  it("grupo avaliado pela soma dos assinados", () => {
    const s = somarPlanos(planos);
    const a = avaliarGrupo(s, comissaoNoMes(1, 20000), posicaoNoAno("2027-01-31"));
    expect(a.indicadores.comissao.esperado).toBe(10000);
    expect(a.farol).toBe("verde");
  });

  it("diferença para a meta da direção", () => {
    const s = somarPlanos(planos);
    const d = compararComDirecao(s, { comissao: 300000, vendas: 40, vgv: null, captacoes: 0 });
    expect(d.comissao).toEqual({
      direcao: 300000,
      somaAssinados: 240000,
      diferenca: -60000,
      pct: 0.8,
    });
    expect(d.vendas.diferenca).toBe(8);
    expect(d.vgv.diferenca).toBeNull(); // direção sem VGV
    expect(d.captacoes.pct).toBeNull(); // direção 0 = não definida
    expect(compararComDirecao(s, null).comissao.diferenca).toBeNull();
  });

  it("cobertura: corretores ativos + gestor/TL que vendem", () => {
    const pessoas = [
      { userId: "A", ativo: true, papeis: ["corretor"] },
      { userId: "B", ativo: true, papeis: ["corretor"] },
      { userId: "C", ativo: true, papeis: ["corretor"] },
      { userId: "D", ativo: false, papeis: ["corretor"] },
      { userId: "G1", ativo: true, papeis: ["gestor"], vende: true },
      { userId: "G2", ativo: true, papeis: ["team_leader"], vende: false },
      { userId: "ADM", ativo: true, papeis: ["admin"], vende: true },
    ];
    expect(contaNaCobertura(pessoas[5])).toBe(false);
    const sit: Record<string, "assinado" | "preenchimento" | "sem_plano"> = {
      A: "assinado",
      B: "assinado",
      C: "preenchimento",
    };
    const c = coberturaPlanos(pessoas, (u) => sit[u] ?? "sem_plano");
    expect(c).toEqual({
      elegiveis: 4,
      assinados: 2,
      preenchimento: 1,
      semPlano: 1,
      pct: 0.5,
      faltam: ["C", "G1"],
    });
    expect(coberturaPlanos([], () => "sem_plano").pct).toBeNull();
  });
});

describe("comissão: o que cada papel vê", () => {
  it("admin/gestor: bruta, imobiliária, indicador, extras e corretor", () => {
    expect(
      quebrarComissao({ bruta: 30000, imobiliaria: 15000, indicador: 1500, extras: 500 }),
    ).toEqual({
      bruta: 30000,
      imobiliaria: 15000,
      indicador: 1500,
      extras: 500,
      corretor: 13000,
    });
  });

  it("corretor: só a parte dele e o que foi descontado dele (sem bruta, sem imobiliária)", () => {
    const v = visaoCorretor(
      quebrarComissao({ bruta: 30000, imobiliaria: 15000, indicador: 1500, extras: 500 }),
    );
    expect(v).toEqual({
      suaParte: 13000,
      descontadoDeVoce: { indicador: 1500, extras: 500, total: 2000 },
    });
    expect(Object.keys(v)).not.toContain("bruta");
    expect(JSON.stringify(v)).not.toContain("imobiliaria");
  });

  it("descontos maiores que a bruta não deixam a parte negativa", () => {
    expect(quebrarComissao({ bruta: 1000, imobiliaria: 900, indicador: 300 }).corretor).toBe(0);
  });
});
