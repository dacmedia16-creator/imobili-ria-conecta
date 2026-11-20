/**
 * Quem abre o painel de metas 2027 da IMOBILIÁRIA (rota e menu) — cartão t_69d29df6. Arquivo leve, sem imports,
 * para o menu não carregar a regra de cálculo. Gestor e administrador; TL e corretor não (o TL usa o painel das
 * equipes). O banco é a proteção real: metas_comissao_quebra e metas_imobiliaria_estoque recusam os demais.
 */
export const PAPEIS_PAINEL_IMOBILIARIA = ["gestor", "admin", "super_admin"] as const;

export function podeAcessarPainelImobiliaria(roles: readonly string[]): boolean {
  return roles.some((r) => (PAPEIS_PAINEL_IMOBILIARIA as readonly string[]).includes(r));
}
