// Minha carreira, PR 4 (cards t_5a47a73c e t_3f1d4f0f): regras puras do bloco "Meu dinheiro".
// Os dados vêm da RPC minhas_comissoes (migração 20261016170000), que já devolve só a comissão do
// corretor logado, uma linha por venda. Decisão de Denis (16/10): mostrar só o total de comissão a que
// ele tem direito — sem "recebido"/"a receber", porque o sistema não registra o repasse ao corretor.

export type MinhaComissao = {
  sale_id: string;
  venda_em: string | null;
  imovel: string | null;
  papel: string | null;
  minha_comissao: number;
};

export type PeriodoDinheiro = "mes" | "ano" | "todas";

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

export function normalizarComissao(r: Record<string, unknown>): MinhaComissao {
  return {
    sale_id: String(r.sale_id),
    venda_em: (r.venda_em as string | null) ?? null,
    imovel: (r.imovel as string | null) ?? null,
    papel: (r.papel as string | null) ?? null,
    minha_comissao: num(r.minha_comissao) ?? 0,
  };
}

/** Vendas do período pela data da venda; `hoje` no horário de São Paulo (AAAA-MM-DD). */
export function filtrarPeriodo(
  lista: MinhaComissao[],
  periodo: PeriodoDinheiro,
  hoje: string,
): MinhaComissao[] {
  if (periodo === "todas") return lista;
  const prefixo = periodo === "mes" ? hoje.slice(0, 7) : hoje.slice(0, 4);
  return lista.filter((c) => (c.venda_em ?? "").startsWith(prefixo));
}

/** Mais recentes primeiro; vendas sem data no fim. */
export function ordenarPorData(lista: MinhaComissao[]): MinhaComissao[] {
  return [...lista].sort((a, b) => (b.venda_em ?? "").localeCompare(a.venda_em ?? ""));
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export const totalComissao = (lista: MinhaComissao[]) =>
  r2(lista.reduce((s, c) => s + c.minha_comissao, 0));

/** "28/10/2026" a partir de "2026-10-28"; "—" se vazio. */
export function dataBR(d: string | null): string {
  if (!d) return "—";
  const [y, m, dd] = d.slice(0, 10).split("-");
  return `${dd}/${m}/${y}`;
}
