import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getRouteAccess } from "@/lib/route-access";
import { ehSoFotografo } from "@/lib/fotografo";

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

/**
 * Guarda da rota /fotografo. Igual à de cima, MENOS para o só-fotógrafo com o módulo desligado:
 * ele fica na tela e vê "Agenda de fotos desativada" (a guarda de _authenticated o manda de volta
 * para /fotografo; redirecionar aqui criaria um vaivém). Aprovado pelo MAX Principal (t_0666d3f0).
 */
export async function guardFotografoRoute(): Promise<{ fotosDesligado: boolean }> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw redirect({ to: "/dashboard" });
  if (await vouchersFotosEnabled()) return { fotosDesligado: false };
  const access = await getRouteAccess();
  if (access && ehSoFotografo(access.roles)) return { fotosDesligado: true };
  throw redirect({ to: "/dashboard" });
}
