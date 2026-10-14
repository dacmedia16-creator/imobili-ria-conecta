import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// RPC da migração 20261014120000 (ainda fora de types.ts).
const db = supabase as unknown as SupabaseClient;

/** Módulo Oportunidades ligado na imobiliária atual. Falha = fechado. */
export async function opportunitiesEnabled(): Promise<boolean> {
  const { data, error } = await db.rpc("opportunities_enabled");
  if (error) return false;
  return data === true;
}

/** Guarda da rota; o banco repete a checagem (policy RESTRICTIVE) ao ler o mural. */
export async function guardOpportunitiesRoute() {
  const { data } = await supabase.auth.getSession();
  if (!data.session || !(await opportunitiesEnabled())) throw redirect({ to: "/dashboard" });
}
