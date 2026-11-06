import type { AppRole } from "@/lib/auth";

/**
 * Quem vê o "Valor para a imobiliária" (o que sobra pra casa) na divisão de comissão da venda.
 * Reunião com broker (05/11/2026) + Denis 06/11: "broker, financeiro, admin continua vendo";
 * corretor, Team Leader, gestor e demais papéis NÃO veem.
 * Não existe papel "broker" no sistema: o dono/broker da imobiliária é o "Administrador principal"
 * (super_admin da organização). Os papéis vêm de user_roles da própria organização (ou os virtuais
 * do contexto da plataforma), então nada é liberado por papel de outra imobiliária.
 * Só esconde na TELA: cálculo, banco, validações e relatórios do Financeiro seguem iguais.
 */
export const PAPEIS_VEEM_VALOR_IMOBILIARIA: AppRole[] = ["super_admin", "admin", "financeiro"];

export function podeVerValorImobiliaria(roles: readonly AppRole[]): boolean {
  return roles.some((r) => PAPEIS_VEEM_VALOR_IMOBILIARIA.includes(r));
}
