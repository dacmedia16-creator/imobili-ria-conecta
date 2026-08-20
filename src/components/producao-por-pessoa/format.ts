// Formatação de exibição do "Produção Gerada por Pessoa" — arredonda só aqui, nunca nos cálculos
// (producao-por-pessoa-calc.ts trabalha com os valores já resolvidos, sem arredondamento prematuro
// além do round2 nas próprias fórmulas).
export const formatMoney = (v: number | null | undefined) =>
  v != null && Number.isFinite(v) ? `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

export const formatQtd = (v: number | null | undefined) =>
  v != null && Number.isFinite(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—";

export const formatDateTimeBR = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
