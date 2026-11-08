import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { LINK_TOKEN_RE, lerRespostaPublica, type LeituraPublica } from "@/lib/link-acompanhamento";

/**
 * Página pública do link de acompanhamento (t_54c79bdc). Sem login.
 * Mesmo desenho do formulário público de leads (leads-form.functions.ts): só o servidor (service_role) chama a
 * função do banco; anon/authenticated não têm acesso. O IP nunca é gravado: só um hash SHA-256 com sal, usado
 * no limite de tentativas. A resposta passa por lerRespostaPublica (lista fechada de campos).
 */
async function hashIp(): Promise<string | null> {
  // No Worker, a Cloudflare sobrescreve cf-connecting-ip (o visitante não consegue forjar).
  const ip = getRequest()?.headers.get("cf-connecting-ip")?.trim();
  const sal = process.env.LEADS_FORM_SAL || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!ip || !sal) return null;
  const bytes = new TextEncoder().encode(`acompanhamento|${sal}|${ip}`);
  const dig = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(dig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const lerAcompanhamento = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: z.string().regex(LINK_TOKEN_RE) }).parse(input))
  .handler(async ({ data }): Promise<LeituraPublica> => {
    const ipHash = await hashIp();
    if (!ipHash) return { ok: false };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: r, error } = await (supabaseAdmin as unknown as SupabaseClient).rpc(
      "acompanhamento_publico",
      { _token: data.token, _ip_hash: ipHash },
    );
    if (error) return { ok: false };
    return lerRespostaPublica(r);
  });
