import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// As RPCs desta migration ainda não constam em types.ts (gerado pelo Supabase).
const db = supabase as unknown as SupabaseClient;

export async function readExclusiveSetting(): Promise<boolean> {
  const { data, error } = await db.rpc("exclusive_capture_enabled");
  if (error) throw error;
  if (typeof data !== "boolean") throw new Error("Estado das captações indisponível");
  return data;
}

export async function setExclusiveSetting(enabled: boolean): Promise<void> {
  const { data, error } = await db.rpc("exclusive_capture_set_enabled", { _enabled: enabled });
  if (error) throw error;
  if (data !== enabled) throw new Error("Não foi possível confirmar a alteração");
}
