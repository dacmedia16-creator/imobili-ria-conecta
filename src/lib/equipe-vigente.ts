/**
 * Equipe de uma pessoa NA DATA da venda (itens 7 e 8, decisões de 27/09/2026).
 * Fonte: RPC equipe_vigencias() — histórico com vigência (team_membership_history), depois a
 * própria equipe de quem é líder (só se a equipe tiver membros ou a pessoa tiver o cargo
 * team_leader; Lançamento é modalidade, não equipe) e por último a equipe em que é líder-auxiliar.
 */
import { supabase } from "@/integrations/supabase/client";

export type EquipeVigencia = {
  membro_id: string;
  team_id: string;
  de: string | null;
  ate: string | null;
  prioridade: number;
};

/** Resolve a equipe da pessoa no instante informado (ISO). Sem data, usa a vigência atual. */
export type ResolverEquipe = (pessoaId: string, em: string | null) => string | null;

export function criarResolverEquipe(vigencias: EquipeVigencia[]): ResolverEquipe {
  const porPessoa = new Map<string, EquipeVigencia[]>();
  for (const v of vigencias) {
    const lista = porPessoa.get(v.membro_id) ?? [];
    lista.push(v);
    porPessoa.set(v.membro_id, lista);
  }
  for (const lista of porPessoa.values()) lista.sort((a, b) => a.prioridade - b.prioridade);

  return (pessoaId, em) => {
    const lista = porPessoa.get(pessoaId);
    if (!lista) return null;
    const t = em ? new Date(em).getTime() : Date.now();
    for (const v of lista) {
      if (v.de && new Date(v.de).getTime() > t) continue;
      if (v.ate && new Date(v.ate).getTime() <= t) continue;
      return v.team_id;
    }
    return null;
  };
}

/** Data civil (YYYY-MM-DD, fuso de Brasília) → instante ao meio-dia de Brasília. */
export function meioDiaSaoPaulo(data: string | null | undefined): string | null {
  if (!data) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(data) ? `${data}T12:00:00-03:00` : data;
}

export async function fetchResolverEquipe(): Promise<ResolverEquipe> {
  const { data, error } = (await supabase.rpc("equipe_vigencias" as never)) as {
    data: EquipeVigencia[] | null;
    error: { message: string } | null;
  };
  if (error) throw error;
  return criarResolverEquipe(data ?? []);
}
