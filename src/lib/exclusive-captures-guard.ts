import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { exclusiveEnabled } from "./exclusive-captures-db";
import { fetchPlatformState } from "./platform-context";

/** Guarda a rota diretamente; o banco repete a checagem em todas as leituras e escritas. */
export async function guardExclusiveRoute() {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session || !(await exclusiveEnabled())) throw redirect({ to: "/dashboard" });
  // Super-admin da plataforma dentro de uma imobiliária: o perfil dele é de outra imobiliária
  // (a RLS o esconde aqui); o banco já validou o contexto e concede papéis virtuais de admin.
  const platform = await fetchPlatformState(session.session.user.id);
  if (platform.context) return;
  const { data: roles, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", session.session.user.id);
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("ativo")
    .eq("id", session.session.user.id)
    .maybeSingle();
  if (
    error ||
    profileError ||
    profile?.ativo !== true ||
    !(roles ?? []).some(({ role }) =>
      ["corretor", "gestor", "team_leader", "admin", "super_admin"].includes(role),
    )
  )
    throw redirect({ to: "/dashboard" });
}
