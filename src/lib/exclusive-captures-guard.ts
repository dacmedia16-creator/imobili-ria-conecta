import { redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { exclusiveEnabled } from "./exclusive-captures-db";
import { fetchPlatformState } from "./platform-context";

const CAPTURE_ROLES = ["corretor", "gestor", "team_leader", "admin", "super_admin"];
/** Mesma regra do menu e da RPC exclusive_unit_save: só a administração cadastra unidades. */
const UNIT_ADMIN_ROLES = ["admin", "super_admin"];

async function guard(allowed: readonly string[], notify: boolean) {
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
    !(roles ?? []).some(({ role }) => allowed.includes(role))
  ) {
    if (notify) toast.error("Acesso não autorizado.");
    throw redirect({ to: "/dashboard" });
  }
}

/** Guarda a rota diretamente; o banco repete a checagem em todas as leituras e escritas. */
export async function guardExclusiveRoute() {
  await guard(CAPTURE_ROLES, false);
}

/** Cadastro de unidades: só admin/super_admin (igual ao menu); nega com aviso, nunca em silêncio. */
export async function guardExclusiveUnitsAdminRoute() {
  await guard(UNIT_ADMIN_ROLES, true);
}
