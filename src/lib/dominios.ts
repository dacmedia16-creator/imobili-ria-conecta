/**
 * Endereços oficiais do ecossistema MAX.
 *
 * Histórico: unicaescolha.com.br → somosmaxhub.com.br (t_97380535, 20/10/2026) → somosunihub.com.br
 * (Etapa 2, t_a69e9d11, aprovado por Denis em 01/11/2026: "os antigos têm que redirecionar para o novo").
 *
 * - Portal ADM: app.<domínio principal>
 * - Login Google (Conta MAX): conta.<domínio principal>
 *
 * VIRADA feita em 01/11/2026 (t_0515ccd3, "sim" de Denis): DOMINIO_PRINCIPAL = "somosunihub" e, no
 * wrangler.toml, APP_URL = "https://app.somosunihub.com.br" (o teste dominios.test.ts confere que os dois batem).
 *
 * Convivência: o login e o "sair" seguem o endereço em que a pessoa está (quem abre app.somosunihub entra
 * por conta.somosunihub e volta para app.somosunihub; quem está em app.somosmaxhub segue no somosmaxhub).
 * O convite aceita as TRÊS origens da Conta MAX (convites antigos continuam válidos).
 */
export type DominioMax = "somosmaxhub" | "somosunihub";

export const DOMINIOS: Record<DominioMax, { app: string; conta: string }> = {
  somosmaxhub: {
    app: "https://app.somosmaxhub.com.br",
    conta: "https://conta.somosmaxhub.com.br",
  },
  somosunihub: {
    app: "https://app.somosunihub.com.br",
    conta: "https://conta.somosunihub.com.br",
  },
};

/** Flag da virada: domínio dos links enviados (WhatsApp, e-mail, og:url) e padrão do login. */
export const DOMINIO_PRINCIPAL: DominioMax = "somosunihub";

export const APP_ORIGIN = DOMINIOS[DOMINIO_PRINCIPAL].app;
export const CONTA_MAX_ORIGIN = DOMINIOS[DOMINIO_PRINCIPAL].conta;

/** Origem antiga do login (aceita só durante a convivência). */
export const CONTA_MAX_ORIGIN_ANTIGA = "https://conta.unicaescolha.com.br";

export const CONTA_MAX_ORIGENS_ACEITAS: readonly string[] = [
  CONTA_MAX_ORIGIN,
  ...Object.values(DOMINIOS)
    .map((d) => d.conta)
    .filter((o) => o !== CONTA_MAX_ORIGIN),
  CONTA_MAX_ORIGIN_ANTIGA,
];

export const CONTA_MAX_LOGIN_URL = `${CONTA_MAX_ORIGIN}/login`;
export const CONTA_MAX_LOGOUT_URL = `${CONTA_MAX_ORIGIN}/logout`;

function hostnameAtual(): string | undefined {
  return typeof window !== "undefined" ? window.location?.hostname : undefined;
}

/**
 * Conta MAX do mesmo domínio em que a pessoa está (app.somosunihub → conta.somosunihub).
 * Fora dos domínios oficiais (homologação, localhost, servidor) usa o domínio principal.
 */
export function contaMaxOriginPara(hostname: string | undefined = hostnameAtual()): string {
  const host = (hostname || "").toLowerCase();
  for (const nome of Object.keys(DOMINIOS) as DominioMax[]) {
    if (host === `app.${nome}.com.br`) return DOMINIOS[nome].conta;
  }
  return CONTA_MAX_ORIGIN;
}

/** Link de entrada pelo Google para um app do ecossistema (ex.: "adm-max"). */
export function contaMaxLoginUrl(
  app: string,
  returnTo?: string,
  hostname: string | undefined = hostnameAtual(),
): string {
  const url = new URL(`${contaMaxOriginPara(hostname)}/login`);
  url.searchParams.set("app", app);
  if (returnTo) url.searchParams.set("return_to", returnTo);
  return url.toString();
}

/** "Sair" da Conta MAX no mesmo domínio em que a pessoa está. */
export function contaMaxLogoutUrl(hostname: string | undefined = hostnameAtual()): string {
  return `${contaMaxOriginPara(hostname)}/logout`;
}

/** O link do convite precisa ser o login Google da Conta MAX (em qualquer origem aceita). */
export function isContaMaxLoginUrl(url: URL): boolean {
  return CONTA_MAX_ORIGENS_ACEITAS.includes(url.origin) && url.pathname === "/login";
}
