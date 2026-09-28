import { supabase } from "@/integrations/supabase/client";
import { responsaveisDaVenda } from "@/lib/sale-permissions";

/**
 * Quem recebe avisos "de corretor" de uma venda: os corretores participantes (venda padrão) ou o
 * operador do Lançamento. Quem só cadastrou a venda e não participa NÃO recebe (decisão de Denis,
 * 28/09/2026). Sem nenhum participante definido, cai no criador (rascunho recém-criado).
 */
export async function buscarResponsaveisDaVenda(saleId: string): Promise<string[]> {
  const [{ data: sale }, { data: extras }] = await Promise.all([
    supabase
      .from("sales")
      .select("corretor_id, corretor_captador_id, corretor_vendedor_id, modalidade")
      .eq("id", saleId)
      .maybeSingle(),
    supabase.from("sale_commission_extras").select("papel, user_id").eq("sale_id", saleId),
  ]);
  if (!sale) return [];
  return responsaveisDaVenda(sale, extras ?? []);
}
