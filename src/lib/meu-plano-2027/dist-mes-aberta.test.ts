// @vitest-environment jsdom
/**
 * Meu Plano 2027 — "Distribuição mês a mês" já vem aberta (Denis 13/11: "quero que essa venha
 * aberta, não fechada"), e continua podendo fechar/abrir pelo título.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { calc, type Respostas } from "./regras";
import { PlanoCtx } from "@/components/minha-carreira/meu-plano/campos";
import { CorpoTela } from "@/components/minha-carreira/meu-plano/telas";

afterEach(cleanup);

describe("p32 — Distribuição mês a mês", () => {
  it("abre aberta ao entrar na tela e fecha/abre pelo título", () => {
    const S = {} as Respostas;
    const ctx = { S, C: calc(S), set: () => undefined, ro: false, inicio: null };
    render(createElement(PlanoCtx.Provider, { value: ctx }, createElement(CorpoTela, { id: "p32" })));
    const det = screen.getByTestId("dist-mes") as HTMLDetailsElement;
    expect(det.open).toBe(true);
    const titulo = det.querySelector("summary") as HTMLElement;
    fireEvent.click(titulo);
    expect(det.open).toBe(false);
    fireEvent.click(titulo);
    expect(det.open).toBe(true);
  });
});
