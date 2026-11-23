// @vitest-environment jsdom
/**
 * Trava do campo "Comissão média por transação" (p32) — Denis, 19/11, t_c14dccfe.
 * "40%" é recusado com mensagem; 500 mostra aviso (sem bloquear); 12000 sem aviso;
 * plano antigo com valor baixo só mostra o aviso, sem gravar nada.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { calc, type Respostas } from "./regras";
import { PlanoCtx } from "@/components/minha-carreira/meu-plano/campos";
import { CorpoTela } from "@/components/minha-carreira/meu-plano/telas";
import { comissaoBaixa, MSG_COMISSAO_BAIXA, MSG_COMISSAO_PCT, temPorcento } from "./comissao";

const S: Respostas = {
  "d.conv": "42",
  "d.ticket": "700.000",
  "d.dias": "90",
  "d.ativos": "15",
  "op.0": "3.000",
  "es.aliq": "10",
  "m.faixa": "60",
  "m.pct": "3",
};

window.scrollTo = () => undefined;
afterEach(cleanup);

function p32(R: Respostas = S, ro = false) {
  const set = vi.fn();
  render(
    createElement(
      PlanoCtx.Provider,
      { value: { S: R, C: calc(R), set, ro, inicio: null } },
      createElement(CorpoTela, { id: "p32" }),
    ),
  );
  const campo = document.querySelector("input[data-k='mt.comMedia']") as HTMLInputElement;
  return { set, campo };
}
const gravouComissao = (set: ReturnType<typeof vi.fn>) =>
  set.mock.calls.filter(([k]) => k === "mt.comMedia");

describe("regra da comissão em reais", () => {
  it("% é detectado; abaixo de R$ 1.000 é baixo; vazio não avisa", () => {
    expect(temPorcento("40%")).toBe(true);
    expect(temPorcento("12.000")).toBe(false);
    expect(comissaoBaixa("500")).toBe(true);
    expect(comissaoBaixa("999,99")).toBe(true);
    expect(comissaoBaixa("1.000")).toBe(false);
    expect(comissaoBaixa("12000")).toBe(false);
    expect(comissaoBaixa("")).toBe(false);
    expect(comissaoBaixa(undefined)).toBe(false);
  });
});

describe("tela Metas (p32): campo Comissão média por transação", () => {
  it('"40%" é recusado: não grava e mostra a mensagem', () => {
    const { set, campo } = p32();
    fireEvent.change(campo, { target: { value: "40%" } });
    expect(gravouComissao(set)).toHaveLength(0);
    expect(screen.getByTestId("aviso-pct-mt.comMedia").textContent).toBe(MSG_COMISSAO_PCT);
    // Depois, digitar em reais volta a gravar e a mensagem some.
    fireEvent.change(campo, { target: { value: "12000" } });
    expect(gravouComissao(set)).toEqual([["mt.comMedia", "12000"]]);
    expect(screen.queryByTestId("aviso-pct-mt.comMedia")).toBeNull();
  });

  it("% recusado também quando o campo já tem valor", () => {
    const { set, campo } = p32({ ...S, "mt.comMedia": "4" });
    fireEvent.change(campo, { target: { value: "40%" } });
    expect(gravouComissao(set)).toHaveLength(0);
    expect(screen.getByTestId("aviso-pct-mt.comMedia")).toBeTruthy();
  });

  it("500 mostra o aviso de valor baixo, mas grava (não bloqueia)", () => {
    const { set, campo } = p32();
    fireEvent.change(campo, { target: { value: "500" } });
    expect(gravouComissao(set)).toEqual([["mt.comMedia", "500"]]);
    cleanup();
    p32({ ...S, "mt.comMedia": "500" });
    expect(screen.getByTestId("aviso-baixo-mt.comMedia").textContent).toBe(MSG_COMISSAO_BAIXA);
  });

  it("12000 sem aviso", () => {
    p32({ ...S, "mt.comMedia": "12000" });
    expect(screen.queryByTestId("aviso-baixo-mt.comMedia")).toBeNull();
    expect(screen.queryByTestId("aviso-pct-mt.comMedia")).toBeNull();
  });

  it("plano antigo com valor baixo (ex.: 40 gravado): só aviso ao abrir, nada é gravado", () => {
    const { set, campo } = p32({ ...S, "mt.comMedia": "40" });
    expect(campo.value).toBe("R$ 40"); // campo em R$ mostra formatado (t_cd9141ab); o gravado não muda
    expect(screen.getByTestId("aviso-baixo-mt.comMedia")).toBeTruthy();
    expect(set).not.toHaveBeenCalled();
  });

  it("campo vazio (sugestão) não mostra aviso nem mensagem", () => {
    p32();
    expect(screen.queryByTestId("aviso-baixo-mt.comMedia")).toBeNull();
    expect(screen.queryByTestId("aviso-pct-mt.comMedia")).toBeNull();
  });
});
