// @vitest-environment jsdom
// Tela Vendas, papel gestor: o pacote financeiro responde 403 (42501 em
// comparativo_comissao_6pct_inconsistencias). Essa falha não pode virar um novo pedido do pacote
// a cada filtro/busca (t_a7b202bf; produção: gestor 14 chamadas x admin 2 em 10 trocas).
import { createElement, type ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const contagem = { lista: 0, pacote: 0 };

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children }: { children?: unknown }) => children,
  useRouter: () => ({ invalidate: vi.fn() }),
}));

vi.mock("@/lib/auth", () => {
  const roles = ["gestor"];
  const valor = {
    user: { id: "u-gestor" },
    roles,
    hasAny: (rs: string[]) => rs.some((r) => roles.includes(r)),
  };
  return { useAuth: () => valor };
});

vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "in", "eq", "is", "order", "range", "abortSignal"]) b[m] = () => b;
    b.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      from: () => builder(),
      rpc: () => Promise.resolve({ data: [], error: null }),
    },
  };
});

const hoje = new Date();
const dataNoMes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;

vi.mock("@/lib/financeiro-dashboard-query", () => ({
  // Mesmo formato do erro do PostgREST que callRpc repassa (RAISE ... ERRCODE '42501' → 403).
  fetchFinanceiroBundle: vi.fn(async () => {
    contagem.pacote += 1;
    await new Promise((r) => setTimeout(r, 30));
    throw {
      code: "42501",
      message: "Acesso não autorizado ao Comparativo de Comissão.",
      details: null,
      hint: null,
    };
  }),
}));

vi.mock("@/lib/vendas-comerciais-query", () => ({
  fetchVendasComerciaisPaginadas: vi.fn(async () => {
    contagem.lista += 1;
    await new Promise((r) => setTimeout(r, 30));
    return {
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
    };
  }),
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
    if (!carregando && contagem.lista > 0 && contagem.pacote > 0) break;
  }
  await esperar(500);
}

function textoResumo() {
  const cartao = screen.queryByText("Efetivadas · VGV REMAX")?.parentElement;
  return cartao?.textContent ?? "(sem cartão)";
}

beforeEach(() => {
  Object.assign(contagem, { lista: 0, pacote: 0 });
  window.history.replaceState(null, "", "/vendas");
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe("tela Vendas (gestor): pacote financeiro com 403", () => {
  it("10 trocas rápidas de busca não pedem o pacote de novo depois da primeira falha", async () => {
    await abrirTela();
    const inicial = { ...contagem };
    const resumoAntes = textoResumo();

    const busca = screen.getByLabelText("Buscar por código, imóvel ou pessoa envolvida");
    const termos = ["C", "C1", "C12", "C1", "C", "C1", "C12", "C1", "C", "C1"];
    for (const termo of termos) {
      fireEvent.change(busca, { target: { value: termo } });
      // passa dos 400 ms de espera: cada troca vira uma carga de verdade
      await esperar(450);
    }
    await esperar(800);

    const rajada = {
      lista: contagem.lista - inicial.lista,
      pacote: contagem.pacote - inicial.pacote,
    };
    process.stdout.write(`\n[gestor-403] ${JSON.stringify({ inicial, rajada })}`);

    expect(inicial.pacote).toBe(1);
    expect(rajada.lista).toBeGreaterThanOrEqual(1);
    expect(rajada.pacote).toBe(0);
    // O cartão do gestor continua igual (o resumo opcional segue indisponível, como hoje).
    expect(textoResumo()).toBe(resumoAntes);
  });
});
