// Integração Clicksign da CAPTAÇÃO (1ª entrega). Desligada por padrão: o botão só aparece quando a
// organização tem clicksign_org_settings.enabled = true e a chave no Vault (decidido no banco, via
// clicksign_capture_config). Aqui não há token, segredo nem chamada direta à Clicksign: o envio passa
// pela edge function clicksign-send, que valida papel, organização e status de novo no servidor.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
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
  error_code: string | null;
  signed: boolean;
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
        return `Envio sem confirmação da Clicksign${teste}: os signatários podem ter recebido o e-mail. Não reenvie; avise o suporte.`;
      }
      return `Enviando para a Clicksign${teste}…`;
    case "running":
      if (e.error_code?.startsWith("post_activate:")) {
        return `Enviado à Clicksign${teste}, mas o registro no ADM MAX ficou incompleto. Não reenvie; avise o suporte.`;
      }
      return `Em assinatura na Clicksign${teste}. Quando todos assinarem, o PDF assinado é anexado sozinho.`;
    case "closed":
      return e.signed
        ? `Assinado na Clicksign${teste}. PDF assinado anexado; confira e aprove manualmente.`
        : `Envelope encerrado na Clicksign${teste}.`;
    case "canceled":
      return `Envelope cancelado, recusado ou vencido na Clicksign${teste}. É possível enviar de novo.`;
    case "error":
      return `O último envio falhou${teste}; nada foi enviado aos signatários. É possível tentar de novo.`;
    default:
      return "";
  }
}

/** Pode (re)enviar: não há envelope em envio ou em assinatura. */
export function canStartEnvelope(e: ClicksignEnvelopeInfo | null): boolean {
  return !e || !["sending", "running"].includes(e.status);
}
