/**
 * Formatador único de reais (item 24, t_55ee647c): sempre 2 casas, nunca 3.
 * Só apresentação — não arredonda nem altera nenhum valor guardado ou calculado.
 * Mantém o formato "R$ 1.234,56" (espaço comum) que as telas já usavam.
 */
export function formatBRL(v: unknown): string {
  return `R$ ${Number(v ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Igual a formatBRL, mas devolve `vazio` quando não há valor. */
export function formatBRLOu<T>(v: unknown, vazio: T): string | T {
  return v != null ? formatBRL(v) : vazio;
}
