import { describe, expect, it } from "vitest";
import { normalizeReais, typeReais } from "./exclusive-captures";

const nb = (s: string) => s.replace(/\u00a0/g, " ");
describe("valor do imóvel em reais", () => {
  it("formata valores já salvos em vários jeitos", () => {
    expect(nb(normalizeReais("1200000"))).toBe("R$ 1.200.000,00");
    expect(nb(normalizeReais("730.000"))).toBe("R$ 730.000,00");
    expect(nb(normalizeReais("195.000,00"))).toBe("R$ 195.000,00");
    expect(nb(normalizeReais("R$ 870.000,00 "))).toBe("R$ 870.000,00");
    expect(normalizeReais("")).toBe("");
  });
  it("máscara ao digitar trata os números como centavos", () => {
    expect(nb(typeReais("120000000"))).toBe("R$ 1.200.000,00");
    expect(nb(typeReais("R$ 1.200.000,005"))).toBe("R$ 12.000.000,05");
    expect(typeReais("")).toBe("");
  });
});
