import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CODIGO_RE,
  TOKEN_RE,
  lerPropostaPublica,
  lerResultadoAssinatura,
  type LeituraPublica,
  type ResultadoAssinatura,
} from "@/lib/proposta-compra";

/**
 * Servidor da proposta de compra (t_4cff61a6). Mesmo desenho do link de acompanhamento:
 * - Enviar/Reenviar: o banco confere quem pode (login de quem clicou) e gera os códigos; só o servidor
 *   (service_role) lê o código para montar a mensagem. Neste cartão o canal é SIMULAÇÃO (nada sai).
 * - Página pública: sem login; só o servidor chama as RPCs públicas; o IP do limite vai como hash com sal;
 *   IP e aparelho em claro só entram no registro da assinatura (prova pedida por Denis).
 */
async function hashIp(ip: string | null): Promise<string | null> {
  const sal = process.env.LEADS_FORM_SAL || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!ip || !sal) return null;
  const dig = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`proposta|${sal}|${ip}`));
  return Array.from(new Uint8Array(dig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function requisicao(): { ip: string | null; userAgent: string | null } {
  const h = getRequest()?.headers;
  // No Worker, a Cloudflare sobrescreve cf-connecting-ip (o visitante não consegue forjar).
  return {
    ip: h?.get("cf-connecting-ip")?.trim() || null,
    userAgent: h?.get("user-agent")?.slice(0, 500) || null,
  };
}

async function admin(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

export const enviarProposta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        propostaId: z.string().uuid(),
        partes: z.array(z.string().uuid()).max(60).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { canalDoAmbiente, enviarCodigos } = await import("@/lib/proposta-compra-envio.server");
    const { APP_URL } = await import("@/lib/sale-notifications.functions");
    const user = context.supabase as unknown as SupabaseClient;
    const { data: prep, error } = await user.rpc("proposta_envio_preparar", {
      _id: data.propostaId,
      _partes: data.partes ?? null,
    });
    if (error) throw new Error(error.message);
    const p = (prep ?? {}) as { codigos?: { codigo_id: string }[]; sem_telefone?: string[]; aguarde?: string[] };
    const ids = (p.codigos ?? []).map((c) => c.codigo_id);
    const adm = await admin();
    const canal = canalDoAmbiente(process.env);
    let itens: unknown[] = [];
    if (ids.length) {
      const { data: d, error: e2 } = await adm.rpc("proposta_envio_dados", { _codigo_ids: ids });
      if (e2) throw new Error("Não foi possível preparar o envio.");
      itens = Array.isArray(d) ? d : [];
    }
    const resultados = await enviarCodigos(itens as never, {
      origin: APP_URL,
      canal,
      soPara: process.env.PROPOSTA_WHATSAPP_SO_PARA ?? null,
      registrar: async (codigoId, ok, erro) => {
        await adm.rpc("proposta_envio_resultado", { _codigo_id: codigoId, _ok: ok, _erro: erro });
      },
    });
    return {
      modo: canal.modo,
      resultados,
      semTelefone: p.sem_telefone?.length ?? 0,
      aguarde: p.aguarde?.length ?? 0,
    };
  });

export const lerPropostaLink = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: z.string().regex(TOKEN_RE) }).parse(input))
  .handler(async ({ data }): Promise<LeituraPublica> => {
    const ipHash = await hashIp(requisicao().ip);
    if (!ipHash) return { ok: false, erro: "invalido" };
    const { data: r, error } = await (await admin()).rpc("proposta_publica_ler", {
      _token: data.token,
      _ip_hash: ipHash,
    });
    if (error) return { ok: false, erro: "indisponivel" };
    return lerPropostaPublica(r);
  });

export const assinarPropostaLink = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        token: z.string().regex(TOKEN_RE),
        codigo: z.string().regex(CODIGO_RE),
        conteudoHash: z.string().regex(/^[0-9a-f]{64}$/),
        aceite: z.literal(true),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<ResultadoAssinatura> => {
    const req = requisicao();
    const ipHash = await hashIp(req.ip);
    if (!ipHash) return { ok: false, erro: "invalido" };
    const { data: r, error } = await (await admin()).rpc("proposta_publica_assinar", {
      _token: data.token,
      _codigo: data.codigo,
      _conteudo_hash: data.conteudoHash,
      _aceite: data.aceite,
      _ip: req.ip,
      _user_agent: req.userAgent,
      _ip_hash: ipHash,
    });
    if (error) return { ok: false, erro: "indisponivel" };
    return lerResultadoAssinatura(r);
  });
