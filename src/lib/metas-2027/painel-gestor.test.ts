import { describe, expect, it } from "vitest";
import type { Respostas } from "@/lib/meu-plano-2027/regras";
import { comGravada } from "./teste-gravada";
import {
  montarPainelGestor,
  periodosDoPainel,
  realizadoDoGrupo,
  respostasDaMeta,
  type PessoaRpc,
  type PlanosRpc,
  type RealizadoRpc,
} from "./painel-gestor";
import { metaDoPlano } from "./regra";

// Mesmo plano fictício de regra.test.ts: VGC R$ 120.000 no ano → R$ 10.000/mês; 24 transações; ticket 400 mil.
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
// Plano de R$ 60.000 (R$ 5.000/mês).
const PLANO_MEIO: Respostas = { ...PLANO, "mt.tCapt": "6", "mt.tVenda": "6" };

const pessoa = (p: Partial<PessoaRpc> & { user_id: string }): PessoaRpc => ({
  nome: p.user_id.toUpperCase(),
  team_id: "t1",
  papeis: ["corretor"],
  tem_plano: false,
  respostas: null,
  assinado_em: null,
  ...p,
});
// A assinatura grava a meta oficial (fonte única, t_91ec7aa3).
const assinado = (r: Respostas) => ({
  tem_plano: true,
  respostas: r,
  assinado_em: "2026-12-10T13:00:00Z",
  ...comGravada(r),
});

const PLANOS: PlanosRpc = {
  todas: true,
  modulo_plano: true,
  equipes: [
    { id: "t1", nome: "Equipe Azul", lider_id: "tl", lider_nome: "Líder Azul" },
    { id: "t2", nome: "Equipe Verde", lider_id: null, lider_nome: null },
  ],
  pessoas: [
    pessoa({ user_id: "a", ...assinado(PLANO) }),
    pessoa({ user_id: "b", ...assinado(PLANO_MEIO) }),
    pessoa({ user_id: "c", tem_plano: true, respostas: PLANO }), // em preenchimento
    pessoa({ user_id: "tl", papeis: ["corretor", "team_leader"] }), // sem plano
    pessoa({ user_id: "v", team_id: "t2", ...assinado(PLANO) }),
    pessoa({ user_id: "g", team_id: null, papeis: ["gestor"] }), // gestor que não vende
  ],
};

const vazio: RealizadoRpc = { captacoes_ligadas: true, vendas: [], captacoes: [] };

describe("painel do gestor — respostas do plano que saem do banco", () => {
  it("só as chaves da meta saem e a meta fica igual à do plano inteiro", () => {
    const cheio: Respostas = {
      ...PLANO,
      "mt.mes.tcapt.3": "3",
      "so.0.n": "Viagem",
      "so.0.v": "20000",
      "av.0": "3",
      "op.0": "5000",
      "or.0.c": "4",
      "es.aliq": "10",
    };
    const r = respostasDaMeta(cheio);
    // Estoque (creIni, canceladas, vendidas) e diagnóstico não entram na meta: não saem.
    expect(Object.keys(r).sort()).toEqual(
      ["m.ticket", "mt.comMedia", "mt.novas", "mt.tCapt", "mt.tVenda", "mt.mes.tcapt.3"].sort(),
    );
    expect(metaDoPlano(r)).toEqual(metaDoPlano(cheio));
  });

  it("sem transações digitadas: as despesas saem SÓ somadas e a meta continua igual", () => {
    const cheio: Respostas = {
      "op.0": "6000",
      "op.2": "1.500",
      "on.1": "500",
      "on.4": "250,50",
      "so.0.v": "10000",
      "so.1.v": "5000",
      "so.0.n": "Carro",
      "es.aliq": "10",
      "m.faixa": "50",
      "m.ticket": "300000",
      "m.pct": "3",
      "m.conv": "25",
      "av.1": "4",
      "or.0.c": "2",
    };
    const r = respostasDaMeta(cheio);
    expect(Object.keys(r).sort()).toEqual(
      ["es.aliq", "m.conv", "m.faixa", "m.pct", "m.ticket", "on.0", "op.0", "so.0.v"].sort(),
    );
    expect(r["op.0"]).toBe(7500); // casa + saúde somadas, sem o item
    expect(r["on.0"]).toBe(750.5);
    expect(r["so.0.v"]).toBe(15000);
    expect(metaDoPlano(r)).not.toBeNull();
    expect(metaDoPlano(r)).toEqual(metaDoPlano(cheio));
  });

  it("transação com texto inválido conta como vazia (igual à conta do plano)", () => {
    const cheio: Respostas = { ...PLANO, "mt.tCapt": "doze", "es.aliq": "10", "op.0": "3000" };
    const r = respostasDaMeta(cheio);
    expect(r["op.0"]).toBe(3000);
    expect(metaDoPlano(r)).toEqual(metaDoPlano(cheio));
  });
});

describe("painel do gestor — realizado da equipe", () => {
  const real: RealizadoRpc = {
    captacoes_ligadas: true,
    vendas: [
      // Venda dividida: a capta, b vende (mesma venda, 2 linhas, mesmo VGV).
      {
        sale_id: "s1",
        user_id: "a",
        venda_em: "2027-03-05",
        comissao: 9000,
        vgv: 500000,
        lados: 1,
      },
      {
        sale_id: "s1",
        user_id: "b",
        venda_em: "2027-03-05",
        comissao: 7000,
        vgv: 500000,
        lados: 1,
      },
      // a capta e vende sozinho.
      {
        sale_id: "s2",
        user_id: "a",
        venda_em: "2027-01-20",
        comissao: 12000,
        vgv: 400000,
        lados: 2,
      },
      // Venda dividida com outra equipe: só b é do grupo t1? não — v é da t2.
      {
        sale_id: "s3",
        user_id: "v",
        venda_em: "2027-02-10",
        comissao: 5000,
        vgv: 300000,
        lados: 1,
      },
    ],
    captacoes: [
      { capture_id: "c1", user_id: "a", aprovada_em: "2027-03-02" },
      { capture_id: "c2", user_id: "b", aprovada_em: "2026-12-20" }, // outro ano: fora
    ],
  };

  it("venda dividida conta 1 vez no VGV; comissão soma a parte de cada um; vendas somam os lados", () => {
    const m = realizadoDoGrupo(real, new Set(["a", "b"]), 2027);
    expect(m[2]).toEqual({ comissao: 16000, vendas: 2, vgv: 500000, captacoes: 1 });
    expect(m[0]).toEqual({ comissao: 12000, vendas: 2, vgv: 400000, captacoes: 0 });
    expect(m[1]).toEqual({ comissao: 0, vendas: 0, vgv: 0, captacoes: 0 });
  });

  it("uma pessoa só: a parte dela e o VGV da venda", () => {
    const m = realizadoDoGrupo(real, new Set(["b"]), 2027);
    expect(m[2]).toEqual({ comissao: 7000, vendas: 1, vgv: 500000, captacoes: 0 });
  });

  it("grupo vazio = zero (não vira 'todo mundo')", () => {
    const m = realizadoDoGrupo(real, new Set(), 2027);
    expect(m.every((x) => x.comissao === 0 && x.vendas === 0)).toBe(true);
  });

  it("captação desligada fica null", () => {
    const m = realizadoDoGrupo({ ...real, captacoes_ligadas: false }, new Set(["a"]), 2027);
    expect(m[2].captacoes).toBeNull();
  });

  it("coordenador de lançamento: conta para a pessoa, mas fica fora da soma da equipe", () => {
    const com: RealizadoRpc = {
      ...real,
      vendas: [
        ...real.vendas,
        {
          sale_id: "s9",
          user_id: "a",
          venda_em: "2027-03-20",
          comissao: 800,
          vgv: 900000,
          lados: 0,
          conta_equipe: false,
          ponta: false,
        },
      ],
    };
    expect(realizadoDoGrupo(com, new Set(["a"]), 2027)[2].comissao).toBe(9800);
    const eq = realizadoDoGrupo(com, new Set(["a", "b"]), 2027, true);
    expect(eq[2]).toEqual({ comissao: 16000, vendas: 2, vgv: 500000, captacoes: 1 });
  });

  it("null = todo mundo das listas (total da imobiliária)", () => {
    const m = realizadoDoGrupo(real, null, 2027, true);
    expect(m[1].comissao).toBe(5000); // v
    expect(m[2].vgv).toBe(500000);
  });
});

describe("painel do gestor — montagem", () => {
  const real: RealizadoRpc = {
    captacoes_ligadas: true,
    vendas: [
      {
        sale_id: "s1",
        user_id: "a",
        venda_em: "2027-03-05",
        comissao: 9000,
        vgv: 500000,
        lados: 1,
      },
      {
        sale_id: "s1",
        user_id: "b",
        venda_em: "2027-03-05",
        comissao: 7000,
        vgv: 500000,
        lados: 1,
      },
      {
        sale_id: "s2",
        user_id: "a",
        venda_em: "2027-01-20",
        comissao: 12000,
        vgv: 400000,
        lados: 2,
      },
      {
        sale_id: "s3",
        user_id: "c",
        venda_em: "2027-02-10",
        comissao: 4000,
        vgv: 300000,
        lados: 1,
      },
    ],
    captacoes: [{ capture_id: "c1", user_id: "a", aprovada_em: "2027-03-02" }],
  };
  const ult12: RealizadoRpc = {
    ...real,
    vendas: [
      ...real.vendas,
      { sale_id: "s0", user_id: "v", venda_em: "2026-12-01", comissao: 1, vgv: 1, lados: 1 },
      // Repasse de líder ao TL pela venda de a: não é "vender" (alerta continua dizendo que ele não vendeu).
      {
        sale_id: "s2",
        user_id: "tl",
        venda_em: "2027-01-20",
        comissao: 500,
        vgv: 400000,
        lados: 0,
        ponta: false,
      },
    ],
  };
  const montar = (hoje = "2027-03-16") =>
    montarPainelGestor({
      hoje,
      planos: PLANOS,
      realizadoAno: real,
      ultimos12: ult12,
      anotacoes: [
        {
          id: "n1",
          user_id: "a",
          texto: "Velha",
          proximo_passo: null,
          proximo_passo_em: null,
          created_at: "2027-03-01T10:00:00Z",
        },
        {
          id: "n2",
          user_id: "a",
          texto: "Nova",
          proximo_passo: "Ligar",
          proximo_passo_em: "2027-03-18",
          created_at: "2027-03-15T10:00:00Z",
        },
        {
          id: "n3",
          user_id: "a",
          texto: "Média",
          proximo_passo: null,
          proximo_passo_em: null,
          created_at: "2027-03-10T10:00:00Z",
        },
      ],
    });

  it("meta da equipe = só os planos assinados; em preenchimento separado", () => {
    const r = montar();
    const azul = r.grupos.find((g) => g.id === "t1")!;
    expect(azul.soma.qtdAssinados).toBe(2);
    expect(azul.soma.qtdPreenchimento).toBe(1);
    expect(azul.soma.qtdSemPlano).toBe(1);
    expect(azul.avaliacao.indicadores.comissao.metaAno).toBe(180000); // 120 mil + 60 mil
    expect(azul.soma.preenchimentoAno.comissao).toBe(120000);
    // Meta do mês de março = distribuição dos planos, não anual ÷ 12: o plano de 6+6 transações põe
    // 1+1 transação em cada um dos 6 primeiros meses (R$ 10 mil em março) → 10 mil + 10 mil.
    expect(azul.avaliacao.indicadores.comissao.metaMes).toBe(20000);
    expect(azul.soma.assinados!.meses[6].comissao).toBe(10000); // julho: só o plano de 120 mil
  });

  it("Opção A: realizado comparado com a meta = só quem assinou; quem não assinou aparece à parte", () => {
    const azul = montar().grupos.find((g) => g.id === "t1")!;
    const c = azul.avaliacao.indicadores.comissao;
    expect(c.realAno).toBe(28000); // 12 mil + 9 mil + 7 mil (a e b assinaram)
    expect(c.realMes).toBe(16000);
    expect(azul.realizadoAno.vgv).toBe(900000); // s1 1 vez + s2
    // c (em preenchimento) vendeu 4 mil: fora da meta, mas visível à parte.
    expect(azul.naoAssinados.pessoas).toBe(1);
    expect(azul.naoAssinados.realizado.comissao).toBe(4000);
    expect(azul.naoAssinados.realizado.vgv).toBe(300000);
    // As duas partes fecham com o total da equipe.
    expect(azul.realizadoTodos.comissao).toBe(32000);
    expect(azul.realizadoTodos.vgv).toBe(1200000);
  });

  it("farol do corretor: ⚪ sem plano assinado / em preenchimento; com plano compara com o esperado", () => {
    const azul = montar().grupos.find((g) => g.id === "t1")!;
    const por = Object.fromEntries(azul.pessoas.map((p) => [p.userId, p]));
    expect(por.c.avaliacao.farol).toBe("cinza");
    expect(por.tl.avaliacao.farol).toBe("cinza");
    // a: esperado até 16/03 = 10k + 10k + 10k × 16/31 ≈ 25.161; feito 21 mil → 83% → 🟡
    expect(por.a.avaliacao.farol).toBe("amarelo");
    // b: esperado ≈ 25.161 (mesma distribuição até março); feito 7 mil → 28% → 🔴
    expect(por.b.avaliacao.farol).toBe("vermelho");
    // quanto falta no ano
    expect(por.a.avaliacao.indicadores.comissao.faltaAno).toBe(99000);
  });

  it("cartões em ordem de atenção: 🔴 primeiro, ⚪ no fim", () => {
    const azul = montar().grupos.find((g) => g.id === "t1")!;
    expect(azul.pessoas.map((p) => p.userId)).toEqual(["b", "a", "c", "tl"]);
  });

  it("últimas 2 anotações de cada corretor, da mais nova para a mais velha", () => {
    const a = montar().total.pessoas.find((p) => p.userId === "a")!;
    expect(a.anotacoes.map((n) => n.texto)).toEqual(["Nova", "Média"]);
  });

  it("sem equipe vira um grupo próprio; total junta todo mundo do escopo", () => {
    const r = montar();
    expect(r.grupos.map((g) => g.nome)).toEqual(["Equipe Azul", "Equipe Verde", "Sem equipe"]);
    expect(r.total.pessoas).toHaveLength(6);
    expect(r.total.soma.qtdAssinados).toBe(3);
    expect(r.total.avaliacao.indicadores.comissao.metaAno).toBe(300000);
  });

  it("cobertura: corretores ativos + gestor/TL que vendem; gestor sem plano e sem venda fica fora", () => {
    const r = montar();
    expect(r.total.cobertura.elegiveis).toBe(5); // a, b, c, tl (é corretor também), v
    expect(r.total.cobertura.assinados).toBe(3);
    expect(r.total.cobertura.faltam.sort()).toEqual(["c", "tl"]);
    expect(r.alertas.find((x) => x.userId === "g")).toBeUndefined();
  });

  it("alerta: quem está há mais tempo sem vender nem captar vem primeiro; nunca = topo", () => {
    const r = montar();
    expect(r.alertas[0].userId).toBe("tl"); // nada em 12 meses
    expect(r.alertas[0].diasParado).toBeNull();
    const v = r.alertas.find((x) => x.userId === "v")!;
    expect(v.diasSemVender).toBe(105); // 01/12/2026 → 16/03/2027
    expect(v.diasSemCaptar).toBeNull();
    const a = r.alertas.find((x) => x.userId === "a")!;
    expect(a.diasParado).toBe(11); // venda 05/03 e captação 02/03 → a mais recente
  });

  it("antes de jan/2027: farol ⚪ aguardando e realizado do ano corrente", () => {
    const r = montarPainelGestor({
      hoje: "2026-11-20",
      planos: PLANOS,
      realizadoAno: {
        captacoes_ligadas: true,
        vendas: [
          { sale_id: "x", user_id: "a", venda_em: "2026-10-01", comissao: 5000, vgv: 1, lados: 1 },
        ],
        captacoes: [],
      },
      ultimos12: vazio,
      anotacoes: [],
    });
    expect(r.anoDados).toBe(2026);
    const a = r.total.pessoas.find((p) => p.userId === "a")!;
    expect(a.avaliacao.farol).toBe("aguardando");
    expect(a.realizadoAno.comissao).toBe(5000);
    expect(r.total.avaliacao.indicadores.comissao.metaAno).toBe(300000);
  });

  it("períodos pedidos ao banco", () => {
    expect(periodosDoPainel("2027-03-16")).toEqual({
      ano: { inicio: "2027-01-01", fim: "2027-12-31" },
      ultimos12: { inicio: "2026-03-16", fim: "2027-03-16" },
    });
    expect(periodosDoPainel("2026-11-20").ano).toEqual({
      inicio: "2026-01-01",
      fim: "2026-12-31",
    });
  });
});
