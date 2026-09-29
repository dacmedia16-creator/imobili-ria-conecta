/**
 * Estado de telas de detalhe acessadas por ID na URL (/vendas/:id, /exclusividades/:id).
 *
 * Regra de segurança: a tela NUNCA pode distinguir "o ID não existe" de "o ID existe, mas é de
 * outra imobiliária / sem permissão". Com RLS as duas situações chegam iguais (zero linhas ou
 * PGRST116), e um ID malformado chega como erro 22P02. Todas viram o mesmo estado neutro
 * `not_found`. Só falha de rede/servidor (sem código do PostgREST) vira `error`, com botão de tentar
 * de novo — isso não revela nada sobre o registro.
 */
export type DetailRouteState = "loading" | "ready" | "not_found" | "error";

export const DETAIL_NOT_FOUND_MESSAGE = {
  venda: "Venda não encontrada ou sem acesso.",
  captacao: "Captação não encontrada ou sem acesso.",
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ID de rota com formato válido. IDs malformados nem precisam ir ao banco. */
export function isDetailRouteId(id: string | null | undefined): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

type LoadError = { code?: unknown; status?: unknown; message?: unknown } | null | undefined;

/** Erro de infraestrutura (rede, 5xx) em vez de "sem linha/sem permissão/ID inválido". */
export function isTransientLoadError(error: LoadError): boolean {
  if (!error) return false;
  const code = typeof error.code === "string" ? error.code : "";
  const status = typeof error.status === "number" ? error.status : 0;
  // Códigos PostgREST/PostgreSQL (PGRST116, 22P02, 42501...) significam que o banco respondeu:
  // tratar como "não encontrada ou sem acesso".
  if (code && !/^(08|53|57|58)/.test(code)) return false;
  if (status >= 400 && status < 500) return false;
  return true;
}

export function resolveDetailRouteState(input: {
  loading: boolean;
  record: unknown;
  error?: LoadError;
}): DetailRouteState {
  if (input.loading) return "loading";
  if (input.record) return "ready";
  return isTransientLoadError(input.error) ? "error" : "not_found";
}
