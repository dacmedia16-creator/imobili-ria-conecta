// Clicksign na VENDA (tela vendas.$id.tsx). Sem token nem chamada direta à Clicksign: tudo passa pela
// edge function clicksign-sale, que confere papel, organização, status e liberação do jurídico de
// novo no servidor. As regras de signatários vêm do mesmo módulo do servidor (_shared/clicksign-venda).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normEmail,
  validEmail,
  validSignerName,
  WITNESS_COUNT,
} from "../../supabase/functions/_shared/clicksign.ts";
import {
  formatCpf,
  MAX_EXTRAS,
  missingEmailMessage,
  missingPartyEmails,
  SALE_ROLE_LABEL,
  type MissingEmail,
  type SaleParty,
} from "../../supabase/functions/_shared/clicksign-venda.ts";
import type { ManagedSigner } from "./exclusive-clicksign";

export { WITNESS_COUNT, MAX_EXTRAS, missingPartyEmails, missingEmailMessage, SALE_ROLE_LABEL };
export type { MissingEmail, SaleParty };

/** Papéis oferecidos na tela para parte extra (decisão de Denis: advogado e cônjuge/anuente). */
export const EXTRA_ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "lawyer", label: "Advogado(a)" },
  { value: "consenting", label: "Anuente (ex.: cônjuge)" },
  { value: "intervening", label: "Interveniente" },
  { value: "party", label: "Parte" },
  { value: "attorney", label: "Procurador(a)" },
  { value: "real_estate_broker", label: "Corretor(a) de imóveis" },
  { value: "intermediary", label: "Intermediário(a)" },
];

export type SaleEnvelopeInfo = {
  status: "sending" | "running" | "closed" | "canceled" | "error";
  is_test: boolean;
  created_at: string;
  error_code: string | null;
  signed: boolean;
  last_event?: string | null;
  last_notified_at?: string | null;
  notify_available_at?: string | null;
  cancel_requested_at?: string | null;
  cancel_reason?: string | null;
  contrato_atual?: boolean;
};

export type ClicksignSaleConfig =
  | { enabled: false }
  | {
      enabled: true;
      test_mode: boolean;
      can_send: boolean;
      witnesses: number;
      deadline_days: number;
      libera_assinatura: boolean;
      contrato: { id: string; file_name: string; created_at?: string } | null;
      imobiliaria: Array<{ id: string; nome: string }>;
      corretores: Array<{ nome: string; email_ok: boolean }>;
      envelope: SaleEnvelopeInfo | null;
    };

export const SALE_CLICKSIGN_DISABLED: ClicksignSaleConfig = Object.freeze({ enabled: false });

/** Qualquer falha = desligado (fail-closed): a tela segue o fluxo manual de hoje. */
export async function clicksignSaleConfig(
  db: SupabaseClient,
  saleId: string,
): Promise<ClicksignSaleConfig> {
  try {
    const { data, error } = await db.rpc(
      "clicksign_sale_config" as never,
      { _id: saleId } as never,
    );
    if (error || !data || typeof data !== "object") return SALE_CLICKSIGN_DISABLED;
    const c = data as Record<string, unknown>;
    if (c.enabled !== true) return SALE_CLICKSIGN_DISABLED;
    return {
      enabled: true,
      test_mode: c.test_mode !== false,
      can_send: c.can_send === true,
      witnesses: typeof c.witnesses === "number" ? c.witnesses : WITNESS_COUNT,
      deadline_days: typeof c.deadline_days === "number" ? c.deadline_days : 30,
      libera_assinatura: c.libera_assinatura !== false,
      contrato: (c.contrato as { id: string; file_name: string } | null) ?? null,
      imobiliaria: Array.isArray(c.imobiliaria)
        ? (c.imobiliaria as Array<{ id: string; nome: string }>)
        : [],
      corretores: Array.isArray(c.corretores)
        ? (c.corretores as Array<{ nome: string; email_ok: boolean }>)
        : [],
      envelope: (c.envelope as SaleEnvelopeInfo | null) ?? null,
    };
  } catch {
    return SALE_CLICKSIGN_DISABLED;
  }
}

/** Mostra "Enviar pela Clicksign" no lugar de "Enviar para assinatura". */
export function showClicksignSend(
  config: ClicksignSaleConfig,
  status: string | null | undefined,
): boolean {
  return config.enabled && config.can_send && status === "contrato_ok_corretor";
}

export function canStartSaleEnvelope(e: SaleEnvelopeInfo | null): boolean {
  return !e || !["sending", "running"].includes(e.status);
}

/** Envelope rodando com pedido de cancelamento (nova versão do contrato / status mudou). */
export function needsAutoCancel(config: ClicksignSaleConfig): boolean {
  return (
    config.enabled &&
    config.can_send &&
    config.envelope?.status === "running" &&
    !!config.envelope.cancel_requested_at
  );
}

export function canCancelSaleEnvelope(config: ClicksignSaleConfig): boolean {
  return config.enabled && config.can_send && config.envelope?.status === "running";
}

export type Candidate = { ref: string; tipo: string; nome: string; email: string };

export async function clicksignSaleCandidates(
  db: SupabaseClient,
  saleId: string,
  q: string,
): Promise<Candidate[]> {
  const { data, error } = await db.rpc(
    "clicksign_sale_extra_candidates" as never,
    { _id: saleId, _q: q } as never,
  );
  if (error) throw new Error("Não foi possível buscar no cadastro agora.");
  return Array.isArray(data) ? (data as Candidate[]) : [];
}

export type ExtraDraft =
  | { origem: "sistema"; ref: string; nome: string; email: string; role: string }
  | { origem: "externo"; nome: string; email: string; cpf: string; role: string };

export type Testemunha = { nome: string; email: string };

export type SaleSendInput = {
  parties: SaleParty[];
  corretores: Array<{ nome: string; email_ok: boolean }>;
  liberaAssinatura: boolean;
  imobiliariaIds: string[];
  testemunhas: Testemunha[];
  extras: ExtraDraft[];
};

export type SaleSendCheck = { missing: MissingEmail[]; errors: string[] };

/**
 * Mesmas regras do servidor (buildSaleSigners) para travar o botão com mensagem clara. As partes
 * sem e-mail ficam em `missing` (atalho para a aba Partes); nada é preenchido sozinho.
 */
export function saleSendCheck(input: SaleSendInput): SaleSendCheck {
  const errors: string[] = [];
  const emails: Array<[string, string]> = [];
  if (!input.liberaAssinatura) errors.push("O jurídico bloqueou este contrato para assinatura");
  const missing = missingPartyEmails(input.parties);
  input.corretores.forEach((c) => {
    if (!c.email_ok) errors.push(`Corretor${c.nome ? ` ${c.nome}` : ""}: cadastro sem e-mail`);
  });
  if (input.imobiliariaIds.length < 1)
    errors.push("Escolha ao menos 1 pessoa para assinar pela imobiliária");
  if (input.testemunhas.length !== WITNESS_COUNT)
    errors.push(`Informe exatamente ${WITNESS_COUNT} testemunhas`);
  input.testemunhas.slice(0, WITNESS_COUNT).forEach((t, i) => {
    const label = `Testemunha ${i + 1}`;
    if (!validSignerName(t.nome)) errors.push(`${label}: informe nome e sobrenome`);
    if (!validEmail(t.email)) errors.push(`${label}: e-mail ausente ou inválido`);
    else emails.push([normEmail(t.email), label]);
  });
  if (input.extras.length > MAX_EXTRAS) errors.push(`No máximo ${MAX_EXTRAS} partes extras`);
  input.extras.forEach((x, i) => {
    const label = `Parte extra ${i + 1}${x.nome ? ` (${x.nome})` : ""}`;
    if (!SALE_ROLE_LABEL[x.role]) errors.push(`${label}: escolha o papel`);
    if (x.origem === "externo") {
      if (!validSignerName(x.nome)) errors.push(`${label}: informe nome e sobrenome`);
      if (!validEmail(x.email)) errors.push(`${label}: e-mail ausente ou inválido`);
      else emails.push([normEmail(x.email), label]);
      if (formatCpf(x.cpf) === "invalid") errors.push(`${label}: CPF inválido`);
    }
  });
  // Partes da venda com e-mail também entram na conferência de repetidos.
  input.parties.forEach((p) => {
    if (validEmail(p.email) && /^(vendedor|comprador)_\d+$/.test(p.papel)) {
      const m = /^(vendedor|comprador)_(\d+)$/.exec(p.papel)!;
      emails.push([
        normEmail(p.email),
        `${m[1] === "vendedor" ? "Vendedor" : "Comprador"} ${m[2]}`,
      ]);
    }
  });
  const seen = new Map<string, string>();
  for (const [email, label] of emails) {
    const prev = seen.get(email);
    if (prev) errors.push(`A mesma pessoa não pode assinar duas vezes (${prev} e ${label})`);
    else seen.set(email, label);
  }
  return { missing, errors };
}

class SaleClicksignError extends Error {
  missing: MissingEmail[];
  constructor(message: string, missing: MissingEmail[] = []) {
    super(message);
    this.missing = missing;
  }
}
export { SaleClicksignError };

async function invokeSale(
  db: SupabaseClient,
  body: Record<string, unknown>,
  fallback: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await db.functions.invoke("clicksign-sale", { body });
  if (error) {
    let message = fallback;
    let missing: MissingEmail[] = [];
    const ctx = (error as { context?: unknown }).context;
    if (ctx && typeof (ctx as Response).json === "function") {
      try {
        const b = (await (ctx as Response).json()) as {
          error?: string;
          details?: string[];
          missing_email?: MissingEmail[];
        };
        if (b?.error) message = b.details?.length ? `${b.error}: ${b.details.join("; ")}` : b.error;
        if (Array.isArray(b?.missing_email)) missing = b.missing_email;
      } catch {
        /* corpo não-JSON */
      }
    }
    throw new SaleClicksignError(message, missing);
  }
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.ok !== true) throw new SaleClicksignError(fallback);
  return d;
}

export async function sendSaleToClicksign(
  db: SupabaseClient,
  input: {
    saleId: string;
    imobiliariaIds: string[];
    testemunhas: Testemunha[];
    extras: ExtraDraft[];
  },
): Promise<{ is_test: boolean; signers: number; warning?: string }> {
  const d = await invokeSale(
    db,
    {
      sale_id: input.saleId,
      action: "send",
      imobiliaria_ids: input.imobiliariaIds,
      testemunhas: input.testemunhas.map((t) => ({ nome: t.nome.trim(), email: t.email.trim() })),
      extras: input.extras.map((x) =>
        x.origem === "sistema"
          ? { origem: "sistema", ref: x.ref, role: x.role }
          : {
              origem: "externo",
              nome: x.nome.trim(),
              email: x.email.trim(),
              cpf: x.cpf.trim() || undefined,
              role: x.role,
            },
      ),
    },
    "Falha ao enviar para a Clicksign. Atualize a página e confira o status antes de tentar de novo.",
  );
  return {
    is_test: d.is_test === true,
    signers: Number(d.signers) || 0,
    ...(typeof d.warning === "string" && d.warning ? { warning: d.warning } : {}),
  };
}

export async function cancelSaleClicksign(
  db: SupabaseClient,
  saleId: string,
): Promise<{ reason: string; warning?: string }> {
  const d = await invokeSale(
    db,
    { sale_id: saleId, action: "cancel" },
    "Não foi possível cancelar a assinatura. Atualize a página e confira o status.",
  );
  return {
    reason: typeof d.reason === "string" ? d.reason : "manual",
    ...(typeof d.warning === "string" ? { warning: d.warning } : {}),
  };
}

export async function saleSignersStatus(
  db: SupabaseClient,
  saleId: string,
): Promise<ManagedSigner[]> {
  const d = await invokeSale(
    db,
    { sale_id: saleId, action: "status" },
    "Não foi possível consultar a Clicksign agora.",
  );
  return Array.isArray(d.signers) ? (d.signers as ManagedSigner[]) : [];
}

export async function resendSaleNotice(
  db: SupabaseClient,
  saleId: string,
): Promise<{ warning?: string }> {
  const d = await invokeSale(
    db,
    { sale_id: saleId, action: "notify" },
    "Não foi possível reenviar o aviso. Atualize a página e tente de novo.",
  );
  return typeof d.warning === "string" ? { warning: d.warning } : {};
}

export async function editSaleSigner(
  db: SupabaseClient,
  input: { saleId: string; idx: number; nome: string; email: string },
): Promise<{ warning?: string }> {
  const d = await invokeSale(
    db,
    {
      sale_id: input.saleId,
      action: "edit_signer",
      idx: input.idx,
      nome: input.nome.trim(),
      email: input.email.trim(),
    },
    "Não foi possível alterar o signatário. Atualize a página e confira antes de tentar de novo.",
  );
  return typeof d.warning === "string" ? { warning: d.warning } : {};
}

export type SaleSignedInfo = {
  document_id: string;
  is_test: boolean;
  closed_at: string;
  auto_marked: boolean;
  signers: Array<{ papel: string; label: string | null; nome: string }>;
};

/** null = o contrato assinado atual não veio da Clicksign (upload manual). */
export async function clicksignSaleSigned(
  db: SupabaseClient,
  saleId: string,
): Promise<SaleSignedInfo | null> {
  try {
    const { data, error } = await db.rpc(
      "clicksign_sale_signed" as never,
      { _id: saleId } as never,
    );
    if (error || !data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    return {
      document_id: String(d.document_id ?? ""),
      is_test: d.is_test === true,
      closed_at: typeof d.closed_at === "string" ? d.closed_at : "",
      auto_marked: d.auto_marked === true,
      signers: Array.isArray(d.signers) ? (d.signers as SaleSignedInfo["signers"]) : [],
    };
  } catch {
    return null;
  }
}

export function saleEnvelopeStatusLabel(e: SaleEnvelopeInfo): string {
  const teste = e.is_test ? " (TESTE)" : "";
  switch (e.status) {
    case "sending":
      if (e.error_code === "activate_unknown") {
        return `Envio sem confirmação da Clicksign${teste}: os signatários podem ter recebido o e-mail. Não reenvie; avise o suporte.`;
      }
      return `Enviando para a Clicksign${teste}…`;
    case "running":
      if (e.cancel_requested_at) {
        return e.cancel_reason === "nova_versao"
          ? `Saiu uma nova versão do contrato${teste}: a assinatura em andamento será cancelada. Depois, envie de novo.`
          : `A assinatura em andamento${teste} será cancelada porque a venda mudou de etapa.`;
      }
      if (e.error_code?.startsWith("post_activate:")) {
        return `Enviado à Clicksign${teste}, mas o registro no ADM MAX ficou incompleto. Não reenvie; avise o suporte.`;
      }
      if (e.error_code?.startsWith("notify_failed:")) {
        return `Enviado${teste}, mas a notificação falhou; use “Reenviar aviso”.`;
      }
      return `Em assinatura na Clicksign${teste}. Quando todos assinarem, o contrato assinado é anexado e a venda é marcada como assinada sozinha.`;
    case "closed":
      return e.signed
        ? `Assinado na Clicksign${teste}. Contrato assinado anexado em “Documento assinado”.`
        : `Envelope encerrado na Clicksign${teste}.`;
    case "canceled":
      return `Assinatura cancelada, recusada ou vencida na Clicksign${teste}. É possível enviar de novo.`;
    case "error":
      return `O último envio falhou${teste}; nada foi enviado aos signatários. É possível tentar de novo.`;
    default:
      return "";
  }
}
