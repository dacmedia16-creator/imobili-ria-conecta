import { supabase } from "@/integrations/supabase/client";
import { MIDIA_OPTIONS } from "@/lib/status";

/** Filtro "Mídia" da lista de Vendas. "todas" = sem filtro; SEM_MIDIA_FILTER = vendas sem mídia. */
export const SEM_MIDIA_FILTER = "__sem_midia__";

export const MIDIA_FILTER_OPTIONS: { key: string; label: string }[] = [
  ...MIDIA_OPTIONS,
  { key: SEM_MIDIA_FILTER, label: "Sem mídia" },
];

export function midiaFilterValido(v: string | null | undefined): v is string {
  return typeof v === "string" && (v === "todas" || MIDIA_FILTER_OPTIONS.some((o) => o.key === v));
}

/** Valor enviado à RPC (parâmetro _midia): undefined quando não há filtro. */
export function midiaFilterParam(f: string): string | undefined {
  return f === "todas" ? undefined : f;
}

/** IDs das vendas (visíveis ao usuário, via RLS) com a mídia escolhida; null = sem filtro. */
export async function fetchSaleIdsPorMidia(f: string): Promise<Set<string> | null> {
  if (f === "todas") return null;
  const ids = new Set<string>();
  const LOTE = 1000;
  for (let de = 0; ; de += LOTE) {
    const base = supabase.from("sales").select("id");
    const filtrada = f === SEM_MIDIA_FILTER ? base.is("midia", null) : base.eq("midia", f);
    const { data, error } = await filtrada.order("id").range(de, de + LOTE - 1);
    if (error) throw error;
    for (const r of data ?? []) ids.add(r.id);
    if (!data || data.length < LOTE) break;
  }
  return ids;
}

/** Aplica o filtro de mídia a linhas que tenham saleId (ex.: efetivadas do resumo financeiro). */
export function filtrarPorSaleIds<T extends { saleId: string }>(
  rows: T[],
  ids: Set<string> | null,
): T[] {
  return ids ? rows.filter((r) => ids.has(r.saleId)) : rows;
}
