// Leitura e gravação do tour (tabela public.user_tour_estado, migrations 20261026120000 e 20261026150000).
// A RLS só deixa cada pessoa ler e gravar a PRÓPRIA linha. Falha = não abre o tour sozinho (nunca
// atrapalha o uso).
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { TOUR_ADM_INICIO, novoAcessoNaSessao, type TourStatus } from "@/lib/tour-primeiro-acesso";

const db = supabase as unknown as SupabaseClient;

function armazenamentoDaSessao(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * true = o tour deve abrir sozinho agora. Conta 1 acesso por sessão da aba (recarregar ou trocar de
 * tela não conta) e o banco soma a abertura de forma atômica: só devolve true até a 3ª abertura.
 */
export async function registrarAberturaAutomatica(userId: string): Promise<boolean> {
  if (!novoAcessoNaSessao(armazenamentoDaSessao(), userId)) return false;
  const { data, error } = await db.rpc("tour_registrar_abertura", { p_tour: TOUR_ADM_INICIO });
  if (error) return false; // shortcut: função ausente/erro de rede = não abre sozinho nesta sessão.
  return data === true;
}

/** Guarda como terminou (concluído/fechado). Não mexe na contagem de aberturas. */
export async function gravarTour(userId: string, status: TourStatus, passo: number) {
  const { error } = await db.from("user_tour_estado").upsert(
    {
      user_id: userId,
      tour: TOUR_ADM_INICIO,
      status,
      passo: Math.max(0, Math.min(50, Math.trunc(passo))),
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: "user_id,tour" },
  );
  if (error) console.warn("Tour: não foi possível gravar a escolha no banco", error.message);
}
