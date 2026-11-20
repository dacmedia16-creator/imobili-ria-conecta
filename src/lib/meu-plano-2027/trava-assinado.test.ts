// @vitest-environment jsdom
/**
 * Plano assinado só leitura (cartão t_850a0d39, Denis 20/11 "trava sim").
 * - lista exata de prefixos livres (espelho de carreira_plano_parte_travada no banco);
 * - o hook não grava campo travado, limpa a fila antiga do aparelho, não regrava a meta e não mostra erro
 *   quando o banco recusa por "Plano assinado";
 * - plano em preenchimento: nada muda.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  MSG_PLANO_ASSINADO,
  PREFIXOS_LIVRES,
  campoLivre,
  erroPlanoAssinado,
  filaPermitida,
  soLivres,
} from "./trava-assinado";

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

const salvamentos = () =>
  rpc.mock.calls.filter((c) => c[0] === "carreira_plano_salvar").map((c) => c[1]._campos);
const espera = (ms: number) => new Promise((x) => setTimeout(x, ms));

afterEach(() => {
  cleanup();
  rpc.mockReset();
  linhaPlano = null;
  leituras = 0;
  window.localStorage.clear();
});

describe("lista de campos livres × travados", () => {
  it("só ac, pm, sem, mc e ui ficam livres", () => {
    expect([...PREFIXOS_LIVRES]).toEqual(["ac", "pm", "sem", "mc", "ui"]);
    for (const k of [
      "ac.mes",
      "ac.0.3",
      "pm.3.comissao",
      "sem.1.2",
      "mc.dataVenda",
      "ui.ult",
      "ui.pag",
    ])
      expect(campoLivre(k), k).toBe(true);
    for (const k of [
      "mt.tCapt",
      "mt.mes.com.3",
      "m.ticket",
      "fu.v2cre",
      "ms.lig",
      "d.comissao",
      "op.0",
      "pq.frase",
      "pa.c.0",
      "d90.inicio",
      "kri.0",
      "acx.0",
      "zz.novo",
    ])
      expect(campoLivre(k), k).toBe(false);
  });

  it("soLivres e filaPermitida tiram só os travados", () => {
    expect(soLivres({ "ac.0.0": "1", "mt.tCapt": "9", "ui.ult": "p1" })).toEqual({
      "ac.0.0": "1",
      "ui.ult": "p1",
    });
    expect(filaPermitida({ "mt.tCapt": "9", "pm.1.trans": "2" }, true)).toEqual({
      fica: { "pm.1.trans": "2" },
      descartou: 1,
    });
    expect(filaPermitida({ "mt.tCapt": "9" }, false)).toEqual({
      fica: { "mt.tCapt": "9" },
      descartou: 0,
    });
  });

  it("reconhece a mensagem do banco", () => {
    expect(MSG_PLANO_ASSINADO).toBe("Plano assinado. Para mudar, peça ao seu gestor para reabrir.");
    expect(erroPlanoAssinado(`ERROR: ${MSG_PLANO_ASSINADO}`)).toBe(true);
    expect(erroPlanoAssinado("Failed to fetch")).toBe(false);
  });
});

describe("hook do plano assinado", () => {
  it("assinado: campo travado não entra na fila; anotação grava", async () => {
    rpc.mockResolvedValue({ data: "2026-11-20T10:00:00Z", error: null });
    linhaPlano = { respostas: { "mt.tCapt": "12" }, assinado_corretor_em: "2026-11-18T13:00:00Z" };
    const { result } = renderHook(() => usePlano("u1"));
    await waitFor(() => expect(result.current.plano).not.toBeNull());
    act(() => {
      result.current.set("mt.tCapt", "99");
      result.current.set("ac.0.1", "3");
    });
    expect(result.current.plano?.respostas["mt.tCapt"]).toBe("12");
    await waitFor(() => expect(salvamentos()).toHaveLength(1), { timeout: 2000 });
    expect(salvamentos()[0]).toEqual({ "ac.0.1": "3" });
    expect(result.current.status).toBe("ok");
  });

  it("assinado: fila antiga do aparelho com campo travado é limpa e não gera erro ao abrir", async () => {
    window.localStorage.setItem(
      "meu-plano-2027:fila:u1",
      JSON.stringify({ "mt.tCapt": "99", "ms.lig": 40, "pm.2.trans": "1" }),
    );
    rpc.mockResolvedValue({ data: "2026-11-20T10:00:00Z", error: null });
    linhaPlano = { respostas: { "mt.tCapt": "12" }, assinado_corretor_em: "2026-11-18T13:00:00Z" };
    const { result } = renderHook(() => usePlano("u1"));
    await waitFor(() => expect(salvamentos()).toHaveLength(1));
    expect(salvamentos()[0]).toEqual({ "pm.2.trans": "1" });
    expect(result.current.plano?.respostas["mt.tCapt"]).toBe("12");
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(JSON.parse(window.localStorage.getItem("meu-plano-2027:fila:u1") ?? "{}")).toEqual({});
  });

  it("banco recusa por 'Plano assinado' (assinou em outro aparelho): sem erro na tela, relê o plano", async () => {
    linhaPlano = { respostas: { "mt.tCapt": "12" }, assinado_corretor_em: null };
    rpc.mockResolvedValue({
      data: null,
      error: { message: "Plano assinado. Para mudar, peça ao seu gestor para reabrir." },
    });
    const { result } = renderHook(() => usePlano("u1"));
    await waitFor(() => expect(result.current.plano).not.toBeNull());
    const antes = leituras;
    linhaPlano = { respostas: { "mt.tCapt": "12" }, assinado_corretor_em: "2026-11-20T09:00:00Z" };
    act(() => result.current.set("mt.tCapt", "99"));
    await waitFor(() => expect(leituras).toBeGreaterThan(antes), { timeout: 2000 });
    await waitFor(() => expect(result.current.plano?.respostas["mt.tCapt"]).toBe("12"));
    expect(result.current.status).toBe("ok");
    expect(result.current.msg).toBeNull();
    await espera(50);
    expect(salvamentos()).toHaveLength(1); // não fica tentando de novo
  });

  it("em preenchimento: nada muda (campo de meta grava)", async () => {
    rpc.mockResolvedValue({ data: "2026-11-20T10:00:00Z", error: null });
    linhaPlano = { respostas: { "mt.tCapt": "12" }, assinado_corretor_em: null };
    const { result } = renderHook(() => usePlano("u1"));
    await waitFor(() => expect(result.current.plano).not.toBeNull());
    act(() => result.current.set("mt.tCapt", "20"));
    await waitFor(() => expect(salvamentos()).toHaveLength(1), { timeout: 2000 });
    expect(salvamentos()[0]).toEqual({ "mt.tCapt": "20" });
  });

  it("não assina com alteração ainda não salva (sem internet): nada se perde", async () => {
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === "carreira_plano_salvar"
          ? { data: null, error: { message: "Failed to fetch" } }
          : { data: "2026-11-20T12:00:00Z", error: null },
      ),
    );
    linhaPlano = { respostas: { "mt.tCapt": "12" }, assinado_corretor_em: null };
    const { result } = renderHook(() => usePlano("u1"));
    await waitFor(() => expect(result.current.plano).not.toBeNull());
    act(() => result.current.set("mt.tCapt", "30"));
    await expect(result.current.assinar()).rejects.toThrow(/Ainda salvando/);
    expect(rpc.mock.calls.filter((c) => c[0] === "carreira_plano_assinar")).toHaveLength(0);
    expect(JSON.parse(window.localStorage.getItem("meu-plano-2027:fila:u1") ?? "{}")).toEqual({
      "mt.tCapt": "30",
    });
  });

  it("ao assinar, trava na hora: a edição seguinte de meta não é enviada", async () => {
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === "carreira_plano_assinar"
          ? { data: "2026-11-20T12:00:00Z", error: null }
          : { data: { status: "gravada", meta: null }, error: null },
      ),
    );
    linhaPlano = { respostas: { "mt.tCapt": "12" }, assinado_corretor_em: null };
    const { result } = renderHook(() => usePlano("u1"));
    await waitFor(() => expect(result.current.plano).not.toBeNull());
    await act(async () => {
      await result.current.assinar();
    });
    act(() => result.current.set("mt.tCapt", "30"));
    await espera(900);
    expect(salvamentos()).toHaveLength(0);
    expect(result.current.plano?.respostas["mt.tCapt"]).toBe("12");
  });
});
