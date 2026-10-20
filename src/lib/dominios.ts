/**
 * Endereços oficiais do ecossistema MAX (migração para somosmaxhub.com.br, t_97380535 — Denis 20/10/2026).
 *
 * - Portal ADM: app.somosmaxhub.com.br
 * - Login Google (Conta MAX): conta.somosmaxhub.com.br
 *
 * Convivência de ~60 dias: o domínio antigo (unicaescolha.com.br) continua funcionando e depois passa a
 * redirecionar (301) para o novo. Por isso o convite aceita as DUAS origens da Conta MAX.
 * Depois dos 60 dias (Etapa 4), remover a origem antiga de CONTA_MAX_ORIGENS_ACEITAS.
 */
export const APP_ORIGIN = "https://app.somosmaxhub.com.br";
export const CONTA_MAX_ORIGIN = "https://conta.somosmaxhub.com.br";

/** Origem antiga do login (aceita só durante a convivência). */
export const CONTA_MAX_ORIGIN_ANTIGA = "https://conta.unicaescolha.com.br";

export const CONTA_MAX_ORIGENS_ACEITAS: readonly string[] = [
  CONTA_MAX_ORIGIN,
  CONTA_MAX_ORIGIN_ANTIGA,
];

export const CONTA_MAX_LOGIN_URL = `${CONTA_MAX_ORIGIN}/login`;
export const CONTA_MAX_LOGOUT_URL = `${CONTA_MAX_ORIGIN}/logout`;

/** Link de entrada pelo Google para um app do ecossistema (ex.: "adm-max"). */
export function contaMaxLoginUrl(app: string, returnTo?: string): string {
  const url = new URL(CONTA_MAX_LOGIN_URL);
  url.searchParams.set("app", app);
  if (returnTo) url.searchParams.set("return_to", returnTo);
  return url.toString();
}

/** O link do convite precisa ser o login Google da Conta MAX (em qualquer origem aceita). */
export function isContaMaxLoginUrl(url: URL): boolean {
  return CONTA_MAX_ORIGENS_ACEITAS.includes(url.origin) && url.pathname === "/login";
}
