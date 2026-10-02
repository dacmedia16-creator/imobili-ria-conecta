/**
 * Contexto do super-admin da PLATAFORMA dentro de uma imobiliária (Parte 2/3).
 *
 * O banco é a autoridade: `platform_enter_org` / `platform_exit_org` / `platform_current_org`
 * (migration 20261002000002_mt_platform_context). O contexto fica preso à sessão de login e
 * expira em 8h. Aqui ficam só as regras puras de tela e um cache por carregamento de página.
 *
 * Papéis no contexto são VIRTUAIS (nada é gravado em user_roles): o banco responde has_role = true
 * para o ator; a tela mostra o menu de administrador da imobiliária.
 */
import { supabase } from "@/integrations/supabase/client";

export const CONTEXT_ROLES = ["super_admin", "admin"] as const;
export const PLATFORM_PANEL_PATH = "/plataforma/imobiliarias";
export const CONTEXT_EXPIRED_KEY = "adm-max:platform-context-expired:v1";

export type PlatformContext = {
  organizationId: string;
  organizationName: string;
  expiresAt: string;
};

export type PlatformState = { isPlatformAdmin: boolean; context: PlatformContext | null };

/** Converte o jsonb da RPC; qualquer formato inesperado = sem contexto (falha fechada). */
export function parsePlatformContext(raw: unknown): PlatformContext | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.organization_id !== "string" || typeof r.expires_at !== "string") return null;
  if (Number.isNaN(Date.parse(r.expires_at))) return null;
  return {
    organizationId: r.organization_id,
    organizationName: typeof r.organization_name === "string" ? r.organization_name : "imobiliária",
    expiresAt: r.expires_at,
  };
}

export function isContextExpired(ctx: PlatformContext | null, now = Date.now()): boolean {
  return !ctx || Date.parse(ctx.expiresAt) <= now;
}

/** Papéis que a tela usa: no contexto, os virtuais; fora dele, os reais do usuário. */
export function effectiveRoles<T extends string>(real: T[], ctx: PlatformContext | null): T[] {
  return ctx ? ([...CONTEXT_ROLES] as unknown as T[]) : real;
}

export function contextBannerText(ctx: PlatformContext): string {
  return `Você está vendo a ${ctx.organizationName}`;
}

/** "14:30" no fuso de São Paulo (horário em que o acesso expira). */
export function formatContextExpiry(ctx: PlatformContext): string {
  return new Date(ctx.expiresAt).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export { isMissingRpc } from "@/lib/rpc-errors";

let cache: { uid: string; promise: Promise<PlatformState> } | null = null;

async function queryPlatformState(): Promise<PlatformState> {
  const { data: isAdmin, error } = await supabase.rpc("is_platform_super_admin");
  // Usuário comum: uma única chamada (a mesma que o menu já fazia) e nada muda para ele.
  if (error || isAdmin !== true) return { isPlatformAdmin: false, context: null };
  const res = await (
    supabase.rpc as unknown as (
      fn: string,
    ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
  )("platform_current_org");
  if (res.error) return { isPlatformAdmin: true, context: null };
  const ctx = parsePlatformContext(res.data);
  return { isPlatformAdmin: true, context: isContextExpired(ctx) ? null : ctx };
}

/** Estado da plataforma do usuário logado, com cache por carregamento de página. */
export function fetchPlatformState(
  uid: string,
  opts: { force?: boolean } = {},
): Promise<PlatformState> {
  if (!opts.force && cache?.uid === uid) {
    return cache.promise.then((s) =>
      s.context && isContextExpired(s.context) ? { ...s, context: null } : s,
    );
  }
  const promise = queryPlatformState().catch(() => ({ isPlatformAdmin: false, context: null }));
  cache = { uid, promise };
  return promise;
}

export function clearPlatformStateCache() {
  cache = null;
}

export type MyAccess = { roles: string[]; inPlatformContext: boolean; error: boolean };

/** Papéis efetivos para guardas de rota (substitui a leitura direta de user_roles). */
export async function loadMyAccess(uid: string): Promise<MyAccess> {
  const [{ data, error }, state] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", uid),
    fetchPlatformState(uid),
  ]);
  const real = (data ?? []).map((r) => r.role as string);
  return {
    roles: effectiveRoles(real, state.context),
    inPlatformContext: state.context !== null,
    error: Boolean(error) && state.context === null,
  };
}

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<RpcResult>)(
    fn,
    args,
  );

export function friendlyContextError(message: string): string {
  if (/sessao de autenticacao/i.test(message))
    return "Sua sessão de login expirou. Entre novamente.";
  if (/imobiliaria indisponivel/i.test(message))
    return "Imobiliária indisponível (suspensa ou inexistente).";
  if (/42501|apenas administrador/i.test(message))
    return "Somente o super-admin da plataforma pode entrar em uma imobiliária.";
  return message;
}

export async function enterOrganization(orgId: string): Promise<PlatformContext> {
  const { data, error } = await rpc("platform_enter_org", { org_id: orgId });
  if (error)
    throw new Error(friendlyContextError(`${error.message ?? ""} ${error.code ?? ""}`.trim()));
  const ctx = parsePlatformContext(data);
  if (!ctx) throw new Error("O banco não confirmou a entrada na imobiliária.");
  clearPlatformStateCache();
  return ctx;
}

export async function exitOrganization(): Promise<void> {
  const { error } = await rpc("platform_exit_org");
  clearPlatformStateCache();
  if (error)
    throw new Error(friendlyContextError(`${error.message ?? ""} ${error.code ?? ""}`.trim()));
}

/** Marca que o contexto expirou para o Painel mostrar o aviso uma vez. */
export function flagContextExpired(name: string) {
  try {
    window.sessionStorage.setItem(CONTEXT_EXPIRED_KEY, name);
  } catch {
    /* sem sessionStorage: só não mostra o aviso */
  }
}

export function takeContextExpiredFlag(): string | null {
  try {
    const v = window.sessionStorage.getItem(CONTEXT_EXPIRED_KEY);
    if (v !== null) window.sessionStorage.removeItem(CONTEXT_EXPIRED_KEY);
    return v;
  } catch {
    return null;
  }
}
