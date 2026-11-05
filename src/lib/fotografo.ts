// Papel "Fotógrafo" (card t_0666d3f0). Decisão de Denis (05/11/2026): "é só fotógrafo".
// Quem tem SÓ esse papel enxerga apenas a área de fotos. O banco é a proteção real
// (is_active_user, RLS restritiva zz_fotografo_fora e os *_enabled() — migration 20261105130100);
// aqui só se escolhe o menu e para onde a rota manda.

/** Tem o papel fotografo e nenhum outro (mesma regra de public.eh_so_fotografo). */
export function ehSoFotografo(roles: readonly string[]): boolean {
  return roles.length > 0 && roles.every((r) => r === "fotografo");
}

/** Telas que o só-fotógrafo abre. Qualquer outra rota leva para /fotografo. */
export const ROTAS_FOTOGRAFO = ["/fotografo", "/notificacoes", "/perfil", "/ajuda"] as const;

export const ENTRADA_FOTOGRAFO = "/fotografo";

/** A rota está liberada para o só-fotógrafo? (/ajuda inclui as subpáginas, como /ajuda/wiki). */
export function rotaPermitidaFotografo(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return ROTAS_FOTOGRAFO.some((r) => p === r || p.startsWith(`${r}/`));
}

/** Para onde mandar o usuário nesta navegação (null = segue para onde ia). */
export function destinoFotografo(roles: readonly string[], pathname: string): string | null {
  if (!ehSoFotografo(roles)) return null;
  return rotaPermitidaFotografo(pathname) ? null : ENTRADA_FOTOGRAFO;
}

/** Abas da tela /fotografo (o menu do fotógrafo aponta direto para cada uma). */
export const ABAS_FOTOGRAFO = ["sessoes", "faixas", "historico"] as const;
export type AbaFotografo = (typeof ABAS_FOTOGRAFO)[number];
export function abaFotografo(v: unknown): AbaFotografo | undefined {
  return (ABAS_FOTOGRAFO as readonly unknown[]).includes(v) ? (v as AbaFotografo) : undefined;
}
