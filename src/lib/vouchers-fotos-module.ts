import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// RPCs da migração 20261105120000 (ainda fora de types.ts).
export const fotosDb = supabase as unknown as SupabaseClient;

/** Módulo "Agendar fotos" (vouchers_fotos) ligado na imobiliária atual. Falha = fechado. */
export async function vouchersFotosEnabled(): Promise<boolean> {
  try {
    const { data, error } = await fotosDb.rpc("vouchers_fotos_enabled");
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/** Guarda das rotas /agendar-fotos e /fotografo; o banco repete a checagem em todas as RPCs. */
export async function guardVouchersFotosRoute() {
  const { data } = await supabase.auth.getSession();
  if (!data.session || !(await vouchersFotosEnabled())) throw redirect({ to: "/dashboard" });
}
