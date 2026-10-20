// Envio do e-mail de convite (t_6e4dab96) pela MESMA função/SMTP das boas-vindas (Zoho, no-reply).
// Sem dependências do Deno (testável no vitest). Banco e SMTP entram por injeção.
import { renderEmailConvite } from "./render.ts";

export const APP_ORIGENS_CONVITE = [
  "https://app.somosmaxhub.com.br",
  "https://adm-max-homolog.dacmedia16.workers.dev",
] as const;

export type DadosConviteDb = {
  email: string;
  token_hash: string;
  status: string;
  expires_at: string;
};

export interface BancoConvite {
  dados(id: string): Promise<DadosConviteDb | null>;
  marcar(id: string, ok: boolean, erro?: string): Promise<void>;
}

export type MensagemConvite = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
  headers: Record<string, string>;
};

const enc = new TextEncoder();
async function sha256Hex(v: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(v)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function enviarConvite(
  banco: BancoConvite,
  smtp: (m: MensagemConvite) => Promise<string>,
  input: { inviteId: unknown; token: unknown; appUrl: unknown },
  remetente: { from: string; dominio: string },
  mascarar: (e: unknown) => string,
  agora: Date = new Date(),
): Promise<{ ok: boolean; error?: string }> {
  const id = String(input.inviteId ?? "");
  const token = String(input.token ?? "");
  const app = String(input.appUrl ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(token))
    return { ok: false, error: "entrada_invalida" };
  if (!(APP_ORIGENS_CONVITE as readonly string[]).includes(app))
    return { ok: false, error: "app_nao_permitido" };
  const d = await banco.dados(id);
  // O token do link precisa ser o do convite (o banco só guarda o hash).
  if (!d || d.token_hash !== (await sha256Hex(token))) return { ok: false, error: "convite_invalido" };
  if (d.status !== "enviado" || new Date(d.expires_at).getTime() <= agora.getTime())
    return { ok: false, error: "convite_nao_aberto" };
  const r = renderEmailConvite({
    link: `${app}/convite/${token}`,
    expiraEm: new Date(d.expires_at),
    email: d.email,
  });
  const msg: MensagemConvite = {
    from: remetente.from,
    to: d.email,
    subject: r.subject,
    text: r.text,
    html: r.html,
    messageId: `<convite.${id}.${agora.getTime()}@${remetente.dominio}>`,
    headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" },
  };
  try {
    await smtp(msg);
  } catch (e) {
    const erro = mascarar(e);
    await banco.marcar(id, false, erro);
    return { ok: false, error: erro };
  }
  await banco.marcar(id, true);
  return { ok: true };
}
