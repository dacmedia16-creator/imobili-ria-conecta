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
  data_assinatura: string | null;
};

export type VendaConcluidaRaw = {
  id: string;
  codigo_interno: string | null;
  imovel_id: string | null;
  corretor_id: string | null;
};

export type OcorrenciaConcluidaRow = {
  saleId: string;
  imovelLabel: string;
  corretorNome: string | null;
  valorComissao: number;
  dataAssinatura: string | null;
};

/** Mês atual para manter a opção disponível mesmo sem registros. */
export function chaveMesAtual(data: Date = new Date()): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}`;
}

export function mesesOcorrenciasConcluidas(rows: OcorrenciaConcluidaRow[], mesAtual: string) {
  const meses = new Set([
    mesAtual,
    // data_assinatura é DATE (YYYY-MM-DD), não um instante UTC.
    ...rows.flatMap((row) => (row.dataAssinatura ? [row.dataAssinatura.slice(0, 7)] : [])),
  ]);
  return [...meses]
    .sort()
    .reverse()
    .map((value) => {
      const [ano, mes] = value.split("-").map(Number);
      const label = new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric",
      });
      return { value, label: label.charAt(0).toUpperCase() + label.slice(1) };
    });
}

/** Uma única seleção alimenta a tabela e os dois cards, preservando a ordem recebida. */
export function resumoOcorrenciasConcluidas(rows: OcorrenciaConcluidaRow[], mes: string) {
  const filtradas =
    mes === "todos" ? rows : rows.filter((row) => row.dataAssinatura?.slice(0, 7) === mes);
  return {
    rows: filtradas,
    totalComissao: filtradas.reduce((total, row) => total + row.valorComissao, 0),
  };
}

/** Rótulo do imóvel/código, na ordem definida: codigo_interno → imovel_id → Venda #<id>. */
export function imovelOuCodigo(sale: {
  id: string;
  codigo_interno: string | null;
  imovel_id: string | null;
}): string {
  return sale.codigo_interno || sale.imovel_id || `Venda #${sale.id.slice(0, 8)}`;
}

/** Assinaturas mais recentes primeiro; sem assinatura ao final, sem inventar data.
 * Desempate por sale_id para ordenação determinística. */
export function montarOcorrenciasConcluidas(opts: {
  occs: OcorrenciaConcluidaRaw[];
  sales: VendaConcluidaRaw[];
  nomesPorId: Record<string, string>;
}): OcorrenciaConcluidaRow[] {
  const salePorId = new Map(opts.sales.map((s) => [s.id, s]));
  const rows: OcorrenciaConcluidaRow[] = opts.occs.map((occ) => {
    const sale = salePorId.get(occ.sale_id);
    return {
      saleId: occ.sale_id,
      imovelLabel: sale ? imovelOuCodigo(sale) : `Venda #${occ.sale_id.slice(0, 8)}`,
      corretorNome: sale?.corretor_id ? (opts.nomesPorId[sale.corretor_id] ?? null) : null,
      valorComissao: Number(occ.valor_comissao ?? 0),
      dataAssinatura: occ.data_assinatura || null,
    };
  });
  rows.sort(
    (a, b) =>
      (b.dataAssinatura ?? "").localeCompare(a.dataAssinatura ?? "") ||
      b.saleId.localeCompare(a.saleId),
  );
  return rows;
}
