import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LOGO_TYPES } from "@/lib/platform-organizations";
import { inviteEmailSchema, selfSignupSchema } from "@/lib/org-invites";

/**
 * Convite de autocadastro (t_6e4dab96) — funções de servidor. Lógica em `org-invites.server.ts`.
 * Painel (criar/reenviar/cancelar/listar): exige login + super-admin da plataforma.
 * Tela do dono (ler reserva/concluir cadastro): sem login no ADM — a prova é a reserva de 1 h que só a
 * ponte Conta MAX entrega depois de conferir o e-mail Google; o banco valida tudo de novo.
 */
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const server = await import("@/lib/org-invites.server");
  return { admin: supabaseAdmin as unknown as SupabaseClient, server };
}

/** Endereço do app que vai no link do e-mail (produção ou homologação, conforme o Worker). */
function appUrl(): string {
  return (process.env.APP_URL || "https://app.somosmaxhub.com.br").replace(/\/+$/, "");
}

/** Reaproveita a Edge Function das boas-vindas (SMTP Zoho já configurado), com a chave do servidor. */
async function sendInviteEmail(input: { inviteId: string; token: string; appUrl: string }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, error: "envio_nao_configurado" };
  const res = await fetch(`${url}/functions/v1/send-email-boas-vindas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({
      acao: "convite",
      invite_id: input.inviteId,
      token: input.token,
      app_url: input.appUrl,
    }),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !body?.ok) return { ok: false, error: body?.error ?? `http_${res.status}` };
  return { ok: true };
}

const claimSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const listOrgInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { admin: a, server } = await admin();
    return server.listInvites(a, context.userId);
  });

export const createOrgInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ email: inviteEmailSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const { admin: a, server } = await admin();
    return server.createInvite(
      a,
      context.userId,
      { email: data.email, appUrl: appUrl() },
      sendInviteEmail,
    );
  });

export const resendOrgInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ inviteId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { admin: a, server } = await admin();
    return server.resendInvite(
      a,
      context.userId,
      { inviteId: data.inviteId, appUrl: appUrl() },
      sendInviteEmail,
    );
  });

export const cancelOrgInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ inviteId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { admin: a, server } = await admin();
    await server.cancelInvite(a, context.userId, data.inviteId);
    return { ok: true };
  });

export const readOrgInviteClaim = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ claim: claimSchema }).parse(input))
  .handler(async ({ data }) => {
    const { admin: a, server } = await admin();
    return server.readClaim(a, data.claim);
  });

export const acceptOrgInvite = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        claim: claimSchema,
        form: selfSignupSchema,
        logo: z
          .object({ base64: z.string().min(1).max(1_500_000), contentType: z.enum(LOGO_TYPES) })
          .nullable()
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { admin: a, server } = await admin();
    return server.acceptInvite(a, { claim: data.claim, form: data.form, logo: data.logo ?? null });
  });
