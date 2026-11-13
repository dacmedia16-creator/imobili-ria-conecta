// @vitest-environment jsdom
/**
 * Meu Plano 2027 — índice de telas (cartão t_0d2a2b8f; caminho único desde t_296fc69e). Dados fictícios.
 * Abre a lista, mostra todas as telas do plano na ordem, marca a atual e o status, e navega.
 */
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IndiceTelas } from "@/components/minha-carreira/meu-plano/IndiceTelas";
import { ORDEM, statusTela } from "./telas";

afterEach(cleanup);

describe("IndiceTelas", () => {
  it("abre, lista as telas do plano na ordem com status e navega ao tocar", () => {
    const irTela = vi.fn();
    const S = { "m.faixa": "60" };
    render(createElement(IndiceTelas, { atual: "p20", S, irTela }));

    expect(screen.queryByTestId("indice-telas")).toBeNull();
    fireEvent.click(screen.getByTestId("abrir-indice"));
    expect(screen.getByTestId("indice-telas")).toBeTruthy();

    const itens = screen.getAllByTestId(/^indice-item-/);
    expect(itens.length).toBe(ORDEM.length);
    expect(itens.map((b) => b.dataset.testid)).toEqual(ORDEM.map((id) => `indice-item-${id}`));

    const atual = screen.getByTestId("indice-item-p20");
    expect(atual.getAttribute("aria-current")).toBe("step");
    expect(atual.textContent).toContain("você está aqui");
    // Status vem da mesma regra do %:
    const st = statusTela("p30", S);
    const rot = st === "ok" ? "preenchida" : st === "parc" ? "em parte" : "vazia";
    expect(screen.getByTestId("indice-item-p30").textContent).toContain(rot);

    fireEvent.click(screen.getByTestId("indice-item-p15"));
    expect(irTela).toHaveBeenCalledWith("p15");
    expect(screen.queryByTestId("indice-telas")).toBeNull();
  });

  it("mostra todas as telas do caminho único (inclui p34–p44 e p49–p51); tocar na atual só fecha", () => {
    const irTela = vi.fn();
    render(createElement(IndiceTelas, { atual: "p22", S: {}, irTela }));
    fireEvent.click(screen.getByTestId("abrir-indice"));
    expect(screen.getAllByTestId(/^indice-item-/).length).toBe(ORDEM.length);
    for (const id of ["p34", "p40", "p44", "p49", "p50", "p51"])
      expect(screen.getByTestId(`indice-item-${id}`)).toBeTruthy();
    fireEvent.click(screen.getByTestId("indice-item-p22"));
    expect(irTela).not.toHaveBeenCalled();
    expect(screen.queryByTestId("indice-telas")).toBeNull();
  });
});
