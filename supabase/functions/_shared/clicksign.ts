// Clicksign API v3 (envelopes, JSON:API) — cliente e regras da captação, sem dependência do Deno.
// Usado pelas edge functions clicksign-send/clicksign-webhook, pela tela (validação) e pelos testes.
// Autenticação: header Authorization com o token SEM prefixo "Bearer" (confirmado no teste D1,
// 18/10/2026, conta de produção da Única Escolha). Nunca logar token, segredo nem e-mail.

export const CLICKSIGN_PROD_BASE = "https://app.clicksign.com/api/v3";
export const WITNESS_COUNT = 2;
export const MAX_IMOBILIARIA_SIGNERS = 10;

export type Papel = "proprietario_1" | "proprietario_2" | "corretor" | "imobiliaria" | "testemunha";
/** Qualificação (requisito "agree") por papel. Validada na conta real no teste D2. */
export const ROLE_BY_PAPEL: Record<Papel, string> = {
  proprietario_1: "contractor",
  proprietario_2: "contractor",
  corretor: "real_estate_broker",
  imobiliaria: "contractee",
  testemunha: "witness",
};

export type SignerInput = { papel: Papel; nome: string; email: string };
export type PersonInput = { nome?: string | null; email?: string | null };

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
export const normEmail = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
export const normName = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ");
export const validEmail = (v: string | null | undefined) => EMAIL_RE.test(normEmail(v));
/** A Clicksign exige ao menos duas palavras no nome do signatário. */
export const validSignerName = (v: string | null | undefined) => /^\S+\s+\S+/.test(normName(v));

const LABEL: Record<Papel, string> = {
  proprietario_1: "Proprietário 1",
  proprietario_2: "Proprietário 2",
  corretor: "Corretor",
  imobiliaria: "Imobiliária",
  testemunha: "Testemunha",
};

function ownerFilled(o: Record<string, unknown> | null | undefined): boolean {
  if (!o || typeof o !== "object") return false;
  return Object.values(o).some((v) => typeof v === "string" && v.trim() !== "");
}

export type BuildInput = {
  form: Record<string, unknown>;
  corretor: PersonInput;
  /** Signatários da Imobiliária JÁ filtrados pelo servidor (usuários da org, com e-mail do cadastro). */
  imobiliaria: PersonInput[];
  testemunhas: PersonInput[];
};

/** Monta e valida os signatários da captação. Retorna erros legíveis (sem e-mail na mensagem). */
export function buildCaptureSigners(input: BuildInput): { signers: SignerInput[]; errors: string[] } {
  const errors: string[] = [];
  const signers: SignerInput[] = [];
  const push = (papel: Papel, p: PersonInput, label: string) => {
    const nome = normName(p.nome);
    const email = normEmail(p.email);
    if (!validSignerName(nome)) errors.push(`${label}: informe nome e sobrenome`);
    if (!validEmail(email)) errors.push(`${label}: e-mail ausente ou inválido`);
    signers.push({ papel, nome, email });
  };
  const o1 = (input.form?.proprietario_1 ?? {}) as Record<string, string>;
  push("proprietario_1", { nome: o1.nome_completo, email: o1.email }, LABEL.proprietario_1);
  const o2 = input.form?.proprietario_2 as Record<string, string> | undefined;
  if (ownerFilled(o2)) {
    push("proprietario_2", { nome: o2?.nome_completo, email: o2?.email }, LABEL.proprietario_2);
  }
  push("corretor", input.corretor, `${LABEL.corretor} (cadastro do captador)`);
  if (input.imobiliaria.length < 1) errors.push("Escolha ao menos 1 pessoa para assinar pela imobiliária");
  if (input.imobiliaria.length > MAX_IMOBILIARIA_SIGNERS) errors.push("Signatários da imobiliária demais");
  input.imobiliaria.forEach((p, i) => push("imobiliaria", p, `${LABEL.imobiliaria} ${i + 1}`));
  if (input.testemunhas.length !== WITNESS_COUNT) {
    errors.push(`Informe exatamente ${WITNESS_COUNT} testemunhas`);
  }
  input.testemunhas
    .slice(0, WITNESS_COUNT)
    .forEach((p, i) => push("testemunha", p, `${LABEL.testemunha} ${i + 1}`));
  const seen = new Map<string, string>();
  signers.forEach((s, i) => {
    if (!s.email) return;
    const prev = seen.get(s.email);
    if (prev !== undefined) {
      errors.push(`A mesma pessoa não pode assinar duas vezes (${prev} e ${signerLabel(signers, i)})`);
    } else seen.set(s.email, signerLabel(signers, i));
  });
  return { signers, errors: [...new Set(errors)] };
}

function signerLabel(list: SignerInput[], i: number): string {
  const s = list[i];
  if (s.papel === "imobiliaria" || s.papel === "testemunha") {
    const n = list.slice(0, i + 1).filter((x) => x.papel === s.papel).length;
    return `${LABEL[s.papel]} ${n}`;
  }
  return LABEL[s.papel];
}

// ---------- hashing / HMAC (WebCrypto: Deno e Node 20+) ----------
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}
export async function hmacSha256Hex(secret: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, body));
}
export function constantTimeEqual(a: string, b: string): boolean {
  const l = enc.encode(a);
  const r = enc.encode(b);
  let diff = l.length ^ r.length;
  for (let i = 0; i < Math.max(l.length, r.length); i += 1) diff |= (l[i] ?? 0) ^ (r[i] ?? 0);
  return diff === 0;
}
/** Content-Hmac: sha256=<hex> = HMAC-SHA256(corpo BRUTO, segredo do webhook da org). */
export async function verifyContentHmac(
  raw: Uint8Array,
  header: string | null,
  secret: string,
): Promise<boolean> {
  const m = /^sha256=([0-9a-f]{64})$/i.exec((header ?? "").trim());
  if (!m || !secret) return false;
  return constantTimeEqual(m[1].toLowerCase(), await hmacSha256Hex(secret, raw));
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// ---------- cliente HTTP ----------
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class ClicksignError extends Error {
  step: string;
  status: number;
  detail: string;
  constructor(step: string, status: number, detail: string) {
    super(`Clicksign ${step}: HTTP ${status}`);
    this.step = step;
    this.status = status;
    this.detail = detail;
  }
}

/** Remove e-mails de qualquer texto antes de guardar/registrar (detalhe de erro da API). */
export const scrubEmails = (s: string) =>
  s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>");

export class ClicksignClient {
  private token: string;
  private fetchImpl: FetchLike;
  private base: string;
  constructor(token: string, fetchImpl: FetchLike = fetch, base = CLICKSIGN_PROD_BASE) {
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.base = base;
  }

  async call(step: string, method: string, path: string, body?: unknown): Promise<any> {
    const headers: Record<string, string> = {
      Authorization: this.token,
      Accept: "application/vnd.api+json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/vnd.api+json";
    const res = await this.fetchImpl(this.base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 300);
      try {
        const j = JSON.parse(text);
        detail = (j.errors ?? [])
          .map((e: any) => [e.source?.pointer, e.detail ?? e.title].filter(Boolean).join(" "))
          .join("; ");
      } catch {
        /* corpo não-JSON */
      }
      throw new ClicksignError(step, res.status, scrubEmails(detail).slice(0, 300));
    }
    return text ? JSON.parse(text) : null;
  }

  createEnvelope(attrs: Record<string, unknown>) {
    return this.call("envelope", "POST", "/envelopes", {
      data: { type: "envelopes", attributes: attrs },
    });
  }
  uploadDocument(envelopeId: string, filename: string, pdf: Uint8Array, metadata: object) {
    return this.call("document", "POST", `/envelopes/${envelopeId}/documents`, {
      data: {
        type: "documents",
        attributes: {
          filename,
          content_base64: `data:application/pdf;base64,${toBase64(pdf)}`,
          metadata,
        },
      },
    });
  }
  createSigner(envelopeId: string, s: SignerInput) {
    return this.call("signer", "POST", `/envelopes/${envelopeId}/signers`, {
      data: { type: "signers", attributes: { name: s.nome, email: s.email } },
    });
  }
  createRequirement(envelopeId: string, documentId: string, signerId: string, attrs: object) {
    return this.call("requirement", "POST", `/envelopes/${envelopeId}/requirements`, {
      data: {
        type: "requirements",
        attributes: attrs,
        relationships: {
          document: { data: { type: "documents", id: documentId } },
          signer: { data: { type: "signers", id: signerId } },
        },
      },
    });
  }
  activate(envelopeId: string) {
    return this.call("activate", "PATCH", `/envelopes/${envelopeId}`, {
      data: { id: envelopeId, type: "envelopes", attributes: { status: "running" } },
    });
  }
  getEnvelope(envelopeId: string) {
    return this.call("get_envelope", "GET", `/envelopes/${envelopeId}`);
  }
  getDocument(envelopeId: string, documentId: string) {
    return this.call("get_document", "GET", `/envelopes/${envelopeId}/documents/${documentId}`);
  }
  deleteEnvelope(envelopeId: string) {
    return this.call("delete", "DELETE", `/envelopes/${envelopeId}`);
  }
}

export type EnvelopePlan = {
  name: string;
  deadlineAt: string;
  filename: string;
  pdf: Uint8Array;
  metadata: Record<string, string>;
  signers: SignerInput[];
};

export type EnvelopeResult = { envelopeId: string; documentId: string; activated: boolean };

/**
 * Monta o envelope completo: envelope → documento → signatários → requisitos (qualificação por papel
 * + autenticação por código no e-mail) e, se `activate`, ativa (todos assinam ao mesmo tempo).
 * Se algo falhar ANTES da ativação, o rascunho é excluído (rascunho não envia e-mail nem cobra).
 * `onEnvelopeCreated` permite gravar o id logo após a criação (rastreio mesmo se cair no meio).
 */
export async function buildEnvelope(
  client: ClicksignClient,
  plan: EnvelopePlan,
  opts: { activate: boolean; onEnvelopeCreated?: (id: string) => Promise<void> | void },
): Promise<EnvelopeResult> {
  const env = await client.createEnvelope({
    name: plan.name.slice(0, 100),
    locale: "pt-BR",
    auto_close: true,
    block_after_refusal: false,
    deadline_at: plan.deadlineAt,
  });
  const envelopeId: string = env?.data?.id;
  if (!envelopeId) throw new ClicksignError("envelope", 0, "resposta sem id");
  try {
    await opts.onEnvelopeCreated?.(envelopeId);
    const doc = await client.uploadDocument(envelopeId, plan.filename, plan.pdf, plan.metadata);
    const documentId: string = doc?.data?.id;
    if (!documentId) throw new ClicksignError("document", 0, "resposta sem id");
    for (const s of plan.signers) {
      const signer = await client.createSigner(envelopeId, s);
      const signerId: string = signer?.data?.id;
      if (!signerId) throw new ClicksignError("signer", 0, "resposta sem id");
      await client.createRequirement(envelopeId, documentId, signerId, {
        action: "agree",
        role: ROLE_BY_PAPEL[s.papel],
      });
      await client.createRequirement(envelopeId, documentId, signerId, {
        action: "provide_evidence",
        auth: "email",
      });
    }
    if (opts.activate) await client.activate(envelopeId);
    return { envelopeId, documentId, activated: opts.activate };
  } catch (err) {
    // Só rascunho pode ser excluído; se a ativação respondeu erro, a exclusão também falha (403) e o
    // erro original é o que importa.
    await client.deleteEnvelope(envelopeId).catch(() => undefined);
    throw err;
  }
}

/** Data limite RFC 3339 a N dias (máx. 90 pela Clicksign). */
export function deadlineIso(days: number, now = new Date()): string {
  const d = Math.min(Math.max(Math.trunc(days) || 30, 1), 90);
  return new Date(now.getTime() + d * 86400000).toISOString();
}

/** Link do PDF assinado: só https em hosts da Clicksign/S3 (evita SSRF via payload). */
export function safeDownloadUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return null;
    const h = url.hostname.toLowerCase();
    const ok =
      h === "app.clicksign.com" ||
      h.endsWith(".clicksign.com") ||
      h.endsWith(".amazonaws.com");
    return ok ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Extrai o link do assinado da resposta GET do documento (v3) ou do payload do webhook. */
export function signedUrlFrom(docResponse: any, webhookDocument: any): string | null {
  const files = docResponse?.data?.links?.files ?? {};
  return (
    safeDownloadUrl(files.signed) ??
    safeDownloadUrl(webhookDocument?.downloads?.signed_file_url) ??
    null
  );
}
