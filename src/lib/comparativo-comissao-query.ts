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
import type { ComparativoRawRow, ComparativoRowComCalculo, InconsistenciaRow } from "@/lib/comparativo-comissao-types";

type TeamRow = { id: string; nome: string; parent_team_id: string | null; lider_id: string | null };
type TeamMemberRow = { membro_id: string; team_id: string };
type CoLeaderRow = { user_id: string; team_id: string };

// "as any" só no nome da RPC: as duas funções já existem no banco (20260813010000), com a correção
// de regra de 20260813020000_corrige_efetivacao_comparativo_comissao.sql ainda não aplicada — e de
// qualquer forma nunca foram regeneradas em src/integrations/supabase/types.ts (arquivo gerado, não
// editado à mão). O cast some sozinho na próxima geração de types.
async function callRpc<T>(name: string): Promise<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await supabase.rpc(name as any)) as { data: T[] | null; error: { message: string } | null };
  if (error) throw error;
  return data ?? [];
}

/** Corretor → equipe: membro (team_members) OU líder/líder-auxiliar da própria equipe (teams.lider_id
 * / team_co_leaders) — mesmo cálculo já usado no filtro por equipe de vendas.index.tsx, pra não
 * perder quem sobe venda em nome próprio sendo também líder (ex.: Lançamento + Gestor acumulados). */
function resolverEquipePorCorretor(teams: TeamRow[], members: TeamMemberRow[], coLeaders: CoLeaderRow[]) {
  const teamIdByCorretor = new Map<string, string>();
  for (const m of members) if (!teamIdByCorretor.has(m.membro_id)) teamIdByCorretor.set(m.membro_id, m.team_id);
  for (const t of teams) if (t.lider_id && !teamIdByCorretor.has(t.lider_id)) teamIdByCorretor.set(t.lider_id, t.id);
  for (const c of coLeaders) if (!teamIdByCorretor.has(c.user_id)) teamIdByCorretor.set(c.user_id, c.team_id);
  return teamIdByCorretor;
}

export async function fetchComparativoRows(): Promise<ComparativoRowComCalculo[]> {
  const candidatos = await callRpc<ComparativoRawRow>("comparativo_comissao_6pct");
  if (candidatos.length === 0) return [];

  const [{ data: profiles }, { data: teams }, { data: members }, { data: coLeaders }] = await Promise.all([
    supabase.from("profiles").select("id, nome"),
    supabase.from("teams").select("id, nome, parent_team_id, lider_id"),
    supabase.from("team_members").select("membro_id, team_id"),
    supabase.from("team_co_leaders").select("user_id, team_id"),
  ]);

  const nomePorId = new Map<string, string>();
  for (const p of profiles ?? []) nomePorId.set(p.id, p.nome ?? p.id);

  const teamsArr = (teams ?? []) as TeamRow[];
  const teamById = new Map(teamsArr.map((t) => [t.id, t]));
  const teamIdByCorretor = resolverEquipePorCorretor(teamsArr, (members ?? []) as TeamMemberRow[], (coLeaders ?? []) as CoLeaderRow[]);

  const rows: ComparativoRowComCalculo[] = [];
  for (const raw of candidatos) {
    // Revalidação defensiva: a RPC já só devolve linha elegível, mas o frontend nunca aceita
    // cegamente — se algum dia chegar uma linha que viole a regra (ex.: evento_fechamento diferente
    // de 'ocorrencia_analise_financeiro'), ela é descartada aqui, nunca exibida.
    if (!elegivelParaComparativo({
      status: raw.status, dataFechamento: raw.data_fechamento,
      eventoFechamento: raw.evento_fechamento, valorNegociado: raw.valor_negociado, valorTotalComissao: raw.valor_total_comissao,
    })) continue;

    const teamId = teamIdByCorretor.get(raw.corretor_id) ?? null;
    const team = teamId ? teamById.get(teamId) ?? null : null;
    const gestorId = team?.lider_id ?? null;

    const calculo = calcularComparativo({
      valorNegociado: raw.valor_negociado, valorTotalComissao: raw.valor_total_comissao, percentualCadastrado: raw.percentual_comissao,
    });

    rows.push({
      ...raw,
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
