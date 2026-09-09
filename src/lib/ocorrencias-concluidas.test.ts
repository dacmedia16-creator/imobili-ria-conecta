import { describe, expect, it } from "vitest";
import {
  chaveMesConclusao,
  mesesOcorrenciasConcluidas,
  resumoOcorrenciasConcluidas,
  imovelOuCodigo,
  montarOcorrenciasConcluidas,
  podeVerOcorrenciasConcluidas,
  ultimaConclusaoPorSale,
  type OcorrenciaConcluidaRaw,
  type OcorrenciaConcluidaRow,
} from "./ocorrencias-concluidas";

describe("filtro mensal de ocorrências concluídas", () => {
  const row = (
    saleId: string,
    dataConclusao: string,
    valorComissao = 100,
  ): OcorrenciaConcluidaRow => ({
    saleId,
    dataConclusao,
    valorComissao,
    imovelLabel: saleId,
    corretorNome: null,
  });
  const rows = [
    row("set-2", "2026-09-20T12:00:00Z", 200),
    row("set-1", "2026-09-10T12:00:00Z", 150),
    row("ago", "2026-08-10T12:00:00Z", 50),
    row("antigo", "2025-09-10T12:00:00Z", 25),
  ];

  it("obtém o mês atual para o padrão inicial", () => {
    expect(chaveMesConclusao(new Date(2026, 8, 9))).toBe("2026-09");
  });

  it("deriva meses únicos dos dados, em ordem decrescente, incluindo o atual vazio", () => {
    expect(mesesOcorrenciasConcluidas(rows, "2026-10")).toEqual([
      { value: "2026-10", label: "Outubro de 2026" },
      { value: "2026-09", label: "Setembro de 2026" },
      { value: "2026-08", label: "Agosto de 2026" },
      { value: "2025-09", label: "Setembro de 2025" },
    ]);
    expect(mesesOcorrenciasConcluidas([], "2026-09")).toEqual([
      { value: "2026-09", label: "Setembro de 2026" },
    ]);
  });

  it("filtra lista e totais juntos sem mudar a ordem nem os dados originais", () => {
    const resumo = resumoOcorrenciasConcluidas(rows, "2026-09");
    expect(resumo.rows.map((r) => r.saleId)).toEqual(["set-2", "set-1"]);
    expect(resumo.rows).toHaveLength(2);
    expect(resumo.totalComissao).toBe(350);
    expect(rows).toHaveLength(4);
  });

  it("troca o mês e não mistura o mesmo mês de outro ano", () => {
    expect(resumoOcorrenciasConcluidas(rows, "2026-08")).toEqual({
      rows: [rows[2]],
      totalComissao: 50,
    });
    expect(resumoOcorrenciasConcluidas(rows, "2025-09").rows).toEqual([rows[3]]);
  });

  it("Todos os meses recupera o histórico e ambos os totais", () => {
    const resumo = resumoOcorrenciasConcluidas(rows, "todos");
    expect(resumo.rows).toEqual(rows);
    expect(resumo.rows).toHaveLength(4);
    expect(resumo.totalComissao).toBe(425);
  });

  it("zera tabela e totais para mês vazio", () => {
    expect(resumoOcorrenciasConcluidas(rows, "2026-10")).toEqual({ rows: [], totalComissao: 0 });
    expect(resumoOcorrenciasConcluidas([], "todos")).toEqual({ rows: [], totalComissao: 0 });
  });

  it("respeita limites de mês e ano no mesmo fuso local da data exibida", () => {
    const limites = [
      row("antes", new Date(2025, 11, 31, 23, 59, 59, 999).toISOString()),
      row("inicio", new Date(2026, 0, 1, 0, 0, 0).toISOString()),
      row("fim", new Date(2026, 0, 31, 23, 59, 59, 999).toISOString()),
      row("depois", new Date(2026, 1, 1, 0, 0, 0).toISOString()),
    ];
    expect(resumoOcorrenciasConcluidas(limites, "2026-01").rows.map((r) => r.saleId)).toEqual([
      "inicio",
      "fim",
    ]);
    expect(chaveMesConclusao(new Date("2026-01-01T01:00:00Z"))).toBe(
      new Date("2026-01-01T01:00:00Z").getMonth() === 11 ? "2025-12" : "2026-01",
    );
  });

  it("filtra pela última conclusão do histórico e usa updated_at apenas no fallback", () => {
    const montadas = montarOcorrenciasConcluidas({
      occs: [
        { id: "o1", sale_id: "historico", valor_comissao: 200, updated_at: "2026-08-10T12:00:00Z" },
        { id: "o2", sale_id: "fallback", valor_comissao: 50, updated_at: "2026-08-20T12:00:00Z" },
      ],
      sales: [],
      nomesPorId: {},
      conclusoesPorSale: ultimaConclusaoPorSale([
        { sale_id: "historico", created_at: "2026-07-10T12:00:00Z" },
        { sale_id: "historico", created_at: "2026-09-10T12:00:00Z" },
      ]),
    });
    expect(resumoOcorrenciasConcluidas(montadas, "2026-09").rows[0].saleId).toBe("historico");
    expect(resumoOcorrenciasConcluidas(montadas, "2026-08").rows.map((r) => r.saleId)).toEqual([
      "fallback",
    ]);
  });
});

describe("podeVerOcorrenciasConcluidas", () => {
  it.each(["gestor", "team_leader", "admin", "super_admin", "financeiro"])(
    "libera o papel %s",
    (papel) => {
      expect(podeVerOcorrenciasConcluidas([papel])).toBe(true);
    },
  );

  it.each(["corretor", "juridico", "lancamento"])("bloqueia o papel %s", (papel) => {
    expect(podeVerOcorrenciasConcluidas([papel])).toBe(false);
  });

  it("bloqueia lista vazia", () => {
    expect(podeVerOcorrenciasConcluidas([])).toBe(false);
  });

  it("libera quando um dos papéis dá acesso, mesmo entre outros sem acesso", () => {
    expect(podeVerOcorrenciasConcluidas(["corretor", "gestor"])).toBe(true);
  });
});

describe("imovelOuCodigo", () => {
  it("prioriza codigo_interno", () => {
    expect(
      imovelOuCodigo({
        id: "aaaaaaaa-0000-0000-0000-000000000000",
        codigo_interno: "C123",
        imovel_id: "IM-9",
      }),
    ).toBe("C123");
  });

  it("usa imovel_id quando não há codigo_interno", () => {
    expect(
      imovelOuCodigo({
        id: "aaaaaaaa-0000-0000-0000-000000000000",
        codigo_interno: null,
        imovel_id: "IM-9",
      }),
    ).toBe("IM-9");
  });

  it("cai para Venda #<id> quando os dois estão vazios", () => {
    expect(
      imovelOuCodigo({
        id: "abcd1234-0000-0000-0000-000000000000",
        codigo_interno: null,
        imovel_id: null,
      }),
    ).toBe("Venda #abcd1234");
  });
});

describe("ultimaConclusaoPorSale", () => {
  it("mantém a entrada mais recente por venda", () => {
    const porSale = ultimaConclusaoPorSale([
      { sale_id: "s1", created_at: "2026-01-10T00:00:00Z" },
      { sale_id: "s1", created_at: "2026-03-10T00:00:00Z" },
      { sale_id: "s2", created_at: "2026-02-10T00:00:00Z" },
    ]);
    expect(porSale).toEqual({
      s1: "2026-03-10T00:00:00Z",
      s2: "2026-02-10T00:00:00Z",
    });
  });

  it("retorna vazio sem histórico", () => {
    expect(ultimaConclusaoPorSale([])).toEqual({});
  });
});

describe("montarOcorrenciasConcluidas", () => {
  const occ = (over: Partial<OcorrenciaConcluidaRaw>): OcorrenciaConcluidaRaw => ({
    id: "occ-1",
    sale_id: "s1",
    valor_comissao: 100,
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  });

  it("ordena por data de conclusão, mais recente primeiro", () => {
    const rows = montarOcorrenciasConcluidas({
      occs: [
        occ({ id: "occ-a", sale_id: "sa", updated_at: "2026-01-01T00:00:00Z" }),
        occ({ id: "occ-b", sale_id: "sb", updated_at: "2026-03-01T00:00:00Z" }),
        occ({ id: "occ-c", sale_id: "sc", updated_at: "2026-02-01T00:00:00Z" }),
      ],
      sales: [],
      nomesPorId: {},
      conclusoesPorSale: {},
    });
    expect(rows.map((r) => r.saleId)).toEqual(["sb", "sc", "sa"]);
  });

  it("usa a data do histórico (fonte primária) em vez de updated_at", () => {
    const rows = montarOcorrenciasConcluidas({
      occs: [occ({ sale_id: "s1", updated_at: "2026-01-01T00:00:00Z" })],
      sales: [],
      nomesPorId: {},
      conclusoesPorSale: { s1: "2026-05-01T00:00:00Z" },
    });
    expect(rows[0].dataConclusao).toBe("2026-05-01T00:00:00Z");
  });

  it("cai para updated_at quando não há registro de conclusão", () => {
    const rows = montarOcorrenciasConcluidas({
      occs: [occ({ sale_id: "s1", updated_at: "2026-01-01T00:00:00Z" })],
      sales: [],
      nomesPorId: {},
      conclusoesPorSale: {},
    });
    expect(rows[0].dataConclusao).toBe("2026-01-01T00:00:00Z");
  });

  it("resolve o corretor pelo nome do profile e o valor da comissão", () => {
    const rows = montarOcorrenciasConcluidas({
      occs: [occ({ sale_id: "s1", valor_comissao: 1234.5 })],
      sales: [{ id: "s1", codigo_interno: "C1", imovel_id: null, corretor_id: "u1" }],
      nomesPorId: { u1: "Maria" },
      conclusoesPorSale: {},
    });
    expect(rows[0]).toMatchObject({
      saleId: "s1",
      imovelLabel: "C1",
      corretorNome: "Maria",
      valorComissao: 1234.5,
    });
  });

  it("trata comissão nula como zero e venda ausente sem quebrar", () => {
    const rows = montarOcorrenciasConcluidas({
      occs: [occ({ sale_id: "s1", valor_comissao: null })],
      sales: [],
      nomesPorId: {},
      conclusoesPorSale: {},
    });
    expect(rows[0]).toMatchObject({
      valorComissao: 0,
      corretorNome: null,
      imovelLabel: "Venda #s1",
    });
  });
});
