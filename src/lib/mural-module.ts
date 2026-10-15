import type { SupabaseClient } from "@supabase/supabase-js";
import confetti from "canvas-confetti";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeEvent } from "@/components/mural/MuralCelebration";

// RPCs/tabelas da migration 20261015120000 (ainda fora de types.ts).
const db = supabase as unknown as SupabaseClient;

/** Módulo Mural de Conquistas ligado na imobiliária atual. Falha = fechado. */
export async function achievementsEnabled(): Promise<boolean> {
  const { data, error } = await db.rpc("achievements_enabled");
  if (error) return false;
  return data === true;
}

/** Imobiliária atual (do JWT no banco, nunca do navegador). */
export async function currentOrgId(): Promise<string | null> {
  const { data, error } = await db.rpc("current_org_id");
  if (error || typeof data !== "string") return null;
  return data;
}

/** Preferência "silenciar comemorações" do próprio usuário (RLS: só lê a própria linha). */
export async function achievementsMuted(userId: string): Promise<boolean> {
  const { data, error } = await db
    .from("achievement_mutes")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

export async function setAchievementsMuted(muted: boolean): Promise<boolean> {
  const { data, error } = await db.rpc("achievement_set_muted", { _muted: muted });
  if (error) throw error;
  return data === true;
}

/** Canal da imobiliária: só INSERT (reativação/revogação são UPDATE e não comemoram). */
export function subscribeAchievements(
  organizationId: string,
  onEvent: (e: RealtimeEvent) => void,
): () => void {
  const channel = db
    .channel(`mural-conquistas:${organizationId}:${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "achievement_posts",
        filter: `organization_id=eq.${organizationId}`,
      },
      (payload) => onEvent({ eventType: payload.eventType, new: payload.new }),
    )
    .subscribe();
  return () => {
    void db.removeChannel(channel);
  };
}

/** Confete leve (canvas-confetti), sem worker e desligado para quem pede menos movimento. */
export function fireCelebrationConfetti() {
  const base = { disableForReducedMotion: true, zIndex: 59, ticks: 160 } as const;
  void confetti({ ...base, particleCount: 70, spread: 70, origin: { x: 0.2, y: 0.25 } });
  void confetti({ ...base, particleCount: 70, spread: 70, origin: { x: 0.8, y: 0.25 } });
}
