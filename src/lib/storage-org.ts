import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** Nunca aceitar organização escolhida pelo navegador: resolver a partir do JWT no servidor. */
export async function storageOrganizationPath(relativePath: string): Promise<string> {
  const { data, error } = await (supabase as unknown as SupabaseClient).rpc("current_org_id");
  if (error || typeof data !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data)) {
    throw new Error("Organização não disponível para arquivos");
  }
  return `${data}/${relativePath}`;
}
