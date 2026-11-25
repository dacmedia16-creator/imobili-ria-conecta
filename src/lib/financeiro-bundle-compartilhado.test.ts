import { beforeEach, describe, expect, it, vi } from "vitest";

// t_205ec8f5: no log de 24/11 o mesmo gestor pediu o pacote financeiro inteiro 2 vezes no mesmo
// segundo (a tela montou de novo). Cada pedido são ~13 leituras pesadas em paralelo, o que dobra a
// pressão no banco justamente no pico. Pedidos simultâneos (ou dentro de 60 s) do MESMO usuário
// passam a reaproveitar a mesma carga; erro não fica guardado.
const estado = vi.hoisted(() => ({
  uid: "u-1" as string | null,
  leituras: {} as Record<string, number>,
  falharComissoes: 0,
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (tabela: string) => {
    estado.leituras[tabela] = (estado.leituras[tabela] ?? 0) + 1;
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "range", "in", "eq"]) b[m] = () => b;
    b.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => {
      if (tabela === "occurrence_commissions" && estado.falharComissoes > 0) {
        estado.falharComissoes -= 1;
        return Promise.resolve({
          data: null,
          error: { code: "42501", message: "permission denied" },
          count: null,
        }).then(ok, erro);
      }
      return Promise.resolve({ data: [], error: null, count: 0 }).then(ok, erro);
    };
    return b;
  };
  return {
    supabase: {
      from: (t: string) => builder(t),
      rpc: async (nome: string) => {
        estado.leituras[`rpc:${nome}`] = (estado.leituras[`rpc:${nome}`] ?? 0) + 1;
        return { data: [], error: null };
      },
      auth: {
        getSession: async () => ({
          data: { session: estado.uid ? { user: { id: estado.uid } } : null },
        }),
      },
    },
  };
});

import * as consulta from "@/lib/financeiro-dashboard-query";
const { fetchFinanceiroBundle } = consulta;

beforeEach(() => {
  // Opcional de propósito: o mesmo teste roda contra o código antigo (controle negativo).
  (consulta as { limparCacheFinanceiroBundle?: () => void }).limparCacheFinanceiroBundle?.();
  estado.uid = "u-1";
  estado.leituras = {};
  estado.falharComissoes = 0;
});

describe("fetchFinanceiroBundle — sem carga dupla", () => {
  it("dois pedidos simultâneos do mesmo usuário fazem UMA carga", async () => {
    const [a, b] = await Promise.all([fetchFinanceiroBundle(), fetchFinanceiroBundle()]);
    expect(a).toBe(b);
    expect(estado.leituras["occurrence_commissions"]).toBe(1);
    expect(estado.leituras["occurrence_partners"]).toBe(1);
    expect(estado.leituras["rpc:vendas_comerciais_canonicas"]).toBe(1);
  });

  it("pedido logo depois (tela montou de novo) reaproveita a carga", async () => {
    await fetchFinanceiroBundle({ incluirInconsistencias: false });
    await fetchFinanceiroBundle({ incluirInconsistencias: false });
    expect(estado.leituras["occurrence_commissions"]).toBe(1);
  });

  it("depois de limpar (venda excluída) busca de novo", async () => {
    await fetchFinanceiroBundle();
    consulta.limparCacheFinanceiroBundle();
    await fetchFinanceiroBundle();
    expect(estado.leituras["occurrence_commissions"]).toBe(2);
  });

  it("usuários diferentes nunca compartilham o pacote", async () => {
    await fetchFinanceiroBundle();
    estado.uid = "u-2";
    await fetchFinanceiroBundle();
    expect(estado.leituras["occurrence_commissions"]).toBe(2);
  });

  it("com e sem inconsistências são cargas separadas", async () => {
    await fetchFinanceiroBundle({ incluirInconsistencias: true });
    await fetchFinanceiroBundle({ incluirInconsistencias: false });
    expect(estado.leituras["rpc:comparativo_comissao_6pct_inconsistencias"]).toBe(1);
    expect(estado.leituras["occurrence_commissions"]).toBe(2);
  });

  it("erro não fica guardado: o próximo pedido tenta de novo (e falha não vira zero)", async () => {
    estado.falharComissoes = 1;
    await expect(fetchFinanceiroBundle()).rejects.toThrow(/Dados financeiros incompletos/);
    await expect(fetchFinanceiroBundle()).resolves.toMatchObject({ efetivadas: [] });
    expect(estado.leituras["occurrence_commissions"]).toBe(2);
  });
});
