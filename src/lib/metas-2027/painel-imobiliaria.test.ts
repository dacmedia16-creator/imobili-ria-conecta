/**
 * Painel de metas 2027 da imobiliária (cartão t_69d29df6): regra pura.
 * Confere meta da direção × assinados × em preenchimento, % da direção, mês a mês, ranking, quebra da comissão.
 */
import { describe, expect, it } from "vitest";
import type { Respostas } from "@/lib/meu-plano-2027/regras";
import {
  direcaoDeRpc,
  lerValorDirecao,
  montarPainelImobiliaria,
  normalizarQuebraRpc,
  somarQuebra,
  type QuebraVendaRpc,
} from "./painel-imobiliaria";
import { metaDoPlano } from "./regra";
import type { PlanosRpc, RealizadoRpc } from "./painel-gestor";

const P = (tc: string, tv: string): Respostas => ({
  "mt.novas": "24",
  "mt.tCapt": tc,
  "mt.tVenda": tv,
  "mt.comMedia": "5000",
  "m.ticket": "400000",
});
const ass = (r: Respostas) => ({
  tem_plano: true,
  respostas: r,
  assinado_em: "2026-12-10T13:00:00Z",
});
const pre = (r: Respostas) => ({ tem_plano: true, respostas: r, assinado_em: null });
const sem = { tem_plano: false, respostas: null, assinado_em: null };

const PLANOS: PlanosRpc = {
  todas: true,
  modulo_plano: true,
  equipes: [
    { id: "az", nome: "Equipe Azul", lider_id: null, lider_nome: null },
    { id: "vd", nome: "Equipe Verde", lider_id: null, lider_nome: null },
  ],
  pessoas: [
    { user_id: "a", nome: "Alfa", team_id: "az", papeis: ["corretor"], ...ass(P("10", "8")) },
    { user_id: "b", nome: "Beta", team_id: "az", papeis: ["corretor"], ...pre(P("6", "6")) },
    { user_id: "c", nome: "Gama", team_id: "vd", papeis: ["corretor"], ...ass(P("12", "10")) },
    { user_id: "g", nome: "Gestora", team_id: "vd", papeis: ["gestor"], ...sem },
  ],
};
const REAL: RealizadoRpc = {
  captacoes_ligadas: true,
  vendas: [
    { sale_id: "s1", user_id: "a", venda_em: "2027-01-10", comissao: 12000, vgv: 450000, lados: 2 },
    { sale_id: "s2", user_id: "a", venda_em: "2027-03-04", comissao: 9000, vgv: 500000, lados: 1 },
    { sale_id: "s2", user_id: "c", venda_em: "2027-03-04", comissao: 7000, vgv: 500000, lados: 1 },
    // Quem já saiu (não está na lista de pessoas): conta no total da imobiliária.
    { sale_id: "s3", user_id: "ex", venda_em: "2027-02-11", comissao: 5000, vgv: 300000, lados: 2 },
  ],
  captacoes: [{ capture_id: "k1", user_id: "c", aprovada_em: "2027-02-14" }],
};
const VAZIO: RealizadoRpc = { captacoes_ligadas: true, vendas: [], captacoes: [] };
const DIRECAO = {
  ano: 2027,
  meta_comissao: 1400000,
  meta_vgv: "60000000",
  meta_vendas: 120,
  meta_captacoes: null,
};

function painel(extra: Partial<Parameters<typeof montarPainelImobiliaria>[0]> = {}) {
  return montarPainelImobiliaria({
    hoje: "2027-03-16",
    planos: PLANOS,
    realizadoAno: REAL,
    ultimos12: REAL,
    anotacoes: [],
    direcao: DIRECAO,
    quebra: null,
    estoque: null,
    ...extra,
  });
}

describe("painel da imobiliária — meta da direção × planos", () => {
  it("oficial = soma dos ASSINADOS; em preenchimento separado; diferença contra a direção", () => {
    const p = painel();
    const somaAss =
      metaDoPlano(P("10", "8"))!.ano.comissao! + metaDoPlano(P("12", "10"))!.ano.comissao!;
    expect(p.comparacao.comissao.somaAssinados).toBe(somaAss);
    expect(p.comparacao.comissao.direcao).toBe(1400000);
    expect(p.comparacao.comissao.diferenca).toBe(somaAss - 1400000);
    expect(p.preenchimento.comissao).toBe(metaDoPlano(P("6", "6"))!.ano.comissao);
    // VGV veio como texto: vira número. Captações sem meta da direção: sem diferença.
    expect(p.comparacao.vgv.direcao).toBe(60000000);
    expect(p.comparacao.captacoes.diferenca).toBeNull();
  });

  it("meta oficial × só quem assinou; meta da direção × imobiliária INTEIRA (inclui quem já saiu)", () => {
    const p = painel();
    // a (12 mil + 9 mil) + c (7 mil) assinaram.
    expect(p.total.realizadoAno.comissao).toBe(28000);
    expect(p.total.avaliacao.indicadores.comissao.realAno).toBe(28000);
    // Quem já saiu (ex, 5 mil) fica à parte e conta para a direção.
    expect(p.total.naoAssinados.realizado.comissao).toBe(5000);
    expect(p.total.naoAssinados.pessoas).toBe(1);
    expect(p.realizadoCasa).toBe(33000);
    expect(p.pctDirecao).toBe(Math.round((33000 / 1400000) * 10000) / 10000);
  });

  it("antes de jan/2027: sem % da direção (o realizado ainda é do ano anterior)", () => {
    const p = painel({ hoje: "2026-11-20" });
    expect(p.pctDirecao).toBeNull();
  });

  it("sem meta da direção: comparação sem diferença e sem %", () => {
    const p = painel({ direcao: null });
    expect(p.direcao).toBeNull();
    expect(p.comparacao.comissao.diferenca).toBeNull();
    expect(p.pctDirecao).toBeNull();
    expect(
      direcaoDeRpc({
        ano: 2027,
        meta_comissao: null,
        meta_vgv: "",
        meta_vendas: null,
        meta_captacoes: null,
      }),
    ).toBeNull();
  });

  it("mês a mês: 12 meses, meta dos assinados, realizado só de quem assinou e meses futuros marcados", () => {
    const p = painel();
    expect(p.meses).toHaveLength(12);
    expect(p.meses[0].realizado).toBe(12000);
    expect(p.meses[1].realizado).toBe(0); // fevereiro: só quem já saiu vendeu (fora da meta oficial)
    expect(p.meses[2].realizado).toBe(16000);
    expect(p.meses[2].futuro).toBe(false);
    expect(p.meses[3].futuro).toBe(true);
    const somaMetas = p.meses.reduce((t, m) => t + (m.meta ?? 0), 0);
    expect(Math.round(somaMetas)).toBe(Math.round(p.comparacao.comissao.somaAssinados!));
  });

  it("cobertura: corretores ativos + gestor que vende (a gestora sem plano e sem venda fica fora)", () => {
    const c = painel().total.cobertura;
    expect(c.elegiveis).toBe(3);
    expect(c.assinados).toBe(2);
    expect(c.preenchimento).toBe(1);
  });
});

describe("painel da imobiliária — ranking", () => {
  it("ranking por equipe com farol e por corretor (sem quem não vende nem tem plano)", () => {
    const p = painel();
    expect(p.rankingEquipes.map((r) => r.nome).sort()).toEqual(["Equipe Azul", "Equipe Verde"]);
    expect(
      p.rankingEquipes.every((r) =>
        ["verde", "amarelo", "vermelho", "cinza", "aguardando"].includes(r.farol),
      ),
    ).toBe(true);
    expect(p.rankingCorretores.map((r) => r.nome)).not.toContain("Gestora");
    const beta = p.rankingCorretores.find((r) => r.nome === "Beta")!;
    expect(beta.farol).toBe("cinza");
    expect(beta.pctAno).toBeNull();
    // Ordem: maior % do esperado primeiro; sem meta (null) por último.
    const pcts = p.rankingCorretores.map((r) => r.pctEsperado ?? -1);
    expect([...pcts].sort((x, y) => y - x)).toEqual(pcts);
  });

  it("antes de 2027: ranking com farol 'aguardando' e realizado do ano corrente", () => {
    const p = painel({ hoje: "2026-11-20", realizadoAno: VAZIO, ultimos12: VAZIO });
    expect(p.base.pos.fase).toBe("antes");
    expect(p.rankingCorretores.find((r) => r.nome === "Alfa")!.farol).toBe("aguardando");
    expect(p.meses.every((m) => m.realizado === 0)).toBe(true);
  });
});

describe("painel da imobiliária — quebra da comissão", () => {
  const Q = (s: string, x: Partial<QuebraVendaRpc>): QuebraVendaRpc => ({
    sale_id: s,
    venda_em: "2027-03-04",
    modalidade: "padrao",
    bruta: 0,
    premio: 0,
    imobiliaria: 0,
    lideres: 0,
    indicador: 0,
    parceria: 0,
    extras: 0,
    corretores: 0,
    diferenca: 0,
    valido: true,
    ...x,
  });

  it("soma bruta → imobiliária → líderes → indicador → parceria/extras → corretores, cada venda 1 vez", () => {
    const vs = [
      Q("s1", { bruta: 30000, imobiliaria: 14000, indicador: 1000, corretores: 15000 }),
      Q("s1", { bruta: 30000, imobiliaria: 14000, indicador: 1000, corretores: 15000 }),
      Q("s2", {
        bruta: 20000,
        imobiliaria: 6000,
        lideres: 2000,
        parceria: 3000,
        extras: 1000,
        corretores: 8000,
        valido: false,
      }),
    ];
    const t = somarQuebra(vs);
    expect(t.vendas).toBe(2);
    expect(t.bruta).toBe(50000);
    expect(t.imobiliaria).toBe(20000);
    expect(t.lideres + t.indicador + t.parceria + t.extras).toBe(7000);
    expect(t.corretores).toBe(23000);
    expect(
      t.bruta +
        t.premio -
        t.imobiliaria -
        t.lideres -
        t.indicador -
        t.parceria -
        t.extras -
        t.corretores -
        t.diferenca,
    ).toBe(0);
    expect(t.inconsistentes).toBe(1);
  });

  it("normaliza números vindos como texto e sem bruta para quem não pode (quebra null)", () => {
    const vs = normalizarQuebraRpc({
      vendas: [{ sale_id: "s", venda_em: "2027-01-01", bruta: "100.5", corretores: "50" }],
    });
    expect(vs[0].bruta).toBe(100.5);
    expect(vs[0].imobiliaria).toBe(0);
    expect(vs[0].valido).toBe(true);
    expect(painel({ quebra: null }).comissao).toBeNull();
    expect(painel({ quebra: vs }).comissao!.bruta).toBe(100.5);
  });
});

describe("formulário da meta da direção", () => {
  it("lê o valor digitado no padrão brasileiro; vazio = sem meta; negativo/inválido = NaN", () => {
    expect(lerValorDirecao("1.400.000")).toBe(1400000);
    expect(lerValorDirecao("R$ 1.400.000,50")).toBe(1400000.5);
    expect(lerValorDirecao("120")).toBe(120);
    expect(lerValorDirecao("")).toBeNull();
    expect(lerValorDirecao("  ")).toBeNull();
    expect(lerValorDirecao("-5")).toBeNaN();
    expect(lerValorDirecao("abc")).toBeNaN();
  });
});
