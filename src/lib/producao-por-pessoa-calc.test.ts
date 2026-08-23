import { describe, expect, it } from "vitest";
import {
  agruparPorPessoa,
  aplicarFiltrosProducao,
  gerarPontas,
  totaisProducao,
} from "./producao-por-pessoa-calc";
import type { FiltrosProducao, ProducaoRawRow } from "./producao-por-pessoa-types";

/** As 8 operações reais concluídas em produção em agosto/2026, usadas pra validar a divisão em
 * pontas com o usuário (simulação em chat antes de virar código) — fixture congelada aqui pra não
 * depender do banco de produção continuar do jeito que estava quando essa conversa aconteceu. */
const ROWS: ProducaoRawRow[] = [
  // Carlos fez as duas pontas da mesma venda — reproduz o exemplo do usuário (VGV 80.000 / comissão 4.800).
  {
    sale_id: "sale-1",
    imovel_id: null,
    codigo_interno: null,
    modalidade: "padrao",
    concluida_em: "2026-08-19T13:42:09.901538+00:00",
    valor_negociado: 80000,
    comissao_bruta: 4800,
    captador_id: "carlos",
    captador_nome: "Carlos Eduardo Carneiro",
    vendedor_id: "carlos",
    vendedor_nome: "Carlos Eduardo Carneiro",
    vendedor_fracao: null,
  },
  // Captador e vendedor são pessoas diferentes.
  {
    sale_id: "sale-2",
    imovel_id: null,
    codigo_interno: "630591041-111",
    modalidade: "padrao",
    concluida_em: "2026-08-18T20:39:33.343928+00:00",
    valor_negociado: 325000,
    comissao_bruta: 19500,
    captador_id: "wanderley",
    captador_nome: "Wanderley Hiro Sato",
    vendedor_id: "orlando",
    vendedor_nome: "Orlando Menck da Silva",
    vendedor_fracao: null,
  },
  // Lançamento — sem captação, pessoa vem de occurrence_commissions.papel = 'corretor_vendedor'.
  {
    sale_id: "sale-3",
    imovel_id: null,
    codigo_interno: null,
    modalidade: "lancamento",
    concluida_em: "2026-08-17T15:08:28.740792+00:00",
    valor_negociado: 519845.41,
    comissao_bruta: 20793.82,
    captador_id: null,
    captador_nome: null,
    vendedor_id: "wilson",
    vendedor_nome: "Wilson Grecchi Junior",
    vendedor_fracao: 1,
  },
  {
    sale_id: "sale-4",
    imovel_id: null,
    codigo_interno: null,
    modalidade: "lancamento",
    concluida_em: "2026-08-17T15:06:20.887427+00:00",
    valor_negociado: 286840.16,
    comissao_bruta: 11473.61,
    captador_id: null,
    captador_nome: null,
    vendedor_id: "wilson",
    vendedor_nome: "Wilson Grecchi Junior",
    vendedor_fracao: 1,
  },
  {
    sale_id: "sale-5",
    imovel_id: null,
    codigo_interno: "630591260-38",
    modalidade: "padrao",
    concluida_em: "2026-08-17T14:48:28.349733+00:00",
    valor_negociado: 200000,
    comissao_bruta: 12000,
    captador_id: "wellington",
    captador_nome: "Wellington de Oliveira",
    vendedor_id: "wellington",
    vendedor_nome: "Wellington de Oliveira",
    vendedor_fracao: null,
  },
  {
    sale_id: "sale-6",
    imovel_id: null,
    codigo_interno: null,
    modalidade: "lancamento",
    concluida_em: "2026-08-17T14:41:20.180521+00:00",
    valor_negociado: 236009.3,
    comissao_bruta: 9440.37,
    captador_id: null,
    captador_nome: null,
    vendedor_id: "gustavo",
    vendedor_nome: "Gustavo Fuentes",
    vendedor_fracao: 1,
  },
  {
    sale_id: "sale-7",
    imovel_id: null,
    codigo_interno: null,
    modalidade: "padrao",
    concluida_em: "2026-08-14T18:36:24.185339+00:00",
    valor_negociado: 315000,
    comissao_bruta: 18900,
    captador_id: "ailton",
    captador_nome: "Ailton Alexandria",
    vendedor_id: "ailton",
    vendedor_nome: "Ailton Alexandria",
    vendedor_fracao: null,
  },
  {
    sale_id: "sale-8",
    imovel_id: null,
    codigo_interno: null,
    modalidade: "lancamento",
    concluida_em: "2026-08-13T14:11:27.732472+00:00",
    valor_negociado: 283736.7,
    comissao_bruta: 11349.47,
    captador_id: null,
    captador_nome: null,
    vendedor_id: "virginia",
    vendedor_nome: "Virginia Aranha",
    vendedor_fracao: 1,
  },
];

const TEAM_ID_POR_PESSOA = new Map<string, string>([
  ["carlos", "t-gabriel"],
  ["wanderley", "t-salvador"],
  ["orlando", "t-orlando"],
  ["wellington", "t-rodrigo"],
  ["ailton", "t-rodrigo"],
  ["wilson", "t-gustavo"],
  ["gustavo", "t-gustavo"],
  ["virginia", "t-virginia"],
]);

const TEAM_NOME_POR_ID = new Map<string, string>([
  ["t-gabriel", "Gabriel Geres"],
  ["t-salvador", "Salvador Ramalho"],
  ["t-orlando", "Orlando Menck"],
  ["t-rodrigo", "Rodrigo Becchelli"],
  ["t-gustavo", "Gustavo Fuentes"],
  ["t-virginia", "Virginia Aranha"],
]);

describe("gerarPontas — dados reais de agosto/2026 (fixture congelada)", () => {
  const pontas = gerarPontas(ROWS, TEAM_ID_POR_PESSOA, TEAM_NOME_POR_ID);

  it("venda padrão vira 2 pontas de 0,5, cada uma com metade do VGV e da comissão", () => {
    const doCarlos = pontas.filter((p) => p.saleId === "sale-1");
    expect(doCarlos).toHaveLength(2);
    expect(doCarlos.map((p) => p.tipo).sort()).toEqual(["captacao", "venda"]);
    for (const p of doCarlos) {
      expect(p.qtd).toBe(0.5);
      expect(p.vgv).toBe(40000);
      expect(p.comissao).toBe(2400);
    }
  });

  it("venda de Lançamento vira 1 ponta única 'venda' com 100% do VGV e da comissão", () => {
    const doGustavo = pontas.filter((p) => p.saleId === "sale-6");
    expect(doGustavo).toHaveLength(1);
    expect(doGustavo[0].tipo).toBe("venda");
    expect(doGustavo[0].qtd).toBe(1);
    expect(doGustavo[0].vgv).toBe(236009.3);
    expect(doGustavo[0].comissao).toBe(9440.37);
  });

  it("Lançamento com duas vendedoras iguais divide produção, VGV e comissão em 50% para cada", () => {
    const duasVendedoras: ProducaoRawRow[] = [
      {
        sale_id: "sale-multi",
        imovel_id: null,
        codigo_interno: "630601276-21",
        modalidade: "lancamento",
        concluida_em: "2026-08-20T00:00:00+00:00",
        valor_negociado: 640000,
        comissao_bruta: 6397.78,
        captador_id: null,
        captador_nome: null,
        vendedor_id: "giovanna",
        vendedor_nome: "Giovanna Moretti",
        vendedor_fracao: 0.5,
      },
      {
        sale_id: "sale-multi",
        imovel_id: null,
        codigo_interno: "630601276-21",
        modalidade: "lancamento",
        concluida_em: "2026-08-20T00:00:00+00:00",
        valor_negociado: 640000,
        comissao_bruta: 6397.78,
        captador_id: null,
        captador_nome: null,
        vendedor_id: "giulia",
        vendedor_nome: "Giulia Moretti",
        vendedor_fracao: 0.5,
      },
    ];
    const resultado = gerarPontas(duasVendedoras, new Map(), new Map());
    expect(resultado).toHaveLength(2);
    expect(resultado.map((p) => p.qtd)).toEqual([0.5, 0.5]);
    expect(resultado.map((p) => p.vgv)).toEqual([320000, 320000]);
    expect(resultado.map((p) => p.comissao)).toEqual([3198.89, 3198.89]);
    expect(totaisProducao(resultado)).toEqual({
      qtdVendas: 1,
      vgv: 640000,
      comissao: 6397.78,
      qtdCaptacao: 0,
      qtdVenda: 1,
    });
  });

  it("cada operação soma exatamente 1 venda / 100% do VGV / 100% da comissão entre as pontas", () => {
    for (const saleId of new Set(ROWS.map((r) => r.sale_id))) {
      const doSale = pontas.filter((p) => p.saleId === saleId);
      const row = ROWS.find((r) => r.sale_id === saleId)!;
      const qtdTotal = doSale.reduce((s, p) => s + p.qtd, 0);
      const vgvTotal = doSale.reduce((s, p) => s + p.vgv, 0);
      const comissaoTotal = doSale.reduce((s, p) => s + p.comissao, 0);
      expect(qtdTotal).toBeCloseTo(1, 6);
      expect(vgvTotal).toBeCloseTo(row.valor_negociado, 2);
      expect(comissaoTotal).toBeCloseTo(row.comissao_bruta, 2);
    }
  });

  it("carrega imovel_id junto do codigo_interno, pro fallback de rótulo da UI", () => {
    const doWanderley = pontas.filter((p) => p.saleId === "sale-2");
    expect(doWanderley.every((p) => p.imovelId === null)).toBe(true);
    expect(doWanderley.every((p) => p.codigoInterno === "630591041-111")).toBe(true);
  });

  it("resolve a equipe da pessoa em cada ponta", () => {
    const captacaoWellington = pontas.find((p) => p.saleId === "sale-5" && p.tipo === "captacao")!;
    expect(captacaoWellington.teamId).toBe("t-rodrigo");
    expect(captacaoWellington.teamNome).toBe("Rodrigo Becchelli");
  });
});

describe("agruparPorPessoa / totaisProducao — mesma fixture", () => {
  const pontas = gerarPontas(ROWS, TEAM_ID_POR_PESSOA, TEAM_NOME_POR_ID);
  const resumo = agruparPorPessoa(pontas);
  const totais = totaisProducao(pontas);

  it("totais gerais batem com a soma sem duplicidade das 8 operações", () => {
    expect(totais.qtdVendas).toBeCloseTo(8, 6);
    expect(totais.vgv).toBeCloseTo(2246431.57, 2);
    expect(totais.comissao).toBeCloseTo(108257.27, 2);
    expect(totais.qtdCaptacao).toBeCloseTo(2, 6);
    expect(totais.qtdVenda).toBeCloseTo(6, 6);
  });

  it("Carlos: 1 venda inteira (fez as duas pontas), reproduz o exemplo do usuário", () => {
    const carlos = resumo.find((r) => r.pessoaId === "carlos")!;
    expect(carlos.qtdVendas).toBeCloseTo(1, 6);
    expect(carlos.vgv).toBeCloseTo(80000, 2);
    expect(carlos.comissao).toBeCloseTo(4800, 2);
    expect(carlos.qtdCaptacao).toBeCloseTo(0.5, 6);
    expect(carlos.qtdVenda).toBeCloseTo(0.5, 6);
  });

  it("Wanderley (só captação) e Orlando (só venda) ficam com 0,5 venda cada, sem duplicar a operação", () => {
    const wanderley = resumo.find((r) => r.pessoaId === "wanderley")!;
    const orlando = resumo.find((r) => r.pessoaId === "orlando")!;
    expect(wanderley.qtdVendas).toBeCloseTo(0.5, 6);
    expect(wanderley.qtdCaptacao).toBeCloseTo(0.5, 6);
    expect(wanderley.qtdVenda).toBe(0);
    expect(orlando.qtdVendas).toBeCloseTo(0.5, 6);
    expect(orlando.qtdVenda).toBeCloseTo(0.5, 6);
    expect(orlando.qtdCaptacao).toBe(0);
    // As duas pontas juntas fecham em 1 venda / 100% do VGV/comissão da operação, cada pessoa só com a sua metade.
    expect(wanderley.vgv + orlando.vgv).toBeCloseTo(325000, 2);
    expect(wanderley.comissao + orlando.comissao).toBeCloseTo(19500, 2);
  });

  it("Wilson acumula as 2 vendas de Lançamento dele, 2,0 vendas equivalentes", () => {
    const wilson = resumo.find((r) => r.pessoaId === "wilson")!;
    expect(wilson.qtdVendas).toBeCloseTo(2, 6);
    expect(wilson.qtdVenda).toBeCloseTo(2, 6);
    expect(wilson.qtdCaptacao).toBe(0);
    expect(wilson.vgv).toBeCloseTo(806685.57, 2);
    expect(wilson.comissao).toBeCloseTo(32267.43, 2);
  });

  it("a soma de VGV/comissão de todas as pessoas bate com os totais gerais (sem duplicidade)", () => {
    const somaVgv = resumo.reduce((s, r) => s + r.vgv, 0);
    const somaComissao = resumo.reduce((s, r) => s + r.comissao, 0);
    const somaQtd = resumo.reduce((s, r) => s + r.qtdVendas, 0);
    expect(somaVgv).toBeCloseTo(totais.vgv, 2);
    expect(somaComissao).toBeCloseTo(totais.comissao, 2);
    expect(somaQtd).toBeCloseTo(totais.qtdVendas, 6);
  });
});

describe("gerarPontas — pessoa não vinculada", () => {
  it("capta/vendedor null vira pessoaId null com nome 'Não vinculado', nunca é descartado", () => {
    const rowsSemVinculo: ProducaoRawRow[] = [
      {
        sale_id: "sale-9",
        imovel_id: null,
        codigo_interno: null,
        modalidade: "lancamento",
        concluida_em: "2026-08-01T00:00:00+00:00",
        valor_negociado: 100000,
        comissao_bruta: 5000,
        captador_id: null,
        captador_nome: null,
        vendedor_id: null,
        vendedor_nome: null,
        vendedor_fracao: 1,
      },
    ];
    const pontas = gerarPontas(rowsSemVinculo, new Map(), new Map());
    expect(pontas).toHaveLength(1);
    expect(pontas[0].pessoaId).toBeNull();
    expect(pontas[0].pessoaNome).toBe("Não vinculado");

    const resumo = agruparPorPessoa(pontas);
    expect(resumo).toHaveLength(1);
    expect(resumo[0].pessoaId).toBeNull();
    expect(resumo[0].chave).toBe("sem-vinculo:Não vinculado");
  });
});

describe("aplicarFiltrosProducao — mesma fixture", () => {
  const pontas = gerarPontas(ROWS, TEAM_ID_POR_PESSOA, TEAM_NOME_POR_ID);
  const base: FiltrosProducao = {
    dataDe: "",
    dataAte: "",
    pessoaId: null,
    teamId: null,
    tipo: "todas",
  };

  it("filtra por pessoa", () => {
    const filtradas = aplicarFiltrosProducao(pontas, { ...base, pessoaId: "wilson" });
    expect(filtradas).toHaveLength(2);
    expect(filtradas.every((p) => p.pessoaId === "wilson")).toBe(true);
  });

  it("filtra por tipo de participação", () => {
    const soCaptacao = aplicarFiltrosProducao(pontas, { ...base, tipo: "captacao" });
    expect(soCaptacao.every((p) => p.tipo === "captacao")).toBe(true);
    expect(soCaptacao).toHaveLength(4); // 4 vendas padrão, uma ponta de captação cada
  });

  it("filtra por período (data de conclusão)", () => {
    const filtradas = aplicarFiltrosProducao(pontas, {
      ...base,
      dataDe: "2026-08-18",
      dataAte: "2026-08-19",
    });
    const saleIds = new Set(filtradas.map((p) => p.saleId));
    expect(saleIds).toEqual(new Set(["sale-1", "sale-2"]));
  });

  it("filtra por equipe", () => {
    const filtradas = aplicarFiltrosProducao(pontas, { ...base, teamId: "t-rodrigo" });
    expect(filtradas.every((p) => p.teamId === "t-rodrigo")).toBe(true);
    const saleIds = new Set(filtradas.map((p) => p.saleId));
    expect(saleIds).toEqual(new Set(["sale-5", "sale-7"]));
  });
});
