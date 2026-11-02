import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// RPC da migration 20261102150000 (ainda fora de types.ts).
const db = supabase as unknown as SupabaseClient;

/** Id do card/item da roda da Academia no hub. */
export const ACADEMIA_CARD_ID = "academia";

/** Academia Única MAX ligada na imobiliária atual do usuário. Sem login ou erro = desligada. */
export async function academiaEnabled(): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("academia_enabled");
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/** Com a Academia desligada, o card continua no hub, mas sem link ("Em breve"). */
export function aplicarModuloAcademia<T extends { id: string; href?: string }>(
  itens: readonly T[],
  ligada: boolean,
): T[] {
  return itens.map((c) => (c.id === ACADEMIA_CARD_ID && !ligada ? { ...c, href: undefined } : c));
}
