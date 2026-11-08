import { supabase } from "@/integrations/supabase/client";
import { corretoresDaVenda } from "@/lib/sale-permissions";

// Cartão "Vendas recentes" do Início com a mesma aparência da lista de Vendas (t_e99f64cb).
// A consulta das vendas NÃO muda (sales, 8 por updated_at, RLS do usuário); aqui só se completam
// os campos que a lista mostra, em 3 leituras em lote só com os IDs exibidos, sob a mesma RLS
// (todas as políticas de leitura dessas tabelas usam can_view_sale).

type LinhaBase = {
  id: string;
  created_at: string;
  corretor_id: string;
  corretor_captador_id: string | null;
  corretor_vendedor_id: string | null;
};

export type ComplementoVendaRecente = {
  /** Corretores participantes (espelho de public.sale_corretores, como a RPC da lista). */
  corretores_ids: string[];
  pagamento_tipo: string | null;
  pagamento_banco: string | null;
  pagamento_correspondente: string | null;
  pagamento_oba: boolean | null;
  /** Última troca de status (sem histórico: a criação) — "Nesta etapa". */
  desde_etapa: string;
};

export async function complementarVendasRecentes<T extends LinhaBase>(
  rows: T[],
): Promise<Array<T & ComplementoVendaRecente>> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [histRes, payRes, extrasRes] = await Promise.all([
    supabase
      .from("sale_status_history")
      .select("sale_id, created_at")
      .in("sale_id", ids)
      .order("created_at", { ascending: false }),
    supabase
      .from("sale_payment")
      .select(
        "sale_id, tipo_pagamento, financiamento_banco, financiamento_correspondente, oba_credito",
      )
      .in("sale_id", ids),
    supabase.from("sale_commission_extras").select("sale_id, user_id, papel").in("sale_id", ids),
  ]);
  // Falha de leitura de um complemento não esconde a venda: cai no padrão (sem etiqueta, criador,
  // criação), igual à lista de Vendas quando o dado não vem.
  const desde = new Map<string, string>();
  for (const h of histRes.error ? [] : (histRes.data ?? []))
    if (!desde.has(h.sale_id)) desde.set(h.sale_id, h.created_at);
  const pagamento = new Map((payRes.error ? [] : (payRes.data ?? [])).map((p) => [p.sale_id, p]));
  const extras = new Map<string, { user_id: string | null; papel: string | null }[]>();
  for (const e of extrasRes.error ? [] : (extrasRes.data ?? []))
    (extras.get(e.sale_id) ?? extras.set(e.sale_id, []).get(e.sale_id)!).push(e);
  return rows.map((r) => {
    const p = pagamento.get(r.id);
    return {
      ...r,
      // Mesma ordem da RPC da lista (array_agg ORDER BY uuid).
      corretores_ids: corretoresDaVenda(r, extras.get(r.id) ?? []).sort(),
      pagamento_tipo: p?.tipo_pagamento ?? null,
      pagamento_banco: p?.financiamento_banco ?? null,
      pagamento_correspondente: p?.financiamento_correspondente ?? null,
      pagamento_oba: p ? p.oba_credito : null,
      desde_etapa: desde.get(r.id) ?? r.created_at,
    };
  });
}
