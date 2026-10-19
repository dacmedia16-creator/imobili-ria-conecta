import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { datasDaVendaNaLista, formatarDataBR } from "./vendas-lista-datas";

const base = {
  status: "rascunho",
  modalidade: "padrao",
  created_at: "2026-10-01T14:00:00+00:00",
  data_assinatura: null,
  data_venda: "2026-10-01",
};

describe("datasDaVendaNaLista (lista de Vendas: Criada em / Assinada em)", () => {
  it("rascunho sem assinatura: data_venda é a criação → 'Ainda não assinada'", () => {
    expect(datasDaVendaNaLista(base, false)).toEqual({ criadaEm: "01/10/2026", assinadaEm: null });
  });

  it("contrato_assinado no histórico: mostra a data oficial como assinatura", () => {
    const s = { ...base, status: "contrato_assinado", data_venda: "2026-10-15" };
    expect(datasDaVendaNaLista(s, true)).toEqual({
      criadaEm: "01/10/2026",
      assinadaEm: "15/10/2026",
    });
  });

  it("assinada no mesmo dia da criação continua 'Assinada em' (status pós-assinatura)", () => {
    const s = { ...base, status: "ocorrencia_pendente" };
    expect(datasDaVendaNaLista(s, false).assinadaEm).toBe("01/10/2026");
  });

  it("devolvida para ajuste depois de assinada: o histórico garante 'Assinada em'", () => {
    const s = { ...base, status: "devolvida_ajuste" };
    expect(datasDaVendaNaLista(s, true).assinadaEm).toBe("01/10/2026");
  });

  it("criação às 22h em SP usa o dia de São Paulo, não o de UTC", () => {
    const s = { ...base, created_at: "2026-10-02T01:00:00+00:00", data_venda: "2026-10-01" };
    expect(datasDaVendaNaLista(s, false)).toEqual({ criadaEm: "01/10/2026", assinadaEm: null });
  });

  it("Lançamento só é assinado com sales.data_assinatura", () => {
    const sem = { ...base, modalidade: "lancamento", status: "ocorrencia_analise_financeiro" };
    expect(datasDaVendaNaLista(sem, false).assinadaEm).toBeNull();
    const com = { ...sem, data_assinatura: "2026-10-05", data_venda: "2026-10-05" };
    expect(datasDaVendaNaLista(com, false).assinadaEm).toBe("05/10/2026");
  });

  it("formatarDataBR", () => {
    expect(formatarDataBR("2026-12-31")).toBe("31/12/2026");
    expect(formatarDataBR(null)).toBeNull();
  });

  it("tela usa as legendas e não volta à data solta", () => {
    const tela = readFileSync("src/routes/_authenticated/vendas.index.tsx", "utf8");
    expect(tela).toContain("Criada em");
    expect(tela).toContain("Assinada em");
    expect(tela).toContain("Ainda não assinada");
    expect(tela).not.toContain("<TableHead>Data da venda</TableHead>");
    expect(tela.match(/<DatasVendaLegenda\b/g)?.length).toBe(2);
  });
});
