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
  /** sale_payment.tipo_pagamento ('vista' | 'financiamento' | 'consorcio'); null = não informado. */
  pagamento_tipo?: string | null;
  pagamento_banco?: string | null;
  pagamento_correspondente?: string | null;
  /** sale_payment.oba_credito (financiada pela Obah); null = não informado. */
  pagamento_oba?: boolean | null;
  /** Corretores participantes (atribuição). `corretor_id` é só quem cadastrou. */
  corretores_ids?: string[];
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
  soMinhaVez?: boolean;
  /** Mídia da venda; "__sem_midia__" = sem mídia. Só é enviado quando há filtro. */
  midia?: string;
  /** Tipo de pagamento; "__nao_informado__" = sem pagamento. Só é enviado quando há filtro. */
  pagamento?: string;
  /** Cancela a requisição HTTP quando o filtro muda antes da resposta chegar. */
  signal?: AbortSignal;
}): Promise<VendasComerciaisPaginadas> {
  const consulta = supabase.rpc(
    (params.soMinhaVez
      ? "list_vendas_comerciais_paginadas_fila"
      : "list_vendas_comerciais_paginadas") as never,
    {
      _page: params.page,
      _page_size: params.pageSize,
      _status: params.status ?? null,
      _statuses: params.statuses ?? null,
      _desde: params.desde ?? null,
      _ate: params.ate ?? null,
      _q: params.q?.trim() || null,
      _corretor_ids: params.corretorIds ?? null,
      ...(params.midia ? { _midia: params.midia } : {}),
      ...(params.pagamento ? { _pagamento: params.pagamento } : {}),
    } as never,
  );
  const { data, error } = await (params.signal ? consulta.abortSignal(params.signal) : consulta);
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
