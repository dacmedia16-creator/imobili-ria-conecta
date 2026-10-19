// Escolha Clicksign × papel na captação (t_e6f778ac): cartão, troca nos dois sentidos, sem envio em dobro.
import { describe, expect, it } from "vitest";
import {
  CLICKSIGN_DISABLED,
  modoAssinaturaCaptacao,
  mostrarEscolhaCaptacao,
  podeTrocarCaptacaoParaClicksign,
  podeTrocarCaptacaoParaPapel,
  type ClicksignCaptureConfig,
  type ClicksignEnvelopeInfo,
} from "./exclusive-clicksign";

const env = (status: ClicksignEnvelopeInfo["status"]): ClicksignEnvelopeInfo => ({
  status,
  is_test: true,
  created_at: "2026-10-19T12:00:00Z",
  error_code: null,
  signed: false,
});
const cfg = (envelope: ClicksignEnvelopeInfo | null, can_send = true): ClicksignCaptureConfig => ({
  enabled: true,
  test_mode: true,
  can_send,
  witnesses: 2,
  deadline_days: 7,
  imobiliaria: [],
  corretor_email_ok: true,
  envelope,
});

describe("modoAssinaturaCaptacao", () => {
  it("fora de em_assinatura não há modo", () => {
    expect(modoAssinaturaCaptacao("enviada", null)).toBeNull();
    expect(modoAssinaturaCaptacao("aprovada", env("closed"))).toBeNull();
  });
  it("em_assinatura com envelope em andamento = Clicksign", () => {
    expect(modoAssinaturaCaptacao("em_assinatura", env("running"))).toBe("clicksign");
    expect(modoAssinaturaCaptacao("em_assinatura", env("sending"))).toBe("clicksign");
  });
  it("em_assinatura sem envelope ou com envelope cancelado = papel", () => {
    expect(modoAssinaturaCaptacao("em_assinatura", null)).toBe("manual");
    expect(modoAssinaturaCaptacao("em_assinatura", env("canceled"))).toBe("manual");
  });
});

describe("cartão Como vai ser assinado?", () => {
  it("aparece para gestor/TL/ADM na captação enviada sem envelope ativo", () => {
    expect(mostrarEscolhaCaptacao("enviada", null, true)).toBe(true);
    expect(mostrarEscolhaCaptacao("enviada", env("canceled"), true)).toBe(true);
  });
  it("não aparece para corretor, nem com envelope em andamento, nem fora de enviada", () => {
    expect(mostrarEscolhaCaptacao("enviada", null, false)).toBe(false);
    expect(mostrarEscolhaCaptacao("enviada", env("running"), true)).toBe(false);
    expect(mostrarEscolhaCaptacao("em_assinatura", null, true)).toBe(false);
    expect(mostrarEscolhaCaptacao("rascunho", null, true)).toBe(false);
  });
});

describe("troca papel → Clicksign", () => {
  it("permitida em assinatura manual sem assinado anexado", () => {
    expect(podeTrocarCaptacaoParaClicksign(cfg(null), "em_assinatura", false)).toBe(true);
    expect(podeTrocarCaptacaoParaClicksign(cfg(env("canceled")), "em_assinatura", false)).toBe(
      true,
    );
  });
  it("bloqueada com assinado no papel já anexado (é conferir e aprovar)", () => {
    expect(podeTrocarCaptacaoParaClicksign(cfg(null), "em_assinatura", true)).toBe(false);
  });
  it("bloqueada com envelope em andamento (sem envio em dobro)", () => {
    expect(podeTrocarCaptacaoParaClicksign(cfg(env("running")), "em_assinatura", false)).toBe(
      false,
    );
    expect(podeTrocarCaptacaoParaClicksign(cfg(env("sending")), "em_assinatura", false)).toBe(
      false,
    );
  });
  it("bloqueada sem permissão de envio ou com Clicksign desligada", () => {
    expect(podeTrocarCaptacaoParaClicksign(cfg(null, false), "em_assinatura", false)).toBe(false);
    expect(podeTrocarCaptacaoParaClicksign(CLICKSIGN_DISABLED, "em_assinatura", false)).toBe(false);
  });
});

describe("troca Clicksign → papel", () => {
  it("permitida com envelope em assinatura e permissão de gerenciar", () => {
    expect(podeTrocarCaptacaoParaPapel(cfg(env("running")), "em_assinatura")).toBe(true);
  });
  it("bloqueada sem envelope em assinatura, sem permissão ou fora de em_assinatura", () => {
    expect(podeTrocarCaptacaoParaPapel(cfg(null), "em_assinatura")).toBe(false);
    expect(podeTrocarCaptacaoParaPapel(cfg(env("canceled")), "em_assinatura")).toBe(false);
    expect(podeTrocarCaptacaoParaPapel(cfg(env("running"), false), "em_assinatura")).toBe(false);
    expect(podeTrocarCaptacaoParaPapel(cfg(env("running")), "enviada")).toBe(false);
    expect(podeTrocarCaptacaoParaPapel(CLICKSIGN_DISABLED, "em_assinatura")).toBe(false);
  });
});
