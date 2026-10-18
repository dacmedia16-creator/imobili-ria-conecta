// Integração Clicksign da CAPTAÇÃO (1ª entrega). Desligada por padrão: o botão só aparece quando a
// organização tem clicksign_org_settings.enabled = true e a chave no Vault (decidido no banco, via
// clicksign_capture_config). Aqui não há token, segredo nem chamada direta à Clicksign: o envio passa
// pela edge function clicksign-send, que valida papel, organização e status de novo no servidor.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fileTooBigMessage,
  MAX_CLICKSIGN_FILE_BYTES,
  normEmail,
  validEmail,
  validSignerName,
  WITNESS_COUNT,
} from "../../supabase/functions/_shared/clicksign.ts";

export { WITNESS_COUNT };

export const clicksignManualInstructions =
  "Baixe o PDF para assinatura (contrato + Plano de Marketing), envie-o para assinatura e anexe aqui o PDF assinado.";

export type ClicksignEnvelopeInfo = {
  status: "sending" | "running" | "closed" | "canceled" | "error";
  is_test: boolean;
  created_at: string;
  updated_at?: string | null;
  error_code: string | null;
  /** Motivo da recusa da Clicksign (400/422), sem e-mail, CPF nem nomes. */
  error_detail?: string | null;
  signed: boolean;
  last_notified_at?: string | null;
  notify_available_at?: string | null;
};

export type ClicksignCaptureConfig =
  | { enabled: false }
  | {
      enabled: true;
      test_mode: boolean;
      can_send: boolean;
      witnesses: number;
      deadline_days: number;
      imobiliaria: Array<{ id: string; nome: string }>;
      corretor_email_ok: boolean;
      /** Tamanho do contrato gerado em bytes (null = desconhecido; o servidor confere). */
      pdf_size?: number | null;
      envelope: ClicksignEnvelopeInfo | null;
    };

export const CLICKSIGN_DISABLED: ClicksignCaptureConfig = Object.freeze({ enabled: false });

/** Lê a configuração para a tela. Qualquer falha = desligado (fail-closed, botão oculto). */
export async function clicksignCaptureConfig(
  db: SupabaseClient,
  captureId: string,
): Promise<ClicksignCaptureConfig> {
  try {
    const { data, error } = await db.rpc("clicksign_capture_config", { _id: captureId });
    if (error || !data || typeof data !== "object") return CLICKSIGN_DISABLED;
    const c = data as Record<string, unknown>;
    if (c.enabled !== true) return CLICKSIGN_DISABLED;
    return {
      enabled: true,
      test_mode: c.test_mode !== false,
      can_send: c.can_send === true,
      witnesses: typeof c.witnesses === "number" ? c.witnesses : WITNESS_COUNT,
      deadline_days: typeof c.deadline_days === "number" ? c.deadline_days : 30,
      imobiliaria: Array.isArray(c.imobiliaria)
        ? (c.imobiliaria as Array<{ id: string; nome: string }>)
        : [],
      corretor_email_ok: c.corretor_email_ok === true,
      pdf_size: typeof c.pdf_size === "number" ? c.pdf_size : null,
      envelope: (c.envelope as ClicksignEnvelopeInfo | null) ?? null,
    };
  } catch {
    return CLICKSIGN_DISABLED;
  }
}

export type Testemunha = { nome: string; email: string };
export type SendDialogInput = {
  form: Record<string, unknown> | null | undefined;
  corretorEmailOk: boolean;
  imobiliariaIds: string[];
  testemunhas: Testemunha[];
  /** Tamanho do PDF gerado em bytes (null/ausente = desconhecido; o servidor confere). */
  pdfSize?: number | null;
};

function ownerFilled(o: unknown): boolean {
  return (
    !!o &&
    typeof o === "object" &&
    Object.values(o as Record<string, unknown>).some(
      (v) => typeof v === "string" && v.trim() !== "",
    )
  );
}

/**
 * Mesmas regras do servidor (buildCaptureSigners), para travar o botão com mensagem clara antes de
 * enviar. O servidor confere de novo; isto é só a experiência da tela.
 */
export function sendDialogErrors(input: SendDialogInput): string[] {
  const errors: string[] = [];
  const emails: Array<[string, string]> = [];
  if (typeof input.pdfSize === "number" && input.pdfSize > MAX_CLICKSIGN_FILE_BYTES) {
    errors.push(fileTooBigMessage(input.pdfSize, "O PDF do contrato"));
  }
  const p1 = (input.form?.proprietario_1 ?? {}) as Record<string, string>;
  if (!validSignerName(p1.nome_completo)) errors.push("Proprietário 1: informe nome e sobrenome");
  if (!validEmail(p1.email)) errors.push("Proprietário 1: e-mail ausente ou inválido no cadastro");
  else emails.push([normEmail(p1.email), "Proprietário 1"]);
  const p2 = input.form?.proprietario_2 as Record<string, string> | undefined;
  if (ownerFilled(p2)) {
    if (!validSignerName(p2?.nome_completo))
      errors.push("Proprietário 2: informe nome e sobrenome");
    if (!validEmail(p2?.email))
      errors.push("Proprietário 2: e-mail ausente ou inválido no cadastro");
    else emails.push([normEmail(p2?.email), "Proprietário 2"]);
  }
  if (!input.corretorEmailOk) errors.push("Corretor: o cadastro do captador está sem e-mail");
  if (input.imobiliariaIds.length < 1)
    errors.push("Escolha ao menos 1 pessoa para assinar pela imobiliária");
  if (input.testemunhas.length !== WITNESS_COUNT) {
    errors.push(`Informe exatamente ${WITNESS_COUNT} testemunhas`);
  }
  input.testemunhas.slice(0, WITNESS_COUNT).forEach((t, i) => {
    const label = `Testemunha ${i + 1}`;
    if (!validSignerName(t.nome)) errors.push(`${label}: informe nome e sobrenome`);
    if (!validEmail(t.email)) errors.push(`${label}: e-mail ausente ou inválido`);
    else emails.push([normEmail(t.email), label]);
  });
  const seen = new Map<string, string>();
  for (const [email, label] of emails) {
    const prev = seen.get(email);
    if (prev) errors.push(`A mesma pessoa não pode assinar duas vezes (${prev} e ${label})`);
    else seen.set(email, label);
  }
  return errors;
}

export type SendResult = { ok: true; is_test: boolean; signers: number; warning?: string };

/** Envia pela edge function. Lança Error com a mensagem do servidor (e detalhes, se houver). */
export async function sendToClicksign(
  db: SupabaseClient,
  input: { captureId: string; imobiliariaIds: string[]; testemunhas: Testemunha[] },
): Promise<SendResult> {
  const { data, error } = await db.functions.invoke("clicksign-send", {
    body: {
      capture_id: input.captureId,
      imobiliaria_ids: input.imobiliariaIds,
      testemunhas: input.testemunhas.map((t) => ({ nome: t.nome.trim(), email: t.email.trim() })),
    },
  });
  if (error) {
    // Sem corpo do servidor não dá para saber em que ponto falhou: não afirmar que nada foi enviado.
    let message =
      "Falha ao enviar para a Clicksign. Atualize a página e confira o status antes de tentar de novo.";
    const ctx = (error as { context?: unknown }).context;
    if (ctx && typeof (ctx as Response).json === "function") {
      try {
        const body = (await (ctx as Response).json()) as { error?: string; details?: string[] };
        if (body?.error) {
          message = body.details?.length ? `${body.error}: ${body.details.join("; ")}` : body.error;
        }
      } catch {
        /* corpo não-JSON */
      }
    }
    throw new Error(message);
  }
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.ok !== true) throw new Error("Resposta inesperada do envio pela Clicksign");
  return {
    ok: true,
    is_test: d.is_test === true,
    signers: Number(d.signers) || 0,
    ...(typeof d.warning === "string" && d.warning ? { warning: d.warning } : {}),
  };
}

export function envelopeStatusLabel(e: ClicksignEnvelopeInfo): string {
  const teste = e.is_test ? " (TESTE)" : "";
  switch (e.status) {
    case "sending":
      if (e.error_code === "activate_unknown") {
        return `Envio sem confirmação da Clicksign${teste}: os signatários podem ter recebido o e-mail. Não reenvie; use “Conferir na Clicksign”.`;
      }
      return `Enviando para a Clicksign${teste}…`;
    case "running":
      if (e.error_code?.startsWith("post_activate:")) {
        return `Enviado à Clicksign${teste}, mas o registro no ADM MAX ficou incompleto. Não reenvie; avise o suporte.`;
      }
      if (e.error_code?.startsWith("notify_failed:")) {
        return `Enviado${teste}, mas a notificação falhou; use “Reenviar aviso” abaixo.`;
      }
      return `Em assinatura na Clicksign${teste}. Quando todos assinarem, o PDF assinado é anexado sozinho.`;
    case "closed":
      return e.signed
        ? `Assinado na Clicksign${teste}. PDF assinado anexado; confira e aprove manualmente.`
        : `Envelope encerrado na Clicksign${teste}.`;
    case "canceled":
      return `Envelope cancelado, recusado ou vencido na Clicksign${teste}. É possível enviar de novo.`;
    case "error":
      return `O último envio falhou${teste}; nada foi enviado aos signatários. É possível tentar de novo.${
        e.error_detail?.trim() ? ` Motivo informado pela Clicksign: ${e.error_detail.trim()}` : ""
      }`;
    default:
      return "";
  }
}

/** "Conferir na Clicksign" da captação (envio sem confirmação). Mesma regra da venda. */
export async function reconcileClicksign(
  db: SupabaseClient,
  captureId: string,
): Promise<{ result: string; message: string; warning?: string }> {
  const d = await invokeManage(
    db,
    { capture_id: captureId, action: "reconcile" },
    "Não foi possível conferir na Clicksign agora. Tente de novo.",
  );
  return {
    result: String(d.result ?? ""),
    message: typeof d.message === "string" ? d.message : "Conferido.",
    ...(typeof d.warning === "string" ? { warning: d.warning } : {}),
  };
}

/** Pode (re)enviar: não há envelope em envio ou em assinatura. */
export function canStartEnvelope(e: ClicksignEnvelopeInfo | null): boolean {
  return !e || !["sending", "running"].includes(e.status);
}

// ---------- envelope em assinatura: quem falta, reenviar aviso, editar signatário ----------

export type ManagedSigner = {
  idx: number;
  papel: string;
  label: string;
  nome: string;
  /** Mascarado pelo servidor (ex.: "an***@example.com"). */
  email: string;
  signed: boolean;
  /** Abriu o contrato (signature_started). Ausente em respostas antigas. */
  opened?: boolean;
  status?: "enviado" | "abriu" | "assinou";
  found: boolean;
  editable: boolean;
};

/** Pode gerenciar (reenviar/editar): gestor/jurídico/ADM com envelope rodando. */
export function canManageEnvelope(config: ClicksignCaptureConfig): boolean {
  return config.enabled && config.can_send && config.envelope?.status === "running";
}

/**
 * Minutos que faltam para liberar "Reenviar aviso" (0 = liberado). O servidor confere de novo;
 * aqui só evita o clique inútil.
 */
export function notifyWaitMinutes(e: ClicksignEnvelopeInfo | null, now = Date.now()): number {
  const at = e?.notify_available_at ? Date.parse(e.notify_available_at) : NaN;
  if (!Number.isFinite(at) || at <= now) return 0;
  return Math.ceil((at - now) / 60000);
}

/** Mesmas regras do servidor (nome com sobrenome, e-mail válido) para travar o botão Salvar. */
export function editSignerErrors(nome: string, email: string): string[] {
  const errors: string[] = [];
  if (!validSignerName(nome)) errors.push("Informe nome e sobrenome");
  if (!validEmail(email)) errors.push("E-mail ausente ou inválido");
  return errors;
}

async function invokeManage(
  db: SupabaseClient,
  body: Record<string, unknown>,
  fallback: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await db.functions.invoke("clicksign-manage", { body });
  if (error) {
    let message = fallback;
    const ctx = (error as { context?: unknown }).context;
    if (ctx && typeof (ctx as Response).json === "function") {
      try {
        const b = (await (ctx as Response).json()) as { error?: string; details?: string[] };
        if (b?.error) message = b.details?.length ? `${b.error}: ${b.details.join("; ")}` : b.error;
      } catch {
        /* corpo não-JSON */
      }
    }
    throw new Error(message);
  }
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.ok !== true) throw new Error(fallback);
  return d;
}

export async function clicksignSignersStatus(
  db: SupabaseClient,
  captureId: string,
): Promise<ManagedSigner[]> {
  const d = await invokeManage(
    db,
    { capture_id: captureId, action: "status" },
    "Não foi possível consultar a Clicksign agora.",
  );
  return Array.isArray(d.signers) ? (d.signers as ManagedSigner[]) : [];
}

export async function resendClicksignNotice(
  db: SupabaseClient,
  captureId: string,
): Promise<{ warning?: string }> {
  const d = await invokeManage(
    db,
    { capture_id: captureId, action: "notify" },
    "Não foi possível reenviar o aviso. Atualize a página e tente de novo.",
  );
  return typeof d.warning === "string" ? { warning: d.warning } : {};
}

export async function editClicksignSigner(
  db: SupabaseClient,
  input: { captureId: string; idx: number; nome: string; email: string },
): Promise<{ warning?: string }> {
  const d = await invokeManage(
    db,
    {
      capture_id: input.captureId,
      action: "edit_signer",
      idx: input.idx,
      nome: input.nome.trim(),
      email: input.email.trim(),
    },
    "Não foi possível alterar o signatário. Atualize a página e confira antes de tentar de novo.",
  );
  return typeof d.warning === "string" ? { warning: d.warning } : {};
}

// ---------- passo "Documento assinado" ----------

export type ClicksignSignedInfo = {
  is_test: boolean;
  closed_at: string;
  signers: Array<{ papel: string; nome: string }>;
};

/** Nome fixo do PDF anexado pelo webhook (clicksign-webhook/core.ts). */
export const CLICKSIGN_SIGNED_FILE = "contrato-assinado-clicksign.pdf";

/**
 * Quem assinou pela Clicksign (sem e-mail). null = o assinado atual não veio da Clicksign;
 * "unknown" = não deu para consultar (a tela usa o nome do arquivo como pista).
 */
export async function clicksignCaptureSigned(
  db: SupabaseClient,
  captureId: string,
  signedDocId?: string | null,
): Promise<ClicksignSignedInfo | null | "unknown"> {
  try {
    const { data, error } = await db.rpc("clicksign_capture_signed", { _id: captureId });
    if (error) return "unknown";
    if (!data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    // O envelope assinado é de outro documento (ex.: upload manual por cima): origem manual.
    if (signedDocId && typeof d.document_id === "string" && d.document_id !== signedDocId) {
      return null;
    }
    return {
      is_test: d.is_test === true,
      closed_at: typeof d.closed_at === "string" ? d.closed_at : "",
      signers: Array.isArray(d.signers) ? (d.signers as ClicksignSignedInfo["signers"]) : [],
    };
  } catch {
    return "unknown";
  }
}

const PAPEL_LABEL: Record<string, string> = {
  proprietario_1: "Proprietário 1",
  proprietario_2: "Proprietário 2",
  corretor: "Corretor",
  imobiliaria: "Imobiliária",
  testemunha: "Testemunha",
};
/** "Proprietário 1", "Imobiliária 2", "Testemunha 1"… na ordem gravada. */
export function signedSignerLabels(list: ClicksignSignedInfo["signers"]): string[] {
  const count: Record<string, number> = {};
  const total: Record<string, number> = {};
  list.forEach((s) => (total[s.papel] = (total[s.papel] ?? 0) + 1));
  return list.map((s) => {
    count[s.papel] = (count[s.papel] ?? 0) + 1;
    const base = PAPEL_LABEL[s.papel] ?? s.papel;
    const n = ["imobiliaria", "testemunha"].includes(s.papel) && total[s.papel] > 1;
    return `${base}${n ? ` ${count[s.papel]}` : ""}: ${s.nome}`;
  });
}

type StepDoc = { kind: string; created_at?: string | null };
const docTime = (d: StepDoc) => (d.created_at ? Date.parse(d.created_at) || 0 : 0);
const newest = <T extends StepDoc>(list: T[]): T | null =>
  list.reduce<T | null>((best, d) => (!best || docTime(d) > docTime(best) ? d : best), null);

/**
 * Contrato assinado que vale para a captação, com a mesma regra do banco (exclusive_capture_action
 * 'aprovar'): o assinado precisa ter sido anexado depois (>=) do PDF gerado. Sem gerado, só vale
 * em captação já aprovada (antigas). Quando uma aprovada é devolvida, o banco mantém o assinado
 * velho como histórico e apaga só o gerado; esse assinado velho não conta.
 */
export function currentSignedDoc<T extends StepDoc>(
  manual: boolean,
  status: string | null | undefined,
  docs: T[],
): T | null {
  if (manual) return null;
  const signed = newest(docs.filter((d) => d.kind === "assinado"));
  if (!signed) return null;
  const gerado = newest(docs.filter((d) => d.kind === "gerado"));
  if (!gerado) return status === "aprovada" ? signed : null;
  return docTime(signed) >= docTime(gerado) ? signed : null;
}

/**
 * Qual passo final a captação usa: o passo 5 "Documento assinado" aparece quando há contrato
 * assinado válido (Clicksign ou upload manual) numa captação normal — ver currentSignedDoc.
 * Captações sem assinado válido continuam com 4 passos; o cadastro manual tem fluxo próprio.
 */
export function hasSignedStep(manual: boolean, docs: StepDoc[], status?: string | null): boolean {
  return currentSignedDoc(manual, status, docs) !== null;
}

/** Origem do assinado mostrada no passo 5. */
export function signedOrigin(
  info: ClicksignSignedInfo | null | "unknown",
  fileName?: string | null,
): string {
  if (info === "unknown") {
    return fileName === CLICKSIGN_SIGNED_FILE
      ? "Clicksign, anexado automaticamente"
      : "Upload manual (anexado no ADM MAX)";
  }
  if (!info) return "Upload manual (anexado no ADM MAX)";
  return `Clicksign${info.is_test ? " (TESTE)" : ""}, anexado automaticamente`;
}
