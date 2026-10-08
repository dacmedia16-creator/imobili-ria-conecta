import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  colunaDoStatus,
  diasSemVender,
  fracaoEquipePorVenda,
  ganhoDoLider,
  mesAnterior,
  nivelSemVender,
  podeAcessarPainelEquipe,
  pontasDoPainel,
  rankingEquipe,
  recebimentosDoMes,
  resumoMes,
  vencimentoExclusiva,
  vezDoStatus,
  type PainelEquipeDados,
} from "@/lib/painel-equipe-calc";
import {
  aplicarFiltrosProducao,
  gerarPontas,
  totaisProducao,
} from "@/lib/producao-por-pessoa-calc";
import { criarResolverEquipe } from "@/lib/equipe-vigente";
import type { ProducaoRawRow } from "@/lib/producao-por-pessoa-types";

const migration = readFileSync(
  new URL("../../supabase/migrations/20261008180000_painel_equipe.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../../supabase/rollback/20261008180000_painel_equipe.sql", import.meta.url),
  "utf8",
);

const venda = (p: Partial<ProducaoRawRow> & { sale_id: string }): ProducaoRawRow => ({
  imovel_id: null,
  codigo_interno: p.sale_id.toUpperCase(),
  modalidade: "padrao",
  concluida_em: "2026-10-05T15:00:00Z",
  valor_negociado: 1_000_000,
  comissao_bruta: 60_000,
  captador_id: null,
  captador_nome: null,
  vendedor_id: null,
  vendedor_nome: null,
  vendedor_fracao: null,
  ...p,
});

// Equipe A: lider (TL), ana, bia. Equipe B: caio. Sem equipe: davi.
const vigencias = [
  { membro_id: "lider", team_id: "A", de: null, ate: null, prioridade: 2 },
  { membro_id: "ana", team_id: "A", de: "2026-01-01T00:00:00Z", ate: null, prioridade: 1 },
  // bia trocou de B para A em 01/10
  {
    membro_id: "bia",
    team_id: "B",
    de: "2026-01-01T00:00:00Z",
    ate: "2026-10-01T03:00:00Z",
    prioridade: 1,
  },
  { membro_id: "bia", team_id: "A", de: "2026-10-01T03:00:00Z", ate: null, prioridade: 1 },
  { membro_id: "caio", team_id: "B", de: "2026-01-01T00:00:00Z", ate: null, prioridade: 1 },
];

const vendas: ProducaoRawRow[] = [
  // v1: ana capta, bia vende — 100% equipe A (outubro)
  venda({
    sale_id: "v1",
    captador_id: "ana",
    captador_nome: "Ana",
    vendedor_id: "bia",
    vendedor_nome: "Bia",
  }),
  // v2: parceria entre equipes — ana capta (A), caio vende (B)
  venda({
    sale_id: "v2",
    valor_negociado: 500_000,
    comissao_bruta: 30_000,
    captador_id: "ana",
    captador_nome: "Ana",
    vendedor_id: "caio",
    vendedor_nome: "Caio",
  }),
  // v3: parceria externa na venda — líder capta, venda inteira da casa
  venda({
    sale_id: "v3",
    valor_negociado: 400_000,
    comissao_bruta: 24_000,
    captador_id: "lider",
    captador_nome: "Líder",
    parceria_externa_venda: true,
  }),
  // v4: setembro — bia ainda era da equipe B; ana capta
  venda({
    sale_id: "v4",
    concluida_em: "2026-09-20T15:00:00Z",
    captador_id: "ana",
    captador_nome: "Ana",
    vendedor_id: "bia",
    vendedor_nome: "Bia",
  }),
  // v5: davi (sem equipe) e caio (B) — não é da equipe A
  venda({
    sale_id: "v5",
    captador_id: "davi",
    captador_nome: "Davi",
    vendedor_id: "caio",
    vendedor_nome: "Caio",
  }),
  // v6: 31/10 às 23h em Brasília = 01/11 UTC → conta em outubro
  venda({
    sale_id: "v6",
    concluida_em: "2026-11-01T02:00:00Z",
    valor_negociado: 200_000,
    comissao_bruta: 12_000,
    captador_id: "bia",
    captador_nome: "Bia",
    vendedor_id: "bia",
    vendedor_nome: "Bia",
  }),
];

const dados: PainelEquipeDados = {
  equipe: { id: "A", nome: "Equipe A", lider_id: "lider", lider_nome: "Líder" },
  viewer_id: "lider",
  eu_id: "lider",
  membros: [
    { user_id: "lider", nome: "Líder", papel: "lider", ultima_venda_em: "2026-10-05T15:00:00Z" },
    { user_id: "ana", nome: "Ana", papel: "membro", ultima_venda_em: "2026-09-10T15:00:00Z" },
    { user_id: "bia", nome: "Bia", papel: "membro", ultima_venda_em: null },
  ],
  vigencias,
  vendas,
  ganhos: [
    { sale_id: "v1", user_id: "ana", pessoal: 6000, lider: 0, outros: 0 },
    { sale_id: "v1", user_id: "bia", pessoal: 6000, lider: 0, outros: 0 },
    { sale_id: "v1", user_id: "lider", pessoal: 0, lider: 1500, outros: 0 },
    { sale_id: "v2", user_id: "ana", pessoal: 3000, lider: 0, outros: 0 },
    { sale_id: "v3", user_id: "lider", pessoal: 4800, lider: 0, outros: 0 },
    { sale_id: "v4", user_id: "ana", pessoal: 6000, lider: 0, outros: 0 },
    { sale_id: "v4", user_id: "bia", pessoal: 6000, lider: 0, outros: 0 },
  ],
  parcelas: [
    {
      sale_id: "v1",
      n: 1,
      valor: 60_000,
      data: "2026-10-20",
      recebido_em: null,
      recebido_valor: null,
    },
    {
      sale_id: "v2",
      n: 1,
      valor: 30_000,
      data: "2026-10-25",
      recebido_em: null,
      recebido_valor: null,
    },
    {
      sale_id: "v2",
      n: 2,
      valor: 10_000,
      data: "2026-11-25",
      recebido_em: null,
      recebido_valor: null,
    },
  ],
  andamento: [],
  exclusivas: [],
  meta: { meta_comissao: 30_000, comissao_realizada: null },
};

const pontas = pontasDoPainel(dados);

describe("Painel da Equipe — números do topo", () => {
  it("bate com a Produção por pessoa filtrada pela mesma equipe e pelo mesmo mês", () => {
    const r = resumoMes(dados, pontas, "2026-10");
    const prod = gerarPontas(vendas, criarResolverEquipe(vigencias), new Map([["A", "Equipe A"]]));
    const filtradas = aplicarFiltrosProducao(prod, {
      dataDe: "2026-10-01",
      dataAte: "2026-10-31",
      pessoaId: null,
      teamId: "A",
      modalidade: "todas",
      tipo: "todas",
    });
    const t = totaisProducao(filtradas);
    expect(r.vgv).toBe(t.vgv);
    expect(r.vgc).toBe(t.comissao);
    expect(r.qtd).toBe(t.qtdVendas);
  });

  it("parceria entre equipes conta só a parte da equipe (sem contar a venda duas vezes)", () => {
    const r = resumoMes(dados, pontas, "2026-10");
    // v1 inteira (1.000.000) + metade da v2 (250.000) + v3 inteira (400.000) + v6 (200.000)
    expect(r.vgv).toBe(1_850_000);
    expect(r.vgc).toBe(60_000 + 15_000 + 24_000 + 12_000);
    expect(r.qtd).toBe(1 + 0.5 + 1 + 1);
    const b = resumoMes(
      { ...dados, equipe: { ...dados.equipe, id: "B" } },
      pontasDoPainel({
        ...dados,
        equipe: { ...dados.equipe, id: "B" },
      }),
      "2026-10",
    );
    // a equipe B fica só com a outra metade da v2 e da v5
    expect(b.vgv).toBe(250_000 + 500_000);
  });

  it("usa a equipe vigente na data da venda", () => {
    // em setembro a bia era da equipe B: só a captação da ana conta para A
    const set = resumoMes(dados, pontas, "2026-09");
    expect(set.vgv).toBe(500_000);
    expect(set.qtd).toBe(0.5);
  });

  it("agrupa pelo mês da assinatura em Brasília (31/10 23h fica em outubro)", () => {
    const nov = resumoMes(dados, pontas, "2026-11");
    expect(nov.vgv).toBe(0);
  });

  it("recebimentos pela data da parcela × fração da equipe", () => {
    const r = resumoMes(dados, pontas, "2026-10");
    expect(r.recebeEquipe).toBe(60_000 + 15_000);
    const linhas = recebimentosDoMes(dados, pontas, "2026-10");
    expect(linhas.map((l) => [l.sale_id, l.fracao, l.parteEquipe])).toEqual([
      ["v1", 1, 60_000],
      ["v2", 0.5, 15_000],
    ]);
    expect(fracaoEquipePorVenda(pontas, "A").has("v5")).toBe(false);
  });

  it("comissão do pessoal soma só membros da equipe na data da venda", () => {
    expect(resumoMes(dados, pontas, "2026-10").comissaoPessoal).toBe(6000 + 6000 + 3000 + 4800);
    // setembro: bia era da equipe B
    expect(resumoMes(dados, pontas, "2026-09").comissaoPessoal).toBe(6000);
  });
});

describe("Painel da Equipe — ganho do líder (hipótese B, sem % automático)", () => {
  it("A = vendas pessoais; B = A + comissão de líder já lançada", () => {
    const g = ganhoDoLider(dados, "2026-10");
    expect(g.a).toBe(4800);
    expect(g.b).toBe(4800 + 1500);
    expect(g.lider.map((x) => x.saleId)).toEqual(["v1"]);
  });
});

describe("Painel da Equipe — ranking, funil e avisos", () => {
  it("ranking marca parceria e soma a parte de cada pessoa", () => {
    const rk = rankingEquipe(dados, pontas, "2026-10");
    const ana = rk.find((x) => x.userId === "ana")!;
    expect(ana.vgv).toBe(500_000 + 250_000);
    expect(ana.parceria).toBe(true);
    expect(ana.ganho).toBe(9000);
    expect(rk.find((x) => x.userId === "caio")).toBeUndefined();
  });

  it("colunas e vez do funil", () => {
    expect(colunaDoStatus("rascunho")).toBe("rascunho");
    expect(colunaDoStatus("ocorrencia_analise_financeiro")).toBe("financeiro");
    expect(colunaDoStatus("aguardando_assinatura")).toBe("andamento");
    expect(vezDoStatus("enviada_revisao")).toBe("gestor");
    expect(vezDoStatus("ocorrencia_concluida")).toBe("concluida");
  });

  it("dias sem vender: 14 amarelo, 30 vermelho, nunca vendeu = vermelho", () => {
    const d = diasSemVender(dados, "2026-10-20");
    expect(d.map((x) => [x.userId, x.dias])).toEqual([
      ["bia", null],
      ["ana", 40],
      ["lider", 15],
    ]);
    expect(nivelSemVender(10)).toBe("ok");
    expect(nivelSemVender(15)).toBe("atencao");
    expect(nivelSemVender(31)).toBe("alerta");
    expect(nivelSemVender(null)).toBe("alerta");
  });

  it("vencimento da exclusiva e mês anterior", () => {
    expect(
      vencimentoExclusiva({
        id: "e",
        captor_id: "ana",
        signed_on: "2026-10-01",
        prazo_dias: "90",
        tipo: null,
        bairro: null,
      }),
    ).toBe("2026-12-30");
    expect(
      vencimentoExclusiva({
        id: "e",
        captor_id: "ana",
        signed_on: null,
        prazo_dias: "90",
        tipo: null,
        bairro: null,
      }),
    ).toBeNull();
    expect(mesAnterior("2026-01")).toBe("2025-12");
  });

  it("menu: gestor, team leader (inclui líder auxiliar) e admin; corretor não", () => {
    expect(podeAcessarPainelEquipe(["gestor"])).toBe(true);
    expect(podeAcessarPainelEquipe(["team_leader"])).toBe(true);
    expect(podeAcessarPainelEquipe(["admin"])).toBe(true);
    expect(podeAcessarPainelEquipe(["corretor"])).toBe(false);
    expect(podeAcessarPainelEquipe(["financeiro"])).toBe(false);
  });
});

describe("Painel da Equipe — contrato da migration", () => {
  it("RPCs SECURITY DEFINER com checagem de permissão e isolamento por imobiliária", () => {
    expect(migration).toMatch(
      /painel_equipe_dados\(_team_id uuid, _mes date\)[\s\S]*SECURITY DEFINER/,
    );
    expect(migration).toMatch(
      /NOT public\.painel_equipe_permitido\(_team_id\)[\s\S]*ERRCODE = '42501'/,
    );
    expect(migration).toContain("t.organization_id = public.current_org_id()");
    expect(migration).toContain("public.leads_team_or_parent(_team_id, auth.uid())");
    expect(migration).toContain("producao_por_pessoa_dados()");
    expect(migration).toContain("'America/Sao_Paulo'");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.painel_equipe_dados\(uuid, date\) FROM PUBLIC, anon/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.painel_equipe_pertence\(uuid, timestamptz, uuid\) FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).not.toMatch(/\b(INSERT|UPDATE|DELETE)\s/);
  });

  it("rollback remove as 4 funções", () => {
    for (const f of [
      "painel_equipe_dados(uuid, date)",
      "painel_equipe_equipes()",
      "painel_equipe_permitido(uuid)",
      "painel_equipe_pertence(uuid, timestamptz, uuid)",
    ])
      expect(rollback).toContain(f);
  });
});
