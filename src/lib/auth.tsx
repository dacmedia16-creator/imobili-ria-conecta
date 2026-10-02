import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  IMPERSONATION_EVENT,
  impersonationMatchesSession,
  readOperationalImpersonation,
  writeOperationalImpersonation,
  type OperationalImpersonation,
} from "@/lib/user-impersonation";
import { restoreOperationalImpersonation } from "@/lib/user-impersonation.functions";
import { effectiveRoles, fetchPlatformState, type PlatformContext } from "@/lib/platform-context";

export type AppRole =
  | "corretor"
  | "gestor"
  | "team_leader"
  | "juridico"
  | "financeiro"
  | "admin"
  | "super_admin"
  | "lancamento"
  | "staff";

type AuthCtx = {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  loading: boolean;
  hasRole: (r: AppRole) => boolean;
  hasAny: (r: AppRole[]) => boolean;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
  impersonation: OperationalImpersonation | null;
  restoreSuperAdmin: () => Promise<void>;
  /** Super-admin da PLATAFORMA (platform_admins). Só controla a tela; o banco decide. */
  platformAdmin: boolean;
  /** Contexto ativo do super-admin da plataforma numa imobiliária (null = fora). */
  platformContext: PlatformContext | null;
  /** true depois que o estado da plataforma foi lido (evita piscar a faixa/redirecionar cedo). */
  platformReady: boolean;
  refreshPlatform: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [impersonation, setImpersonation] = useState<OperationalImpersonation | null>(null);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [platformContext, setPlatformContext] = useState<PlatformContext | null>(null);
  const [platformReady, setPlatformReady] = useState(false);
  const restoreImpersonationFn = useServerFn(restoreOperationalImpersonation);

  // Papéis reais (user_roles) + estado da plataforma. No contexto de uma imobiliária, os papéis
  // são os VIRTUAIS de administrador que o banco concede ao ator (nada é gravado em user_roles).
  const loadRoles = async (uid: string | undefined, force = false) => {
    if (!uid) {
      setRoles([]);
      setPlatformAdmin(false);
      setPlatformContext(null);
      setPlatformReady(true);
      return;
    }
    const [{ data }, state] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", uid),
      fetchPlatformState(uid, { force }),
    ]);
    setPlatformAdmin(state.isPlatformAdmin);
    setPlatformContext(state.context);
    setRoles(
      effectiveRoles(
        (data ?? []).map((r) => r.role as AppRole),
        state.context,
      ),
    );
    setPlatformReady(true);
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
      setTimeout(() => {
        loadRoles(s?.user.id);
      }, 0);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      loadRoles(data.session?.user.id).finally(() => setLoading(false));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const sync = () => setImpersonation(readOperationalImpersonation());
    sync();
    window.addEventListener(IMPERSONATION_EVENT, sync);
    return () => window.removeEventListener(IMPERSONATION_EVENT, sync);
  }, []);

  const restoreSuperAdmin = async () => {
    const state = readOperationalImpersonation();
    if (!state) throw new Error("Não há sessão administrativa para restaurar.");
    const result = await restoreImpersonationFn({ data: { auditId: state.auditId } });
    const { error } = await supabase.auth.verifyOtp({
      token_hash: result.tokenHash,
      type: "magiclink",
    });
    if (error) throw error;
    writeOperationalImpersonation(null);
    setImpersonation(null);
  };

  const value: AuthCtx = {
    session,
    user: session?.user ?? null,
    roles,
    loading,
    hasRole: (r) => roles.includes(r),
    hasAny: (rs) => rs.some((r) => roles.includes(r)),
    signOut: async () => {
      await supabase.auth.signOut();
    },
    refreshRoles: async () => loadRoles(session?.user.id),
    impersonation: impersonationMatchesSession(impersonation, session) ? impersonation : null,
    restoreSuperAdmin,
    platformAdmin,
    platformContext,
    platformReady,
    refreshPlatform: async () => loadRoles(session?.user.id, true),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth fora do AuthProvider");
  return c;
}

export const ROLE_LABEL: Record<AppRole, string> = {
  corretor: "Corretor",
  gestor: "Gestor",
  team_leader: "Team Leader",
  juridico: "Jurídico",
  financeiro: "Financeiro",
  admin: "Administrador",
  super_admin: "Super Admin",
  lancamento: "Lançamento",
  staff: "Staff",
};
