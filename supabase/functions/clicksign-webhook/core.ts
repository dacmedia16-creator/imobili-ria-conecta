// Lógica do webhook da Clicksign (sem Deno; testável com mock).
/* eslint-disable @typescript-eslint/no-explicit-any -- payload do webhook da Clicksign sem tipos publicados */
// URL por organização: /functions/v1/clicksign-webhook/<webhook_slug>. Valida o Content-Hmac
// (sha256 = HMAC-SHA256 do corpo BRUTO com o segredo daquela org) em tempo constante, registra o
// evento de forma idempotente (org + sha256 do corpo) e, quando o documento fecha, baixa o PDF
// assinado e anexa como "assinado" (sem aprovar a captação: a aprovação continua manual).
import {
  ClicksignClient,
  normEmail,
  sha256Hex,
  signedUrlFrom,
  verifyContentHmac,
  type FetchLike,
} from "../_shared/clicksign.ts";

export const CLOSE_EVENTS = new Set(["document_closed"]);
export const CANCEL_EVENTS = new Set(["cancel", "deadline", "refusal"]);
const SLUG_RE = /^[0-9a-f]{32,64}$/;
const MAX_BODY = 1024 * 1024;

export type OrgWebhook = { organizationId: string; secret: string | null; token: string | null };
export type EnvelopeRow = {
  id: string;
  envelope_key: string;
  document_key: string | null;
  capture_id: string | null;
  organization_id: string;
  /** Ausente = captação (linhas e testes anteriores à venda). */
  origem?: "captacao" | "venda";
  sale_id?: string | null;
};
export const isVenda = (env: EnvelopeRow) => env.origem === "venda";

export type WebhookDeps = {
  findOrg(slug: string): Promise<OrgWebhook | null>;
  /** Insere o evento; devolve false se (org, body_sha256) já existe e já foi processado. */
  recordEvent(row: {
    organization_id: string;
    body_sha256: string;
    event_name: string | null;
    document_key: string | null;
  }): Promise<{ id: number; fresh: boolean }>;
  finishEvent(id: number, result: string): Promise<void>;
  findEnvelope(org: string, documentKey: string): Promise<EnvelopeRow | null>;
  updateEnvelope(id: string, patch: Record<string, unknown>): Promise<void>;
  /**
   * Grava o PDF e devolve o caminho. Captação: bucket exclusive-captures, org/captura/uuid.pdf.
   * Venda: bucket sale-documents, org/venda/outros/contrato_assinado/uuid.pdf.
   */
  storePdf(env: EnvelopeRow, pdf: Uint8Array): Promise<string>;
  /** Captação: clicksign_attach_signed. Venda (4º argumento): clicksign_sale_attach_signed. */
  attachSigned(
    envelopeId: string,
    path: string,
    fileName: string,
    origem?: "venda",
  ): Promise<string>;
  /** Remove o PDF gravado (bucket conforme a origem). */
  removeObject(path: string, origem?: "venda"): Promise<void>;
  /** Venda: cancelamento/prazo/recusa pela RPC (volta a venda para o gestor reenviar). */
  saleCanceled?(envelopeId: string, reason: string): Promise<string>;
  /**
   * Evento "sign" (uma assinatura): aviso só no sino (clicksign_aviso_assinou). `emailSha256` = sha256
   * do e-mail de quem assinou (o e-mail nunca sai daqui); `eventId` garante 1 aviso por evento.
   */
  signNotice?(envelopeId: string, emailSha256: string | null, eventId: number): Promise<number>;
  fetch: FetchLike;
  clicksignBase?: string;
};

export type CoreResult = { status: number; body: Record<string, unknown> };
const r = (status: number, body: Record<string, unknown>): CoreResult => ({ status, body });

export const SIGN_EVENT = "sign";

/** sha256 do e-mail de quem assinou (evento "sign": event.data.signer.email). Nunca guarda o e-mail. */
export async function signerEmailSha(payload: any): Promise<string | null> {
  const email = normEmail(payload?.event?.data?.signer?.email);
  return email && email.includes("@") ? sha256Hex(email) : null;
}

function documentKeyFrom(payload: any): string | null {
  const d = payload?.document;
  const key = (Array.isArray(d) ? d[0]?.key : d?.key) ?? null;
  return typeof key === "string" && /^[0-9a-f-]{36}$/i.test(key) ? key : null;
}

export async function handleWebhook(
  deps: WebhookDeps,
  slug: string,
  raw: Uint8Array,
  headers: { hmac: string | null; event: string | null },
): Promise<CoreResult> {
  if (!SLUG_RE.test(slug)) return r(404, { error: "not_found" });
  if (raw.length === 0 || raw.length > MAX_BODY) return r(400, { error: "invalid_body" });
  const org = await deps.findOrg(slug);
  // Mesma resposta para slug inexistente e HMAC inválido: não revela quais URLs existem.
  if (!org || !org.secret) return r(401, { error: "unauthorized" });
  if (!(await verifyContentHmac(raw, headers.hmac, org.secret)))
    return r(401, { error: "unauthorized" });

  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return r(400, { error: "invalid_json" });
  }
  const eventName: string | null =
    (typeof payload?.event?.name === "string" ? payload.event.name : null) ?? headers.event ?? null;
  const documentKey = documentKeyFrom(payload);
  const bodySha = await sha256Hex(raw);
  const ev = await deps.recordEvent({
    organization_id: org.organizationId,
    body_sha256: bodySha,
    event_name: eventName,
    document_key: documentKey,
  });
  if (!ev.fresh) return r(200, { ok: true, duplicate: true });

  const done = async (result: string, status = 200) => {
    await deps.finishEvent(ev.id, result);
    return r(status, { ok: status < 300, result });
  };
  if (!documentKey) return done("ignored:no_document");
  const env = await deps.findEnvelope(org.organizationId, documentKey);
  if (!env) return done("ignored:unknown_document");

  if (eventName && CANCEL_EVENTS.has(eventName)) {
    if (isVenda(env) && deps.saleCanceled) {
      const res = await deps.saleCanceled(env.id, eventName);
      return done(`envelope:${eventName}:${res}`);
    }
    await deps.updateEnvelope(env.id, {
      status: "canceled",
      last_event: eventName,
      updated_at: new Date().toISOString(),
    });
    return done(`envelope:${eventName}`);
  }
  if (!eventName || !CLOSE_EVENTS.has(eventName)) {
    await deps.updateEnvelope(env.id, {
      last_event: eventName ?? "desconhecido",
      updated_at: new Date().toISOString(),
    });
    if (eventName === SIGN_EVENT && deps.signNotice) {
      // Aviso é melhor esforço: falha aqui não faz a Clicksign reenviar o evento.
      const n = await deps
        .signNotice(env.id, await signerEmailSha(payload), ev.id)
        .catch(() => -1);
      return done(`noted:sign:${n < 0 ? "aviso_falhou" : n}`);
    }
    return done(`noted:${eventName ?? "?"}`);
  }

  // document_closed: PDF pronto. Busca o link no GET do documento (link temporário).
  if (!org.token) return done("error:no_token", 500);
  let url: string | null = null;
  try {
    const client = new ClicksignClient(org.token, deps.fetch, deps.clicksignBase);
    const doc = await client.getDocument(env.envelope_key, documentKey);
    url = signedUrlFrom(
      doc,
      Array.isArray(payload?.document) ? payload.document[0] : payload?.document,
    );
  } catch {
    url = signedUrlFrom(
      null,
      Array.isArray(payload?.document) ? payload.document[0] : payload?.document,
    );
  }
  if (!url) {
    await deps.finishEvent(ev.id, "error:no_signed_url");
    // 5xx: a Clicksign reenvia; o evento fica marcado para nova tentativa (ver recordEvent).
    return r(502, { ok: false, result: "error:no_signed_url" });
  }
  const res = await deps.fetch(url, { method: "GET" });
  const pdf = new Uint8Array(await res.arrayBuffer());
  const isPdf = pdf.length > 4 && new TextDecoder().decode(pdf.subarray(0, 5)) === "%PDF-";
  if (!res.ok || !isPdf || pdf.length > 16 * 1024 * 1024) {
    await deps.finishEvent(ev.id, "error:download");
    return r(502, { ok: false, result: "error:download" });
  }
  const path = await deps.storePdf(env, pdf);
  const venda = isVenda(env);
  const remove = () =>
    (venda ? deps.removeObject(path, "venda") : deps.removeObject(path)).catch(() => undefined);
  let result: string;
  try {
    result = venda
      ? await deps.attachSigned(env.id, path, "contrato-assinado-clicksign.pdf", "venda")
      : await deps.attachSigned(env.id, path, "contrato-assinado-clicksign.pdf");
  } catch (e) {
    await remove();
    throw e;
  }
  // Venda: "attached_only" também anexou (só a marcação automática não aconteceu).
  const kept = result === "attached" || (venda && result === "attached_only");
  if (!kept) await remove();
  return done(`signed:${result}`);
}
