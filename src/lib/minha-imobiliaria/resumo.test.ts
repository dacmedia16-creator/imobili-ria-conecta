/** Avisos, números do mês e termômetro da Minha imobiliária (t_f7f1b3e4). */
import { describe, expect, it } from "vitest";
import type { RealizadoRpc } from "@/lib/metas-2027/painel-gestor";
import {
  comissaoDoMes,
  direcaoMensal,
  montarAvisos,
  montarResumo,
  normalizarResumoRpc,
  periodosResumo,
  vgvDoMes,
  type ResumoRpc,
} from "./resumo";

const RPC: ResumoRpc = normalizarResumoRpc({
  hoje: "2026-11-20",
  mes_inicio: "2026-11-01",
  ant_inicio: "2026-10-01",
  ant_fim: "2026-10-20",
  modulos: { captacao: true, leads: true, locacao: true },
  exclusivas: {
    ativas: 58,
    ativas_30d: 66,
    novas_mes: 7,
    novas_ant: 9,
    vencendo: 4,
    vencendo_primeira_dias: 4,
    vencendo_primeira_imovel: "Rua das Acácias, 120",
  },
  leads: {
    prazo_aceite_min: 30,
    sem_atendimento: 6,
    mais_antigo_horas: 75,
    mais_antigo_origem: "olx",
    recebidos_mes: 142,
    recebidos_ant: 131,
    elegiveis_mes: 100,
    no_prazo_mes: 71,
    elegiveis_ant: 100,
    no_prazo_ant: 83,
  },
  vendas_paradas: { qtd: 2, maior_dias: 9, maior_status: "aguardando_assinatura" },
  alugueis: { qtd: 3, valor: "7840.00", maior_dias: 12 },
  produtivos: {
    ativos: 41,
    produtivos: 23,
    admins_que_venderam: 1,
    ativos_ant: 41,
    produtivos_ant: 25,
  },
  novos_sem_venda: 2,
});
const V = (s: string, d: string, vgv: number, com: number, conta = true) => ({
  sale_id: s,
  user_id: "u" + s,
  venda_em: d,
  comissao: com,
  vgv,
  lados: 1,
  conta_equipe: conta,
});
const REAL: RealizadoRpc = {
  captacoes_ligadas: true,
  captacoes: [],
  vendas: [
    V("a", "2026-11-03", 2_000_000, 50_000),
    { ...V("a", "2026-11-03", 2_000_000, 40_000), user_id: "outro" }, // mesma venda, 2ª pessoa
    V("b", "2026-11-18", 1_920_000, 30_000),
    V("c", "2026-11-19", 500_000, 9_000, false), // só coordenador de lançamento: fora
    V("d", "2026-10-30", 999_999, 1), // mês passado
  ],
};
const ANT: RealizadoRpc = { ...REAL, vendas: [V("x", "2026-10-10", 4_380_000, 130_000)] };

describe("direcaoMensal", () => {
  it("meta mensal = meta ANUAL da direção ÷ 12; vazio ou 0 = sem meta", () => {
    expect(direcaoMensal({ meta_comissao: 3_600_000, meta_vgv: "72000000" })).toEqual({
      comissao: 300_000,
      vgv: 6_000_000,
    });
    expect(direcaoMensal(null)).toEqual({ comissao: null, vgv: null });
    expect(direcaoMensal({ meta_comissao: 0, meta_vgv: null })).toEqual({
      comissao: null,
      vgv: null,
    });
  });
});

describe("VGV e comissão do mês", () => {
  it("VGV 1 vez por venda; comissão soma a parte de cada pessoa; coordenador de lançamento fora", () => {
    expect(vgvDoMes(REAL, "2026-11-20")).toBe(3_920_000);
    expect(comissaoDoMes(REAL, "2026-11-20")).toBe(120_000);
  });
});

describe("montarAvisos", () => {
  it("ordem do mais grave ao mais leve, no máximo 5, textos da maquete", () => {
    const a = montarAvisos(RPC);
    expect(a.map((x) => x.chave)).toEqual(["leads", "alugueis", "exclusivas", "vendas", "novos"]);
    expect(a[0]).toMatchObject({
      qtd: 6,
      tom: "red",
      titulo: "leads sem atendimento há mais de 24h",
    });
    expect(a[0].detalhe).toBe("O mais antigo espera há 3 dias (portal OLX).");
    expect(a[1].detalhe.replace(/\s/g, " ")).toBe(
      "R$ 7.840 em aberto · o maior atraso tem 12 dias.",
    );
    expect(a[2].detalhe).toBe("A primeira vence em 4 dias (Rua das Acácias, 120).");
    expect(a[3].detalhe).toBe("A mais antiga está parada há 9 dias em “Aguardando assinatura”.");
    expect(a[4]).toMatchObject({ tom: "blue", titulo: "corretores novos ainda sem venda" });
  });

  it("tudo em dia ou módulo desligado: aviso some sem erro", () => {
    const ok = normalizarResumoRpc({
      ...RPC,
      exclusivas: { ...RPC.exclusivas, vencendo: 0 },
      leads: null,
      alugueis: null,
      vendas_paradas: { qtd: 0, maior_dias: null, maior_status: null },
      novos_sem_venda: 0,
    });
    expect(montarAvisos(ok)).toEqual([]);
  });
});

describe("montarResumo", () => {
  const r = montarResumo({
    resumo: RPC,
    direcao: direcaoMensal({ meta_comissao: 3_600_000, meta_vgv: 72_000_000 }),
    realMes: REAL,
    realAnt: ANT,
  });

  it("cartões: VGV × meta (anual ÷ 12), comparação com o mesmo período do mês anterior", () => {
    expect(r.vgv).toMatchObject({ valor: 3_920_000, meta: 6_000_000, antes: 4_380_000 });
    expect(r.vgv.pct).toBeCloseTo(0.6533, 3);
    expect(r.vgv.ritmo).toBeCloseTo(0.6533 / (20 / 30), 3);
    expect(r.comissao.variacao).toBeCloseTo(120_000 / 130_000 - 1);
    expect(r.exclusivas).toMatchObject({ novas: 7, ativas: 58 });
    expect(r.exclusivas!.variacao).toBeCloseTo(-8 / 66);
    expect(r.leads).toMatchObject({
      recebidos: 142,
      pctNoPrazo: 0.71,
      pctNoPrazoAnt: 0.83,
      prazoMin: 30,
    });
    expect(r.produtivos).toMatchObject({ qtd: 23, total: 41, admins: 1 });
    expect(r.mesAnterior).toBe("outubro");
  });

  it("termômetro: 5 sinais com as faixas da maquete e cor geral", () => {
    const s = Object.fromEntries(r.termometro.sinais.map((x) => [x.chave, x]));
    // 65% da meta com 67% do mês = 98% do ritmo → amarelo (maquete: "um pouco abaixo do ritmo")
    expect(s.meta).toMatchObject({
      cor: "amarelo",
      texto: "65% da meta com 67% do mês — um pouco abaixo do ritmo",
    });
    expect(s.estoque).toMatchObject({ cor: "vermelho", texto: "58 ativas — caiu 12% em 30 dias" });
    expect(s.leads).toMatchObject({ cor: "amarelo", texto: "71% atendidos no prazo (meta 85%)" });
    expect(s.produtivos).toMatchObject({
      cor: "amarelo",
      texto: "23 de 41 venderam em 90 dias (56%)",
    });
    expect(s.vendas).toMatchObject({
      cor: "verde",
      texto: "Só 2 vendas paradas há mais de 5 dias",
    });
    expect(r.termometro.geral).toBe("vermelho");
    expect(r.termometro.acesos).toBe(4);
  });

  it("meta no ritmo: verde ≥ 100%, amarelo 85–99%, vermelho < 85% (% da meta ÷ % do mês)", () => {
    const com = (vgv: number) =>
      montarResumo({
        resumo: RPC,
        direcao: { comissao: null, vgv: 6_000_000 },
        realMes: { ...REAL, vendas: [V("z", "2026-11-02", vgv, 1)] },
        realAnt: ANT,
      }).termometro.sinais[0].cor;
    expect(com(4_000_000)).toBe("verde"); // 66,7% da meta com 66,7% do mês
    expect(com(3_500_000)).toBe("amarelo"); // 87,5%
    expect(com(3_000_000)).toBe("vermelho"); // 75%
  });

  it("sem meta da direção: sinal cinza e cartão sem %", () => {
    const x = montarResumo({
      resumo: RPC,
      direcao: { comissao: null, vgv: null },
      realMes: REAL,
      realAnt: ANT,
    });
    expect(x.vgv.pct).toBeNull();
    expect(x.termometro.sinais[0]).toMatchObject({
      cor: "cinza",
      texto: "Sem meta da direção definida",
    });
  });

  it("tudo em dia: verde e nenhum aviso", () => {
    const ok = normalizarResumoRpc({
      ...RPC,
      exclusivas: { ...RPC.exclusivas, ativas: 71, vencendo: 0 },
      leads: { ...RPC.leads, sem_atendimento: 0, no_prazo_mes: 92 },
      alugueis: { qtd: 0, valor: 0, maior_dias: null },
      vendas_paradas: { qtd: 0, maior_dias: null, maior_status: null },
      produtivos: { ...RPC.produtivos, produtivos: 31 },
      novos_sem_venda: 0,
    });
    const x = montarResumo({
      resumo: ok,
      direcao: { comissao: null, vgv: 6_000_000 },
      realMes: { ...REAL, vendas: [V("z", "2026-11-02", 6_480_000, 1)] },
      realAnt: ANT,
    });
    expect(x.avisos).toEqual([]);
    expect(x.termometro).toMatchObject({ geral: "verde", acesos: 0 });
  });
});

describe("periodosResumo", () => {
  it("mês corrente até hoje e o mesmo período do mês anterior (fim limitado ao último dia)", () => {
    expect(periodosResumo("2026-11-20")).toEqual({
      mes: { inicio: "2026-11-01", fim: "2026-11-20" },
      ant: { inicio: "2026-10-01", fim: "2026-10-20" },
    });
    expect(periodosResumo("2027-03-31").ant).toEqual({ inicio: "2027-02-01", fim: "2027-02-28" });
    expect(periodosResumo("2027-01-15").ant).toEqual({ inicio: "2026-12-01", fim: "2026-12-15" });
  });
});
