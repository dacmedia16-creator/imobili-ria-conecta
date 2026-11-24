// @vitest-environment jsdom
/**
 * Meu Plano 2027 de OUTRA pessoa (cartão t_c9b0f633, Denis 24/11: "ao clicar no nome da pessoa abre o plano dela
 * como ela preenche, e os adm podem editar"; só ADMINISTRADORES editam, gestor/líder no máximo visualizam).
 * - modo "editar" (administrador): grava pela RPC do administrador, com o id da pessoa, mesmo no plano assinado;
 *   meta pela RPC do administrador; NUNCA assina pela pessoa; fila do aparelho separada da do próprio plano.
 * - modo "ver" (gestor/líder): nenhuma gravação.
 * - tela: faixa "Plano de X · modo leitura" / "editando como administrador"; recusa do banco (42501) mostra o aviso.
 * O banco é a proteção real (suíte supabase/tests/meu_plano_admin_edita.sql).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, render, screen } from "@testing-library/react";
import { createElement } from "react";

const rpc = vi.fn();
let linhaPlano: Record<string, unknown> | null = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (t: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: t === "carreira_plano" ? linhaPlano : null }),
          }),
        }),
        is: () => ({ maybeSingle: async () => ({ data: null }) }),
      }),
    }),
  },
}));
// A tela do plano usa só o roteamento passado por props; o resto do app não entra.
vi.mock("@/components/minha-carreira/meu-plano/MeuPlano", () => ({
  MeuPlano: (p: { userId: string; modo: string; nome: string | null }) =>
    createElement("div", {
      "data-testid": "meu-plano",
      "data-modo": p.modo,
      "data-user": p.userId,
    }),
}));

import { usePlano } from "@/components/minha-carreira/meu-plano/usePlano";
import {
  PlanoDaPessoa,
  textoFaixa,
  ehRecusa,
} from "@/components/minha-carreira/meu-plano/PlanoDaPessoa";

const chamadas = (nome: string) => rpc.mock.calls.filter((c) => c[0] === nome).map((c) => c[1]);
const passa = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const ASSINADO = {
  respostas: { "mt.tCapt": "12", "mt.tVenda": "10", "mt.comMedia": "15000" },
  assinado_corretor_em: "2026-11-20T10:00:00Z",
};

beforeEach(() => {
  vi.useFakeTimers();
  rpc.mockResolvedValue({ data: "2026-11-24T00:00:00Z", error: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  rpc.mockReset();
  linhaPlano = null;
  window.localStorage.clear();
});

describe("usePlano em modo administrador (editar)", () => {
  it("plano ASSINADO: campo de meta grava pela RPC do administrador, com o id da pessoa", async () => {
    linhaPlano = ASSINADO;
    const { result } = renderHook(() => usePlano("pessoa-1", "editar"));
    await passa(10);
    act(() => result.current.set("mt.tCapt", "11"));
    await passa(1_000);
    expect(chamadas("carreira_plano_salvar")).toHaveLength(0);
    expect(chamadas("carreira_plano_admin_salvar")).toEqual([
      { _corretor: "pessoa-1", _ano: 2027, _campos: { "mt.tCapt": "11" } },
    ]);
    expect(result.current.plano?.respostas["mt.tCapt"]).toBe("11");
    // Fila do aparelho separada: não mistura com o plano próprio de quem está logado.
    expect(window.localStorage.getItem("meu-plano-2027:fila:pessoa-1")).toBeNull();
  });

  it("meta oficial pela RPC do administrador; assinar é recusado (o corretor assina)", async () => {
    linhaPlano = ASSINADO;
    rpc.mockImplementation(async (nome: string) =>
      nome === "carreira_plano_admin_usar_meta"
        ? { data: { status: "gravada", meta: { meta_comissao: 1 } }, error: null }
        : { data: null, error: null },
    );
    const { result } = renderHook(() => usePlano("pessoa-1", "editar"));
    await passa(10);
    await act(async () => {
      await result.current.usarMeta(
        { comissao: 300000, vgv: null, vendas: 20, captacoes: 10 },
        true,
      );
    });
    expect(chamadas("carreira_plano_admin_usar_meta")[0]).toMatchObject({
      _corretor: "pessoa-1",
      _comissao: 300000,
      _substituir: true,
    });
    expect(chamadas("carreira_plano_usar_meta")).toHaveLength(0);
    await expect(result.current.assinar()).rejects.toThrow(/próprio corretor/);
    expect(chamadas("carreira_plano_assinar")).toHaveLength(0);
  });
});

describe("usePlano em modo leitura (ver)", () => {
  it("nada é gravado: nem campo, nem meta", async () => {
    linhaPlano = { respostas: { "mt.tCapt": "8" }, assinado_corretor_em: null };
    const { result } = renderHook(() => usePlano("pessoa-2", "ver"));
    await passa(10);
    act(() => result.current.set("mt.tCapt", "99"));
    await passa(2_000);
    expect(rpc).not.toHaveBeenCalled();
    expect(result.current.plano?.respostas["mt.tCapt"]).toBe("8");
    await expect(
      result.current.usarMeta({ comissao: 1, vgv: null, vendas: 1, captacoes: 1 }, true),
    ).rejects.toThrow(/leitura/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("usePlano do próprio plano não muda", () => {
  it("sem modo: segue gravando por carreira_plano_salvar", async () => {
    linhaPlano = { respostas: {}, assinado_corretor_em: null };
    const { result } = renderHook(() => usePlano("eu"));
    await passa(10);
    act(() => result.current.set("pq.frase", "x"));
    await passa(1_000);
    expect(chamadas("carreira_plano_salvar")).toEqual([
      { _ano: 2027, _campos: { "pq.frase": "x" } },
    ]);
    expect(chamadas("carreira_plano_admin_salvar")).toHaveLength(0);
  });
});

describe("tela do plano de outra pessoa", () => {
  it("faixa do topo com o nome e o modo", () => {
    expect(textoFaixa({ modo: "ver", nome: "Ana Souza" })).toBe(
      "Plano de Ana Souza · modo leitura",
    );
    expect(textoFaixa({ modo: "editar", nome: "Ana Souza" })).toBe(
      "Plano de Ana Souza · editando como administrador",
    );
    expect(ehRecusa("Sem acesso ao plano desta pessoa", "42501")).toBe(true);
    expect(ehRecusa("Failed to fetch")).toBe(false);
  });

  it("administrador: faixa 'editando' e o plano em modo editar", async () => {
    vi.useRealTimers();
    rpc.mockResolvedValue({ data: { modo: "editar", nome: "Ana Souza" }, error: null });
    render(
      createElement(PlanoDaPessoa, {
        userId: "pessoa-1",
        vista: { v: "inicio" },
        ir: () => undefined,
      }),
    );
    const faixa = await screen.findByTestId("faixa-plano-pessoa");
    expect(faixa.textContent).toBe("Plano de Ana Souza · editando como administrador");
    expect(screen.getByTestId("meu-plano").getAttribute("data-modo")).toBe("editar");
    expect(rpc).toHaveBeenCalledWith("carreira_plano_acesso", { _corretor: "pessoa-1" });
  });

  it("gestor/líder: faixa 'modo leitura'", async () => {
    vi.useRealTimers();
    rpc.mockResolvedValue({ data: { modo: "ver", nome: "Ana Souza" }, error: null });
    render(
      createElement(PlanoDaPessoa, {
        userId: "pessoa-1",
        vista: { v: "inicio" },
        ir: () => undefined,
      }),
    );
    expect((await screen.findByTestId("faixa-plano-pessoa")).textContent).toBe(
      "Plano de Ana Souza · modo leitura",
    );
    expect(screen.getByTestId("meu-plano").getAttribute("data-modo")).toBe("ver");
  });

  it("corretor comum (banco recusa 42501): aviso de recusa, o plano nem é montado", async () => {
    vi.useRealTimers();
    rpc.mockResolvedValue({
      data: null,
      error: { message: "Sem acesso ao plano desta pessoa", code: "42501" },
    });
    render(
      createElement(PlanoDaPessoa, {
        userId: "pessoa-1",
        vista: { v: "inicio" },
        ir: () => undefined,
      }),
    );
    expect((await screen.findByTestId("plano-recusado")).textContent).toMatch(
      /não tem acesso ao plano desta pessoa/,
    );
    expect(screen.queryByTestId("meu-plano")).toBeNull();
  });
});
