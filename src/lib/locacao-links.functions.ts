import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Token de 256 bits gerado pelo pgcrypto; somente hash SHA-256 é salvo no banco. Em claro só volta ao corretor.
const tokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
const envelope = z.object({ token: tokenSchema });
const extSchema = z.enum(["pdf", "jpg", "jpeg", "png", "webp"]);
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

type PublicResult = {
  ok: boolean;
  parte?: "proprietario" | "locatario" | "fiador";
  pessoa?: string;
  status?: string;
  dados?: Record<string, string>;
  itens?: { item: string; enviado: boolean }[];
  expira_em?: string;
  path?: string;
};
async function publico(
  nome: string,
  token: string,
  args: Record<string, unknown> = {},
): Promise<PublicResult> {
  const hash = await ipHash();
  if (!hash) return { ok: false };
  const { data, error } = await (
    await admin()
  ).rpc(nome, { _token: token, _ip_hash: hash, ...args });
  if (error) return { ok: false };
  return (data ?? { ok: false }) as PublicResult;
}

export const emitirLinkLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        locacaoId: z.string().uuid(),
        parte: z.enum(["locatario", "proprietario", "fiador"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: r, error } = await (context.supabase as unknown as SupabaseClient).rpc(
      "locacao_links_emitir",
      {
        _id: data.locacaoId,
        _parte: data.parte,
      },
    );
    if (error) throw new Error(error.message);
    const convite = r as { token?: string; expira_em?: string } | null;
    if (!convite?.token || !tokenSchema.safeParse(convite.token).success || !convite.expira_em)
      throw new Error("Convite indisponível.");
    return { token: convite.token, expiraEm: convite.expira_em };
  });

export const lerLinkLocacao = createServerFn({ method: "POST" })
  .validator((input: unknown) => envelope.parse(input))
  .handler(async ({ data }) => publico("locacao_link_ler", data.token));

export const salvarLinkLocacao = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    envelope
      .extend({
        dados: z.record(z.string(), z.string().max(500)).refine((v) => Object.keys(v).length <= 40),
      })
      .parse(input),
  )
  .handler(async ({ data }) => publico("locacao_link_salvar", data.token, { _dados: data.dados }));

export const prepararArquivoLinkLocacao = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    envelope.extend({ item: z.string().min(1).max(200), ext: extSchema }).parse(input),
  )
  .handler(async ({ data }) => {
    const prep = await publico("locacao_link_preparar", data.token, {
      _item: data.item,
      _ext: data.ext,
    });
    if (
      !prep.ok ||
      typeof prep.path !== "string" ||
      !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(locatario|proprietario|fiador)\/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$/.test(
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

export const registrarArquivoLinkLocacao = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    envelope.extend({ path: z.string().max(220), nome: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data }) =>
    publico("locacao_link_registrar", data.token, { _path: data.path, _nome: data.nome }),
  );

export const enviarLinkLocacao = createServerFn({ method: "POST" })
  .validator((input: unknown) => envelope.parse(input))
  .handler(async ({ data }) => publico("locacao_link_enviar", data.token));
