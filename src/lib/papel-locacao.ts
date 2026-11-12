// Papel geral "Locação" (card t_1fe07126, tópico 6238). Decisões de Denis (12/11/2026): 1, 2 e 3 = sim.
// Quem tem SÓ esse papel enxerga apenas Início, Locação (com Sugestões e erros e a Ajuda MAX da locação),
// Reserva de salas, Mural de Conquistas e a própria conta. O banco é a proteção real (is_active_user,
// RLS restritiva zz_locacao_fora e os *_enabled() — migration 20261122120100); aqui só se escolhe o menu e
// para onde a rota manda. NÃO confundir com os papéis internos da Locação (gestora, contratos, vistoria,
// financeiro), que continuam em locacao_papeis.

/**
 * Tem o papel locacao e nenhum outro papel de agência (mesma regra de public.eh_so_locacao).
 * O 'fotografo' junto não libera nada: Locação + Fotógrafo continua só-Locação (falha fechada, igual ao banco).
 */
export function ehSoLocacao(roles: readonly string[]): boolean {
  return roles.includes("locacao") && roles.every((r) => r === "locacao" || r === "fotografo");
}

/** Telas que o só-Locação abre (com as subpáginas). Qualquer outra rota leva para o Início. */
export const ROTAS_LOCACAO = [
  "/dashboard",
  "/locacoes",
  "/reservas-salas",
  "/mural-conquistas",
  "/notificacoes",
  "/perfil",
  "/ajuda",
] as const;

export const ENTRADA_LOCACAO = "/dashboard";

/** A rota está liberada para o só-Locação? (/locacoes inclui /locacoes/$id e /locacoes/sugestoes). */
export function rotaPermitidaLocacao(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return ROTAS_LOCACAO.some((r) => p === r || p.startsWith(`${r}/`));
}

/** Para onde mandar o usuário nesta navegação (null = segue para onde ia). */
export function destinoLocacao(roles: readonly string[], pathname: string): string | null {
  if (!ehSoLocacao(roles)) return null;
  return rotaPermitidaLocacao(pathname) ? null : ENTRADA_LOCACAO;
}
