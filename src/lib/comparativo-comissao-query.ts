/**
 * Busca/agregação de dados do Comparativo 6% — único módulo que fala com o Supabase. Só leitura:
 * nenhuma função aqui faz insert/update/delete. As duas RPCs (comparativo_comissao_6pct e
 * comparativo_comissao_6pct_inconsistencias) já barram qualquer papel fora de
 * admin/super_admin/financeiro (ver migration), então um erro delas aqui normalmente significa
 * "sem permissão" — tratado como lista vazia pelo chamador (a página nem chega a chamar isto se a
 * role local não bater, ver src/routes/_authenticated/comparativo-comissao.tsx).
 */
import { supabase } from "@/integrations/supabase/client";
import { calcularComparativo, elegivelParaComparativo } from "@/lib/comparativo-comissao-calc";
import type {
  ComparativoRawRow,
  ComparativoRowComCalculo,
  InconsistenciaRow,
} from "@/lib/comparativo-comissao-types";
import { metricasSemParceria } from "@/lib/metricas-sem-parceria";
import { fetchResolverEquipe, meioDiaSaoPaulo } from "@/lib/equipe-vigente";

type TeamRow = { id: string; nome: string; parent_team_id: string | null; lider_id: string | null };

// "as any" só no nome da RPC: as duas funções já existem no banco (20260813010000), com a correção
// de regra de 20260813020000_corrige_efetivacao_comparativo_comissao.sql ainda não aplicada — e de
// qualquer forma nunca foram regeneradas em src/integrations/supabase/types.ts (arquivo gerado, não
// editado à mão). O cast some sozinho na próxima geração de types.
async function callRpc<T>(name: string): Promise<T[]> {
  const { data, error } = (await supabase.rpc(name as never)) as {
    data: T[] | null;
    error: { message: string } | null;
  };
  if (error) throw error;
  return data ?? [];
}

export async function fetchComparativoRows(): Promise<ComparativoRowComCalculo[]> {
  const candidatos = await callRpc<ComparativoRawRow>("comparativo_comissao_6pct");
  if (candidatos.length === 0) return [];

  const [{ data: profiles }, { data: teams }, resolverEquipe] = await Promise.all([
    supabase.from("profiles").select("id, nome"),
    supabase.from("teams").select("id, nome, parent_team_id, lider_id"),
    fetchResolverEquipe(),
  ]);

  const nomePorId = new Map<string, string>();
  for (const p of profiles ?? []) nomePorId.set(p.id, p.nome ?? p.id);

  const teamsArr = (teams ?? []) as TeamRow[];
  const teamById = new Map(teamsArr.map((t) => [t.id, t]));
  const rows: ComparativoRowComCalculo[] = [];
  for (const raw of candidatos) {
    // Revalidação defensiva: a RPC já só devolve linha elegível, mas o frontend nunca aceita
    // cegamente — se algum dia chegar uma linha que viole a regra (ex.: evento_fechamento diferente
    // de 'ocorrencia_analise_financeiro'), ela é descartada aqui, nunca exibida.
    if (
      !elegivelParaComparativo({
        status: raw.status,
        dataFechamento: raw.data_fechamento,
        eventoFechamento: raw.evento_fechamento,
        valorNegociado: raw.valor_negociado,
        valorTotalComissao: raw.valor_total_comissao,
      })
    )
      continue;

    // Equipe vigente na data da assinatura (itens 7 e 8).
    const teamId = resolverEquipe(raw.corretor_id, meioDiaSaoPaulo(raw.data_fechamento));
    const team = teamId ? (teamById.get(teamId) ?? null) : null;
    const gestorId = team?.lider_id ?? null;

    const proprias = metricasSemParceria({
      vgv: raw.valor_negociado,
      comissaoBruta: raw.valor_total_comissao,
      parceriaExterna: raw.parceria_externa,
    });
    const rowSemParceria = {
      ...raw,
      valor_negociado: proprias.vgvProprio,
      valor_total_comissao: proprias.comissaoPropria,
    };
    const calculo = calcularComparativo({
      valorNegociado: rowSemParceria.valor_negociado,
      valorTotalComissao: rowSemParceria.valor_total_comissao,
      percentualCadastrado: raw.percentual_comissao,
    });

    rows.push({
      ...rowSemParceria,
      corretorNome: nomePorId.get(raw.corretor_id) ?? raw.corretor_id,
      teamId,
      teamNome: team?.nome ?? null,
      gestorId,
      gestorNome: gestorId ? (nomePorId.get(gestorId) ?? gestorId) : null,
      ...calculo,
    });
  }

  return rows;
}

/** Contador "Inconsistências encontradas" — só ID/código interno e motivo (ver InconsistenciaRow),
 * nunca nome/valores. Falha de permissão vira lista vazia pro chamador, mesmo padrão de
 * fetchComparativoRows. */
export async function fetchComparativoInconsistencias(): Promise<InconsistenciaRow[]> {
  return callRpc<InconsistenciaRow>("comparativo_comissao_6pct_inconsistencias");
}
