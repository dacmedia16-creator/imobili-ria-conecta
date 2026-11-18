import { describe, expect, it, vi } from "vitest";
import { elementoTelaCheia, entrarTelaCheia, sairTelaCheia, suportaTelaCheia } from "./tela-cheia";

describe("tela cheia do leitor do book", () => {
  it("Chrome/Safari desktop: suporta (padrão ou webkit)", () => {
    expect(suportaTelaCheia({ fullscreenEnabled: true }, { requestFullscreen: () => {} })).toBe(
      true,
    );
    expect(
      suportaTelaCheia({ webkitFullscreenEnabled: true }, { webkitRequestFullscreen: () => {} }),
    ).toBe(true);
  });

  it("iPhone (sem fullscreen de elemento), SSR ou iframe sem permissão: esconde o botão", () => {
    expect(suportaTelaCheia({}, {})).toBe(false);
    expect(suportaTelaCheia(undefined)).toBe(false);
    expect(suportaTelaCheia({ fullscreenEnabled: false }, { requestFullscreen: () => {} })).toBe(
      false,
    );
    expect(suportaTelaCheia({ fullscreenEnabled: true }, {})).toBe(false);
  });

  it("entra pelo padrão e cai no webkit quando só ele existe", async () => {
    const padrao = vi.fn(async () => {});
    expect(await entrarTelaCheia({ requestFullscreen: padrao })).toBe(true);
    expect(padrao).toHaveBeenCalledOnce();
    const webkit = vi.fn();
    expect(await entrarTelaCheia({ webkitRequestFullscreen: webkit })).toBe(true);
    expect(webkit).toHaveBeenCalledOnce();
    expect(await entrarTelaCheia({})).toBe(false);
  });

  it("recusa do navegador não quebra a tela", async () => {
    const recusa = vi.fn(async () => {
      throw new TypeError("Permissions check failed");
    });
    expect(await entrarTelaCheia({ requestFullscreen: recusa })).toBe(false);
  });

  it("sai só se estiver em tela cheia", async () => {
    const sair = vi.fn(async () => {});
    await sairTelaCheia({ fullscreenElement: null, exitFullscreen: sair });
    expect(sair).not.toHaveBeenCalled();
    const el = {} as Element;
    expect(elementoTelaCheia({ webkitFullscreenElement: el })).toBe(el);
    await sairTelaCheia({ fullscreenElement: el, exitFullscreen: sair });
    expect(sair).toHaveBeenCalledOnce();
  });
});
