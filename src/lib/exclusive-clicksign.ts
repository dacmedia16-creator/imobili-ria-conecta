// Fail-closed adapter. No endpoint, credential, fetch or third-party SDK is used here.
// A future automated integration requires a separate authorization and implementation.
export type ClicksignConfig = { mode: "disabled" | "manual" };
export const clicksignConfig: Readonly<ClicksignConfig> = Object.freeze({ mode: "disabled" });
export const clicksignManualInstructions =
  "Integração automática Clicksign desativada. Baixe o contrato gerado, envie-o externamente e anexe aqui o PDF assinado. Nenhuma chamada à Clicksign ocorre nesta aplicação.";

export async function sendToClicksign(
  _captureId: string,
  _config: ClicksignConfig = clicksignConfig,
): Promise<never> {
  throw new Error(
    "Integração automática Clicksign desativada. Baixe o PDF e use o fluxo externo manual.",
  );
}
