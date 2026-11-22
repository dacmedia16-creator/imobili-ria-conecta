/**
 * Quem abre o painel de metas 2027 da IMOBILIÁRIA (rota e menu) — cartão t_69d29df6. Arquivo leve, sem imports,
 * para o menu não carregar a regra de cálculo. Só administrador e Administrador principal (t_82b66d41, Denis
 * 22/11/2026: gestor vê só a própria equipe, no painel das equipes, como o TL). O banco é a proteção real:
 * metas_comissao_quebra e metas_imobiliaria_estoque recusam os demais (migration 20261219130000).
 */
export const PAPEIS_PAINEL_IMOBILIARIA = ["admin", "super_admin"] as const;

export function podeAcessarPainelImobiliaria(roles: readonly string[]): boolean {
  return roles.some((r) => (PAPEIS_PAINEL_IMOBILIARIA as readonly string[]).includes(r));
}
