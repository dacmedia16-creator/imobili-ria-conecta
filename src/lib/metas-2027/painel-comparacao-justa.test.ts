/**
 * Comparação justa meta × realizado — OPÇÃO A (cartão t_e4943168, decisão de Denis 20/11, tópico 6238).
 * A meta da equipe soma só as metas oficiais GRAVADAS (botão verde, mesmo sem assinar), então o realizado comparado com ela (%, ritmo, falta, farol) também
 * soma só quem assinou. A produção de quem não assinou aparece à parte. Na imobiliária, a meta da DIREÇÃO continua
 * comparada com a casa inteira. Venda dividida conta 1 vez; venda conta na assinatura.
 */
import { describe, expect, it } from "vitest";
import type { Respostas } from "@/lib/meu-plano-2027/regras";
import { comGravada } from "./teste-gravada";
import {
  montarPainelGestor,
  realizadoDoGrupo,
  type PessoaRpc,
  type PlanosRpc,
  type RealizadoRpc,
  type VendaRpc,
} from "./painel-gestor";
import { montarPainelImobiliaria } from "./painel-imobiliaria";
import { INDICADORES } from "./regra";

// Plano fictício: VGC R$ 120.000 no ano (R$ 10.000/mês), 24 transações.
const PLANO: Respostas = {
  "mt.novas": "24",
  "mt.tCapt": "12",
  "mt.tVenda": "12",
  "mt.comMedia": "5000",
  "m.ticket": "400000",
};
const pessoa = (
  id: string,
  assinadoEm: string | null,
  extra: Partial<PessoaRpc> = {},
): PessoaRpc => ({
  user_id: id,
  nome: id,
  team_id: "eq",
  papeis: ["corretor"],
  tem_plano: assinadoEm != null,
  respostas: assinadoEm != null ? PLANO : null,
  assinado_em: assinadoEm,
  // A assinatura grava a meta oficial (fonte única, t_91ec7aa3).
  ...(assinadoEm != null ? comGravada(PLANO, assinadoEm) : {}),
  ...extra,
});
const planos = (ps: PessoaRpc[]): PlanosRpc => ({
  todas: true,
  modulo_plano: true,
  equipes: [{ id: "eq", nome: "Equipe Gustavo", lider_id: null, lider_nome: "Gustavo" }],
  pessoas: ps,
});
const V = (s: string, u: string, d: string, com: number, vgv: number, lados = 1): VendaRpc => ({
  sale_id: s,
  user_id: u,
  venda_em: d,
  comissao: com,
  vgv,
  lados,
});
const vazio: RealizadoRpc = { captacoes_ligadas: true, vendas: [], captacoes: [] };

function equipe(ps: PessoaRpc[], real: RealizadoRpc, hoje = "2027-03-16") {
  const r = montarPainelGestor({
    hoje,
    planos: planos(ps),
    realizadoAno: real,
    ultimos12: vazio,
    anotacoes: [],
  });
  return { r, g: r.grupos.find((x) => x.id === "eq")! };
}

/** As duas partes (assinados + não assinados) fecham com o total da equipe. */
function fecha(g: ReturnType<typeof equipe>["g"]) {
  for (const k of INDICADORES)
    expect(
      Math.round(((g.realizadoAno[k] ?? 0) + (g.naoAssinados.realizado[k] ?? 0)) * 100) / 100,
      k,
    ).toBe(g.realizadoTodos[k]);
}

// 14 corretores; só "p1" assinou. Cada um vendeu 1 lado de R$ 10 mil em fevereiro de 2027.
const QUATORZE = Array.from({ length: 14 }, (_, i) => `p${i + 1}`);
const REAL_14: RealizadoRpc = {
  captacoes_ligadas: true,
  vendas: QUATORZE.map((u, i) => V(`s${i + 1}`, u, "2027-02-10", 10000, 400000)),
  captacoes: [
    { capture_id: "c1", user_id: "p1", aprovada_em: "2027-02-01" },
    { capture_id: "c2", user_id: "p2", aprovada_em: "2027-02-01" },
  ],
};

describe("Opção A — equipe", () => {
  it("1 de 14 assinados: meta e realizado só do assinado; os outros 13 à parte", () => {
    const ps = QUATORZE.map((u) => pessoa(u, u === "p1" ? "2026-12-10T13:00:00Z" : null));
    const { g } = equipe(ps, REAL_14);
    const c = g.avaliacao.indicadores.comissao;
    expect(c.metaAno).toBe(120000);
    expect(c.realAno).toBe(10000); // antes: 140.000 (os 14) contra a meta de 1 plano
    expect(g.realizadoAno).toEqual({ comissao: 10000, vendas: 1, vgv: 400000, captacoes: 1 });
    expect(g.naoAssinados.pessoas).toBe(13);
    expect(g.naoAssinados.realizado).toEqual({
      comissao: 130000,
      vendas: 13,
      vgv: 5200000,
      captacoes: 1,
    });
    expect(g.realizadoTodos.comissao).toBe(140000);
    // Esperado até 16/03 = 10k + 10k + 10k × 16/31 ≈ 25.161; feito 10 mil → 🔴 (antes ficava 🟢 com 140 mil).
    expect(g.avaliacao.farol).toBe("vermelho");
    expect(g.cobertura.assinados).toBe(1);
    expect(g.cobertura.elegiveis).toBe(14);
    fecha(g);
  });

  it("0 assinados: sem meta, sem % e farol ⚪; toda a produção aparece à parte", () => {
    const { g } = equipe(
      QUATORZE.map((u) => pessoa(u, null)),
      REAL_14,
    );
    const c = g.avaliacao.indicadores.comissao;
    expect(g.soma.assinados).toBeNull();
    expect(c.metaAno).toBeNull();
    expect(c.pctAno).toBeNull();
    expect(c.pctEsperado).toBeNull();
    expect(g.avaliacao.farol).toBe("cinza");
    expect(g.realizadoAno).toEqual({ comissao: 0, vendas: 0, vgv: 0, captacoes: 0 });
    expect(g.naoAssinados.pessoas).toBe(14);
    expect(g.naoAssinados.realizado.comissao).toBe(140000);
    fecha(g);
  });

  it("equipe toda assinada: resultado igual ao de antes (realizado da equipe inteira)", () => {
    const ps = QUATORZE.map((u) => pessoa(u, "2026-12-10T13:00:00Z"));
    const { g } = equipe(ps, REAL_14);
    // Como era: realizado de todas as pessoas da equipe.
    const antes = realizadoDoGrupo(REAL_14, new Set(QUATORZE), 2027, true);
    expect(g.mesesAssinados).toEqual(antes);
    expect(g.realizadoAno).toEqual(g.realizadoTodos);
    expect(g.avaliacao.indicadores.comissao.realAno).toBe(140000);
    expect(g.avaliacao.indicadores.comissao.metaAno).toBe(14 * 120000);
    expect(g.naoAssinados.pessoas).toBe(0);
    expect(g.naoAssinados.realizado).toEqual({ comissao: 0, vendas: 0, vgv: 0, captacoes: 0 });
  });

  it("corretor que assina no meio do ano: entra com o ano inteiro (venda conta na assinatura do contrato)", () => {
    const real: RealizadoRpc = {
      captacoes_ligadas: true,
      vendas: [V("s1", "m", "2027-02-10", 8000, 300000), V("s2", "m", "2027-07-05", 6000, 200000)],
      captacoes: [],
    };
    const ps = [pessoa("m", null)];
    // Em maio, "m" ainda não assinou: a produção dele fica à parte.
    const maio = equipe(ps, real, "2027-05-20").g;
    expect(maio.realizadoAno.comissao).toBe(0);
    expect(maio.naoAssinados.realizado.comissao).toBe(8000);
    // Assinou em junho: em agosto, a venda de fevereiro também conta para a meta (o plano é do ano todo).
    const ago = equipe([pessoa("m", "2027-06-15T12:00:00Z")], real, "2027-08-20").g;
    expect(ago.realizadoAno.comissao).toBe(14000);
    expect(ago.avaliacao.indicadores.comissao.realAno).toBe(14000);
    expect(ago.naoAssinados.realizado.comissao).toBe(0);
    expect(ago.naoAssinados.pessoas).toBe(0);
  });

  it("venda dividida entre quem assinou e quem não assinou: VGV 1 vez (na parte de quem assinou)", () => {
    const real: RealizadoRpc = {
      captacoes_ligadas: true,
      vendas: [
        V("d1", "ass", "2027-03-05", 9000, 500000), // captou
        V("d1", "nao", "2027-03-05", 7000, 500000), // vendeu
        V("d2", "nao", "2027-03-08", 3000, 200000), // venda só de quem não assinou
      ],
      captacoes: [],
    };
    const { g } = equipe([pessoa("ass", "2026-12-10T13:00:00Z"), pessoa("nao", null)], real);
    expect(g.realizadoAno).toMatchObject({ comissao: 9000, vendas: 1, vgv: 500000 });
    expect(g.naoAssinados.realizado).toMatchObject({ comissao: 10000, vendas: 2, vgv: 200000 });
    expect(g.naoAssinados.pessoas).toBe(1);
    // Total: d1 1 vez + d2 = 700 mil (não 1,2 mi); lados 3; comissão 19 mil.
    expect(g.realizadoTodos).toMatchObject({ comissao: 19000, vendas: 3, vgv: 700000 });
    fecha(g);
  });

  it("antes de jan/2027: realizado de 2026 só de quem assinou, sem farol; depois, farol com o realizado de 2027", () => {
    const real26: RealizadoRpc = {
      captacoes_ligadas: true,
      vendas: [
        V("x", "ass", "2026-10-01", 5000, 250000),
        V("y", "nao", "2026-09-01", 20000, 900000, 2),
      ],
      captacoes: [],
    };
    const ps = [pessoa("ass", "2026-11-18T13:00:00Z"), pessoa("nao", null)];
    const antes = equipe(ps, real26, "2026-11-20");
    expect(antes.r.anoDados).toBe(2026);
    expect(antes.g.avaliacao.farol).toBe("aguardando");
    // Antes de jan, o realizado de 2026 não entra no "realizado da meta" (a tela mostra só os dois números).
    expect(antes.g.avaliacao.indicadores.comissao.realAno).toBe(0);
    expect(antes.g.realizadoAno.comissao).toBe(5000);
    expect(antes.g.naoAssinados.realizado).toMatchObject({ comissao: 20000, vendas: 2 });
    const real27: RealizadoRpc = {
      captacoes_ligadas: true,
      vendas: [
        V("z", "ass", "2027-01-20", 12000, 400000),
        V("w", "nao", "2027-01-22", 30000, 1, 1),
      ],
      captacoes: [],
    };
    const depois = equipe(ps, real27, "2027-01-31");
    expect(depois.r.anoDados).toBe(2027);
    // Esperado em 31/01 = 10 mil (janeiro inteiro); feito 12 mil → 🟢. A venda de quem não assinou não entra.
    expect(depois.g.avaliacao.indicadores.comissao.realAno).toBe(12000);
    expect(depois.g.avaliacao.farol).toBe("verde");
    expect(depois.g.naoAssinados.realizado.comissao).toBe(30000);
  });
});

describe("Opção A — imobiliária", () => {
  const ps = [pessoa("a", "2026-12-10T13:00:00Z"), pessoa("b", null)];
  const real: RealizadoRpc = {
    captacoes_ligadas: true,
    vendas: [
      V("s1", "a", "2027-02-10", 10000, 400000),
      V("s1", "b", "2027-02-10", 6000, 400000), // venda dividida com quem não assinou
      V("s2", "saiu", "2027-03-01", 4000, 200000), // quem já saiu da imobiliária
    ],
    captacoes: [],
  };
  const montar = (hoje = "2027-03-16") =>
    montarPainelImobiliaria({
      hoje,
      planos: planos(ps),
      realizadoAno: real,
      ultimos12: vazio,
      anotacoes: [],
      direcao: {
        ano: 2027,
        meta_comissao: 400000,
        meta_vgv: null,
        meta_vendas: null,
        meta_captacoes: null,
      },
      quebra: null,
      estoque: null,
    });

  it("meta oficial × só quem assinou; direção × imobiliária inteira; não assinados (e quem saiu) à parte", () => {
    const p = montar();
    expect(p.total.avaliacao.indicadores.comissao.realAno).toBe(10000);
    expect(p.total.avaliacao.indicadores.comissao.metaAno).toBe(120000);
    expect(p.total.naoAssinados.realizado.comissao).toBe(10000); // b 6 mil + quem saiu 4 mil
    expect(p.total.naoAssinados.pessoas).toBe(2);
    expect(p.realizadoCasa).toBe(20000);
    expect(p.pctDirecao).toBe(0.05); // 20 mil ÷ 400 mil
    // VGV da casa: s1 1 vez + s2.
    expect(p.total.realizadoTodos.vgv).toBe(600000);
    expect(p.total.realizadoAno.vgv).toBe(400000);
    expect(p.meses[1].realizado).toBe(10000); // fevereiro: só a parte de "a"
    expect(p.meses[2].realizado).toBe(0); // março: só quem já saiu (fora da meta oficial)
    // Ranking por equipe usa a mesma comparação justa.
    expect(p.rankingEquipes[0].realizado).toBe(10000);
  });

  it("antes de jan/2027: sem % da direção", () => {
    expect(montar("2026-11-20").pctDirecao).toBeNull();
  });
});
