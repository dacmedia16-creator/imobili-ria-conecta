import { beforeEach, describe, expect, it, vi } from "vitest";

type Resposta = { data: unknown; error: unknown };
type Chamada = { table: string; select?: string; eq?: [string, string]; in?: [string, string[]] };

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  calls: [] as Chamada[],
  respostas: {} as Record<string, () => Promise<Resposta>>,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
import { aplicarDatasRecentes, formatarDataRecente } from "./dashboard-datas-recentes";

// Cadeias reais usadas: from().select().in() e from().select().eq().in().
function builder(table: string) {
  const call: Chamada = { table };
  mocks.calls.push(call);
  const b = {
    select(cols: string) {
      call.select = cols;
      return b;
    },
    eq(col: string, val: string) {
      call.eq = [col, val];
      return b;
    },
    in(col: string, vals: string[]) {
      call.in = [col, vals];
      return mocks.respostas[table]();
    },
  };
  return b;
}

const ok = (data: unknown) => () => Promise.resolve({ data, error: null });

const rows = [
  { id: "recente-a", created_at: "2026-09-08T01:00:00Z", status: "rascunho" },
  { id: "recente-b", created_at: "2026-09-07T23:00:00-03:00", status: "rascunho" },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.calls.length = 0;
  mocks.from.mockImplementation(builder);
  mocks.respostas.occurrences = ok([]);
  mocks.respostas.sale_status_history = ok([]);
});

describe("datas das vendas recentes (data oficial)", () => {
  it("sem histórico usa a ocorrência (fallback) e consulta só os IDs recentes em lote", async () => {
    mocks.respostas.occurrences = ok([{ sale_id: "recente-a", data_assinatura: "2026-08-31" }]);
    expect(await aplicarDatasRecentes(rows)).toEqual([
      { ...rows[0], data_venda: "2026-08-31" },
      { ...rows[1], data_venda: "2026-09-07" },
    ]);
    expect(mocks.calls).toHaveLength(2);
    expect(mocks.calls.find((c) => c.table === "occurrences")).toEqual({
      table: "occurrences",
      select: "sale_id, data_assinatura",
      in: ["sale_id", ["recente-a", "recente-b"]],
    });
    expect(mocks.calls.find((c) => c.table === "sale_status_history")).toEqual({
      table: "sale_status_history",
      select: "sale_id, created_at",
      eq: ["para", "contrato_assinado"],
      in: ["sale_id", ["recente-a", "recente-b"]],
    });
  });

  it("venda reassinada: vale a ÚLTIMA assinatura (data civil SP), acima da ocorrência", async () => {
    mocks.respostas.occurrences = ok([{ sale_id: "recente-a", data_assinatura: "2026-08-10" }]);
    mocks.respostas.sale_status_history = ok([
      { sale_id: "recente-a", created_at: "2026-08-10T15:00:00Z" },
      // 01:30 UTC de 01/09 = 22:30 de 31/08 em São Paulo
      { sale_id: "recente-a", created_at: "2026-09-01T01:30:00Z" },
    ]);
    const [a] = await aplicarDatasRecentes(rows);
    expect(a.data_venda).toBe("2026-08-31");
  });

  it("Lançamento: usa sales.data_assinatura mesmo com histórico", async () => {
    const lanc = [{ ...rows[0], modalidade: "lancamento", data_assinatura: "2026-10-02" }];
    mocks.respostas.sale_status_history = ok([
      { sale_id: "recente-a", created_at: "2026-10-05T15:00:00Z" },
    ]);
    const [a] = await aplicarDatasRecentes(lanc);
    expect(a.data_venda).toBe("2026-10-02");
  });

  it("usa o dia de criação quando não há assinatura nem ocorrência", async () => {
    mocks.respostas.occurrences = ok([{ sale_id: "recente-a", data_assinatura: null }]);
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
    mocks.respostas.sale_status_history = () =>
      Promise.resolve({ data: null, error: { message: "indisponível" } });
    expect(await aplicarDatasRecentes(rows)).toEqual(
      rows.map((row) => ({ ...row, data_venda: null })),
    );
  });

  it("preserva a lista e indica data indisponível se a consulta rejeita", async () => {
    mocks.respostas.occurrences = () => Promise.reject(new Error("offline"));
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
