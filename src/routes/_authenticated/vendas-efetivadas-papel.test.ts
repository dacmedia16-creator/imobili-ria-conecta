// @vitest-environment jsdom
// Tela Vendas, cartão "Efetivadas" por papel (t_a42027c1, opção A de Denis 22/11).
// Usa o fetchFinanceiroBundle REAL; só o cliente Supabase é simulado, com a mesma regra do banco:
// comparativo_comissao_6pct_inconsistencias responde 403/42501 para quem não é financeiro, admin
// ou super_admin. Antes da correção, gestor/TL/corretor viam "R$ 0 · 0 vendas" sem aviso.
import { createElement, type ComponentType } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  roles: [] as string[],
  rpcs: [] as string[],
  falhaReal: false,
}));

const PAPEIS_FINANCEIROS = ["financeiro", "admin", "super_admin"];

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children }: { children?: unknown }) => children,
  useRouter: () => ({ invalidate: vi.fn() }),
}));

vi.mock("@/lib/auth", () => {
  // Objeto estável entre renders (como o AuthProvider real): os efeitos da tela dependem dele.
  const valor = {
    user: { id: "u-teste" },
    get roles() {
      return estado.roles;
    },
    hasAny: (rs: string[]) => rs.some((r) => estado.roles.includes(r)),
  };
  return { useAuth: () => valor };
});

const hoje = new Date();
const dataNoMes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;

vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "in", "eq", "is", "order", "range", "abortSignal"]) b[m] = () => b;
    b.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(ok, erro);
    return b;
  };
  const rpc = (nome: string) => {
    estado.rpcs.push(nome);
    if (nome === "vendas_comerciais_canonicas") {
      if (estado.falhaReal)
        return Promise.resolve({
          data: null,
          error: { message: "upstream connect error", code: "", status: 500 },
        });
      return Promise.resolve({
        data: [
          {
            sale_id: "s-1",
            codigo_interno: "C1",
            imovel_id: null,
            modalidade: "venda",
            status: "contrato_assinado",
            corretor_id: "c-1",
            valor_negociado: 500000,
            valor_total_comissao: 30000,
            data_fechamento: dataNoMes,
          },
        ],
        error: null,
      });
    }
    if (nome === "comparativo_comissao_6pct_inconsistencias") {
      // Mesma regra da RPC no banco (RAISE ... ERRCODE '42501' → HTTP 403).
      if (!estado.roles.some((r) => PAPEIS_FINANCEIROS.includes(r)))
        return Promise.resolve({
          data: null,
          error: {
            code: "42501",
            message: "Acesso não autorizado ao Comparativo de Comissão.",
            details: null,
            hint: null,
          },
        });
      return Promise.resolve({ data: [], error: null });
    }
    // RPC de comissões/parcerias visíveis (t_205ec8f5 B): devolve objeto, não lista.
    if (nome === "financeiro_comissoes_parcerias_visiveis")
      return Promise.resolve({ data: { comissoes: [], parcerias: [] }, error: null });
    return Promise.resolve({ data: [], error: null });
  };
  return { supabase: { from: () => builder(), rpc } };
});

vi.mock("@/lib/vendas-comerciais-query", () => ({
  fetchVendasComerciaisPaginadas: vi.fn(async () => ({
    rows: [
      {
        id: "s-1",
        status: "contrato_assinado",
        valor_negociado: 500000,
        imovel_id: null,
        codigo_interno: "C1",
        corretor_captador: null,
        corretor_vendedor: null,
        updated_at: dataNoMes,
        created_at: dataNoMes,
        corretor_id: "c-1",
        modalidade: "venda",
        data_assinatura: dataNoMes,
        data_venda: dataNoMes,
        corretores_ids: ["c-1"],
      },
    ],
    total_count: 1,
    total_valor: 500000,
  })),
}));

vi.mock("@/lib/vendas-midia-filtro", async (original) => {
  const real = await original<typeof import("@/lib/vendas-midia-filtro")>();
  return { ...real, fetchSaleIdsPorMidia: vi.fn(async () => null) };
});

const esperar = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

async function abrirTela() {
  const { Route } = await import("./vendas.index");
  const SalesList = (Route as unknown as { options: { component: ComponentType } }).options
    .component;
  render(createElement(SalesList));
  for (let i = 0; i < 80; i++) {
    await esperar(100);
    const carregando = document.querySelector('[aria-label="Carregando vendas"]');
    if (!carregando && document.querySelector('[data-testid="resumo-efetivadas"]')) break;
  }
  await esperar(300);
  return screen.getByTestId("resumo-efetivadas").textContent ?? "";
}

beforeEach(() => {
  estado.rpcs = [];
  estado.falhaReal = false;
  window.history.replaceState(null, "", "/vendas");
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe("cartão Efetivadas em /vendas por papel", () => {
  const casos: Array<[string, string[], boolean]> = [
    ["gestor", ["gestor"], false],
    ["líder de equipe (TL)", ["corretor", "team_leader"], false],
    ["corretor", ["corretor"], false],
    ["financeiro", ["financeiro"], true],
    ["admin", ["admin"], true],
  ];

  it.each(casos)("%s vê o total das efetivadas que enxerga", async (_n, roles, financeiro) => {
    estado.roles = roles;
    const texto = await abrirTela();
    expect(texto).toContain("500.000");
    expect(texto).toContain("1 venda");
    expect(texto).not.toMatch(/Não foi possível/);
    const chamouInconsistencias = estado.rpcs.includes("comparativo_comissao_6pct_inconsistencias");
    // Quem não é do financeiro nem pede a conferência de inconsistências (zero 403 no banco).
    expect(chamouInconsistencias).toBe(financeiro);
    expect(estado.rpcs).toContain("vendas_comerciais_canonicas");
  });

  it("erro real (500/rede) mostra aviso de falha em vez de R$ 0", async () => {
    estado.roles = ["gestor"];
    estado.falhaReal = true;
    const texto = await abrirTela();
    expect(texto).toMatch(/Não foi possível carregar as efetivadas/);
    expect(texto).not.toMatch(/R\$\s*0\b/);
    expect(texto).not.toContain("0 vendas");
  });
});
