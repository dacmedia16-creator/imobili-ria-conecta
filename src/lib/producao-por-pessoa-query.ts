/**
 * Busca/agregação de dados do "Produção por Pessoa" — único módulo que fala com o Supabase.
 * Só leitura. A RPC producao_por_pessoa_dados concentra também o fallback seguro de gestor/Team
 * Leader por lado nas vendas padrão, para a regra ser compartilhada por qualquer consumidor. Ela
 * barra qualquer papel fora de admin/super_admin/financeiro (ver migration), então um erro dela aqui
 * normalmente significa "sem permissão" — tratado como lista vazia pelo chamador.
 */
import { supabase } from "@/integrations/supabase/client";
import { gerarPontas } from "@/lib/producao-por-pessoa-calc";
import type { ProducaoPonta, ProducaoRawRow } from "@/lib/producao-por-pessoa-types";
import { fetchResolverEquipe } from "@/lib/equipe-vigente";

type TeamRow = { id: string; nome: string };

// "as any" só no nome da RPC: producao_por_pessoa_dados existe no banco (20260820100000) mas ainda
// não foi regenerada em src/integrations/supabase/types.ts (arquivo gerado, não editado à mão). O
// cast some sozinho na próxima geração de types.
export async function fetchProducaoPorPessoa(): Promise<ProducaoPonta[]> {
  const { data, error } = (await supabase.rpc("producao_por_pessoa_dados" as never)) as {
    data: ProducaoRawRow[] | null;
    error: { message: string } | null;
  };
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Equipe vigente na data da assinatura (concluida_em = venda_em da base canônica), itens 7 e 8.
  const [{ data: teams }, resolverEquipe] = await Promise.all([
    supabase.from("teams").select("id, nome"),
    fetchResolverEquipe(),
  ]);
  const teamNomeById = new Map(((teams ?? []) as TeamRow[]).map((t) => [t.id, t.nome]));

  return gerarPontas(rows, resolverEquipe, teamNomeById);
}
