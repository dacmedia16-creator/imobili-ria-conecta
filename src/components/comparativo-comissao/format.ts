// Formatação de exibição do Comparativo 6% — arredonda só aqui, nunca nos cálculos
// (comparativo-comissao-calc.ts trabalha com os valores cheios, sem arredondamento prematuro).
export const formatMoney = (v: number | null | undefined) =>
  v != null && Number.isFinite(v) ? `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

export const formatPercent = (v: number | null | undefined) =>
  v != null && Number.isFinite(v) ? `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 3 })}%` : "—";

export const formatDateBR = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString("pt-BR") : "—");
