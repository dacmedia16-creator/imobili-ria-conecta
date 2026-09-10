import { supabase } from "@/integrations/supabase/client";

export type VendaComercialValida = { sale_id: string; venda_em: string };
export type AtribuicaoComercialResumo = {
  user_id: string;
  team_id: string | null;
  vendas: number;
  comissao: number;
  vgv: number;
};
export type VendaComercialPaginada = {
  id: string;
  status: string;
  valor_negociado: number | null;
  imovel_id: string | null;
  codigo_interno: string | null;
  corretor_captador: string | null;
  corretor_vendedor: string | null;
  updated_at: string;
  created_at: string;
  corretor_id: string;
  modalidade: string;
  data_assinatura: string | null;
  data_venda: string;
};
export type VendasComerciaisPaginadas = {
  rows: VendaComercialPaginada[];
  total_count: number;
  total_valor: number;
};

/** Fonte única no frontend para saber se uma venda conta comercialmente e em qual data. */
export async function fetchVendasComerciaisValidas(): Promise<VendaComercialValida[]> {
  const { data, error } = await supabase.rpc("vendas_comerciais_validas" as never);
  if (error) throw error;
  return (data ?? []) as VendaComercialValida[];
}

export async function fetchVendasComerciaisPaginadas(params: {
  page: number;
  pageSize: number;
  status?: string;
  statuses?: string[];
  desde?: string;
  ate?: string;
  q?: string;
  corretorIds?: string[];
}): Promise<VendasComerciaisPaginadas> {
  const { data, error } = await supabase.rpc(
    "list_vendas_comerciais_paginadas" as never,
    {
      _page: params.page,
      _page_size: params.pageSize,
      _status: params.status ?? null,
      _statuses: params.statuses ?? null,
      _desde: params.desde ?? null,
      _ate: params.ate ?? null,
      _q: params.q?.trim() || null,
      _corretor_ids: params.corretorIds ?? null,
    } as never,
  );
  if (error) throw error;
  return (data ?? {
    rows: [],
    total_count: 0,
    total_valor: 0,
  }) as unknown as VendasComerciaisPaginadas;
}
export async function fetchAtribuicaoComercialResumo(): Promise<AtribuicaoComercialResumo[]> {
  const { data, error } = await supabase.rpc("atribuicao_comercial_resumo" as never);
  if (error) throw error;
  return (data ?? []) as AtribuicaoComercialResumo[];
}
