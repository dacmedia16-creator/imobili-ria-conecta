import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// RPC da migração 20261006170000 (ainda fora de types.ts).
const db = supabase as unknown as SupabaseClient;

/** Módulo Feedback ao proprietário ligado na imobiliária atual. Falha = fechado. */
export async function ownerFeedbackEnabled(): Promise<boolean> {
  const { data, error } = await db.rpc("owner_feedback_enabled");
  if (error) return false;
  return data === true;
}

/** Guarda da rota; o banco repete a checagem ao ler os números. */
export async function guardOwnerFeedbackRoute() {
  const { data } = await supabase.auth.getSession();
  if (!data.session || !(await ownerFeedbackEnabled())) throw redirect({ to: "/dashboard" });
}
