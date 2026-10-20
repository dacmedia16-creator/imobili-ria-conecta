/**
 * Convite de autocadastro de imobiliária (t_6e4dab96) — lógica de servidor.
 *
 * - Criar/reenviar/cancelar/listar: só super-admin da plataforma (assertPlatformAdmin + checagem
 *   repetida dentro das funções org_invite_* no banco). O token vai só no link; o banco guarda o hash.
 * - E-mail: a MESMA Edge Function das boas-vindas (send-email-boas-vindas, acao "convite"), SMTP Zoho
 *   de no-reply@somosmaxhub.com.br. Nenhum segredo de e-mail passa por aqui.
 * - Aceite: depois que a ponte Conta MAX conferiu o e-mail Google e devolveu a reserva, o dono envia o
 *   cadastro; org_invite_accept trava o convite e cria a imobiliária ATIVA (uso único, à prova de corrida);
 *   aqui criamos o usuário dele como primeiro administrador. Se a criação do usuário falhar, desfazemos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { OrgScopeError } from "./org-scope";
import { assertPlatformAdmin, createFirstAdmin, storeLogo, type LogoUpload } from "./platform-organizations.server";
import { slugify, onlyDigits } from "./platform-organizations";
import {
  displayStatus,
  inviteErrorMessage,
  inviteLink,
  newInviteToken,
  sha256Hex,
  type InviteListItem,
  type InviteRow,
  type SelfSignupForm,
} from "./org-invites";

/** O dono vira o primeiro administrador com o mesmo papel do fluxo atual (padrão "Super Admin"). */
export const INVITE_OWNER_ROLE = "super_admin" as const;

export type SendEmail = (input: {
  inviteId: string;
  token: string;
  appUrl: string;
}) => Promise<{ ok: boolean; error?: string }>;

async function rpc(admin: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

function friendly(e: unknown, fallback: string): Error {
  const msg = e instanceof Error ? e.message : String(e);
  return new OrgScopeError(inviteErrorMessage(msg, fallback));
}

export type InviteSendResult = { inviteId: string; emailSent: boolean; emailError: string | null };

async function sendAfterCreate(
  inviteId: string,
  token: string,
  appUrl: string,
  sendEmail: SendEmail,
): Promise<InviteSendResult> {
  try {
    const r = await sendEmail({ inviteId, token, appUrl });
    return { inviteId, emailSent: r.ok, emailError: r.ok ? null : (r.error ?? "falha_envio") };
  } catch {
    return { inviteId, emailSent: false, emailError: "falha_envio" };
  }
}

export async function createInvite(
  admin: SupabaseClient,
  callerId: string,
  input: { email: string; appUrl: string },
  sendEmail: SendEmail,
): Promise<InviteSendResult> {
  await assertPlatformAdmin(admin, callerId);
  const token = newInviteToken();
  let id: string;
  try {
    id = (await rpc(admin, "org_invite_create", {
      _email: input.email,
      _token_hash: await sha256Hex(token),
      _actor: callerId,
    })) as string;
  } catch (e) {
    throw friendly(e, "Não foi possível criar o convite.");
  }
  return sendAfterCreate(id, token, input.appUrl, sendEmail);
}

export async function resendInvite(
  admin: SupabaseClient,
  callerId: string,
  input: { inviteId: string; appUrl: string },
  sendEmail: SendEmail,
): Promise<InviteSendResult> {
  await assertPlatformAdmin(admin, callerId);
  const token = newInviteToken();
  let id: string;
  try {
    id = (await rpc(admin, "org_invite_resend", {
      _id: input.inviteId,
      _token_hash: await sha256Hex(token),
      _actor: callerId,
    })) as string;
  } catch (e) {
    throw friendly(e, "Não foi possível reenviar o convite.");
  }
  return sendAfterCreate(id, token, input.appUrl, sendEmail);
}

export async function cancelInvite(admin: SupabaseClient, callerId: string, inviteId: string) {
  await assertPlatformAdmin(admin, callerId);
  try {
    await rpc(admin, "org_invite_cancel", { _id: inviteId, _actor: callerId });
  } catch (e) {
    throw friendly(e, "Não foi possível cancelar o convite.");
  }
}

export async function listInvites(
  admin: SupabaseClient,
  callerId: string,
  now: Date = new Date(),
): Promise<InviteListItem[]> {
  await assertPlatformAdmin(admin, callerId);
  const { data, error } = await admin
    .from("organization_invites")
    .select(
      "id, email, status, expires_at, created_at, sent_at, send_error, accepted_at, organization_id, organizations(nome)",
    )
    .neq("status", "substituido")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Não foi possível carregar os convites.");
  // A tabela é nova e ainda não consta do types.ts gerado; o embed organizations(nome) vem como objeto.
  return ((data ?? []) as unknown as Array<InviteRow & { organizations: { nome: string } | null }>).map(
    ({ organizations, ...r }) => ({
      ...r,
      organizacao: organizations?.nome ?? null,
      situacao: displayStatus(r, now),
    }),
  );
}

/** Tela de cadastro: confere a reserva e devolve o e-mail convidado (sem mais nenhum dado). */
export async function readClaim(admin: SupabaseClient, claim: string): Promise<{ email: string }> {
  try {
    const data = await rpc(admin, "org_invite_claim_info", { _claim_hash: await sha256Hex(claim) });
    const row = (Array.isArray(data) ? data[0] : data) as { email: string } | null;
    if (!row?.email) throw new Error("reserva_invalida");
    return { email: row.email };
  } catch (e) {
    throw friendly(e, "Não foi possível abrir o cadastro.");
  }
}

export type AcceptResult = {
  organizationId: string;
  organizationName: string;
  email: string;
  logoSaved: boolean;
};

export async function acceptInvite(
  admin: SupabaseClient,
  input: { claim: string; form: SelfSignupForm; logo?: LogoUpload | null },
): Promise<AcceptResult> {
  const f = input.form;
  let accepted: { invite_id: string; organization_id: string; email: string };
  try {
    accepted = (await rpc(admin, "org_invite_accept", {
      _claim_hash: await sha256Hex(input.claim),
      _slug: slugify(f.nome) || "imobiliaria",
      _nome: f.nome,
      _cnpj: onlyDigits(f.cnpj),
      _razao_social: f.razaoSocial || null,
      _creci: f.creci || null,
      _cidade: f.cidade,
      _uf: f.uf,
      _cor_primaria: f.corPrimaria || null,
      _cor_secundaria: f.corSecundaria || null,
    })) as typeof accepted;
  } catch (e) {
    throw friendly(e, "Não foi possível concluir o cadastro.");
  }

  let userId: string;
  try {
    userId = await createFirstAdmin(
      admin,
      accepted.organization_id,
      { nome: f.donoNome, email: accepted.email },
      INVITE_OWNER_ROLE,
    );
  } catch (e) {
    // Desfaz a imobiliária (ainda vazia) e devolve o convite para o dono tentar de novo.
    await admin.rpc("org_invite_accept_undo", { _invite_id: accepted.invite_id });
    throw friendly(e, "Não foi possível criar seu acesso. Tente de novo em instantes.");
  }
  await rpc(admin, "org_invite_accept_finish", {
    _invite_id: accepted.invite_id,
    _user_id: userId,
  });
  // Dados pessoais complementares e logo: falha aqui não desfaz a imobiliária (o dono ajusta depois).
  await admin
    .from("profiles")
    .update({ telefone: f.donoTelefone.trim() })
    .eq("id", userId);
  let logoSaved = false;
  if (input.logo) {
    try {
      await storeLogo(admin, accepted.organization_id, input.logo);
      logoSaved = true;
    } catch {
      logoSaved = false;
    }
  }
  return {
    organizationId: accepted.organization_id,
    organizationName: f.nome,
    email: accepted.email,
    logoSaved,
  };
}

export { inviteLink };
