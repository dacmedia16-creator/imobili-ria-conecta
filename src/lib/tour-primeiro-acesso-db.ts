// Leitura e gravação da escolha do tour (tabela public.user_tour_estado, migration 20261026120000).
// A RLS só deixa cada pessoa ler e gravar a PRÓPRIA linha. Falha de leitura = não abre o tour
// (nunca atrapalha o uso); falha de gravação = guarda só neste navegador.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { TOUR_ADM_INICIO, chaveTourLocal, type TourStatus } from "@/lib/tour-primeiro-acesso";

const db = supabase as unknown as SupabaseClient;

function lerLocal(userId: string): boolean {
  try {
    return window.localStorage.getItem(chaveTourLocal(userId)) !== null;
  } catch {
    return false;
  }
}

function gravarLocal(userId: string, status: TourStatus) {
  try {
    window.localStorage.setItem(chaveTourLocal(userId), status);
  } catch {
    /* sem armazenamento local: fica só o banco */
  }
}

/** true = já viu (ou não deu para saber); false = primeira vez. */
export async function tourJaVisto(userId: string): Promise<boolean> {
  if (lerLocal(userId)) return true;
  const { data, error } = await db
    .from("user_tour_estado")
    .select("status")
    .eq("user_id", userId)
    .eq("tour", TOUR_ADM_INICIO)
    .maybeSingle();
  if (error) return true; // shortcut: tabela ausente/erro de rede = não abre sozinho.
  if (data) gravarLocal(userId, (data as { status: TourStatus }).status);
  return Boolean(data);
}

export async function gravarTour(userId: string, status: TourStatus, passo: number) {
  gravarLocal(userId, status);
  const { error } = await db.from("user_tour_estado").upsert(
    {
      user_id: userId,
      tour: TOUR_ADM_INICIO,
      status,
      passo: Math.max(0, Math.min(50, Math.trunc(passo))),
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: "user_id,tour" },
  );
  if (error) console.warn("Tour: não foi possível gravar a escolha no banco", error.message);
}
