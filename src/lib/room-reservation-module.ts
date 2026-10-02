import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// RPC da migração 20261002000005 (ainda fora de types.ts).
const db = supabase as unknown as SupabaseClient;

/** Módulo Reserva de salas ligado na imobiliária atual. Falha = fechado. */
export async function roomReservationEnabled(): Promise<boolean> {
  const { data, error } = await db.rpc("room_reservation_enabled");
  if (error) return false;
  return data === true;
}

/** Guarda da rota; o banco repete a checagem ao criar reservas. */
export async function guardRoomReservationRoute() {
  const { data } = await supabase.auth.getSession();
  if (!data.session || !(await roomReservationEnabled())) throw redirect({ to: "/dashboard" });
}
