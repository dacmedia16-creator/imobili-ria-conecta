import { redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadMyAccess, onPlatformStateReset, type MyAccess } from "@/lib/platform-context";

/** Login + papéis efetivos do usuário, compartilhados pelas guardas de rota (beforeLoad). */
export type RouteAccess = MyAccess & { userId: string };

/** Vai no contexto do roteador (createRootRouteWithContext): as rotas leem daqui em vez de
 * repetir getSession() + loadMyAccess() a cada navegação. */
export type RouterAuth = { getAccess: () => Promise<RouteAccess | null> };

// Papéis mudam raramente; 60 s evita uma consulta por navegação sem deixar um cargo removido
// valendo por muito tempo. O banco (RLS/RPC) continua sendo a proteção real dos dados.
const TTL_MS = 60_000;
let cache: { uid: string; at: number; promise: Promise<MyAccess> } | null = null;
let listening = false;

/** Descarta os papéis em cache (troca de login, entrada/saída de imobiliária, refreshRoles). */
export function clearRouteAccessCache() {
  cache = null;
}
onPlatformStateReset(clearRouteAccessCache);

export async function getRouteAccess(now = Date.now()): Promise<RouteAccess | null> {
  if (!listening && typeof window !== "undefined") {
    listening = true;
    supabase.auth.onAuthStateChange((event) => {
      if (event !== "TOKEN_REFRESHED") clearRouteAccessCache();
    });
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    clearRouteAccessCache();
    return null;
  }
  const uid = session.user.id;
  if (!cache || cache.uid !== uid || now - cache.at > TTL_MS) {
    const promise = loadMyAccess(uid);
    cache = { uid, at: now, promise };
    // Erro de leitura não fica em cache: a próxima navegação tenta de novo.
    promise.then(
      (a) => {
        if (a.error && cache?.promise === promise) cache = null;
      },
      () => {
        if (cache?.promise === promise) cache = null;
      },
    );
  }
  return { ...(await cache.promise), userId: uid };
}

export const routerAuth: RouterAuth = { getAccess: () => getRouteAccess() };

type GuardOpts = {
  /** Erro ao ler os papéis bloqueia a rota (falha fechada). */
  denyOnError?: boolean;
  /** Mostra "Acesso não autorizado." ao redirecionar (padrão: sim). */
  notify?: boolean;
};

/** Guarda padrão de beforeLoad: sem login → /auth; sem o cargo → /dashboard. */
export async function requireRoles(
  auth: RouterAuth,
  allow: (roles: string[]) => boolean,
  { denyOnError = false, notify = true }: GuardOpts = {},
): Promise<RouteAccess> {
  const access = await auth.getAccess();
  if (!access) throw redirect({ to: "/auth" });
  if ((denyOnError && access.error) || !allow(access.roles)) {
    if (notify) toast.error("Acesso não autorizado.");
    throw redirect({ to: "/dashboard" });
  }
  return access;
}

/** Atalho para regras do tipo "qualquer um destes cargos". */
export const anyOf =
  (...allowed: string[]) =>
  (roles: string[]) =>
    roles.some((r) => allowed.includes(r));
