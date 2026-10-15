import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { achievementsEnabled } from "@/lib/mural-module";
import {
  sanitizeFeed,
  type BirthdayRow,
  type Cheerer,
  type FeedPost,
  type RankingRow,
} from "@/lib/mural-conquistas";

// RPCs das migrações 20261015120000/20261015130000 (ainda fora de types.ts).
const db = supabase as unknown as SupabaseClient;

/** Guarda da rota: sem sessão ou com o módulo desligado, volta ao Início sem nenhuma outra consulta. */
export async function guardMuralRoute() {
  const { data } = await supabase.auth.getSession();
  if (!data.session || !(await achievementsEnabled())) throw redirect({ to: "/dashboard" });
}

export async function loadFeed(limit = 30): Promise<FeedPost[]> {
  const { data, error } = await db.rpc("achievement_feed", { _limit: limit });
  if (error) throw error;
  return sanitizeFeed(data);
}

export async function loadCheerers(postIds: string[]): Promise<Cheerer[]> {
  if (!postIds.length) return [];
  const { data, error } = await db.rpc("achievement_cheerers", { _post_ids: postIds });
  if (error) throw error;
  return (data ?? []) as Cheerer[];
}

/** Devolve o total de parabéns do post (o banco ignora o segundo parabéns da mesma pessoa). */
export async function cheer(postId: string): Promise<number> {
  const { data, error } = await db.rpc("achievement_cheer", { _post_id: postId });
  if (error) throw error;
  return Number(data) || 0;
}

export async function loadRanking(ano: number, mes: number): Promise<RankingRow[]> {
  const { data, error } = await db.rpc("achievement_ranking", { _ano: ano, _mes: mes });
  if (error) throw error;
  return ((data ?? []) as RankingRow[]).map((r) => ({ ...r, pontos: Number(r.pontos) || 0 }));
}

export async function loadBirthdays(mes: number): Promise<BirthdayRow[]> {
  const { data, error } = await db.rpc("achievement_birthdays", { _mes: mes });
  if (error) throw error;
  return (data ?? []) as BirthdayRow[];
}
