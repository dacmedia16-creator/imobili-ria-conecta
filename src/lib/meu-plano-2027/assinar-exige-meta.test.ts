// @vitest-environment jsdom
/**
 * Só assina com a meta oficial calculada (cartão t_3d55d20c, Denis 23/11/2026).
 * - regra pura faltaParaMeta = metaOficialDoPlano(calc()) null, conferida com os casos compartilhados com o SQL;
 * - tela p45: "Assinar como corretor" desabilitado sem meta, com o que falta e o link para a tela Metas;
 *   com a meta calculada, assina normalmente; a trava dos valores em vermelho continua valendo;
 * - hook: não chama carreira_plano_assinar sem meta (mesmo se alguém pular o botão);
 * - erroPlano traduz a recusa nova do banco.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { calc, metaOficialDoPlano, type Respostas } from "./regras";
import { faltaParaMeta, metaCalculada, msgFaltaMeta } from "./meta-calculavel";
import CASOS from "./meta-calculavel.casos.json";

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
const toastErro = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastErro(...a), success: vi.fn(), info: vi.fn() },
}));

import { usePlano } from "@/components/minha-carreira/meu-plano/usePlano";
import { MeuPlano, type Vista } from "@/components/minha-carreira/meu-plano/MeuPlano";
import { erroPlano } from "./modulo";

// Plano com o pacto preenchido, mas SEM captação e SEM comissão média (nem ticket/% nem estilo de vida).
const SEM_META: Respostas = { "mt.creFim": "20", "pq.frase": "Minha família", "m.conv": "22" };
const COM_META: Respostas = {
  ...SEM_META,
  "mt.tCapt": "12",
  "mt.tVenda": "8",
  "mt.comMedia": "15000",
};
// Meta calculada, mas com valor em vermelho (42.000 captações): continua travado pela conferência.
const VERMELHO: Respostas = { ...SEM_META, "mt.tCapt": "42.000", "mt.comMedia": "15000" };

function banco() {
  rpc.mockImplementation((fn: string) => {
    if (fn === "carreira_plano_assinar")
      return Promise.resolve({ data: "2026-11-23T13:00:00Z", error: null });
    if (fn === "carreira_plano_usar_meta")
      return Promise.resolve({ data: { status: "gravada", meta: null }, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}
const assinaturas = () => rpc.mock.calls.filter((c) => c[0] === "carreira_plano_assinar");

window.scrollTo = () => undefined;
afterEach(() => {
  cleanup();
  rpc.mockReset();
  toastErro.mockReset();
  linhaPlano = null;
  window.localStorage.clear();
});

describe("regra única: pode assinar = meta oficial calculada", () => {
  it.each(CASOS as { nome: string; r: Respostas; falta: string[] }[])("$nome", ({ r, falta }) => {
    expect(faltaParaMeta(r).map((f) => f.campo)).toEqual(falta);
    // Nunca diverge de metaOficialDoPlano (a meta que a assinatura grava).
    expect(metaCalculada(r)).toBe(metaOficialDoPlano(calc(r)) !== null);
  });

  it("as taxas do funil da imobiliária não mudam a meta (por isso o banco não precisa delas)", () => {
    for (const c of CASOS as { r: Respostas }[]) {
      const a = metaOficialDoPlano(calc(c.r));
      const b = metaOficialDoPlano(calc(c.r, { v2cre: 10, v1v2: 90, folga: 0 }));
      expect(b).toEqual(a);
    }
  });

  it("mensagem diz o que falta", () => {
    expect(msgFaltaMeta(faltaParaMeta(SEM_META))).toBe(
      "Para assinar, falta a meta oficial: complete transações de captação e comissão média por transação na tela Metas.",
    );
    expect(msgFaltaMeta([])).toBe("");
  });
});

function tela(r: Respostas, id = "p45") {
  linhaPlano = { respostas: r, assinado_corretor_em: null, meta_oficial: null };
  const ir = vi.fn();
  const vista: Vista = { v: "tela", id };
  render(createElement(MeuPlano, { userId: "u1", vista, ir }));
  return ir;
}
const botao = () => screen.findByTestId("assinar-pacto") as Promise<HTMLButtonElement>;

describe("tela de assinatura (p45)", () => {
  it("sem captação e comissão média: botão desabilitado, mostra o que falta e leva à tela Metas", async () => {
    banco();
    const ir = tela(SEM_META);
    const b = await botao();
    expect(b.disabled).toBe(true);
    const aviso = await screen.findByTestId("falta-meta-assinatura");
    expect(aviso.textContent).toMatch(/falta a meta oficial/i);
    expect(aviso.textContent).toMatch(/Transações de captação/);
    expect(aviso.textContent).toMatch(/Comissão média/);
    fireEvent.click(screen.getByRole("button", { name: "Ir para a tela Metas" }));
    expect(ir).toHaveBeenCalledWith({ v: "tela", id: "p32" });
    fireEvent.click(b);
    await new Promise((x) => setTimeout(x, 50));
    expect(assinaturas()).toHaveLength(0);
  });

  it("com a meta calculada: botão habilitado e assina normalmente", async () => {
    banco();
    tela(COM_META);
    const b = await botao();
    expect(b.disabled).toBe(false);
    expect(screen.queryByTestId("falta-meta-assinatura")).toBeNull();
    await act(async () => {
      fireEvent.click(b);
    });
    await waitFor(() => expect(assinaturas()).toHaveLength(1));
  });

  it("valor em vermelho continua travando, mesmo com a meta calculada", async () => {
    banco();
    tela(VERMELHO);
    const b = await botao();
    expect(b.disabled).toBe(true);
    expect(await screen.findByTestId("bloqueio-assinatura")).toBeTruthy();
    expect(screen.queryByTestId("falta-meta-assinatura")).toBeNull();
  });

  it("tela Metas (p32) também avisa que sem meta não dá para assinar", async () => {
    banco();
    tela(SEM_META, "p32");
    expect(await screen.findByTestId("falta-meta-assinatura")).toBeTruthy();
  });
});

describe("hook: não chama o banco sem meta", () => {
  it("assinar() recusa com a mensagem e não chama carreira_plano_assinar", async () => {
    banco();
    linhaPlano = { respostas: SEM_META, assinado_corretor_em: null, meta_oficial: null };
    const { result } = renderHook(() => usePlano("u1"));
    await waitFor(() => expect(result.current.plano).not.toBeNull());
    await expect(result.current.assinar()).rejects.toThrow(/falta a meta oficial/);
    expect(assinaturas()).toHaveLength(0);
  });
});

describe("erroPlano traduz a recusa do banco", () => {
  it("Plano sem meta calculada", () => {
    expect(
      erroPlano(
        "Plano sem meta calculada: falta transações de captação e comissão média por transação. Complete na tela Metas antes de assinar.",
      ),
    ).toBe(
      "Para assinar, falta a meta oficial: complete transações de captação e comissão média por transação na tela Metas.",
    );
  });
});
