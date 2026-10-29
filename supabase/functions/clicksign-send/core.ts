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
  fileTooBigMessage,
  MAX_CLICKSIGN_FILE_BYTES,
  notifySigners,
  sendFailure,
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
  "Enviado, mas a notificação falhou; use “Reenviar aviso” na captação.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Testemunhas automáticas da captação (t_e8078685), decididas no banco
 * (exclusive_testemunhas_resolver): 1 = corretor da captação, 2 = gestor da equipe (ou o escolhido
 * pelo staff). `problemas` vazio e `pdfOk` = pode enviar.
 */
export type TestemunhasAuto = {
  corretor: PersonInput;
  gestor: PersonInput | null;
  problemas: string[];
  pdfOk: boolean;
};

/**
 * Converte a resposta de exclusive_testemunhas_resolver. Resposta ausente/estranha = problema
 * (fail-closed: nunca vira testemunha vazia).
 */
export function testemunhasDoBanco(raw: unknown): TestemunhasAuto {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pessoa = (v: unknown): PersonInput | null => {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    return {
      nome: typeof o.nome === "string" ? o.nome : "",
      email: typeof o.email === "string" ? o.email : "",
    };
  };
  const problemas = Array.isArray(r.problemas)
    ? r.problemas.filter((x): x is string => typeof x === "string")
    : [];
  const corretor = pessoa(r.corretor);
  if (!corretor || r.ok !== true) {
    if (!problemas.length) problemas.push("Não foi possível conferir as testemunhas da captação");
  }
  return {
    corretor: corretor ?? { nome: "", email: "" },
    gestor: pessoa(r.gestor),
    problemas,
    pdfOk: r.pdf_ok === true,
  };
}

export const TESTEMUNHAS_PDF_MSG =
  "As testemunhas impressas no PDF não são as atuais (a testemunha mudou depois de gerar). Gere o PDF para assinatura de novo.";

export type SendContext = {
  organizationId: string;
  form: Record<string, unknown>;
  /** Testemunhas do banco. O corretor assina só como testemunha 1 (não como parte). */
  testemunhas: TestemunhasAuto;
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
  // Testemunhas enviadas pela tela são IGNORADAS (t_e8078685): vêm do cadastro, decididas no banco.

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
  // Nunca envia com testemunha vazia ou incompleta: o motivo vem do banco, sem e-mail nem CPF.
  const tw = ctx.testemunhas;
  if (tw.problemas.length || !tw.gestor) {
    return fail(422, "Testemunhas incompletas", {
      code: "testemunhas",
      details: tw.problemas.length ? tw.problemas : ["Testemunha 2: escolha um gestor ou team leader"],
    });
  }
  if (!tw.pdfOk) {
    return fail(422, TESTEMUNHAS_PDF_MSG, { code: "testemunhas:pdf" });
  }
  const { signers, errors } = buildCaptureSigners({
    form: ctx.form,
    corretor: null,
    imobiliaria: imobIds.map((id) => byId.get(id)!),
    testemunhas: [tw.corretor, tw.gestor],
  });
  if (errors.length) return fail(422, "Dados incompletos para assinatura", { details: errors });

  const hashed = await Promise.all(
    signers.map(async (s) => ({
      papel: s.papel,
      nome: s.nome,
      email_sha256: await sha256Hex(s.email),
      ...(s.papel === "testemunha" ? { cadastro: true } : {}),
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

  // PDF lido ANTES da linha de rastreio: acima de 10 MB (limite da Clicksign) a mensagem é clara e
  // nada é criado nem chamado na Clicksign.
  let pdf: Uint8Array;
  try {
    pdf = await deps.loadPdf(captureId, ctx.gerado.id);
  } catch {
    return fail(
      502,
      "Não foi possível ler o PDF do contrato agora. Nada foi enviado; tente de novo em instantes.",
      { code: "file:read" },
    );
  }
  if (!pdf.length) {
    return fail(422, "O PDF do contrato está vazio. Gere o contrato de novo.", {
      code: "file:empty",
    });
  }
  if (pdf.length > MAX_CLICKSIGN_FILE_BYTES) {
    return fail(422, fileTooBigMessage(pdf.length, "O PDF do contrato"), {
      code: "file:too_big",
    });
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
        bulkLargeEnvelope: true,
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
    const { code, detail, screen } = sendFailure(
      e,
      signers.map((s) => s.nome),
    );
    await deps
      .updateEnvelope(envelopeRow, {
        status: "error",
        error_code: code,
        error_detail: detail,
        updated_at: new Date().toISOString(),
      })
      .catch(() => undefined);
    return fail(
      502,
      "Falha ao enviar para a Clicksign. Nada foi enviado aos signatários; tente de novo ou use o fluxo manual.",
      {
        code,
        ...(screen ? { details: [screen] } : {}),
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
