// @vitest-environment jsdom
/**
 * Meu Plano 2027 — assinatura vira a meta anual oficial de 2027 (cartão t_365eb6c2, Denis 11/11).
 * Banco simulado: confere as chamadas que o hook faz (ano 2027, substituir = true) e a ressincronização
 * quando o plano já assinado é alterado. A regra "substitui a manual e não toca 2026" é do próprio
 * carreira_plano_usar_meta (make_date(_ano,1,1)), coberta em supabase/tests/meu_plano_2027.sql.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Respostas } from "./regras";

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

import { metaIgual, usePlano } from "@/components/minha-carreira/meu-plano/usePlano";

const ANA: Respostas = {
  "d.comissao": "210000",
  "d.trans": "11",
  "d.conv": "22",
  "d.ticket": "700000",
  "d.dias": "118",
  "d.ativos": "14",
  "op.0": "3450",
  "op.1": "760",
  "op.2": "1080",
  "op.3": "1600",
  "op.4": "600",
  "op.5": "940",
  "op.6": "110",
  "op.7": "30",
  "on.0": "980",
  "on.1": "200",
  "on.2": "1350",
  "on.3": "59,99",
  "on.4": "570",
  "on.5": "200",
  "so.0.v": "40000",
  "so.1.v": "30000",
  "so.2.v": "5000",
  "es.aliq": "15",
  "m.faixa": "45",
  "m.ticket": "700000",
  "m.pct": "3",
  "m.conv": "22",
  "fu.v2cre": "50",
  "fu.v1v2": "60",
  "fu.folga": "25",
};
const META_ANA = {
  meta_comissao: 588000,
  meta_vgv: 19600000,
  meta_vendas: 28,
  meta_captacoes: 127,
};

function banco() {
  rpc.mockImplementation((fn: string, args: Record<string, unknown>) => {
    if (fn === "carreira_plano_assinar")
      return Promise.resolve({ data: "2026-11-18T13:00:00Z", error: null });
    if (fn === "carreira_plano_usar_meta")
      return Promise.resolve({
        data: {
          status: "gravada",
          meta: {
            meta_comissao: args._comissao,
            meta_vgv: args._vgv,
            meta_vendas: args._vendas,
            meta_captacoes: args._captacoes,
          },
        },
        error: null,
      });
    return Promise.resolve({ data: null, error: null });
  });
}
const chamadasMeta = () => rpc.mock.calls.filter((c) => c[0] === "carreira_plano_usar_meta");

afterEach(() => {
  cleanup();
  rpc.mockReset();
  linhaPlano = null;
  window.localStorage.clear();
});

describe("assinar grava a meta anual oficial de 2027", () => {
  it("assinatura chama usar_meta(2027, …, substituir = true) com o Objetivo do plano", async () => {
    banco();
    linhaPlano = { respostas: ANA, assinado_corretor_em: null, meta_oficial: null };
    const { result } = renderHook(() => usePlano("u1"));
    await waitFor(() => expect(result.current.plano).not.toBeNull());
    expect(chamadasMeta()).toHaveLength(0); // sem assinatura, nada é gravado
    let r: { metaGravada: boolean } | undefined;
    await act(async () => {
      r = await result.current.assinar();
    });
    expect(r?.metaGravada).toBe(true);
    await new Promise((x) => setTimeout(x, 30));
    expect(chamadasMeta()).toHaveLength(1); // sem chamada dupla
    const c = chamadasMeta()[0][1];
    expect(c).toEqual({
      _ano: 2027,
      _comissao: 588000,
      _vgv: 19600000,
      _vendas: 28,
      _captacoes: 127,
      _substituir: true,
    });
    await waitFor(() => expect(result.current.plano?.meta_oficial).toEqual(META_ANA));
  });

  it("plano incompleto: assina sem gravar meta", async () => {
    banco();
    linhaPlano = {
      respostas: { "d.comissao": "1" },
      assinado_corretor_em: null,
      meta_oficial: null,
    };
    const { result } = renderHook(() => usePlano("u1"));
    await waitFor(() => expect(result.current.plano).not.toBeNull());
    let r: { metaGravada: boolean } | undefined;
    await act(async () => {
      r = await result.current.assinar();
    });
    expect(r?.metaGravada).toBe(false);
    expect(chamadasMeta()).toHaveLength(0);
  });

  it("plano assinado e alterado depois: a meta acompanha uma vez e para", async () => {
    banco();
    linhaPlano = {
      respostas: ANA,
      assinado_corretor_em: "2026-11-18T13:00:00Z",
      meta_oficial: { ...META_ANA, meta_comissao: 300000 },
    };
    const { result } = renderHook(() => usePlano("u1"));
    await waitFor(() => expect(chamadasMeta()).toHaveLength(1));
    expect(chamadasMeta()[0][1]).toMatchObject({
      _ano: 2027,
      _comissao: 588000,
      _substituir: true,
    });
    await waitFor(() => expect(result.current.plano?.meta_oficial).toEqual(META_ANA));
    await new Promise((x) => setTimeout(x, 30));
    expect(chamadasMeta()).toHaveLength(1);
  });

  it("plano assinado com meta já igual: não regrava", async () => {
    banco();
    linhaPlano = {
      respostas: ANA,
      assinado_corretor_em: "2026-11-18T13:00:00Z",
      meta_oficial: META_ANA,
    };
    const { result } = renderHook(() => usePlano("u1"));
    await waitFor(() => expect(result.current.plano).not.toBeNull());
    await new Promise((x) => setTimeout(x, 30));
    expect(chamadasMeta()).toHaveLength(0);
  });

  it("metaIgual compara com arredondamento de centavos", () => {
    expect(
      metaIgual(META_ANA, { comissao: 588000, vgv: 19600000, vendas: 28, captacoes: 127 }),
    ).toBe(true);
    expect(metaIgual(null, { comissao: 1, vgv: null, vendas: 1, captacoes: null })).toBe(false);
    expect(
      metaIgual(META_ANA, { comissao: 588001, vgv: 19600000, vendas: 28, captacoes: 127 }),
    ).toBe(false);
  });
});
