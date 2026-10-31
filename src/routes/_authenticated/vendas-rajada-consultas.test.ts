// @vitest-environment jsdom
// Tela Vendas: 10 trocas rápidas de filtro/busca não podem virar uma rajada de consultas ao banco
// (causa nº1 da lentidão de 19/10 — t_5a6a9f24 / t_4103542a).
import { createElement, type ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const contagem = { lista: 0, pacote: 0, midia: 0, historico: 0, abortadas: 0 };

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children }: { children?: unknown }) => children,
  useRouter: () => ({ invalidate: vi.fn() }),
}));

vi.mock("@/lib/auth", () => {
  const roles = ["financeiro"];
  const valor = {
    user: { id: "u-1" },
    roles,
    hasAny: (rs: string[]) => rs.some((r) => roles.includes(r)),
  };
  return { useAuth: () => valor };
});

vi.mock("@/integrations/supabase/client", () => {
  const builder = (tabela: string) => {
    let signal: AbortSignal | undefined;
    const b: Record<string, unknown> = {};
    for (const m of ["select", "in", "eq", "is", "order", "range"]) b[m] = () => b;
    b.abortSignal = (s: AbortSignal) => {
      signal = s;
      return b;
    };
    b.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => {
      if (tabela === "sale_status_history") {
        contagem.historico += 1;
        if (signal?.aborted) contagem.abortadas += 1;
      }
      return Promise.resolve({ data: [], error: null }).then(ok, erro);
    };
    return b;
  };
  return {
    supabase: {
      from: (t: string) => builder(t),
      rpc: () => Promise.resolve({ data: [], error: null }),
    },
  };
});

const hoje = new Date();
const dataNoMes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;

vi.mock("@/lib/financeiro-dashboard-query", () => ({
  fetchFinanceiroBundle: vi.fn(async () => {
    contagem.pacote += 1;
    await new Promise((r) => setTimeout(r, 30));
    return {
      efetivadas: [
        {
          saleId: "s-1",
          imovelLabel: "Imóvel 1",
          codigoInterno: "C1",
          dataEfetivacao: dataNoMes,
          modalidade: "venda",
          corretorId: "c-1",
          teamId: null,
          gestorId: null,
          valorNegociado: 500000,
          valorTotalComissao: 30000,
          parceriaExterna: 0,
          saldoInicialImobiliaria: 30000,
          receitaLiquidaImobiliaria: 15000,
          participantesIds: ["c-1"],
        },
      ],
      parcelas: [],
      comissoes: [],
      divergencias: [],
      corretorOptions: [],
      gestorOptions: [],
      teamOptions: [],
    };
  }),
}));

vi.mock("@/lib/vendas-comerciais-query", () => ({
  fetchVendasComerciaisPaginadas: vi.fn(async (p: { signal?: AbortSignal }) => {
    contagem.lista += 1;
    await new Promise((r) => setTimeout(r, 30));
    if (p.signal?.aborted) contagem.abortadas += 1;
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
  return {
    ...real,
    fetchSaleIdsPorMidia: vi.fn(async (f: string) => {
      contagem.midia += 1;
      return f === "todas" ? null : new Set<string>();
    }),
  };
});

const esperar = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

async function abrirTela() {
  const { Route } = await import("./vendas.index");
  const SalesList = (Route as unknown as { options: { component: ComponentType } }).options
    .component;
  render(createElement(SalesList));
  // Espera a carga inicial terminar (lista + resumo na tela) e as consultas pararem.
  for (let i = 0; i < 80; i++) {
    await esperar(100);
    const carregando = document.querySelector('[aria-label="Carregando vendas"]');
    if (!carregando && document.querySelector('[data-testid="resumo-efetivadas"]')) break;
  }
  await esperar(500);
}

function textoResumo() {
  const cartao = screen.getByTestId("resumo-efetivadas");
  const lancadas = screen.getByTestId("resumo-lançadas");
  return `${cartao.textContent} | ${lancadas.textContent}`;
}

beforeEach(() => {
  Object.assign(contagem, { lista: 0, pacote: 0, midia: 0, historico: 0, abortadas: 0 });
  window.history.replaceState(null, "", "/vendas");
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe("tela Vendas: rajada de filtros", () => {
  it("10 trocas rápidas de busca/período geram 1 consulta da lista e nenhum pacote financeiro a mais", async () => {
    await abrirTela();
    const inicial = { ...contagem };
    const resumoAntes = textoResumo();

    const busca = screen.getByLabelText("Buscar por código, imóvel ou pessoa envolvida");
    const de = screen.getByLabelText("Data da venda de") as HTMLInputElement;
    const deOriginal = de.value;
    const termos = ["C", "C1", "C", "C1", "C12", "C1"];
    let t = 0;
    for (let i = 0; i < 10; i++) {
      if (i % 3 === 2) {
        // troca de período no meio da digitação (ida e volta)
        fireEvent.change(de, {
          target: { value: i % 2 ? deOriginal : dataNoMes.replace(/01$/, "02") },
        });
      } else {
        fireEvent.change(busca, { target: { value: termos[t++ % termos.length] } });
      }
      await esperar(50);
    }
    fireEvent.change(de, { target: { value: deOriginal } });
    await esperar(1200);

    const rajada = {
      lista: contagem.lista - inicial.lista,
      pacote: contagem.pacote - inicial.pacote,
      midia: contagem.midia - inicial.midia,
      historico: contagem.historico - inicial.historico,
    };
    process.stdout.write(`\n[rajada-vendas] ${JSON.stringify({ inicial, rajada })}`);
    process.stdout.write(`\n[rajada-vendas] resumo: ${resumoAntes}`);

    // Abrir a tela: 1 consulta da lista e 1 pacote financeiro (antes: 2 listas).
    expect(inicial.lista).toBe(1);
    expect(inicial.pacote).toBe(1);
    expect(rajada.lista).toBe(1);
    expect(rajada.pacote).toBe(0);
    expect(rajada.midia).toBeLessThanOrEqual(1);
    // Os números da tela continuam os mesmos depois da rajada.
    expect(textoResumo()).toBe(resumoAntes);
  });

  it("troca de filtro durante uma carga cancela a requisição anterior", async () => {
    await abrirTela();
    const busca = screen.getByLabelText("Buscar por código, imóvel ou pessoa envolvida");
    fireEvent.change(busca, { target: { value: "C" } });
    await esperar(410); // dispara a consulta de \"C\" (30 ms de resposta)
    fireEvent.change(busca, { target: { value: "C1" } });
    await esperar(800);
    expect(contagem.abortadas).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("resumo-efetivadas")).toBeTruthy();
  });
});
