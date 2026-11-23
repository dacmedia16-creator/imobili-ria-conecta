// @vitest-environment jsdom
/**
 * Campos em R$ do Meu Plano 2027 (t_cd9141ab, Denis 23/11, tópico 6238): o corretor via "400000" cru no
 * "Ticket médio De R$ … a R$ …". Agora o campo mostra "R$ 400.000" (e ",00" quando há centavos) enquanto
 * digita e depois de preenchido, e grava o número puro, lido igual por num() e pelo banco.
 * Campos de % e de quantidade não mudam.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, useState } from "react";
import { calc, num, type Respostas, type Valor } from "./regras";
import { mascaraDinheiro, mostraDinheiro } from "./dinheiro";
import { PlanoCtx } from "@/components/minha-carreira/meu-plano/campos";
import { CorpoTela } from "@/components/minha-carreira/meu-plano/telas";

window.scrollTo = () => undefined;
afterEach(cleanup);

describe("máscara de R$", () => {
  it.each([
    ["400000", "R$ 400.000", "400000"],
    ["400.000", "R$ 400.000", "400000"],
    ["400.000,00", "R$ 400.000,00", "400000"],
    ["400.000,5", "R$ 400.000,5", "400000.5"],
    ["R$ 1.500.000,99", "R$ 1.500.000,99", "1500000.99"],
    ["0", "R$ 0", "0"],
    ["R$ ", "", ""],
    ["", "", ""],
    ["Ainda sem histórico", "", ""],
    ["000123", "R$ 123", "123"],
    [",5", "R$ 0,5", "0.5"],
  ])("%j → mostra %j, grava %j", (bruto, texto, valor) => {
    expect(mascaraDinheiro(bruto)).toEqual({ texto, valor });
    if (valor) expect(num(valor)).toBe(Number(valor));
  });

  it("colado no formato americano (500.00) vira quinhentos, não 50 mil", () => {
    expect(mascaraDinheiro("500.00", true)).toEqual({ texto: "R$ 500,00", valor: "500" });
    expect(mascaraDinheiro("1.500", true).valor).toBe("1500");
  });

  it("valor já gravado aparece formatado; texto antigo aparece como está", () => {
    expect(mostraDinheiro("400000")).toBe("R$ 400.000");
    expect(mostraDinheiro("400.000,00")).toBe("R$ 400.000");
    expect(mostraDinheiro("400000.5")).toBe("R$ 400.000,50");
    expect(mostraDinheiro(700000)).toBe("R$ 700.000");
    expect(mostraDinheiro("Ainda sem histórico ")).toBe("Ainda sem histórico");
    expect(mostraDinheiro("")).toBe("");
    expect(mostraDinheiro(null)).toBe("");
  });
});

function Tela({ id, S0, set }: { id: string; S0: Respostas; set: (k: string, v: Valor) => void }) {
  const [S, setS] = useState<Respostas>(S0);
  const ctx = {
    S,
    C: calc(S),
    set: (k: string, v: Valor) => {
      set(k, v);
      setS((s) => ({ ...s, [k]: v }));
    },
    ro: false,
    inicio: null,
  };
  return createElement(PlanoCtx.Provider, { value: ctx }, createElement(CorpoTela, { id }));
}
const campo = (c: HTMLElement, k: string) => c.querySelector<HTMLInputElement>(`[data-k="${k}"]`)!;

describe("tela do plano (p34, Ticket médio De/a)", () => {
  it("digitar 400000 mostra R$ 400.000 e grava 400000; ao sair do campo continua formatado", () => {
    const set = vi.fn();
    const { container } = render(createElement(Tela, { id: "p34", S0: {}, set }));
    const de = campo(container, "pos.de");
    fireEvent.change(de, { target: { value: "400000" } });
    expect(de.value).toBe("R$ 400.000");
    expect(set).toHaveBeenLastCalledWith("pos.de", "400000");
    fireEvent.blur(de);
    expect(de.value).toBe("R$ 400.000");
    const ate = campo(container, "pos.ate");
    fireEvent.change(ate, { target: { value: "600.000,00" } });
    expect(ate.value).toBe("R$ 600.000,00");
    expect(set).toHaveBeenLastCalledWith("pos.ate", "600000");
  });

  it("valor gravado cru (400000) já abre como R$ 400.000", () => {
    const { container } = render(
      createElement(Tela, {
        id: "p34",
        S0: { "pos.de": "400000", "pos.ate": "600000" },
        set: vi.fn(),
      }),
    );
    expect(campo(container, "pos.de").value).toBe("R$ 400.000");
    expect(campo(container, "pos.ate").value).toBe("R$ 600.000");
  });

  it("campo de % não ganha máscara", () => {
    const set = vi.fn();
    const { container } = render(createElement(Tela, { id: "p34", S0: {}, set }));
    const pct = campo(container, "pos.pctHoje");
    fireEvent.change(pct, { target: { value: "12,5" } });
    expect(pct.value).toBe("12,5");
    expect(set).toHaveBeenLastCalledWith("pos.pctHoje", "12,5");
  });
});
