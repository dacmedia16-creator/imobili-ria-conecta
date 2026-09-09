/**
 * Lógica pura da página "Ocorrências concluídas" — nenhuma função aqui fala com o Supabase;
 * tudo é testável com dados soltos. A visibilidade por papel (gestor/team_leader só enxergam a
 * própria equipe; financeiro/admin/super_admin enxergam tudo) é imposta pela RLS no banco
 * (occ_view/history_view/sales_select passam por can_view_sale/is_lead_of), então este módulo
 * não faz nenhum filtro de papel — só monta/ordena o que a RLS já entregou.
 */

/** Papéis com acesso à página — fonte única, usada no item de menu (AppShell) e no beforeLoad. */
export const PAPEIS_OCORRENCIAS_CONCLUIDAS = [
  "gestor",
  "team_leader",
  "admin",
  "super_admin",
  "financeiro",
] as const;

export function podeVerOcorrenciasConcluidas(roles: readonly string[]): boolean {
  return roles.some((r) => (PAPEIS_OCORRENCIAS_CONCLUIDAS as readonly string[]).includes(r));
}

export type OcorrenciaConcluidaRaw = {
  id: string;
  sale_id: string;
  valor_comissao: number | null;
  updated_at: string;
};

export type VendaConcluidaRaw = {
  id: string;
  codigo_interno: string | null;
  imovel_id: string | null;
  corretor_id: string | null;
};

export type ConclusaoHistoryRaw = {
  sale_id: string;
  created_at: string;
};

export type OcorrenciaConcluidaRow = {
  saleId: string;
  imovelLabel: string;
  corretorNome: string | null;
  valorComissao: number;
  dataConclusao: string;
};

/** Rótulo do imóvel/código, na ordem definida: codigo_interno → imovel_id → Venda #<id>. */
export function imovelOuCodigo(sale: {
  id: string;
  codigo_interno: string | null;
  imovel_id: string | null;
}): string {
  return sale.codigo_interno || sale.imovel_id || `Venda #${sale.id.slice(0, 8)}`;
}

/** Data de conclusão por venda — a mais recente entrada `para = 'ocorrencia_concluida'` do
 * histórico (uma venda pode ser reaberta e reconcluída, gerando mais de um registro). */
export function ultimaConclusaoPorSale(history: ConclusaoHistoryRaw[]): Record<string, string> {
  const porSale: Record<string, string> = {};
  for (const h of history) {
    const atual = porSale[h.sale_id];
    if (!atual || h.created_at > atual) porSale[h.sale_id] = h.created_at;
  }
  return porSale;
}

/** Monta a lista de ocorrências concluídas ordenada por data de conclusão (mais recente primeiro),
 * com fallback de data para `occurrences.updated_at` quando não há registro de conclusão no
 * histórico (fonte primária). Desempate por sale_id pra ordenação ser determinística. */
export function montarOcorrenciasConcluidas(opts: {
  occs: OcorrenciaConcluidaRaw[];
  sales: VendaConcluidaRaw[];
  nomesPorId: Record<string, string>;
  conclusoesPorSale: Record<string, string>;
}): OcorrenciaConcluidaRow[] {
  const salePorId = new Map(opts.sales.map((s) => [s.id, s]));
  const rows: OcorrenciaConcluidaRow[] = opts.occs.map((occ) => {
    const sale = salePorId.get(occ.sale_id);
    return {
      saleId: occ.sale_id,
      imovelLabel: sale ? imovelOuCodigo(sale) : `Venda #${occ.sale_id.slice(0, 8)}`,
      corretorNome: sale?.corretor_id ? (opts.nomesPorId[sale.corretor_id] ?? null) : null,
      valorComissao: Number(occ.valor_comissao ?? 0),
      dataConclusao: opts.conclusoesPorSale[occ.sale_id] ?? occ.updated_at,
    };
  });
  rows.sort(
    (a, b) => b.dataConclusao.localeCompare(a.dataConclusao) || b.saleId.localeCompare(a.saleId),
  );
  return rows;
}
