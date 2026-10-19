// Assinatura manual (papel) ao lado da Clicksign na VENDA (cartão t_e6f778ac; maquete aprovada por
// Denis em 19/10/2026). Só regras de tela: quem pode e o que mostrar. Quem decide de verdade é o
// banco (validate_sale_status_transition, policies de sale_documents/storage e clicksign_sale_*).
import type { ClicksignSaleConfig, SaleEnvelopeInfo } from "./sale-clicksign";

export type PapeisAssinatura = {
  /** Gestor ou team leader com gestão desta venda (isGestor da tela). */
  isGestor: boolean;
  isJuridico: boolean;
  /** admin ou super_admin. */
  isAdminLike: boolean;
};

export const TEXTO_ORIENTACAO_PAPEL =
  "Imprima, colete as assinaturas e suba o contrato assinado aqui no mesmo dia.";
export const STATUS_AGUARDANDO_MANUAL = "Aguardando assinatura manual";

/**
 * Leva para assinatura no papel, sobe e marca o contrato assinado: gestor, team leader, jurídico e
 * ADM. Corretor não (continua só acompanhando).
 */
export function podeOperarAssinatura(p: PapeisAssinatura): boolean {
  return p.isGestor || p.isJuridico || p.isAdminLike;
}

/** "Devolver ao jurídico" na assinatura continua com gestor/team leader e ADM (regra do banco). */
export function podeDevolverDaAssinatura(p: PapeisAssinatura): boolean {
  return p.isGestor || p.isAdminLike;
}

function envelopeAtivo(e: SaleEnvelopeInfo | null | undefined): boolean {
  return !!e && (e.status === "sending" || e.status === "running");
}

/** A Clicksign está disponível para este usuário enviar nesta venda (org ligada + can_send). */
export function clicksignDisponivel(config: ClicksignSaleConfig): boolean {
  return config.enabled && config.can_send;
}

/**
 * Cartão "Como vai ser assinado?" em contrato_ok_corretor. Só aparece quando há Clicksign para
 * escolher; sem ela, a tela mostra o "Enviar para assinatura" manual de sempre.
 */
export function mostrarEscolhaAssinatura(
  config: ClicksignSaleConfig,
  status: string,
  p: PapeisAssinatura,
): boolean {
  return status === "contrato_ok_corretor" && podeOperarAssinatura(p) && clicksignDisponivel(config);
}

/** Org sem Clicksign (ou usuário sem can_send): botão manual "Enviar para assinatura". */
export function mostrarEnvioManualSimples(
  config: ClicksignSaleConfig,
  status: string,
  p: PapeisAssinatura,
): boolean {
  return status === "contrato_ok_corretor" && podeOperarAssinatura(p) && !clicksignDisponivel(config);
}

/**
 * Em aguardando_assinatura: "clicksign" se há envelope em envio/assinatura; senão é a assinatura
 * manual (papel). Fora dessa etapa: null.
 */
export function modoAssinatura(
  config: ClicksignSaleConfig,
  status: string,
): "clicksign" | "manual" | null {
  if (status !== "aguardando_assinatura") return null;
  return config.enabled && envelopeAtivo(config.envelope) ? "clicksign" : "manual";
}

/** Rótulo do status no topo: "Aguardando assinatura manual" quando é no papel. */
export function rotuloStatusAssinatura(config: ClicksignSaleConfig, status: string): string | null {
  return modoAssinatura(config, status) === "manual" ? STATUS_AGUARDANDO_MANUAL : null;
}

/**
 * Manual → Clicksign: só sem envelope ativo e sem o assinado no papel já anexado (aí é marcar como
 * assinado). O banco confere de novo em clicksign_sale_authorize (sem envio em dobro).
 */
export function podeTrocarParaClicksign(
  config: ClicksignSaleConfig,
  status: string,
  p: PapeisAssinatura,
  temContratoAssinado: boolean,
): boolean {
  return (
    modoAssinatura(config, status) === "manual" &&
    podeOperarAssinatura(p) &&
    clicksignDisponivel(config) &&
    config.enabled &&
    config.libera_assinatura &&
    !temContratoAssinado
  );
}

/** Clicksign → manual: envelope em assinatura (running) e quem pode cancelar (can_send). */
export function podeTrocarParaPapel(config: ClicksignSaleConfig, status: string): boolean {
  return (
    status === "aguardando_assinatura" &&
    clicksignDisponivel(config) &&
    config.enabled &&
    config.envelope?.status === "running"
  );
}
