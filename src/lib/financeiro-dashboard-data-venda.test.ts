import { describe, it, expect } from "vitest";
import { dataDaVenda } from "@/lib/financeiro-dashboard-query";
import { dataAssinaturaOficial, ultimasAssinaturasPorVenda } from "@/lib/data-assinatura-oficial";

describe("dataDaVenda (data oficial = último contrato_assinado)", () => {
  it("venda padrão usa o último contrato_assinado, mesmo com data diferente na ocorrência", () => {
    expect(dataDaVenda("venda", "2026-08-25", null, "2026-09-04")).toBe("2026-09-04");
  });
  it("lançamento usa a data da venda", () => {
    expect(dataDaVenda("lancamento", "2026-08-01", "2026-09-02", "2026-09-05")).toBe("2026-09-02");
  });
  it("lançamento sem data da venda cai na data de fechamento", () => {
    expect(dataDaVenda("lancamento", null, null, "2026-09-05")).toBe("2026-09-05");
  });
});

describe("dataAssinaturaOficial", () => {
  it("venda sem histórico usa a ocorrência e depois a venda (fallback)", () => {
    expect(
      dataAssinaturaOficial({
        modalidade: "venda",
        saleDataAssinatura: "2026-09-10",
        ultimaAssinatura: null,
        occDataAssinatura: "2026-08-25",
      }),
    ).toBe("2026-08-25");
    expect(
      dataAssinaturaOficial({
        modalidade: "venda",
        saleDataAssinatura: "2026-09-10",
        ultimaAssinatura: null,
        occDataAssinatura: null,
      }),
    ).toBe("2026-09-10");
  });
  it("venda reassinada vale a ÚLTIMA assinatura, em data civil de São Paulo", () => {
    const m = ultimasAssinaturasPorVenda([
      { sale_id: "a", created_at: "2026-08-20T15:00:00Z" },
      { sale_id: "a", created_at: "2026-09-01T02:30:00Z" }, // 31/08 23:30 em SP
      { sale_id: "b", created_at: "2026-09-05T12:00:00Z" },
    ]);
    expect(m.get("a")).toBe("2026-08-31");
    expect(m.get("b")).toBe("2026-09-05");
  });
});
