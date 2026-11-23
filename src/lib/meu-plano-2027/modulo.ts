import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/errors";

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

/**
 * Quem assina o pacto como broker e reabre o plano (o banco repete a regra em meu_plano_eh_broker).
 * Gestor continua aqui, mas só para a própria equipe: vê (veImobiliaria), assina e reabre só quem lidera
 * (carreira_plano_assinar_broker/carreira_plano_reabrir, migration 20261219120000, t_82b66d41).
 */
export const PAPEIS_BROKER = ["gestor", "admin", "super_admin"] as const;
export const ehBroker = (roles: readonly string[]) =>
  roles.some((r) => (PAPEIS_BROKER as readonly string[]).includes(r));
/**
 * Quem vê os planos da imobiliária TODA (decisão de Denis 21/11/2026, t_48670ed3): só admin e administrador
 * principal. Gestor e team leader veem só a própria equipe, igual ao Painel da Equipe. O banco repete a regra
 * (meu_plano_ve_imobiliaria, migration 20261218120000).
 */
export const PAPEIS_IMOBILIARIA = ["admin", "super_admin"] as const;
export const veImobiliaria = (roles: readonly string[]) =>
  roles.some((r) => (PAPEIS_IMOBILIARIA as readonly string[]).includes(r));
/**
 * Team leader vê (somente leitura) e baixa o plano dos membros da PRÓPRIA equipe (t_65edd0b0). O banco decide
 * quem é da equipe (RLS carreira_plano_ler_lider + carreira_plano_equipe); aqui só mostra o botão "Equipe".
 */
export const ehLider = (roles: readonly string[]) => roles.includes("team_leader");

/** Mensagem curta para os erros das RPCs do plano. */
export function erroPlano(msg: string | undefined | null): string {
  const m = msg ?? "";
  if (/não está ligado|42501.*ligado/i.test(m))
    return "O Meu Plano 2027 não está ligado nesta imobiliária.";
  if (/Login necessário/i.test(m)) return "Sua sessão expirou. Entre de novo.";
  if (/ainda não assinou/i.test(m)) return "O corretor ainda não assinou o pacto.";
  if (/Preencha o pacto/i.test(m)) return "Preencha o pacto antes de assinar.";
  // Trava de valores (t_125c4dd3): o banco explica o motivo depois dos dois pontos.
  const trava = m.match(/Plano com valor fora do limite:\s*(.+)$/i);
  if (trava) return trava[1];
  // Assinatura sem meta oficial calculada (t_3d55d20c): o banco diz o que falta depois de "falta".
  const semMeta = m.match(/Plano sem meta calculada:\s*falta\s+(.+?)\.\s/i);
  if (semMeta || /Plano sem meta calculada/i.test(m))
    return `Para assinar, falta a meta oficial: complete ${semMeta ? semMeta[1] : "a tela Metas"} na tela Metas.`;
  if (/Meta inválida/i.test(m)) return "A meta tem valor fora do permitido. Confira a tela Metas.";
  if (/líder de equipe vê a equipe/i.test(m)) return "Você ainda não lidera nenhuma equipe.";
  if (/reabrir o seu próprio plano/i.test(m)) return "Você não pode reabrir o seu próprio plano.";
  if (/líder da equipe reabre/i.test(m))
    return "Só o gestor, o administrador ou o líder da equipe do corretor reabre o plano.";
  if (/motivo da reabertura/i.test(m)) return "Escreva o motivo da reabertura (5 a 300 letras).";
  if (/não está assinado/i.test(m))
    return "Este plano já está em preenchimento (não está assinado).";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "Sem conexão. Tentando de novo…";
  return mensagemErro(m, "Não foi possível salvar.");
}
