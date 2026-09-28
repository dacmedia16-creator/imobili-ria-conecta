import { supabase } from "@/integrations/supabase/client";
import { corretoresDaVenda, responsaveisDaVenda } from "@/lib/sale-permissions";

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

type VendaParaAtribuicao = {
  id: string;
  corretor_id: string;
  corretor_captador_id?: string | null;
  corretor_vendedor_id?: string | null;
};
type ExtraDaVenda = { sale_id: string; papel: string | null; user_id: string | null };

/** Monta venda → corretores participantes (atribuição). Puro, para ser testável. */
export function montarCorretoresPorVenda(
  sales: VendaParaAtribuicao[],
  extras: ExtraDaVenda[],
): Map<string, string[]> {
  const extrasPorVenda = new Map<string, ExtraDaVenda[]>();
  for (const e of extras) {
    const atuais = extrasPorVenda.get(e.sale_id) ?? [];
    atuais.push(e);
    extrasPorVenda.set(e.sale_id, atuais);
  }
  return new Map(sales.map((s) => [s.id, corretoresDaVenda(s, extrasPorVenda.get(s.id) ?? [])]));
}

/**
 * Corretores participantes (atribuição de venda/produção/comissão) de várias vendas de uma vez.
 * Usado pelos relatórios: nome/filtro "Corretor" e equipe seguem os participantes, nunca quem só
 * cadastrou. Busca em lotes de 100 IDs para não estourar a URL.
 */
export async function buscarCorretoresPorVenda(saleIds: string[]): Promise<Map<string, string[]>> {
  const ids = Array.from(new Set(saleIds));
  const sales: VendaParaAtribuicao[] = [];
  const extras: ExtraDaVenda[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100);
    const [s, e] = await Promise.all([
      supabase
        .from("sales")
        .select("id, corretor_id, corretor_captador_id, corretor_vendedor_id")
        .in("id", lote),
      supabase
        .from("sale_commission_extras")
        .select("sale_id, papel, user_id")
        .in("sale_id", lote)
        .in("papel", ["corretor_captador", "corretor_vendedor"]),
    ]);
    if (s.error) throw s.error;
    if (e.error) throw e.error;
    sales.push(...(s.data ?? []));
    extras.push(...(e.data ?? []));
  }
  return montarCorretoresPorVenda(sales, extras);
}
