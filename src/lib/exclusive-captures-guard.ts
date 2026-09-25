import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { exclusiveEnabled } from "./exclusive-captures-db";

/** Guarda a rota diretamente; o banco repete a checagem em todas as leituras e escritas. */
export async function guardExclusiveRoute() {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session || !(await exclusiveEnabled())) throw redirect({ to: "/dashboard" });
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
