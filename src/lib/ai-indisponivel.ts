/**
 * IA de leitura (Gemini) sem crédito (HTTP 402) ou sem cota (HTTP 429).
 *
 * Nos dois casos, tentar de novo na hora não adianta. Por isso, o usuário recebe uma mensagem
 * clara para preencher manualmente, a falha fica registrada com um código identificável e os
 * administradores da plataforma recebem aviso quando ela se repete (ver ai-indisponivel.server.ts).
 */

export const AI_UNAVAILABLE_MESSAGE =
  "Leitura por IA temporariamente indisponível. Preencha manualmente ou tente mais tarde.";

export type AiUnavailableCode = "IA_SEM_CREDITO" | "IA_COTA_EXCEDIDA";

/** 402 = créditos/faturamento esgotados; 429 = limite de uso (cota) atingido. Outros: null. */
export function aiUnavailableCode(status: number): AiUnavailableCode | null {
  if (status === 402) return "IA_SEM_CREDITO";
  if (status === 429) return "IA_COTA_EXCEDIDA";
  return null;
}

export type AiUnavailableError = Error & { aiUnavailable: AiUnavailableCode; httpStatus: number };

export function isAiUnavailableError(err: unknown): err is AiUnavailableError {
  const code = (err as { aiUnavailable?: unknown } | null)?.aiUnavailable;
  return code === "IA_SEM_CREDITO" || code === "IA_COTA_EXCEDIDA";
}

/**
 * Erro da resposta HTTP do Gemini. Inclui `aiUnavailable` em 402/429 e só repete em 5xx.
 * `detail` é o começo do corpo da resposta do Google, que nunca contém a chave. Ela vai no
 * cabeçalho da requisição, e não na resposta.
 */
export function geminiHttpError(status: number, detail = ""): Error & { retryable: boolean } {
  const code = aiUnavailableCode(status);
  const msg = `${code ? `${code}: ` : ""}Gemini ${status}${detail ? `: ${detail}` : ""}`;
  const err = new Error(msg) as Error & {
    retryable: boolean;
    aiUnavailable?: AiUnavailableCode;
    httpStatus: number;
  };
  err.retryable = status >= 500;
  err.httpStatus = status;
  if (code) err.aiUnavailable = code;
  return err;
}

/** Regra do aviso: 3 ou mais falhas 402/429 em 1 hora, no máximo um aviso a cada 6 horas. */
export const AI_ALERT_THRESHOLD = 3;
export const AI_ALERT_WINDOW_MS = 60 * 60 * 1000;
export const AI_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export const AI_FAILURE_ACTION = "ia_leitura_indisponivel";
export const AI_ALERT_ACTION = "ia_alerta_plataforma";
export const AI_ALERT_NOTIFICATION_TYPE = "ia_leitura_indisponivel";

export function shouldAlert(failuresLastHour: number, alertsLastCooldown: number): boolean {
  return failuresLastHour >= AI_ALERT_THRESHOLD && alertsLastCooldown === 0;
}

export function alertText(code: AiUnavailableCode, failures: number) {
  const causa =
    code === "IA_SEM_CREDITO"
      ? "Os créditos do Google Gemini acabaram (erro 402). Recarregue ou ative o faturamento no Google AI Studio."
      : "A cota de uso do Google Gemini foi atingida (erro 429). Verifique os limites no Google AI Studio.";
  return {
    titulo: "Leitura por IA indisponível",
    mensagem: `${failures} leituras falharam na última hora. ${causa} Enquanto isso, os usuários preenchem manualmente.`,
  };
}
