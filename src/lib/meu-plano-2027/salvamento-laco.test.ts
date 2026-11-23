// @vitest-environment jsdom
/**
 * Meu Plano 2027 — salvamento automático não pode virar laço (cartão t_359e9e2a, diagnóstico t_c62ae99e:
 * 949 recusas "Plano assinado" de uma aba só, uma a cada ~30 s, em 22/11).
 * - recusa "Plano assinado" é SEMPRE definitiva (não só a 1ª): tira os campos travados da fila e não reagenda;
 * - qualquer outro erro para depois de 5 tentativas e mostra "Não foi possível salvar" (fila fica no aparelho);
 * - depois que a tela sai (desmonta), nenhuma nova tentativa é agendada.
 * Relógio simulado: os minutos de espera crescente passam na hora.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const rpc = vi.fn();
let linhaPlano: Record<string, unknown> | null = null;
let leituras = 0;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (t: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (t === "carreira_plano") leituras++;
              return { data: t === "carreira_plano" ? linhaPlano : null };
            },
          }),
        }),
        is: () => ({ maybeSingle: async () => ({ data: null }) }),
      }),
    }),
  },
}));

import { usePlano } from "@/components/minha-carreira/meu-plano/usePlano";

const salvamentos = () => rpc.mock.calls.filter((c) => c[0] === "carreira_plano_salvar").length;
const passa = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const RECUSA = {
  data: null,
  error: { message: "Plano assinado. Para mudar, peça ao seu gestor para reabrir.", code: "PT409" },
};
const SEM_REDE = { data: null, error: { message: "Failed to fetch" } };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  rpc.mockReset();
  linhaPlano = null;
  leituras = 0;
  window.localStorage.clear();
});

async function abrir() {
  const h = renderHook(() => usePlano("u1"));
  await passa(10);
  expect(h.result.current.plano).not.toBeNull();
  return h;
}

describe("salvamento automático sem laço", () => {
  it("recusa repetida de plano assinado não gera laço", async () => {
    // Aba que não enxerga a assinatura (leitura atrasada): toda tentativa de campo de meta é recusada.
    linhaPlano = { respostas: { "mt.tCapt": "12" }, assinado_corretor_em: null };
    rpc.mockResolvedValue(RECUSA);
    const { result } = await abrir();
    act(() => result.current.set("mt.tCapt", "99"));
    await passa(1_000);
    expect(salvamentos()).toBe(1);
    // 2ª edição de campo travado (a leitura ainda não mostra a assinatura): 2ª recusa.
    act(() => result.current.set("mt.tCapt", "98"));
    await passa(1_000);
    expect(salvamentos()).toBe(2);
    // 10 minutos parada: nenhuma nova tentativa sozinha.
    await passa(10 * 60_000);
    expect(salvamentos()).toBe(2);
    expect(result.current.status).not.toBe("erro");
    expect(JSON.parse(window.localStorage.getItem("meu-plano-2027:fila:u1") ?? "{}")).toEqual({});
    expect(leituras).toBeGreaterThanOrEqual(3); // abriu + releu a cada recusa
  });

  it("recusa pelo código 409 (PT409) também é definitiva, mesmo com outro texto", async () => {
    linhaPlano = { respostas: {}, assinado_corretor_em: null };
    rpc.mockResolvedValue({ data: null, error: { message: "Plano travado", code: "PT409" } });
    const { result } = await abrir();
    act(() => result.current.set("mt.tCapt", "99"));
    await passa(1_000);
    act(() => result.current.set("mt.tCapt", "98"));
    await passa(10 * 60_000);
    expect(salvamentos()).toBe(2);
  });

  it("outro erro: para depois de 5 tentativas e mostra 'Não foi possível salvar'", async () => {
    linhaPlano = { respostas: {}, assinado_corretor_em: null };
    rpc.mockResolvedValue(SEM_REDE);
    const { result } = await abrir();
    act(() => result.current.set("mt.tCapt", "20"));
    await passa(30 * 60_000);
    expect(salvamentos()).toBe(5);
    expect(result.current.status).toBe("erro");
    expect(result.current.msg).toMatch(/Não foi possível salvar/);
    // Nada se perde: segue guardado no aparelho.
    expect(JSON.parse(window.localStorage.getItem("meu-plano-2027:fila:u1") ?? "{}")).toEqual({
      "mt.tCapt": "20",
    });
    // Nova edição do corretor tenta de novo (até 5 outra vez) e grava quando a conexão volta.
    rpc.mockResolvedValue({ data: null, error: null });
    act(() => result.current.set("mt.tCapt", "21"));
    await passa(1_000);
    expect(salvamentos()).toBe(6);
    expect(result.current.status).toBe("ok");
  });

  it("timer não reagenda depois que a tela sai (desmonta)", async () => {
    linhaPlano = { respostas: {}, assinado_corretor_em: null };
    rpc.mockResolvedValue(SEM_REDE);
    const { result, unmount } = await abrir();
    act(() => result.current.set("mt.tCapt", "20"));
    await passa(1_000); // 1ª tentativa falhou, 2ª agendada
    expect(salvamentos()).toBe(1);
    unmount(); // ao sair, faz 1 última tentativa (não perde o que digitou)
    await passa(10);
    const aoSair = salvamentos();
    expect(aoSair).toBeLessThanOrEqual(2);
    await passa(30 * 60_000);
    expect(salvamentos()).toBe(aoSair);
  });
});
