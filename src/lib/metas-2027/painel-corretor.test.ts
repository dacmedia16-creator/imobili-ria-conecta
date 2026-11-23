import { describe, expect, it } from "vitest";
import type { Respostas } from "@/lib/meu-plano-2027/regras";
import { gravadaDe } from "./teste-gravada";
import {
  dataAprovacao,
  larguraBarra,
  listaCumpridas,
  montarPainelCorretor,
  realizadoDoCorretor,
  visaoDaVenda,
  type CaptacaoCorretor,
  type ComissaoVendaCorretor,
} from "./painel-corretor";
import { posicaoNoAno } from "./regra";

// Mesmo plano fictício de regra.test.ts: VGC R$ 120.000 no ano → R$ 10.000/mês; 24 transações (2/mês);
// 24 novas CREs (2/mês); ticket R$ 400.000.
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
// A assinatura grava a meta oficial (fonte única, t_91ec7aa3).
const ASSINADO = {
  respostas: PLANO,
  assinadoEm: "2026-12-10T13:00:00Z",
  metaOficial: gravadaDe(PLANO),
  metaOficialEm: "2026-12-10T13:00:00Z",
};

const venda = (p: Partial<ComissaoVendaCorretor> & { sale_id: string; venda_em: string }) =>
  ({
    imovel: "Casa · Bairro QA",
    codigo: "QA-1",
    papel: "vendedor",
    lados: 1,
    vgv: 500000,
    minha_parte: 6000,
    indicador: 0,
    extras: 0,
    descontado: 0,
    ...p,
  }) as ComissaoVendaCorretor;

const base = {
  userId: "u1",
  plano: ASSINADO,
  vendas: [] as ComissaoVendaCorretor[],
  captacoesContagem: { ano: 0, mes: 0 },
  captacoes: [] as CaptacaoCorretor[],
};

describe("painel do corretor — meta, barras e quanto falta", () => {
  it("meio de março, plano assinado: meta do ano, do mês (distribuição do plano) e falta por semana", () => {
    const vendas = [
      venda({ sale_id: "s1", venda_em: "2027-01-20", minha_parte: 12000 }),
      venda({ sale_id: "s2", venda_em: "2027-03-05", minha_parte: 4000 }),
    ];
    const r = montarPainelCorretor({ ...base, hoje: "2027-03-16", vendas });
    const c = r.avaliacao.indicadores.comissao;
    expect(r.situacao).toBe("assinado");
    expect(c.metaAno).toBe(120000);
    expect(c.metaMes).toBe(10000);
    expect(c.realAno).toBe(16000);
    expect(c.realMes).toBe(4000);
    expect(c.faltaMes).toBe(6000);
    // 16/03 → faltam 16 dias (16..31) = 3 semanas.
    expect(r.pos.semanasRestantes).toBe(3);
    expect(c.faltaSemana).toBe(2000);
    // Esperado até hoje = jan + fev + 16/31 de março.
    expect(c.esperado).toBeCloseTo(20000 + 10000 * (16 / 31), 2);
    expect(r.avaliacao.farol).toBe("vermelho"); // 16.000 ÷ 25.161 ≈ 64%
  });

  it("vendas contam na assinatura e não somam venda de outro ano", () => {
    const vendas = [
      venda({ sale_id: "s0", venda_em: "2026-12-31" }),
      venda({ sale_id: "s1", venda_em: "2027-02-01T02:00:00Z" }), // 31/01 23h em SP
    ];
    const r = montarPainelCorretor({ ...base, hoje: "2027-02-10", vendas });
    expect(r.avaliacao.indicadores.vendas.realAno).toBe(1);
    expect(r.avaliacao.indicadores.vendas.realMes).toBe(0);
    expect(r.cumpridas.map((x) => x.data)).toEqual(["2027-01-31"]);
  });

  it("farol nas bordas: 100% do esperado = 🟢, 80% = 🟡, abaixo = 🔴", () => {
    // Fim de fevereiro: esperado = 20.000.
    const hoje = "2027-02-28";
    const f = (v: number) =>
      montarPainelCorretor({
        ...base,
        hoje,
        vendas: [venda({ sale_id: "s", venda_em: "2027-02-10", minha_parte: v })],
      }).avaliacao.farol;
    expect(f(20000)).toBe("verde");
    expect(f(16000)).toBe("amarelo");
    expect(f(15999.99)).toBe("vermelho");
  });

  it("sem plano assinado: ⚪, sem meta e sem quanto falta (mas mostra o realizado)", () => {
    const vendas = [venda({ sale_id: "s1", venda_em: "2027-03-05", minha_parte: 4000 })];
    for (const plano of [{ respostas: PLANO, assinadoEm: null }, null]) {
      const r = montarPainelCorretor({ ...base, plano, hoje: "2027-03-16", vendas });
      expect(r.avaliacao.farol).toBe("cinza");
      expect(r.meta).toBeNull();
      expect(r.avaliacao.indicadores.comissao.metaMes).toBeNull();
      expect(r.avaliacao.indicadores.comissao.faltaMes).toBeNull();
      expect(r.avaliacao.indicadores.comissao.realAno).toBe(4000);
    }
  });

  it("antes de jan/2027: a lista de cumpridas mostra o ano corrente", () => {
    const vendas = [venda({ sale_id: "s26", venda_em: "2026-10-02" })];
    const r = montarPainelCorretor({ ...base, hoje: "2026-11-19", vendas });
    expect(r.cumpridas.map((x) => x.data)).toEqual(["2026-10-02"]);
    // A meta de 2027 não conta venda de 2026.
    expect(r.avaliacao.indicadores.comissao.realAno).toBe(0);
  });

  it("antes de jan/2027: ⚪ aguardando, sem esperado nem falta", () => {
    const r = montarPainelCorretor({ ...base, hoje: "2026-11-19" });
    expect(r.avaliacao.farol).toBe("aguardando");
    expect(r.pos.fase).toBe("antes");
    expect(r.avaliacao.indicadores.comissao.faltaMes).toBeNull();
    expect(r.avaliacao.indicadores.comissao.metaAno).toBe(120000);
  });

  it("vendas contam LADOS (unidade da meta do plano): captou e vendeu = 2; só indicou/liderou = 0", () => {
    const vendas = [
      venda({ sale_id: "a", venda_em: "2027-03-02", lados: 2, minha_parte: 9000 }),
      venda({ sale_id: "b", venda_em: "2027-03-03", lados: 1 }),
      venda({ sale_id: "c", venda_em: "2027-03-04", lados: 0, minha_parte: 500 }),
    ];
    const r = montarPainelCorretor({ ...base, hoje: "2027-03-16", vendas });
    expect(r.avaliacao.indicadores.vendas.realMes).toBe(3);
    // A comissão de indicador/líder conta, mesmo sem lado.
    expect(r.avaliacao.indicadores.comissao.realMes).toBe(15500);
  });

  it("captações: usa a contagem oficial de meu_realizado (ano e mês)", () => {
    const r = montarPainelCorretor({
      ...base,
      hoje: "2027-03-16",
      captacoesContagem: { ano: 5, mes: 1 },
    });
    const cap = r.avaliacao.indicadores.captacoes;
    expect(cap.realAno).toBe(5);
    expect(cap.realMes).toBe(1);
    expect(cap.metaMes).toBe(2);
    expect(cap.faltaMes).toBe(1);
  });

  it("captações desligadas (meu_realizado devolve null): sem número de captação", () => {
    const pos = posicaoNoAno("2027-03-16");
    const meses = realizadoDoCorretor("u1", [], { ano: null, mes: null }, pos);
    expect(meses.every((m) => m.captacoes === null)).toBe(true);
  });

  it("captações em janeiro: o mês e o ano batem", () => {
    const pos = posicaoNoAno("2027-01-20");
    const meses = realizadoDoCorretor("u1", [], { ano: 3, mes: 3 }, pos);
    expect(meses[0].captacoes).toBe(3);
  });
});

describe("painel do corretor — comissão (só a parte dele)", () => {
  it("visão da venda: sua parte + descontado de você (indicador e extras), sem bruta", () => {
    const v = visaoDaVenda(
      venda({
        sale_id: "s",
        venda_em: "2027-01-10",
        minha_parte: 7000,
        indicador: 1500,
        extras: 500,
      }),
    );
    expect(v).toEqual({
      suaParte: 7000,
      descontadoDeVoce: { indicador: 1500, extras: 500, total: 2000 },
    });
    expect(Object.keys(v)).not.toContain("bruta");
  });

  it("total do ano soma só a parte dele e o descontado dele", () => {
    const vendas = [
      venda({ sale_id: "a", venda_em: "2027-01-10", minha_parte: 7000, indicador: 1500 }),
      venda({ sale_id: "b", venda_em: "2027-02-10", minha_parte: 3000, extras: 250 }),
    ];
    const r = montarPainelCorretor({ ...base, hoje: "2027-03-01", vendas });
    expect(r.totalAno).toEqual({ suaParte: 10000, descontado: 1750 });
    expect(r.avaliacao.indicadores.comissao.realAno).toBe(10000);
  });
});

describe("painel do corretor — lista do que foi cumprido", () => {
  it("vendas e captações com data e imóvel, da mais recente para a mais antiga", () => {
    const vendas = [venda({ sale_id: "a", venda_em: "2027-02-03", imovel: "Apto · Centro" })];
    const caps: CaptacaoCorretor[] = [
      { id: "c1", imovel: "Casa · Jardim", signedOn: "2027-02-10", aprovacoes: [] },
      {
        id: "c2",
        imovel: null,
        signedOn: "2027-01-02",
        aprovacoes: ["2027-01-05T12:00:00Z", "2027-01-20T12:00:00Z"],
      },
      { id: "c3", imovel: "Fora do ano", signedOn: "2026-12-01", aprovacoes: [] },
    ];
    const xs = listaCumpridas(vendas, caps);
    expect(xs.map((x) => [x.tipo, x.data, x.imovel])).toEqual([
      ["captacao", "2027-02-10", "Casa · Jardim"],
      ["venda", "2027-02-03", "Apto · Centro"],
      ["captacao", "2027-01-20", "Imóvel sem descrição"],
    ]);
  });

  it("data da captação = última aprovação no dia de SP; sem histórico, a data do contrato", () => {
    expect(dataAprovacao({ signedOn: "2027-01-02", aprovacoes: ["2027-03-01T01:00:00Z"] })).toBe(
      "2027-02-28",
    );
    expect(dataAprovacao({ signedOn: "2027-01-02", aprovacoes: [] })).toBe("2027-01-02");
    expect(dataAprovacao({ signedOn: null, aprovacoes: [] })).toBeNull();
  });
});

describe("barra (só exibição)", () => {
  it("limita entre 0 e 100 e marca onde deveria estar", () => {
    expect(larguraBarra(5000, 10000, 2500)).toEqual({ pct: 50, marca: 25 });
    expect(larguraBarra(15000, 10000, 12000)).toEqual({ pct: 100, marca: 100 });
    expect(larguraBarra(100, null)).toEqual({ pct: 0, marca: null });
    expect(larguraBarra(100, 0)).toEqual({ pct: 0, marca: null });
  });
});
