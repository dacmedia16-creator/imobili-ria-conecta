import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), in: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
import { aplicarDatasRecentes, formatarDataRecente } from "./dashboard-datas-recentes";

const rows = [
  { id: "recente-a", created_at: "2026-09-08T01:00:00Z", status: "rascunho" },
  { id: "recente-b", created_at: "2026-09-07T23:00:00-03:00", status: "rascunho" },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ in: mocks.in });
});

describe("datas das vendas recentes", () => {
  it("prioriza assinatura, mantém ordem/campos e consulta só os IDs recentes em lote", async () => {
    mocks.in.mockResolvedValue({
      data: [{ sale_id: "recente-a", data_assinatura: "2026-08-31" }],
      error: null,
    });
    expect(await aplicarDatasRecentes(rows)).toEqual([
      { ...rows[0], data_venda: "2026-08-31" },
      { ...rows[1], data_venda: "2026-09-07" },
    ]);
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("occurrences");
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith("sale_id, data_assinatura");
    expect(mocks.in).toHaveBeenCalledExactlyOnceWith("sale_id", ["recente-a", "recente-b"]);
  });

  it("usa o dia de criação quando assinatura é nula ou ocorrência ausente", async () => {
    mocks.in.mockResolvedValue({
      data: [{ sale_id: "recente-a", data_assinatura: null }],
      error: null,
    });
    expect((await aplicarDatasRecentes(rows)).map((row) => row.data_venda)).toEqual([
      "2026-09-08",
      "2026-09-07",
    ]);
  });

  it("não consulta com lista vazia", async () => {
    expect(await aplicarDatasRecentes([])).toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("não apresenta fallback confirmado se a API retorna erro", async () => {
    mocks.in.mockResolvedValue({ data: null, error: { message: "indisponível" } });
    expect(await aplicarDatasRecentes(rows)).toEqual(
      rows.map((row) => ({ ...row, data_venda: null })),
    );
  });

  it("preserva a lista e indica data indisponível se a consulta rejeita", async () => {
    mocks.in.mockRejectedValue(new Error("offline"));
    expect(await aplicarDatasRecentes(rows)).toEqual(
      rows.map((row) => ({ ...row, data_venda: null })),
    );
  });

  it("formata DD/MM/AAAA sem converter timezone", () => {
    expect(formatarDataRecente("2026-09-08")).toBe("Data: 08/09/2026");
    expect(formatarDataRecente("2024-02-29")).toBe("Data: 29/02/2024");
    expect(formatarDataRecente(null)).toBe("Data indisponível");
  });
});
