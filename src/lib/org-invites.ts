/**
 * Convite por e-mail para o dono de imobiliária se autocadastrar (t_6e4dab96, Denis 20/10/2026).
 * Regras puras usadas pela tela, pelo servidor e pelos testes. A autorização definitiva fica no banco
 * (funções org_invite_*, só service_role) e no servidor (assertPlatformAdmin).
 *
 * Login: reutiliza a Conta MAX (Google via WorkOS). Não existe login Google novo.
 */
import { z } from "zod";
import {
  isValidCnpj,
  COLOR_RE,
  ORGANIZATION_MODULES,
  type OrganizationModule,
} from "./platform-organizations";

export const INVITE_TTL_DAYS = 7;
/** Módulos desligados na imobiliária que nasce pelo convite (decisão de Denis). */
// "leads" (piloto t_2472761a): a RPC do convite não grava esse módulo; sem linha = desligado.
// "crm" (t_188fb282): idem, nasce desligado.
export const INVITE_MODULES_OFF: readonly OrganizationModule[] = ["oportunidades", "leads", "crm"];

export function inviteModules(): Record<OrganizationModule, boolean> {
  return Object.fromEntries(
    ORGANIZATION_MODULES.map((m) => [m, !INVITE_MODULES_OFF.includes(m)]),
  ) as Record<OrganizationModule, boolean>;
}

/** Guardado no navegador entre o link do convite e a volta da Conta MAX. */
export const INVITE_TOKEN_STORAGE = "adm_max_convite_token";
/** Reserva (1 h) devolvida pela ponte depois de conferir o e-mail. */
export const INVITE_CLAIM_STORAGE = "adm_max_convite_reserva";

const enc = new TextEncoder();

export async function sha256Hex(value: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Token aleatório de 32 bytes em base64url (vai só no link; o banco guarda o hash). */
export function newInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** O token guardado no navegador só vale 30 min (não sequestra um login normal mais tarde). */
export const INVITE_PENDING_TTL_MS = 30 * 60_000;

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Onde o token pendente fica: localStorage (vale para todas as abas do mesmo navegador), porque no
 * celular o link costuma abrir no navegador interno do Gmail e o login pode voltar em outra aba.
 * A validade de 30 min e o uso único (takePendingInvite apaga) limitam o efeito de ficar guardado.
 */
export function pendingInviteStorage(w: { localStorage?: Storage; sessionStorage?: Storage }): KV {
  try {
    if (w.localStorage) return w.localStorage;
  } catch {
    /* localStorage bloqueado: cai para a aba */
  }
  return w.sessionStorage as KV;
}

export function savePendingInvite(storage: KV, token: string, now = Date.now()) {
  storage.setItem(INVITE_TOKEN_STORAGE, JSON.stringify({ token, at: now }));
}

/** Lê e APAGA o token pendente (uso único no navegador). */
export function takePendingInvite(storage: KV, now = Date.now()): string | null {
  const raw = storage.getItem(INVITE_TOKEN_STORAGE);
  storage.removeItem(INVITE_TOKEN_STORAGE);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { token?: unknown; at?: unknown };
    if (typeof v.token !== "string" || !INVITE_TOKEN_RE.test(v.token)) return null;
    if (typeof v.at !== "number" || now - v.at > INVITE_PENDING_TTL_MS || v.at > now + 60_000)
      return null;
    return v.token;
  } catch {
    return null;
  }
}

export function inviteLink(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/convite/${token}`;
}

export type InviteDbStatus = "enviado" | "aceito" | "cancelado" | "substituido";
export type InviteDisplayStatus = InviteDbStatus | "expirado";

export const INVITE_STATUS_LABEL: Record<InviteDisplayStatus, string> = {
  enviado: "Enviado",
  aceito: "Aceito",
  expirado: "Expirado",
  cancelado: "Cancelado",
  substituido: "Substituído (reenviado)",
};

export function displayStatus(
  row: { status: InviteDbStatus; expires_at: string },
  now: Date = new Date(),
): InviteDisplayStatus {
  if (row.status === "enviado" && new Date(row.expires_at).getTime() <= now.getTime())
    return "expirado";
  return row.status;
}

export type InviteRow = {
  id: string;
  email: string;
  status: InviteDbStatus;
  expires_at: string;
  created_at: string;
  sent_at: string | null;
  send_error: string | null;
  accepted_at: string | null;
  organization_id: string | null;
  organizacao: string | null;
};
export type InviteListItem = InviteRow & { situacao: InviteDisplayStatus };

/** Mensagens claras para os códigos levantados pelo banco e pela ponte. */
export const INVITE_ERROR_MESSAGES = {
  convite_invalido: "Este link de convite não é válido. Peça um novo convite ao UniHub.",
  convite_expirado: "Este convite expirou (vale 7 dias). Peça um novo convite ao UniHub.",
  convite_ja_usado: "Este convite já foi usado: a imobiliária já foi cadastrada.",
  convite_cancelado: "Este convite foi cancelado. Peça um novo convite ao UniHub.",
  convite_substituido:
    "Este link foi substituído por um convite mais novo. Use o último e-mail recebido.",
  convite_outro_email:
    "Este convite foi enviado para outro e-mail. Entre com a conta Google do e-mail que recebeu o convite.",
  email_ja_cadastrado:
    "Este e-mail já tem acesso ao ADM MAX. Entre normalmente pelo botão Entrar com Google.",
  reserva_invalida:
    "Seu tempo para concluir o cadastro acabou (1 hora). Abra de novo o link do convite.",
  convite_sem_permissao: "Somente o super-admin da plataforma envia convites.",
  convite_nao_aberto: "Só é possível cancelar convite que ainda não foi aceito.",
  email_not_verified: "Sua conta Google precisa ter o e-mail confirmado.",
  ticket_reused: "Este acesso já foi usado. Abra de novo o link do convite.",
  invalid_ticket: "O acesso pela Conta MAX não foi aceito. Abra de novo o link do convite.",
  slug_indisponivel: "Não foi possível gerar o endereço da imobiliária. Tente outro nome.",
  cnpj_duplicado: "Já existe uma imobiliária com esse CNPJ no ADM MAX.",
} as const;
export type InviteErrorCode = keyof typeof INVITE_ERROR_MESSAGES;

export function inviteErrorCode(message: string | null | undefined): InviteErrorCode | null {
  const m = String(message ?? "");
  if (/organizations_cnpj_unique/.test(m)) return "cnpj_duplicado";
  const codes = Object.keys(INVITE_ERROR_MESSAGES) as InviteErrorCode[];
  // Mais longos primeiro: "convite_invalido" não pode capturar outro código que o contenha.
  return codes.sort((a, b) => b.length - a.length).find((c) => m.includes(c)) ?? null;
}

export function inviteErrorMessage(message: string | null | undefined, fallback: string): string {
  const code = inviteErrorCode(message);
  return code ? INVITE_ERROR_MESSAGES[code] : fallback;
}

export const inviteEmailSchema = z.string().trim().toLowerCase().email().max(255);

const optionalText = (min: number, max: number, msg: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (v.length >= min && v.length <= max), msg)
    .optional()
    .nullable();

const optionalColor = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === "" || COLOR_RE.test(v), "Cor inválida (use o formato #RRGGBB).")
  .optional()
  .nullable();

/** Cadastro feito pelo dono: dados da imobiliária + dados pessoais (sem senha). */
export const selfSignupSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome da imobiliária.").max(120),
  razaoSocial: optionalText(2, 160, "Razão social: de 2 a 160 caracteres."),
  cnpj: z.string().trim().refine(isValidCnpj, "CNPJ inválido."),
  creci: optionalText(3, 50, "CRECI da imobiliária: de 3 a 50 caracteres."),
  cidade: z.string().trim().min(2, "Informe a cidade.").max(80),
  uf: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "UF com 2 letras (ex.: SP)."),
  corPrimaria: optionalColor,
  corSecundaria: optionalColor,
  donoNome: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .refine((v) => v.split(/\s+/).filter(Boolean).length >= 2, "Digite seu nome completo."),
  donoTelefone: z
    .string()
    .trim()
    .refine((v) => {
      const d = v.replace(/\D/g, "");
      return d.length >= 10 && d.length <= 13;
    }, "Telefone com DDD (ex.: 15 99999-9999)."),
});
export type SelfSignupForm = z.infer<typeof selfSignupSchema>;
