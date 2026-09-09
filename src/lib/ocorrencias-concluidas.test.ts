import { describe, expect, it } from "vitest";
import {
  imovelOuCodigo,
  montarOcorrenciasConcluidas,
  podeVerOcorrenciasConcluidas,
  ultimaConclusaoPorSale,
  type OcorrenciaConcluidaRaw,
} from "./ocorrencias-concluidas";

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
