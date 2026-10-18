import { describe, expect, it } from "vitest";
import { signerStatusLabel, signerStatusOf } from "./clicksign-signer-status";

describe("status por signatário (captação e venda)", () => {
  it("assinou prevalece sobre abriu", () => {
    expect(signerStatusOf({ signed: true, opened: true })).toBe("assinou");
    expect(signerStatusLabel({ signed: true })).toBe("Assinou");
  });
  it("abriu o contrato sem assinar", () => {
    expect(signerStatusOf({ signed: false, opened: true })).toBe("abriu");
    expect(signerStatusLabel({ status: "abriu", signed: false })).toBe("Abriu o contrato");
  });
  it("captação antiga, sem eventos (resposta sem opened/status): só Enviado ou Assinou", () => {
    expect(signerStatusLabel({ signed: false })).toBe("Enviado");
    expect(signerStatusLabel({ signed: true })).toBe("Assinou");
    expect(signerStatusLabel({})).toBe("Enviado");
  });
  it("não inventa status de e-mail não entregue", () => {
    expect(signerStatusLabel({ status: "bounce" })).toBe("Enviado");
  });
});
