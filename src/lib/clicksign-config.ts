// Tela "Assinatura digital" (t_7508c6b6): tipos, regras de "pode ligar?" e chamada à edge
// clicksign-config. A chave e o segredo nunca chegam aqui depois de salvos: a tela só recebe
// "configurado" e a data. A edge e o banco conferem tudo de novo (esta é só a ajuda da tela).
import type { SupabaseClient } from "@supabase/supabase-js";

export type ConfigCandidate = { id: string; nome: string; email: string; email_ok: boolean };
export type ConfigAudit = {
  action: "chave_api" | "segredo_webhook" | "configuracao" | "teste_conexao" | "ligar" | "desligar";
  detail: Record<string, unknown>;
  created_at: string;
  actor: string;
};
export type ClicksignConfig = {
  enabled: boolean;
  sale_enabled: boolean;
  test_mode: boolean;
  allowlist_count: number;
  deadline_days: number;
  signer_ids: string[];
  valid_signers: number;
  token: { configured: boolean; set_at: string | null };
  webhook: { configured: boolean; set_at: string | null; slug: string };
  webhook_url: string | null;
  connection: { ok: boolean | null; checked_at: string | null };
  candidates: ConfigCandidate[];
  audit: ConfigAudit[];
};
export type ConnectionTest = { ok: boolean; code: string | null; message: string };

/** Eventos que o ADM MAX usa no webhook (marcar na Clicksign ao cadastrar o endereço). */
export const WEBHOOK_EVENTS = ["sign", "document_closed", "cancel", "deadline", "refusal"] as const;

export type Requisito = {
  key: "chave" | "webhook" | "assinante" | "teste";
  label: string;
  ok: boolean;
};

/** O que precisa estar pronto para o botão "Ligar assinatura digital" liberar. */
export function requisitosParaLigar(c: ClicksignConfig): Requisito[] {
  return [
    { key: "chave", label: "Chave de API salva", ok: c.token.configured },
    { key: "webhook", label: "Segredo do webhook salvo", ok: c.webhook.configured },
    {
      key: "assinante",
      label: "Ao menos 1 pessoa assinando pela imobiliária",
      ok: c.valid_signers > 0,
    },
    { key: "teste", label: "Teste de conexão aprovado", ok: c.connection.ok === true },
  ];
}

export const podeLigar = (c: ClicksignConfig) => requisitosParaLigar(c).every((r) => r.ok);

/** Está ligada só quando captação E venda estão ligadas (o botão liga/desliga as duas juntas). */
export const estaLigada = (c: ClicksignConfig) => c.enabled && c.sale_enabled;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Separa a lista de e-mails de teste (vírgula, ponto e vírgula ou linha) e acusa os inválidos. */
export function parseAllowlist(text: string): { emails: string[]; invalid: string[] } {
  const parts = text
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const emails = [...new Set(parts)];
  return {
    emails: emails.filter((e) => EMAIL_RE.test(e)),
    invalid: emails.filter((e) => !EMAIL_RE.test(e)),
  };
}

/** Prazo digitado → dias válidos (1 a 90) ou null. */
export function parseDeadline(v: string): number | null {
  if (!/^\d{1,2}$/.test(v.trim())) return null;
  const n = Number(v);
  return n >= 1 && n <= 90 ? n : null;
}

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
export const formatDataHora = fmt;

/** Linha da auditoria em português, sem nenhum valor secreto (o banco já não guarda). */
export function auditoriaTexto(a: ConfigAudit): string {
  const d = a.detail ?? {};
  switch (a.action) {
    case "chave_api":
      return d.operacao === "trocou" ? "Trocou a chave de API" : "Cadastrou a chave de API";
    case "segredo_webhook":
      return d.operacao === "trocou"
        ? "Trocou o segredo do webhook"
        : "Cadastrou o segredo do webhook";
    case "teste_conexao":
      return d.ok
        ? "Testou a conexão: ok"
        : `Testou a conexão: falhou${d.codigo ? ` (${String(d.codigo)})` : ""}`;
    case "ligar":
      return "Ligou a assinatura digital (captação e venda)";
    case "desligar":
      return "Desligou a assinatura digital (captação e venda)";
    default: {
      const partes: string[] = [];
      if (typeof d.modo_teste === "boolean")
        partes.push(d.modo_teste ? "modo teste ligado" : "modo teste desligado");
      if (typeof d.prazo_dias === "number") partes.push(`prazo ${d.prazo_dias} dias`);
      if (typeof d.assinam_pela_imobiliaria === "number")
        partes.push(`${d.assinam_pela_imobiliaria} assinando pela imobiliária`);
      if (typeof d.emails_teste === "number") partes.push(`${d.emails_teste} e-mails de teste`);
      return `Alterou a configuração${partes.length ? `: ${partes.join(", ")}` : ""}`;
    }
  }
}

type Body =
  | { action: "view" }
  | { action: "save_secret"; kind: "access_token" | "webhook"; value: string }
  | {
      action: "save";
      test_mode?: boolean;
      signer_ids?: string[];
      allowlist?: string[];
      deadline_days?: number;
    }
  | { action: "test" }
  | { action: "set_enabled"; on: boolean };

/** Chama a edge. Lança Error com a mensagem do servidor. */
export async function callClicksignConfig(
  db: SupabaseClient,
  body: Body,
): Promise<{ config: ClicksignConfig; test?: ConnectionTest }> {
  const { data, error } = await db.functions.invoke("clicksign-config", { body });
  if (error) {
    let message = "Não foi possível falar com o servidor. Atualize a página e tente de novo.";
    const ctx = (error as { context?: unknown }).context;
    if (ctx && typeof (ctx as Response).json === "function") {
      try {
        const b = (await (ctx as Response).json()) as { error?: string };
        if (b?.error) message = b.error;
      } catch {
        /* corpo não-JSON */
      }
    }
    throw new Error(message);
  }
  const d = (data ?? {}) as { ok?: boolean; config?: ClicksignConfig; test?: ConnectionTest };
  if (d.ok !== true || !d.config) throw new Error("Resposta inesperada do servidor");
  return { config: d.config, ...(d.test ? { test: d.test } : {}) };
}
