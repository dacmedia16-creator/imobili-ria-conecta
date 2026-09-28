import { supabase } from "@/integrations/supabase/client";
import { classificarGrupoVenda, type GrupoVenda, type SaleStatus } from "@/lib/status";
import { fetchMetricasSemParceria } from "@/lib/metricas-sem-parceria-query";
import { corretoresDaVenda } from "@/lib/sale-permissions";

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
 *
 * `"todas"` (em vez de uma lista de IDs) é pra financeiro/admin/super_admin: esses papéis já
 * enxergam toda a tabela `sales` via RLS (ver sales_select em
 * 20260804200100_team_leader_same_perms_as_gestor.sql), então filtrar por `.in("corretor_id", ...)`
 * seria redundante — e exigiria antes buscar a lista de todos os corretores do sistema só pra
 * repassar aqui.
 */
export async function fetchResumoGrupoVenda(
  corretorIds: string[] | "todas",
): Promise<ResumoPorGrupo> {
  if (corretorIds !== "todas" && corretorIds.length === 0) return resumoVazio();
  // Atribuição pelos PARTICIPANTES da venda (captador, vendedor e extras corretor_*), nunca por
  // quem cadastrou (sales.corretor_id só vale como fallback quando não há participante).
  const [{ data, error }, extrasRes, metricas] = await Promise.all([
    supabase
      .from("sales")
      .select("id, status, valor_negociado, corretor_id, corretor_captador_id, corretor_vendedor_id"),
    corretorIds === "todas"
      ? Promise.resolve({ data: [], error: null })
      : // Todos os extras de corretor (não só os do alvo): sem eles, uma venda cujos corretores
        // estão só em extras cairia no fallback do criador e contaria para ele.
        supabase
          .from("sale_commission_extras")
          .select("sale_id, papel, user_id")
          .in("papel", ["corretor_captador", "corretor_vendedor"]),
    fetchMetricasSemParceria(),
  ]);
  if (error) throw error;
  if (extrasRes.error) throw extrasRes.error;
  const extrasPorVenda = new Map<string, { papel: string | null; user_id: string | null }[]>();
  for (const e of (extrasRes.data ?? []) as {
    sale_id: string;
    papel: string | null;
    user_id: string | null;
  }[]) {
    extrasPorVenda.set(e.sale_id, [...(extrasPorVenda.get(e.sale_id) ?? []), e]);
  }
  const alvo = corretorIds === "todas" ? null : new Set(corretorIds);
  const linhas = (data ?? []).filter(
    (v) =>
      !alvo ||
      corretoresDaVenda(v, extrasPorVenda.get(v.id) ?? []).some((id) => alvo.has(id)),
  );
  return agruparVendasPorGrupoComVgv(
    linhas.map((v) => ({
      status: v.status,
      valor_negociado: metricas.get(v.id)?.vgvProprio ?? 0,
    })),
  );
}

/**
 * VGV ativo total = VGV em andamento (grupo "futura") + VGV confirmado (grupo "confirmada"),
 * cada venda contada exatamente uma vez porque vem de `agruparVendasPorGrupoComVgv`
 * (classificação por status ATUAL, mutuamente exclusiva — ver classificarGrupoVenda). Preparação e
 * encerrada (cancelada/arquivada) ficam de fora por construção, não somados aqui.
 */
export function vgvAtivoTotal(resumo: ResumoPorGrupo): ResumoGrupoVenda {
  return {
    quantidade: resumo.futura.quantidade + resumo.confirmada.quantidade,
    vgv: resumo.futura.vgv + resumo.confirmada.vgv,
  };
}
