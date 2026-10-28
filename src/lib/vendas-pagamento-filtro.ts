import { supabase } from "@/integrations/supabase/client";

/**
 * Filtro "Pagamento" da lista de Vendas (t_7538ddac). "todas" = sem filtro.
 * Os valores batem com sale_payment.tipo_pagamento; NAO_INFORMADO = venda sem linha em sale_payment
 * (tipo_pagamento é NOT NULL, então "sem tipo" não existe no banco).
 */
export const PAGAMENTO_NAO_INFORMADO = "__nao_informado__";

export const PAGAMENTO_FILTER_OPTIONS: { key: string; label: string }[] = [
  { key: "financiamento", label: "Financiada" },
  { key: "vista", label: "À vista" },
  { key: "consorcio", label: "Consórcio" },
  { key: PAGAMENTO_NAO_INFORMADO, label: "Não informado" },
];

export function pagamentoFilterValido(v: string | null | undefined): v is string {
  return (
    typeof v === "string" && (v === "todas" || PAGAMENTO_FILTER_OPTIONS.some((o) => o.key === v))
  );
}

/** Valor enviado à RPC (parâmetro _pagamento): undefined quando não há filtro. */
export function pagamentoFilterParam(f: string): string | undefined {
  return f === "todas" ? undefined : f;
}

/**
 * Seleção de vendas para o cartão de efetivadas (mesma regra da RPC):
 * - tipo escolhido: incluir só as vendas com esse tipo;
 * - "Não informado": excluir todas as vendas que têm pagamento visível.
 */
export type SelecaoPagamento = { modo: "incluir" | "excluir"; ids: Set<string> };

/** Lê sale_payment com a RLS do usuário (só o que ele já vê); null = sem filtro. */
export async function fetchSelecaoPorPagamento(f: string): Promise<SelecaoPagamento | null> {
  if (f === "todas") return null;
  const naoInformado = f === PAGAMENTO_NAO_INFORMADO;
  const ids = new Set<string>();
  const LOTE = 1000;
  for (let de = 0; ; de += LOTE) {
    const base = supabase.from("sale_payment").select("sale_id");
    const filtrada = naoInformado ? base : base.eq("tipo_pagamento", f);
    const { data, error } = await filtrada.order("sale_id").range(de, de + LOTE - 1);
    if (error) throw error;
    for (const r of data ?? []) ids.add(r.sale_id);
    if (!data || data.length < LOTE) break;
  }
  return { modo: naoInformado ? "excluir" : "incluir", ids };
}

export function filtrarPorPagamento<T extends { saleId: string }>(
  rows: T[],
  sel: SelecaoPagamento | null,
): T[] {
  if (!sel) return rows;
  return rows.filter((r) => (sel.modo === "incluir") === sel.ids.has(r.saleId));
}

/** Texto da etiqueta "Financiada" (hover/toque): banco e correspondente quando preenchidos. */
export function detalheFinanciada(
  banco: string | null | undefined,
  correspondente: string | null | undefined,
): string {
  const partes = ["Financiada"];
  if (banco?.trim()) partes.push(`Banco: ${banco.trim()}`);
  if (correspondente?.trim()) partes.push(`Correspondente: ${correspondente.trim()}`);
  return partes.join(" · ");
}

export function ehFinanciada(tipo: string | null | undefined): boolean {
  return tipo === "financiamento";
}
