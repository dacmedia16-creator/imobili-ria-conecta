// Lógica do envio da captação para a Clicksign, sem dependências do Deno (testável com mock).
// A autorização (papel, org, status, envelope em andamento) fica no banco: clicksign_capture_authorize,
// chamada com o JWT do usuário. Aqui: montar signatários, travas do modo teste e o envelope.
import {
  buildCaptureSigners,
  buildEnvelope,
  ClicksignActivationUnknownError,
  ClicksignClient,
  ClicksignError,
  deadlineIso,
  notifySigners,
  sha256Hex,
  type EnvelopeResult,
  type FetchLike,
  type PersonInput,
  WITNESS_COUNT,
} from "../_shared/clicksign.ts";

export const ACTIVATE_UNKNOWN_MSG =
  "Não foi possível confirmar o envio na Clicksign: os signatários podem ter recebido o e-mail. " +
  "Não reenvie; confira o envelope na Clicksign ou avise o suporte.";
export const POST_ACTIVATE_MSG =
  "Enviado à Clicksign, mas o registro no ADM MAX não foi concluído. Não reenvie; avise o suporte " +
  "para atualizar o status da captação.";
export const NOTIFY_FAILED_MSG =
  "Enviado, mas a notificação falhou; peça reenvio de aviso ao suporte.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SendContext = {
  organizationId: string;
  form: Record<string, unknown>;
  corretor: PersonInput;
  /** Signatários válidos da imobiliária (usuários ativos da org com e-mail do cadastro). */
  imobiliaria: Array<{ id: string; nome: string; email: string }>;
  testMode: boolean;
  allowlistSha256: string[];
  deadlineDays: number;
  token: string | null;
  gerado: { id: string; fileName: string };
};

export type SendDeps = {
  /** RPC clicksign_capture_authorize com o JWT do usuário; lança Error com mensagem clara. */
  authorize(captureId: string): Promise<string>;
  loadContext(organizationId: string, captureId: string): Promise<SendContext>;
  loadPdf(captureId: string, documentId: string): Promise<Uint8Array>;
  /** Insere a linha de rastreio (status sending). Lança "duplicate" se já houver envio em andamento. */
  insertEnvelope(row: Record<string, unknown>): Promise<string>;
  updateEnvelope(id: string, patch: Record<string, unknown>): Promise<void>;
  markSent(id: string): Promise<void>;
  actorId: string;
  fetch: FetchLike;
  clicksignBase?: string;
};

export type CoreResult = { status: number; body: Record<string, unknown> };
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): CoreResult => ({
  status,
  body: { error, ...extra },
});

export async function handleSend(deps: SendDeps, body: unknown): Promise<CoreResult> {
  const b = (body ?? {}) as Record<string, unknown>;
  const captureId = typeof b.capture_id === "string" ? b.capture_id : "";
  if (!UUID_RE.test(captureId)) return fail(400, "Captação inválida");
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
        return {
          nome: typeof o.nome === "string" ? o.nome.slice(0, 200) : "",
          email: typeof o.email === "string" ? o.email.slice(0, 200) : "",
        };
      })
    : [];

  let org: string;
  try {
    org = await deps.authorize(captureId);
  } catch (e) {
    return fail(403, e instanceof Error ? e.message : "Envio não autorizado");
  }
  const ctx = await deps.loadContext(org, captureId);
  if (!ctx.token) return fail(503, "Chave da Clicksign não configurada para esta imobiliária");

  const byId = new Map(ctx.imobiliaria.map((p) => [p.id, p]));
  if (imobIds.some((id) => !byId.has(id))) {
    return fail(422, "Signatário da imobiliária inválido", {
      details: ["Escolha somente pessoas da lista da imobiliária"],
    });
  }
  const { signers, errors } = buildCaptureSigners({
    form: ctx.form,
    corretor: ctx.corretor,
    imobiliaria: imobIds.map((id) => byId.get(id)!),
    testemunhas,
  });
  if (errors.length) return fail(422, "Dados incompletos para assinatura", { details: errors });

  const hashed = await Promise.all(
    signers.map(async (s) => ({
      papel: s.papel,
      nome: s.nome,
      email_sha256: await sha256Hex(s.email),
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
      organization_id: org,
      capture_id: captureId,
      source_document_id: ctx.gerado.id,
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

  // Fase 1: até a ativação confirmada. document_key é gravado ANTES de ativar (webhook acha o envelope).
  const client = new ClicksignClient(ctx.token, deps.fetch, deps.clicksignBase);
  let built: EnvelopeResult;
  try {
    const pdf = await deps.loadPdf(captureId, ctx.gerado.id);
    const prefix = ctx.testMode ? "TESTE - " : "";
    built = await buildEnvelope(
      client,
      {
        name: `${prefix}Termo de exclusividade - captação ${captureId.slice(0, 8)}`,
        deadlineAt: deadlineIso(ctx.deadlineDays),
        filename: `${prefix.replace(/ - $/, "-")}termo-exclusividade-${captureId.slice(0, 8)}.pdf`,
        pdf,
        metadata: { origem: "adm-max-captacao", capture_id: captureId, row: envelopeRow },
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
      // Pode ter sido enviado: mantém 'sending' (o índice único continua bloqueando o reenvio).
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
      {
        code,
        ...(detail ? { details: [detail] } : {}),
      },
    );
  }

  // Fase 2: o envelope JÁ está rodando na Clicksign. Nenhuma falha local daqui em diante pode virar
  // 'error' (isso liberaria um reenvio real em dobro) nem dizer "nada foi enviado".
  // Na v3 ativar NÃO dispara e-mail: a notificação é um passo separado, feito logo após a ativação.
  // Se falhar, só registra e avisa na tela (não reverte o envelope nem libera reenvio).
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
      .updateEnvelope(envelopeRow, {
        error_code: notifyCode,
        updated_at: new Date().toISOString(),
      })
      .catch(() => undefined);
    return { status: 200, body: { ...ok, warning: NOTIFY_FAILED_MSG, code: notifyCode } };
  }
  return { status: 200, body: ok };
}
