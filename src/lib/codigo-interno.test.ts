import { describe, expect, it } from "vitest";
import { codigoInternoValido, mascararCodigoInterno } from "./codigo-interno";

describe("mascararCodigoInterno", () => {
  it("insere o hífen depois do 9º dígito", () => {
    expect(mascararCodigoInterno("630591023665")).toBe("630591023-665");
    expect(mascararCodigoInterno("63059126143")).toBe("630591261-43");
    expect(mascararCodigoInterno("6305912981")).toBe("630591298-1");
  });

  it("não insere hífen antes de completar 9 dígitos", () => {
    expect(mascararCodigoInterno("63059")).toBe("63059");
    expect(mascararCodigoInterno("630591023")).toBe("630591023");
  });

  it("aceita só dígitos: remove ponto, espaço, letras e hífen digitado fora do lugar", () => {
    expect(mascararCodigoInterno(".630591260-24")).toBe("630591260-24");
    expect(mascararCodigoInterno("630 591 023-665")).toBe("630591023-665");
    expect(mascararCodigoInterno("63-0591023a665")).toBe("630591023-665");
  });

  it("limita o sufixo a 3 dígitos", () => {
    expect(mascararCodigoInterno("6305910236654")).toBe("630591023-665");
  });

  it("é idempotente sobre um valor já mascarado", () => {
    expect(mascararCodigoInterno("630591023-665")).toBe("630591023-665");
  });
});

describe("codigoInternoValido", () => {
  it("aceita vazio e o padrão completo", () => {
    expect(codigoInternoValido("")).toBe(true);
    expect(codigoInternoValido(null)).toBe(true);
    expect(codigoInternoValido("630591023-665")).toBe(true);
    expect(codigoInternoValido("630591298-1")).toBe(true);
  });

  it("recusa código incompleto ou fora do padrão", () => {
    expect(codigoInternoValido("630591023")).toBe(false);
    expect(codigoInternoValido("630591023-")).toBe(false);
    expect(codigoInternoValido("63059126143")).toBe(false);
    expect(codigoInternoValido(".630591260-24")).toBe(false);
    expect(codigoInternoValido("630591023-6654")).toBe(false);
  });
});
