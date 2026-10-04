import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// As colunas da migration de homologação ainda não constam do types.ts gerado.
const db = supabase as unknown as SupabaseClient;

export type AgencyProfile = {
  id: string;
  nome: string;
  razao_social: string | null;
  creci: string | null;
  cidade: string | null;
  uf: string | null;
  cor_primaria: string | null;
  cor_secundaria: string | null;
  logo_path: string | null;
};
export type AgencyRoom = { id: string; nome: string; ativo: boolean; ordem: number };

/** Só busca a organização ativa do JWT/contexto, nunca aceita ID escolhido pelo navegador. */
export async function loadAgencyProfile(): Promise<AgencyProfile> {
  const { data: id, error: scopeError } = await db.rpc("current_org_id");
  if (scopeError || !id) throw new Error("Imobiliária não identificada.");
  const { data, error } = await db
    .from("organizations")
    .select("id,nome,razao_social,creci,cidade,uf,cor_primaria,cor_secundaria,logo_path")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Não foi possível carregar os dados da imobiliária.");
  return data as AgencyProfile;
}

export async function listAgencyRooms(): Promise<AgencyRoom[]> {
  const { data, error } = await db
    .from("agency_rooms")
    .select("id,nome,ativo,ordem")
    .order("ordem")
    .order("nome");
  if (error) throw new Error("Não foi possível carregar as salas da imobiliária.");
  return (data ?? []) as AgencyRoom[];
}

export async function saveAgencyRoom(
  room: Partial<AgencyRoom> & Pick<AgencyRoom, "nome" | "ativo" | "ordem">,
) {
  const { error } = await db.rpc("agency_room_save", {
    _id: room.id ?? null,
    _nome: room.nome.trim(),
    _ativo: room.ativo,
    _ordem: room.ordem,
  });
  if (error) throw error;
}

export async function saveAgencyProfile(data: Record<string, string | null>) {
  const { error } = await db.rpc("agency_profile_save", { _data: data });
  if (error) throw error;
}

export function agencyCity(city: string | null | undefined) {
  return city?.trim() || "Sorocaba";
}
export function agencyUf(uf: string | null | undefined, city: string | null | undefined) {
  return uf?.trim() || (city?.trim() ? "" : "SP");
}
