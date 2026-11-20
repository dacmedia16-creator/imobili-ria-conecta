/**
 * Quem vê "Minha imobiliária" e quem continua com "Minha carreira" (cartão t_f7f1b3e4, Denis 20/11/2026).
 * Arquivo leve, sem imports: o menu e as guardas de rota usam sem carregar a tela.
 * - Dono (Administrador principal, super_admin) e administrador (admin): veem SÓ "Minha imobiliária".
 * - Gestor, Team Leader e corretor (sem papel de administração): continuam com "Minha carreira".
 * O banco é a proteção real: minha_imobiliaria_resumo/atividades recusam quem não é dono/admin desta imobiliária.
 */
export const PAPEIS_MINHA_IMOBILIARIA = ["admin", "super_admin"] as const;
export const PAPEIS_MINHA_CARREIRA = ["corretor", "gestor", "team_leader"] as const;

const tem = (roles: readonly string[], lista: readonly string[]) =>
  roles.some((r) => lista.includes(r));

export function podeVerMinhaImobiliaria(roles: readonly string[]): boolean {
  return tem(roles, PAPEIS_MINHA_IMOBILIARIA);
}

/** Minha carreira: corretor, gestor ou TL que NÃO é dono/admin (o admin que vende também perde a carreira). */
export function podeVerMinhaCarreira(roles: readonly string[]): boolean {
  return tem(roles, PAPEIS_MINHA_CARREIRA) && !podeVerMinhaImobiliaria(roles);
}
