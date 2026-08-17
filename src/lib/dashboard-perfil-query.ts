import { supabase } from "@/integrations/supabase/client";
import { classificarGrupoVenda, type GrupoVenda, type SaleStatus } from "@/lib/status";

export type ResumoGrupoVenda = { quantidade: number; vgv: number };
export type ResumoPorGrupo = Record<GrupoVenda, ResumoGrupoVenda>;

function resumoVazio(): ResumoPorGrupo {
  return {
    preparacao: { quantidade: 0, vgv: 0 },
    futura: { quantidade: 0, vgv: 0 },
    confirmada: { quantidade: 0, vgv: 0 },
    encerrada: { quantidade: 0, vgv: 0 },
  };
}

/**
 * Pura — agrega quantidade e VGV por grupo de negócio a partir de linhas já buscadas de `sales`
 * (status + valor_negociado). Separada do fetch pra ser testável sem rede. Diferente de
 * `agruparContagemPorGrupoVenda` (status.ts): aquela parte de uma contagem JÁ agregada no banco
 * (o `funil` de dashboard_stats()) e não carrega VGV; esta parte de linhas individuais, porque os
 * painéis de Gestor/Corretor precisam do valor negociado somado por grupo, não só da contagem.
 */
export function agruparVendasPorGrupoComVgv(
  linhas: { status: string; valor_negociado: number | string | null }[],
): ResumoPorGrupo {
  const resumo = resumoVazio();
  for (const linha of linhas) {
    const grupo = classificarGrupoVenda(linha.status as SaleStatus);
    resumo[grupo].quantidade += 1;
    resumo[grupo].vgv += Number(linha.valor_negociado ?? 0);
  }
  return resumo;
}

/**
 * Busca status + valor_negociado das vendas de um conjunto de corretores (RLS de `sales` já
 * restringe o que cada papel pode ver — corretor só as próprias, gestor/team_leader só as da
 * equipe que lidera) e agrega por grupo de negócio. Um único corretor_id é só `[corretorId]`.
 */
export async function fetchResumoGrupoVenda(corretorIds: string[]): Promise<ResumoPorGrupo> {
  if (corretorIds.length === 0) return resumoVazio();
  const { data, error } = await supabase
    .from("sales")
    .select("status, valor_negociado")
    .in("corretor_id", corretorIds);
  if (error) throw error;
  return agruparVendasPorGrupoComVgv(data ?? []);
}
