// Clicksign na VENDA, sem dependências do Deno (testável com mock). Ações:
// - "send": envia o contrato vigente do jurídico (último sale_documents tipo 'contrato') com todas as
//   partes da venda, corretor(es), imobiliária, 2 testemunhas e partes extras;
// - "cancel": cancela o documento em assinatura na Clicksign (botão ou pedido automático por nova
//   versão do contrato / venda que saiu da assinatura) e devolve a venda ao gestor;
// - "status" | "notify" | "edit_signer": mesma gestão da captação (handleManage, kind 'venda').
// A regra de quem pode e de qual venda/envelope fica no banco (RPCs com o JWT do usuário).
// Nunca devolve nem registra e-mail em claro (só mascarado na tela e sha256 no banco).
import {
  buildEnvelope,
  ClicksignActivationUnknownError,
  ClicksignClient,
  ClicksignError,
  deadlineIso,
  mimeForFilename,
  notifySigners,
  sha256Hex,
  WITNESS_COUNT,
  type EnvelopeResult,
  type FetchLike,
  type PersonInput,
  type StoredSigner,
} from "../_shared/clicksign.ts";
import {
  buildSaleSigners,
  MAX_EXTRAS,
  type SaleExtra,
  type SaleParty,
} from "../_shared/clicksign-venda.ts";
import { handleManage, type ManageDeps } from "../clicksign-manage/core.ts";

export const ACTIVATE_UNKNOWN_MSG =
  "Não foi possível confirmar o envio na Clicksign: os signatários podem ter recebido o e-mail. " +
  "Não reenvie; confira o envelope na Clicksign ou avise o suporte.";
export const POST_ACTIVATE_MSG =
  "Enviado à Clicksign, mas o registro no ADM MAX não foi concluído. Não reenvie; avise o suporte " +
  "para atualizar o status da venda.";
export const NOTIFY_FAILED_MSG =
  "Enviado, mas a notificação falhou; use “Reenviar aviso” na venda.";
export const MISSING_EMAIL_MSG = "Há partes da venda sem e-mail";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_RE = /^(corretor|parceiro|parceria):[0-9a-f-]{36}$/i;
const MAX_FILE = 20 * 1024 * 1024;

export type SaleSendContext = {
  parties: SaleParty[];
  corretores: PersonInput[];
  /** Signatários válidos da imobiliária (usuários ativos da org com e-mail do cadastro). */
  imobiliaria: Array<{ id: string; nome: string; email: string }>;
  testMode: boolean;
  allowlistSha256: string[];
  deadlineDays: number;
  token: string | null;
  contrato: { id: string; fileName: string };
  imovel: string;
};

export type SaleDeps = ManageDeps & {
  /** clicksign_sale_authorize com o JWT do usuário → {org, contrato}; lança Error claro. */
  authorizeSend(saleId: string): Promise<{ org: string; contrato: string }>;
  loadSendContext(org: string, saleId: string, contratoId: string): Promise<SaleSendContext>;
  /** Dados das partes extras do sistema pela ref (mesma org), via service_role. */
  resolveExtras(
    org: string,
    saleId: string,
    refs: string[],
  ): Promise<Array<{ ref: string; nome: string; email: string }>>;
  loadFile(contratoId: string): Promise<Uint8Array>;
  insertEnvelope(row: Record<string, unknown>): Promise<string>;
  updateEnvelope(id: string, patch: Record<string, unknown>): Promise<void>;
  markSent(id: string): Promise<void>;
  /** Pedido de cancelamento gravado no envelope (nova versão / status mudou) ou null. */
  cancelReason(envelopeRow: string): Promise<"nova_versao" | "status_mudou" | null>;
  /** clicksign_sale_canceled (service_role): marca cancelado e devolve a venda ao gestor. */
  markCanceled(envelopeRow: string, reason: string): Promise<string>;
};

export type CoreResult = { status: number; body: Record<string, unknown> };
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): CoreResult => ({
  status,
  body: { error, ...extra },
});

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

/** Lê as partes extras do corpo (no máximo MAX_EXTRAS + 1, para o erro aparecer). */
export function parseExtras(raw: unknown): {
  extras: Array<SaleExtra & { ref?: string }>;
  invalid: boolean;
} {
  if (!Array.isArray(raw)) return { extras: [], invalid: false };
  let invalid = false;
  const extras = raw.slice(0, MAX_EXTRAS + 1).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const role = str(o.role, 40);
    if (o.origem === "sistema") {
      const ref = str(o.ref, 60);
      if (!REF_RE.test(ref)) invalid = true;
      return { origem: "sistema" as const, ref, role, nome: "", email: "" };
    }
    if (o.origem !== "externo") invalid = true;
    return {
      origem: "externo" as const,
      nome: str(o.nome),
      email: str(o.email),
      cpf: str(o.cpf, 20),
      role,
    };
  });
  return { extras, invalid };
}

export async function handleSale(deps: SaleDeps, body: unknown): Promise<CoreResult> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.action === "send") return handleSaleSend(deps, b);
  if (b.action === "cancel") return handleSaleCancel(deps, b);
  return handleManage(deps, b, "venda");
}

async function handleSaleSend(deps: SaleDeps, b: Record<string, unknown>): Promise<CoreResult> {
  const saleId = str(b.sale_id, 40);
  if (!UUID_RE.test(saleId)) return fail(400, "Venda inválida");
  const imobIds = Array.isArray(b.imobiliaria_ids)
    ? [
        ...new Set(
          b.imobiliaria_ids.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)),
        ),
      ]
    : [];
  const testemunhas = Array.isArray(b.testemunhas)
    ? b.testemunhas.slice(0, WITNESS_COUNT + 1).map((t) => {
        const o = (t ?? {}) as Record<string, unknown>;
        return { nome: str(o.nome), email: str(o.email) };
      })
    : [];
  const parsed = parseExtras(b.extras);
  if (parsed.invalid) return fail(422, "Parte extra inválida");

  let auth: { org: string; contrato: string };
  try {
    auth = await deps.authorizeSend(saleId);
  } catch (e) {
    return fail(403, e instanceof Error ? e.message : "Envio não autorizado");
  }
  const ctx = await deps.loadSendContext(auth.org, saleId, auth.contrato);
  if (!ctx.token) return fail(503, "Chave da Clicksign não configurada para esta imobiliária");
  const mime = mimeForFilename(ctx.contrato.fileName);
  if (!mime) {
    return fail(422, "O contrato do jurídico precisa ser PDF, DOC ou DOCX para ir à Clicksign");
  }

  const byId = new Map(ctx.imobiliaria.map((p) => [p.id, p]));
  if (imobIds.some((id) => !byId.has(id))) {
    return fail(422, "Signatário da imobiliária inválido", {
      details: ["Escolha somente pessoas da lista da imobiliária"],
    });
  }
  const refs = parsed.extras.filter((x) => x.origem === "sistema").map((x) => x.ref!);
  const resolved = refs.length ? await deps.resolveExtras(auth.org, saleId, refs) : [];
  const byRef = new Map(resolved.map((r) => [r.ref, r]));
  if (refs.some((r) => !byRef.has(r))) {
    return fail(422, "Parte extra do sistema não encontrada", {
      details: ["Busque e escolha de novo a pessoa do sistema"],
    });
  }
  const extras: SaleExtra[] = parsed.extras.map((x) =>
    x.origem === "sistema"
      ? {
          origem: "sistema",
          role: x.role,
          nome: byRef.get(x.ref!)!.nome,
          email: byRef.get(x.ref!)!.email,
        }
      : x,
  );

  const { signers, errors, missingEmail } = buildSaleSigners({
    parties: ctx.parties,
    corretores: ctx.corretores,
    imobiliaria: imobIds.map((id) => byId.get(id)!),
    testemunhas,
    extras,
  });
  if (missingEmail.length) {
    // Venda antiga sem e-mail: bloqueia com o atalho para a aba Partes (nada é preenchido sozinho).
    return fail(422, MISSING_EMAIL_MSG, { details: errors, missing_email: missingEmail });
  }
  if (errors.length) return fail(422, "Dados incompletos para assinatura", { details: errors });

  const hashed: StoredSigner[] = await Promise.all(
    signers.map(async (s) => ({
      papel: s.papel,
      nome: s.nome,
      email_sha256: await sha256Hex(s.email),
      label: s.label,
      role: s.role,
    })),
  );
  if (ctx.testMode) {
    const allow = new Set(ctx.allowlistSha256);
    if (hashed.some((h) => !allow.has(h.email_sha256))) {
      return fail(422, "Modo teste: há signatário fora da lista autorizada de teste", {
        details: ["No modo teste só e-mails da allowlist da imobiliária podem receber"],
      });
    }
  }

  let envelopeRow: string;
  try {
    envelopeRow = await deps.insertEnvelope({
      organization_id: auth.org,
      origem: "venda",
      sale_id: saleId,
      source_document_id: ctx.contrato.id,
      status: "sending",
      is_test: ctx.testMode,
      signers: hashed,
      created_by: deps.actorId,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "duplicate") {
      return fail(409, "Este contrato já está em envio ou em assinatura na Clicksign");
    }
    throw e;
  }

  const client = new ClicksignClient(ctx.token, deps.fetch, deps.clicksignBase);
  let built: EnvelopeResult;
  try {
    const file = await deps.loadFile(ctx.contrato.id);
    if (!file.length || file.length > MAX_FILE) throw new ClicksignError("document", 0, "tamanho");
    const prefix = ctx.testMode ? "TESTE - " : "";
    const ext = ctx.contrato.fileName.toLowerCase().split(".").pop();
    built = await buildEnvelope(
      client,
      {
        name: `${prefix}Contrato de compra e venda - ${ctx.imovel || saleId.slice(0, 8)}`,
        deadlineAt: deadlineIso(ctx.deadlineDays),
        filename: `${prefix.replace(/ - $/, "-")}contrato-venda-${saleId.slice(0, 8)}.${ext}`,
        pdf: file,
        mime,
        metadata: { origem: "adm-max-venda", sale_id: saleId, row: envelopeRow },
        signers,
      },
      {
        activate: true,
        onEnvelopeCreated: (id) => deps.updateEnvelope(envelopeRow, { envelope_key: id }),
        onDocumentCreated: (id) => deps.updateEnvelope(envelopeRow, { document_key: id }),
      },
    );
  } catch (e) {
    if (e instanceof ClicksignActivationUnknownError) {
      await deps
        .updateEnvelope(envelopeRow, {
          error_code: "activate_unknown",
          updated_at: new Date().toISOString(),
        })
        .catch(() => undefined);
      return fail(502, ACTIVATE_UNKNOWN_MSG, { code: "activate_unknown" });
    }
    const code = e instanceof ClicksignError ? `${e.step}:${e.status}` : "internal";
    await deps
      .updateEnvelope(envelopeRow, {
        status: "error",
        error_code: code,
        updated_at: new Date().toISOString(),
      })
      .catch(() => undefined);
    const detail = e instanceof ClicksignError && e.status === 422 ? e.detail : undefined;
    return fail(
      502,
      "Falha ao enviar para a Clicksign. Nada foi enviado aos signatários; tente de novo ou use o fluxo manual.",
      { code, ...(detail ? { details: [detail] } : {}) },
    );
  }

  // O envelope JÁ está rodando: nenhuma falha local daqui em diante vira 'error' (liberaria envio em dobro).
  const notifyErr = await notifySigners(client, built.envelopeId);
  const notifyCode = notifyErr ? `notify_failed:${notifyErr}` : null;
  const ok = { ok: true, status: "running", is_test: ctx.testMode, signers: signers.length };
  try {
    await deps.markSent(envelopeRow);
  } catch {
    await deps
      .updateEnvelope(envelopeRow, {
        status: "running",
        error_code: `post_activate:mark_sent${notifyCode ? `|${notifyCode}` : ""}`,
        updated_at: new Date().toISOString(),
      })
      .catch(() => undefined);
    return {
      status: 200,
      body: {
        ...ok,
        warning: notifyCode ? `${POST_ACTIVATE_MSG} ${NOTIFY_FAILED_MSG}` : POST_ACTIVATE_MSG,
        ...(notifyCode ? { code: notifyCode } : {}),
      },
    };
  }
  if (notifyCode) {
    await deps
      .updateEnvelope(envelopeRow, { error_code: notifyCode, updated_at: new Date().toISOString() })
      .catch(() => undefined);
    return { status: 200, body: { ...ok, warning: NOTIFY_FAILED_MSG, code: notifyCode } };
  }
  return { status: 200, body: ok };
}

/** Cancelamento já feito/ineficaz na Clicksign (documento não está mais "running"). */
function docNotRunning(doc: unknown): boolean {
  const st = (doc as { data?: { attributes?: { status?: string } } })?.data?.attributes?.status;
  return typeof st === "string" && st !== "running";
}

async function handleSaleCancel(deps: SaleDeps, b: Record<string, unknown>): Promise<CoreResult> {
  const saleId = str(b.sale_id, 40);
  if (!UUID_RE.test(saleId)) return fail(400, "Venda inválida");
  let auth: { org: string; envelope: string };
  try {
    auth = await deps.authorize(saleId);
  } catch (e) {
    return fail(403, e instanceof Error ? e.message : "Ação não autorizada");
  }
  const ctx = await deps.loadContext(auth.org, auth.envelope);
  if (!ctx.token) return fail(503, "Chave da Clicksign não configurada para esta imobiliária");
  // O motivo vem do banco (pedido automático) e nunca do navegador; sem pedido = botão manual.
  const reason = (await deps.cancelReason(auth.envelope)) ?? "manual";
  const lock = await deps.lock(auth.envelope, "edit");
  if (lock !== "ok") return fail(409, "Outra ação está em andamento neste envelope. Aguarde.");
  const client = new ClicksignClient(ctx.token, deps.fetch, deps.clicksignBase);
  try {
    await client.cancelDocument(ctx.envelopeKey, ctx.documentKey);
  } catch (e) {
    // Pode já ter fechado/cancelado lá (ex.: duas abas). Confere antes de desistir.
    const gone = await client
      .getDocument(ctx.envelopeKey, ctx.documentKey)
      .then(docNotRunning, () => false);
    if (!gone) {
      await deps.done(auth.envelope, { action: null }).catch(() => undefined);
      const code = e instanceof ClicksignError ? `${e.step}:${e.status}` : "internal";
      return fail(502, "A Clicksign não confirmou o cancelamento. Nada mudou; tente de novo.", {
        code,
      });
    }
  }
  try {
    const res = await deps.markCanceled(auth.envelope, reason);
    return { status: 200, body: { ok: true, result: res, reason } };
  } catch {
    return {
      status: 200,
      body: {
        ok: true,
        reason,
        warning: "Cancelado na Clicksign, mas o registro no ADM MAX falhou. Avise o suporte.",
      },
    };
  }
}
