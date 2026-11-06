import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// RPC da migration 20261105160000 (ainda fora de types.ts).
const db = supabase as unknown as SupabaseClient;

/** Sistemas com chave por imobiliária em organization_modules (Passo 3; só a plataforma liga e desliga). */
export type SistemaModulo = "visita" | "estudo" | "academia" | "sessenta";
const SISTEMAS: readonly SistemaModulo[] = ["visita", "estudo", "academia", "sessenta"];

/** Cartão do Hub -> módulo que o controla. Cartões fora daqui (ADM, Especialistas, Obah, "Em breve") não mudam. */
export const CARD_MODULO: Readonly<Record<string, SistemaModulo>> = {
  visita: "visita",
  estudo: "estudo",
  academia: "academia",
  "60dias": "sessenta",
};

/**
 * Sistemas ligados na imobiliária de quem está logado (plataforma = os 4).
 * `null` = não deu para saber (sem login, erro, resposta estranha): o Hub usa o padrão seguro.
 */
export async function sistemasLigados(): Promise<ReadonlySet<SistemaModulo> | null> {
  try {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) return null;
    const { data, error } = await db.rpc("sistemas_ligados");
    if (error || !Array.isArray(data)) return null;
    return new Set(data.filter((m): m is SistemaModulo => SISTEMAS.includes(m as SistemaModulo)));
  } catch {
    return null;
  }
}

/**
 * Nenhum cartão some (Denis, 06/11/2026, t_5ea3c841; revoga a decisão 3 de t_311cc909).
 * Desligado: o cartão continua no Hub e na roda, sem link, com o selo "Em breve".
 * Padrão seguro (`ligados === null`: sem login, carregando ou erro na leitura): igual ao de antes da etapa 1
 * (Academia e 60 Dias sem link, "Em breve"; Visita e Estudo com link).
 * Ligado: o cartão aparece com link; o 60 Dias ganha o link `sessentaHref` (passe da Conta MAX).
 * Tirar o link não bloqueia o sistema: o bloqueio no servidor é das etapas 2 a 4.
 */
export function aplicarSistemasLigados<T extends { id: string; href?: string }>(
  itens: readonly T[],
  ligados: ReadonlySet<SistemaModulo> | null,
  sessentaHref: string,
): T[] {
  if (ligados === null) {
    return itens.map((c) =>
      c.id === "academia" || c.id === "60dias" ? { ...c, href: undefined } : c,
    );
  }
  return itens.map((c) => {
    const mod = CARD_MODULO[c.id];
    if (!mod) return c;
    if (!ligados.has(mod)) return { ...c, href: undefined };
    return c.id === "60dias" ? { ...c, href: sessentaHref } : c;
  });
}
