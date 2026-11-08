import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Chave pública VAPID para o aparelho se inscrever no push (cartão t_c337fc12). Ela não é segredo,
 * mas fica guardada como secret do Worker (VAPID_PUBLIC_KEY) junto com a privada, nunca no código.
 * Sem a chave configurada devolve null e a tela mostra "push indisponível".
 */
export const chavePublicaPush = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ chave: string | null }> => {
    const chave = process.env.VAPID_PUBLIC_KEY?.trim();
    return { chave: chave && /^[A-Za-z0-9_-]{80,100}$/.test(chave) ? chave : null };
  });
