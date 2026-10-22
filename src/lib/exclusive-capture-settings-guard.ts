import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getRouteAccess } from "@/lib/route-access";

// Visibilidade da tela; a RPC do banco é a autorização definitiva para qualquer mudança.
// Usa os papéis EFETIVOS (os mesmos do menu e das demais guardas): no "Entrar como" da
// plataforma valem os papéis virtuais do contexto, que o banco também reconhece via has_role
// (card t_722085c6). Usuário real: continua exigindo super_admin (Administrador principal) ativo.
export async function guardExclusiveSettingsRoute() {
  const access = await getRouteAccess();
  if (!access || access.error || !access.roles.includes("super_admin"))
    throw redirect({ to: "/dashboard" });
  // Contexto: o banco já confirmou o admin da plataforma (platform_current_org); a checagem de
  // perfil "ativo" da imobiliária vale só para o usuário real.
  if (access.inPlatformContext) return;
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("ativo")
    .eq("id", access.userId)
    .maybeSingle();
  if (error || profile?.ativo !== true) throw redirect({ to: "/dashboard" });
}
