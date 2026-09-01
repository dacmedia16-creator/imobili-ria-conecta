import { supabase } from "@/integrations/supabase/client";

export type VendaComercialValida = { sale_id: string; venda_em: string };

/** Fonte única no frontend para saber se uma venda conta comercialmente e em qual data. */
export async function fetchVendasComerciaisValidas(): Promise<VendaComercialValida[]> {
  const { data, error } = await supabase.rpc("vendas_comerciais_validas" as never);
  if (error) throw error;
  return (data ?? []) as VendaComercialValida[];
}
