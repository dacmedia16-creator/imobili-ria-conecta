import { describe, it, expect } from "vitest";
import { dataDaVenda } from "@/lib/financeiro-dashboard-query";

describe("dataDaVenda (mês da venda = data de assinatura)", () => {
  it("usa a data digitada na ocorrência", () => {
    expect(dataDaVenda("venda", "2026-08-25", null, "2026-09-04")).toBe("2026-08-25");
  });
  it("sem ocorrência datada, usa a data da venda", () => {
    expect(dataDaVenda("venda", null, "2026-09-10", "2026-09-12")).toBe("2026-09-10");
  });
  it("lançamento usa a data da venda", () => {
    expect(dataDaVenda("lancamento", "2026-08-01", "2026-09-02", "2026-09-05")).toBe("2026-09-02");
  });
  it("sem nenhuma data digitada, usa a mudança de status", () => {
    expect(dataDaVenda("venda", null, null, "2026-09-04")).toBe("2026-09-04");
  });
});
