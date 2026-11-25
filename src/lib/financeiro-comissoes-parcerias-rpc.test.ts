import { beforeEach, describe, expect, it, vi } from "vitest";

// t_205ec8f5 B: o pacote financeiro lia occurrence_commissions/occurrence_partners direto e, para
// gestor, o RLS recalculava as vendas visíveis várias vezes por leitura (4–8 s, 57014 em 24/11).
// Agora pede a RPC financeiro_comissoes_parcerias_visiveis (mesmas linhas, conjunto calculado 1x).
// Banco sem a migration: volta para a leitura direta, sem quebrar a tela.
const estado = vi.hoisted(() => ({
  respostasRpc: [] as Array<{ data: unknown; error: unknown }>,
  rpcs: 0,
  tabelas: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (tabela: string) => {
    estado.tabelas.push(tabela);
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "range"]) b[m] = () => b;
    b.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
      Promise.resolve({
        data: [{ id: `${tabela}-1`, occurrence_id: "o-1" }],
        error: null,
        count: 1,
      }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      from: (t: string) => builder(t),
      rpc: async (nome: string) => {
        if (nome !== "financeiro_comissoes_parcerias_visiveis") return { data: [], error: null };
        estado.rpcs += 1;
        return estado.respostasRpc.shift() ?? { data: null, error: { message: "sem resposta" } };
      },
    },
  };
});

import * as consulta from "@/lib/financeiro-dashboard-query";

const buscar = () =>
  (
    consulta as unknown as {
      buscarComissoesEParcerias: () => Promise<{ comissoes: unknown[]; parcerias: unknown[] }>;
    }
  ).buscarComissoesEParcerias();

const OK = {
  data: {
    comissoes: [{ id: "c-1", occurrence_id: "o-1", valor: 10 }],
    parcerias: [{ id: "p-1", occurrence_id: "o-1", valor: 5 }],
  },
  error: null,
};

beforeEach(() => {
  estado.respostasRpc = [];
  estado.rpcs = 0;
  estado.tabelas = [];
});

describe("buscarComissoesEParcerias (RPC de visibilidade)", () => {
  it("usa a RPC e NÃO lê as tabelas pesadas", async () => {
    estado.respostasRpc = [OK];
    const r = await buscar();
    expect(r.comissoes).toHaveLength(1);
    expect(r.parcerias).toHaveLength(1);
    expect(estado.rpcs).toBe(1);
    expect(estado.tabelas).toEqual([]);
  });

  it("banco ainda sem a migration (PGRST202): volta para a leitura direta das tabelas", async () => {
    estado.respostasRpc = [
      { data: null, error: { code: "PGRST202", message: "Could not find the function" } },
    ];
    const r = await buscar();
    expect(estado.tabelas.sort()).toEqual(["occurrence_commissions", "occurrence_partners"]);
    expect(r.comissoes).toHaveLength(1);
  });

  it("statement timeout: repete a RPC uma vez", async () => {
    estado.respostasRpc = [{ data: null, error: { code: "57014", message: "timeout" } }, OK];
    await expect(buscar()).resolves.toMatchObject({ comissoes: [{ id: "c-1" }] });
    expect(estado.rpcs).toBe(2);
  });

  it("outro erro ou resposta sem listas: falha (a tela mostra 'Tentar de novo', nunca zero)", async () => {
    estado.respostasRpc = [{ data: null, error: { code: "42501", message: "Não autenticado." } }];
    await expect(buscar()).rejects.toThrow(/Dados financeiros incompletos/);
    estado.respostasRpc = [{ data: { comissoes: [] }, error: null }];
    await expect(buscar()).rejects.toThrow(/Dados financeiros incompletos/);
    expect(estado.tabelas).toEqual([]);
  });
});
