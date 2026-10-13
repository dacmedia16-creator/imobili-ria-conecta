import { describe, expect, it } from "vitest";
import {
  dataAssinaturaOficial,
  dataOficialVendaComercial,
  ultimasAssinaturasPorVenda,
} from "./data-assinatura-oficial";

describe("dataAssinaturaOficial (espelho de public.data_assinatura_oficial)", () => {
  it("venda reassinada: a última assinatura vence a ocorrência", () => {
    const ultima = ultimasAssinaturasPorVenda([
      { sale_id: "v", created_at: "2026-08-10T15:00:00Z" },
      { sale_id: "v", created_at: "2026-09-01T01:30:00Z" }, // 31/08 22:30 em SP
    ]).get("v");
    expect(ultima).toBe("2026-08-31");
    expect(
      dataAssinaturaOficial({
        modalidade: "padrao",
        saleDataAssinatura: "2026-08-01",
        ultimaAssinatura: ultima,
        occDataAssinatura: "2026-08-10",
      }),
    ).toBe("2026-08-31");
  });

  it("Lançamento usa sales.data_assinatura mesmo com histórico", () => {
    expect(
      dataAssinaturaOficial({
        modalidade: "lancamento",
        saleDataAssinatura: "2026-10-02",
        ultimaAssinatura: "2026-10-05",
        occDataAssinatura: "2026-10-06",
      }),
    ).toBe("2026-10-02");
  });

  it("sem histórico cai na ocorrência e depois na venda", () => {
    const base = { modalidade: "padrao", ultimaAssinatura: null };
    expect(
      dataAssinaturaOficial({
        ...base,
        saleDataAssinatura: "2026-09-01",
        occDataAssinatura: "2026-09-03",
      }),
    ).toBe("2026-09-03");
    expect(
      dataAssinaturaOficial({ ...base, saleDataAssinatura: "2026-09-01", occDataAssinatura: null }),
    ).toBe("2026-09-01");
  });
});

describe("dataOficialVendaComercial (Relatórios / Comissões)", () => {
  it("venda padrão: venda_em (último contrato_assinado) em data civil SP", () => {
    expect(
      dataOficialVendaComercial({
        vendaEm: "2026-09-01T01:30:00+00:00",
        modalidade: "padrao",
        saleDataAssinatura: null,
        occDataAssinatura: "2026-08-10",
      }),
    ).toBe("2026-08-31");
  });

  it("Lançamento: sales.data_assinatura; sem ela, ocorrência; sem ambas, venda_em", () => {
    const base = { vendaEm: "2026-10-07T13:00:00+00:00", modalidade: "lancamento" };
    expect(
      dataOficialVendaComercial({
        ...base,
        saleDataAssinatura: "2026-10-02",
        occDataAssinatura: "2026-10-04",
      }),
    ).toBe("2026-10-02");
    expect(
      dataOficialVendaComercial({
        ...base,
        saleDataAssinatura: null,
        occDataAssinatura: "2026-10-04",
      }),
    ).toBe("2026-10-04");
    expect(
      dataOficialVendaComercial({ ...base, saleDataAssinatura: null, occDataAssinatura: null }),
    ).toBe("2026-10-07");
  });

  it("venda não elegível (sem venda_em) não ganha data — elegibilidade inalterada", () => {
    expect(
      dataOficialVendaComercial({
        vendaEm: null,
        modalidade: "padrao",
        saleDataAssinatura: "2026-09-01",
        occDataAssinatura: "2026-09-01",
      }),
    ).toBeNull();
  });
});
