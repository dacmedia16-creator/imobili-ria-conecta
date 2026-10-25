import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { CONSENTIMENTO_LGPD, FORM_TEMPO_MINIMO_MS, FORM_TOKEN_RE } from "@/lib/leads";

/**
 * Formulário público de teste dos leads (P2, card t_9a8dccc7). Sem login.
 * Proteção anti-spam gratuita, em camadas: campo-armadilha + tempo mínimo (aqui) e limite por IP
 * e por imobiliária no banco (lead_form_enviar). O IP nunca é gravado: só um hash SHA-256 com sal.
 * Só o servidor (service_role) chama as funções do banco; anon/authenticated não têm acesso.
 * Nenhuma mensagem é enviada ao cliente nem ao corretor fora do sino do ADM.
 */
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

const tokenSchema = z.string().regex(FORM_TOKEN_RE);

async function hashIp(): Promise<string | null> {
  // No Worker, a Cloudflare sobrescreve cf-connecting-ip (o visitante não consegue forjar).
  const ip = getRequest()?.headers.get("cf-connecting-ip")?.trim();
  // Sal secreto do servidor (nunca público): sem ele o hash poderia ser revertido testando IPs.
  const sal = process.env.LEADS_FORM_SAL || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!ip || !sal) return null;
  const bytes = new TextEncoder().encode(`${sal}|${ip}`);
  const dig = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(dig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const lerFormularioLead = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: tokenSchema }).parse(input))
  .handler(async ({ data }) => {
    const { data: info, error } = await (
      await admin()
    ).rpc("lead_form_info", {
      _token: data.token,
    });
    if (error || !info) return { ok: false as const };
    return {
      ok: true as const,
      imobiliaria: String((info as { imobiliaria?: string }).imobiliaria ?? ""),
    };
  });

const envioSchema = z.object({
  token: tokenSchema,
  nome: z.string().trim().min(1).max(120),
  telefone: z.string().max(30).default(""),
  email: z.string().trim().max(160).default(""),
  mensagem: z.string().max(1000).default(""),
  imovel: z.string().uuid().nullable().default(null),
  consentimento: z.literal(true),
  site: z.string().max(200).default(""),
  abertoHaMs: z.number().int().min(0).max(86_400_000),
});

export const enviarFormularioLead = createServerFn({ method: "POST" })
  .validator((input: unknown) => envioSchema.parse(input))
  .handler(async ({ data }) => {
    // Robô: responde "ok" sem gravar (não ensina o robô a contornar).
    if (data.site.trim() !== "" || data.abertoHaMs < FORM_TEMPO_MINIMO_MS) return { ok: true };
    const ipHash = await hashIp();
    if (!ipHash) return { ok: false, erro: "indisponivel" };
    const { data: r, error } = await (
      await admin()
    ).rpc("lead_form_enviar", {
      _token: data.token,
      _nome: data.nome,
      _telefone: data.telefone,
      _email: data.email,
      _mensagem: data.mensagem,
      _capture_id: data.imovel,
      _consentimento: CONSENTIMENTO_LGPD,
      _ip_hash: ipHash,
    });
    if (error) return { ok: false, erro: "falha" };
    return r as { ok: boolean; erro?: string };
  });
