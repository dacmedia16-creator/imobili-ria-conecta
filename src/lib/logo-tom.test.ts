import { describe, expect, it } from "vitest";
import { plaquinhaDoLogo, tomDosPixels } from "./logo-tom";

const px = (...cores: [number, number, number, number][]) => cores.flat();

describe("tomDosPixels", () => {
  it("logo escuro (azul-marinho) é escuro", () => {
    expect(tomDosPixels(px([10, 30, 90, 255], [20, 40, 100, 255]))).toBe("escuro");
  });
  it("logo branco é claro", () => {
    expect(tomDosPixels(px([255, 255, 255, 255], [240, 240, 240, 255]))).toBe("claro");
  });
  it("ignora o fundo transparente", () => {
    // Fundo transparente "preto" não puxa a média para baixo.
    expect(tomDosPixels(px([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [255, 255, 255, 255]))).toBe(
      "claro",
    );
  });
  it("imagem toda transparente é indefinida", () => {
    expect(tomDosPixels(px([255, 255, 255, 0]))).toBeNull();
  });
});

describe("plaquinhaDoLogo", () => {
  it("fundo escuro: plaquinha clara para logo escuro, falha ou indefinido", () => {
    expect(plaquinhaDoLogo("escuro", "escuro")).toBe("clara");
    expect(plaquinhaDoLogo("escuro", null)).toBe("clara");
    expect(plaquinhaDoLogo("escuro", "claro")).toBeNull();
  });
  it("fundo claro: plaquinha escura só para logo claro", () => {
    expect(plaquinhaDoLogo("claro", "claro")).toBe("escura");
    expect(plaquinhaDoLogo("claro", "escuro")).toBeNull();
    expect(plaquinhaDoLogo("claro", null)).toBeNull();
  });
});
