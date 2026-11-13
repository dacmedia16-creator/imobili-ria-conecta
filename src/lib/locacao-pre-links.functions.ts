import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Link do cliente na PRÉ-APROVAÇÃO da locação (t_b2ce1207). Escopo próprio: as RPCs locacao_pre_link_* só leem a
// tabela locacao_pre_links e só valem com a locação na pré-análise; o link da Documentação (PR #316) não abre aqui
// e este não abre lá. Mesmo padrão de segurança: token de 256 bits do pgcrypto, banco guarda só o SHA-256,
// funções públicas apenas com service_role, limite por IP (hash do IP da Cloudflare com a chave do servidor).
const tokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
const envelope = z.object({ token: tokenSchema });
const bucket = "locacao-documentos";

async function admin(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

async function ipHash(): Promise<string | null> {
  // Somente o IP definido pela Cloudflare (não aceitar X-Forwarded-For do visitante).
  const ip = getRequest()?.headers.get("cf-connecting-ip");
  if (!ip || ip.length > 64) return null;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${secret}:${ip}`));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type PreLinkResult = {
  ok: boolean;
  parte?: "locatario" | "fiador";
  status?: string;
  dados?: Record<string, string>;
  expira_em?: string;
  garantia?: string;
  pede_renda?: boolean;
  anexo_matricula?: boolean;
  arquivos?: string[];
  faltando?: string[];
  path?: string;
};
async function publico(
  nome: string,
  token: string,
  args: Record<string, unknown> = {},
): Promise<PreLinkResult> {
  const hash = await ipHash();
  if (!hash) return { ok: false };
  const { data, error } = await (
    await admin()
  ).rpc(nome, { _token: token, _ip_hash: hash, ...args });
  if (error) return { ok: false };
  return (data ?? { ok: false }) as PreLinkResult;
}

export const emitirLinkPreLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ locacaoId: z.string().uuid(), parte: z.enum(["locatario", "fiador"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: r, error } = await (context.supabase as unknown as SupabaseClient).rpc(
      "locacao_pre_links_emitir",
      { _id: data.locacaoId, _parte: data.parte },
    );
    if (error) throw new Error(error.message);
    const convite = r as { token?: string; expira_em?: string } | null;
    if (!convite?.token || !tokenSchema.safeParse(convite.token).success || !convite.expira_em)
      throw new Error("Convite indisponível.");
    return { token: convite.token, expiraEm: convite.expira_em };
  });

export const lerLinkPreLocacao = createServerFn({ method: "POST" })
  .validator((input: unknown) => envelope.parse(input))
  .handler(async ({ data }) => publico("locacao_pre_link_ler", data.token));

export const salvarLinkPreLocacao = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    envelope
      .extend({
        dados: z.record(z.string(), z.string().max(200)).refine((v) => Object.keys(v).length <= 10),
      })
      .parse(input),
  )
  .handler(async ({ data }) =>
    publico("locacao_pre_link_salvar", data.token, { _dados: data.dados }),
  );

export const prepararArquivoLinkPreLocacao = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    envelope.extend({ ext: z.enum(["pdf", "jpg", "jpeg", "png", "webp"]) }).parse(input),
  )
  .handler(async ({ data }) => {
    const prep = await publico("locacao_pre_link_preparar", data.token, { _ext: data.ext });
    if (
      !prep.ok ||
      typeof prep.path !== "string" ||
      !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/pre-fiador\/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$/.test(
        prep.path,
      )
    )
      return { ok: false };
    const { data: signed, error } = await (
      await admin()
    ).storage
      .from(bucket)
      .createSignedUploadUrl(prep.path);
    if (error || !signed?.token) return { ok: false };
    return { ok: true, path: prep.path, token: signed.token };
  });

export const registrarArquivoLinkPreLocacao = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    envelope.extend({ path: z.string().max(220), nome: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data }) =>
    publico("locacao_pre_link_registrar", data.token, { _path: data.path, _nome: data.nome }),
  );

export const enviarLinkPreLocacao = createServerFn({ method: "POST" })
  .validator((input: unknown) => envelope.parse(input))
  .handler(async ({ data }) => publico("locacao_pre_link_enviar", data.token));
