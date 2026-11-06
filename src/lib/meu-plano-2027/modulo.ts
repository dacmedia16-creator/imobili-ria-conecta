import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// Tabela carreira_plano e RPCs da migração 20261107120000 (ainda fora de types.ts). O banco garante:
// corretor só lê/grava o próprio plano; gestor/admin leem a imobiliária; módulo desligado = nada.
export const planoDb = supabase as unknown as SupabaseClient;

/** Módulo "Meu Plano 2027" ligado na imobiliária atual. Falha = fechado. */
export async function meuPlanoEnabled(): Promise<boolean> {
  try {
    const { data, error } = await planoDb.rpc("meu_plano_2027_enabled");
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function guardMeuPlanoRoute() {
  const { data } = await supabase.auth.getSession();
  if (!data.session || !(await meuPlanoEnabled())) throw redirect({ to: "/minha-carreira" });
}

/** Quem vê os planos da equipe (somente leitura). O banco repete a regra (meu_plano_eh_broker). */
export const PAPEIS_BROKER = ["gestor", "admin", "super_admin"] as const;
export const ehBroker = (roles: readonly string[]) =>
  roles.some((r) => (PAPEIS_BROKER as readonly string[]).includes(r));

/** Mensagem curta para os erros das RPCs do plano. */
export function erroPlano(msg: string | undefined | null): string {
  const m = msg ?? "";
  if (/não está ligado|42501.*ligado/i.test(m))
    return "O Meu Plano 2027 não está ligado nesta imobiliária.";
  if (/Login necessário/i.test(m)) return "Sua sessão expirou. Entre de novo.";
  if (/ainda não assinou/i.test(m)) return "O corretor ainda não assinou o pacto.";
  if (/Preencha o pacto/i.test(m)) return "Preencha o pacto antes de assinar.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "Sem conexão. Tentando de novo…";
  return m || "Não foi possível salvar.";
}
