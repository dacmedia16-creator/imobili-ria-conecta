import { supabase } from "@/integrations/supabase/client";

export type VendaComercialValida = { sale_id: string; venda_em: string };
export type AtribuicaoComercialResumo = {
  user_id: string;
  team_id: string | null;
  vendas: number;
  comissao: number;
  vgv: number;
};

/** Fonte única no frontend para saber se uma venda conta comercialmente e em qual data. */
export async function fetchVendasComerciaisValidas(): Promise<VendaComercialValida[]> {
  const { data, error } = await supabase.rpc("vendas_comerciais_validas" as never);
  if (error) throw error;
  return (data ?? []) as VendaComercialValida[];
}

export async function fetchAtribuicaoComercialResumo(): Promise<AtribuicaoComercialResumo[]> {
  const { data, error } = await supabase.rpc("atribuicao_comercial_resumo" as never);
  if (error) throw error;
  return (data ?? []) as AtribuicaoComercialResumo[];
}
