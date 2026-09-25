import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// Visibilidade da tela; a RPC do banco é a autorização definitiva para qualquer mudança.
export async function guardExclusiveSettingsRoute() {
  const { data } = await supabase.auth.getSession();
  const actor = data.session?.user.id;
  if (!actor) throw redirect({ to: "/dashboard" });
  const [{ data: profile, error: profileError }, { data: roles, error: rolesError }] =
    await Promise.all([
      supabase.from("profiles").select("ativo").eq("id", actor).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", actor),
    ]);
  if (
    profileError ||
    rolesError ||
    profile?.ativo !== true ||
    !(roles ?? []).some(({ role }) => role === "super_admin")
  )
    throw redirect({ to: "/dashboard" });
}
