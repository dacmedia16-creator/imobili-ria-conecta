import { describe, expect, it, vi } from "vitest";
import { clicavelPorTeclado } from "./clicavel";

const evento = (key: string, mesmoAlvo = true) => {
  const alvo = {};
  return {
    key,
    target: alvo,
    currentTarget: mesmoAlvo ? alvo : {},
    preventDefault: vi.fn(),
  } as never;
};

describe("clicavelPorTeclado", () => {
  it("entra no Tab e é anunciado como botão", () => {
    const p = clicavelPorTeclado(() => {}, "Abrir");
    expect(p.role).toBe("button");
    expect(p.tabIndex).toBe(0);
    expect(p["aria-label"]).toBe("Abrir");
  });

  it("abre com Enter e com Espaço", () => {
    const acao = vi.fn();
    const p = clicavelPorTeclado(acao);
    p.onKeyDown(evento("Enter"));
    p.onKeyDown(evento(" "));
    expect(acao).toHaveBeenCalledTimes(2);
  });

  it("ignora outras teclas e teclas de elementos internos", () => {
    const acao = vi.fn();
    const p = clicavelPorTeclado(acao);
    p.onKeyDown(evento("a"));
    p.onKeyDown(evento("Enter", false));
    expect(acao).not.toHaveBeenCalled();
  });
});
