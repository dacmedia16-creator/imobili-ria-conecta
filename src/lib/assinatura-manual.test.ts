// Assinatura manual (papel) × Clicksign na venda — regras de tela por papel (t_e6f778ac).
import { describe, expect, it } from "vitest";
import {
  modoAssinatura,
  mostrarEnvioManualSimples,
  mostrarEscolhaAssinatura,
  podeDevolverDaAssinatura,
  podeOperarAssinatura,
  podeTrocarParaClicksign,
  podeTrocarParaPapel,
  rotuloStatusAssinatura,
  STATUS_AGUARDANDO_MANUAL,
  type PapeisAssinatura,
} from "./assinatura-manual";
import {
  SALE_CLICKSIGN_DISABLED,
  type ClicksignSaleConfig,
  type SaleEnvelopeInfo,
} from "./sale-clicksign";

const P = {
  gestor: { isGestor: true, isJuridico: false, isAdminLike: false },
  teamLeader: { isGestor: true, isJuridico: false, isAdminLike: false },
  juridico: { isGestor: false, isJuridico: true, isAdminLike: false },
  adm: { isGestor: false, isJuridico: false, isAdminLike: true },
  corretor: { isGestor: false, isJuridico: false, isAdminLike: false },
} satisfies Record<string, PapeisAssinatura>;

const env = (status: SaleEnvelopeInfo["status"]): SaleEnvelopeInfo => ({
  status,
  is_test: true,
  created_at: "2026-10-19T12:00:00Z",
  error_code: null,
  signed: false,
});
const cs = (over: Partial<Extract<ClicksignSaleConfig, { enabled: true }>> = {}): ClicksignSaleConfig => ({
  enabled: true,
  test_mode: true,
  can_send: true,
  witnesses: 2,
  deadline_days: 30,
  libera_assinatura: true,
  contrato: { id: "doc", file_name: "contrato.pdf" },
  imobiliaria: [],
  corretores: [],
  envelope: null,
  ...over,
});

describe("assinatura manual: quem pode", () => {
  it("gestor, team leader, jurídico e ADM operam; corretor não", () => {
    expect(podeOperarAssinatura(P.gestor)).toBe(true);
    expect(podeOperarAssinatura(P.teamLeader)).toBe(true);
    expect(podeOperarAssinatura(P.juridico)).toBe(true);
    expect(podeOperarAssinatura(P.adm)).toBe(true);
    expect(podeOperarAssinatura(P.corretor)).toBe(false);
  });
  it("devolver ao jurídico segue com gestor/TL e ADM (jurídico não)", () => {
    expect(podeDevolverDaAssinatura(P.gestor)).toBe(true);
    expect(podeDevolverDaAssinatura(P.adm)).toBe(true);
    expect(podeDevolverDaAssinatura(P.juridico)).toBe(false);
    expect(podeDevolverDaAssinatura(P.corretor)).toBe(false);
  });
});

describe("assinatura manual: escolha Clicksign ou papel (contrato_ok_corretor)", () => {
  it("com Clicksign ligada: cartão de escolha para gestor, jurídico e ADM; nada para o corretor", () => {
    for (const p of [P.gestor, P.juridico, P.adm]) {
      expect(mostrarEscolhaAssinatura(cs(), "contrato_ok_corretor", p)).toBe(true);
      expect(mostrarEnvioManualSimples(cs(), "contrato_ok_corretor", p)).toBe(false);
    }
    expect(mostrarEscolhaAssinatura(cs({ can_send: false }), "contrato_ok_corretor", P.corretor)).toBe(false);
    expect(mostrarEnvioManualSimples(cs({ can_send: false }), "contrato_ok_corretor", P.corretor)).toBe(false);
  });
  it("sem Clicksign na org: volta o botão manual de sempre (sem cartão de escolha)", () => {
    expect(mostrarEscolhaAssinatura(SALE_CLICKSIGN_DISABLED, "contrato_ok_corretor", P.gestor)).toBe(false);
    expect(mostrarEnvioManualSimples(SALE_CLICKSIGN_DISABLED, "contrato_ok_corretor", P.gestor)).toBe(true);
    expect(mostrarEnvioManualSimples(SALE_CLICKSIGN_DISABLED, "contrato_ok_corretor", P.juridico)).toBe(true);
  });
  it("fora de contrato_ok_corretor não mostra a escolha", () => {
    expect(mostrarEscolhaAssinatura(cs(), "aguardando_assinatura", P.gestor)).toBe(false);
    expect(mostrarEscolhaAssinatura(cs(), "em_elaboracao_contrato", P.juridico)).toBe(false);
  });
});

describe("assinatura manual: status e troca de ideia (aguardando_assinatura)", () => {
  it("sem envelope ativo = manual, com rótulo 'Aguardando assinatura manual'", () => {
    expect(modoAssinatura(cs(), "aguardando_assinatura")).toBe("manual");
    expect(modoAssinatura(SALE_CLICKSIGN_DISABLED, "aguardando_assinatura")).toBe("manual");
    expect(modoAssinatura(cs({ envelope: env("canceled") }), "aguardando_assinatura")).toBe("manual");
    expect(rotuloStatusAssinatura(cs(), "aguardando_assinatura")).toBe(STATUS_AGUARDANDO_MANUAL);
  });
  it("envelope em envio/assinatura = Clicksign (sem rótulo manual)", () => {
    expect(modoAssinatura(cs({ envelope: env("running") }), "aguardando_assinatura")).toBe("clicksign");
    expect(modoAssinatura(cs({ envelope: env("sending") }), "aguardando_assinatura")).toBe("clicksign");
    expect(rotuloStatusAssinatura(cs({ envelope: env("running") }), "aguardando_assinatura")).toBeNull();
    expect(modoAssinatura(cs(), "contrato_ok_corretor")).toBeNull();
  });
  it("manual → Clicksign: sem envelope e sem assinado anexado; corretor nunca", () => {
    expect(podeTrocarParaClicksign(cs(), "aguardando_assinatura", P.juridico, false)).toBe(true);
    expect(podeTrocarParaClicksign(cs(), "aguardando_assinatura", P.gestor, false)).toBe(true);
    expect(podeTrocarParaClicksign(cs(), "aguardando_assinatura", P.gestor, true)).toBe(false);
    expect(podeTrocarParaClicksign(cs({ envelope: env("running") }), "aguardando_assinatura", P.gestor, false)).toBe(false);
    expect(podeTrocarParaClicksign(cs({ libera_assinatura: false }), "aguardando_assinatura", P.gestor, false)).toBe(false);
    expect(podeTrocarParaClicksign(SALE_CLICKSIGN_DISABLED, "aguardando_assinatura", P.gestor, false)).toBe(false);
    expect(podeTrocarParaClicksign(cs({ can_send: false }), "aguardando_assinatura", P.corretor, false)).toBe(false);
  });
  it("Clicksign → papel: só com envelope em assinatura e quem pode enviar", () => {
    expect(podeTrocarParaPapel(cs({ envelope: env("running") }), "aguardando_assinatura")).toBe(true);
    expect(podeTrocarParaPapel(cs({ envelope: env("sending") }), "aguardando_assinatura")).toBe(false);
    expect(podeTrocarParaPapel(cs({ envelope: env("running"), can_send: false }), "aguardando_assinatura")).toBe(false);
    expect(podeTrocarParaPapel(cs(), "aguardando_assinatura")).toBe(false);
  });
});
