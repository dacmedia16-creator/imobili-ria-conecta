import { isExpired, type OpportunityKind, type OpportunityPost } from "@/lib/oportunidades";

/** Faixas de valor do filtro, iguais às da maquete aprovada. */
export const FAIXAS_VALOR: { id: string; label: string; min: number; max: number }[] = [
  { id: "loc-ate-3k", label: "Locação até R$ 3 mil", min: 0, max: 3_000 },
  { id: "loc-3k", label: "Locação acima de R$ 3 mil", min: 3_000, max: 20_000 },
  { id: "ate-400k", label: "Até R$ 400 mil", min: 20_000, max: 400_000 },
  { id: "400-800k", label: "R$ 400 a 800 mil", min: 400_000, max: 800_000 },
  { id: "800k", label: "Acima de R$ 800 mil", min: 800_000, max: 99_999_999 },
];

export type FiltrosMural = {
  tipo?: string;
  finalidade?: string;
  bairro?: string;
  faixa?: string;
  corretor?: string;
  busca?: string;
};

/** Valor usado no filtro: oferta = preço; procura = teto (como na maquete). */
export const valorDoFiltro = (p: OpportunityPost) => p.valor ?? p.valor_max ?? p.valor_min;

/** Aplica validade (7 dias) e todos os filtros juntos (E lógico). */
export function filtrarMural(posts: OpportunityPost[], f: FiltrosMural, now: Date = new Date()): OpportunityPost[] {
  const faixa = FAIXAS_VALOR.find((x) => x.id === f.faixa);
  const q = (f.busca ?? "").trim().toLowerCase();
  return posts.filter((p) => {
    if (isExpired(p.posted_at, now)) return false;
    if (f.tipo && p.tipo !== f.tipo) return false;
    if (f.finalidade && p.finalidade !== f.finalidade) return false;
    if (f.bairro && p.bairro !== f.bairro) return false;
    if (f.corretor && p.corretor !== f.corretor) return false;
    if (faixa) {
      const v = valorDoFiltro(p);
      if (!v || v < faixa.min || v > faixa.max) return false;
    }
    if (q && !`${p.texto} ${p.bairro ?? ""} ${p.corretor} ${p.tipo ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export const contarPorAba = (posts: OpportunityPost[], kind: OpportunityKind) =>
  posts.filter((p) => p.kind === kind).length;

/** Data curta do post (dd/mm) no fuso de São Paulo. */
export const dataCurta = (postedAt: string) =>
  new Date(postedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
