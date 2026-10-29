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
  captureOwnerList,
  papelLabel,
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

// ---------- testemunhas automáticas da captação (t_e8078685) ----------
// Testemunha 1 = corretor da captação; testemunha 2 = gestor da equipe dele (ou outro gestor/TL da
// mesma imobiliária escolhido pelo staff). Tudo decidido no banco (exclusive_testemunhas*); a edge
// clicksign-send monta os signatários pelo banco e ignora o que vier da tela.

export type TestemunhaPessoa = {
  id: string;
  nome: string;
  /** Só para quem gera o PDF ou envia (pode_gerir). Vazio = sem CPF válido. */
  cpf?: string;
  ok: boolean;
  falta: string[];
  origem?: "equipe" | "escolhido";
};

export type TestemunhasCaptacao = {
  /** A imobiliária usa a Clicksign na captação: testemunhas automáticas valem. */
  aplica: boolean;
  corretor: TestemunhaPessoa;
  gestor: TestemunhaPessoa | null;
  /** Líder da equipe do corretor (padrão), mesmo quando outro foi escolhido. */
  gestorEquipe: { id: string; nome: string } | null;
  /** Por que não há gestor padrão. */
  motivo: "sem_equipe" | "corretor_e_lider" | null;
  escolhido: boolean;
  /** Mensagens prontas do banco (sem e-mail nem CPF). Vazio = testemunhas completas. */
  problemas: string[];
  ok: boolean;
  pdfGerado: boolean;
  /** O PDF gerado tem impressas as testemunhas atuais. */
  pdfOk: boolean;
  podeGerir: boolean;
  /** Impressão digital de nome+CPF das testemunhas (só para quem gere; vai de volta ao fixar). */
  dados?: string;
};

function pessoa(v: unknown): TestemunhaPessoa | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === "string" ? x : "");
  return {
    id: s(o.id),
    nome: s(o.nome),
    ...(typeof o.cpf === "string" ? { cpf: o.cpf } : {}),
    ok: o.ok === true,
    falta: Array.isArray(o.falta) ? o.falta.filter((x): x is string => typeof x === "string") : [],
    ...(o.origem === "equipe" || o.origem === "escolhido" ? { origem: o.origem } : {}),
  };
}

/** Converte a resposta de exclusive_testemunhas. Formato inesperado = null (tela trata como falha). */
export function parseTestemunhas(raw: unknown): TestemunhasCaptacao | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const corretor = pessoa(r.corretor);
  if (!corretor) return null;
  const ge = r.gestor_equipe as Record<string, unknown> | null | undefined;
  return {
    aplica: r.aplica === true,
    corretor,
    gestor: pessoa(r.gestor),
    gestorEquipe:
      ge && typeof ge.id === "string"
        ? { id: ge.id, nome: typeof ge.nome === "string" ? ge.nome : "" }
        : null,
    motivo: r.motivo === "sem_equipe" || r.motivo === "corretor_e_lider" ? r.motivo : null,
    escolhido: r.escolhido === true,
    problemas: Array.isArray(r.problemas)
      ? r.problemas.filter((x): x is string => typeof x === "string")
      : [],
    ok: r.ok === true,
    pdfGerado: r.pdf_gerado === true,
    pdfOk: r.pdf_ok === true,
    podeGerir: r.pode_gerir === true,
    ...(typeof r.dados === "string" ? { dados: r.dados } : {}),
  };
}

/** Lê as testemunhas da captação. Falha = null (a tela não deixa enviar nem gera com elas). */
export async function testemunhasCaptacao(
  db: SupabaseClient,
  captureId: string,
): Promise<TestemunhasCaptacao | null> {
  try {
    const { data, error } = await db.rpc("exclusive_testemunhas", { _id: captureId });
    if (error) return null;
    return parseTestemunhas(data);
  } catch {
    return null;
  }
}

export type CandidatoTestemunha = {
  id: string;
  nome: string;
  ok: boolean;
  falta: string | null;
  daEquipe: boolean;
};

/** Gestores/team leaders ativos da MESMA imobiliária (o banco filtra). Sem e-mail nem CPF. */
export async function candidatosTestemunha(
  db: SupabaseClient,
  captureId: string,
): Promise<CandidatoTestemunha[]> {
  const { data, error } = await db.rpc("exclusive_testemunhas_candidatos", { _id: captureId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((c) => ({
    id: String(c.id ?? ""),
    nome: typeof c.nome === "string" ? c.nome : "",
    ok: c.ok === true,
    falta: typeof c.falta === "string" ? c.falta : null,
    daEquipe: c.da_equipe === true,
  }));
}

/** Escolhe a testemunha 2 (null = volta para o gestor da equipe). O banco confere tudo de novo. */
export async function escolherTestemunhaGestor(
  db: SupabaseClient,
  captureId: string,
  userId: string | null,
): Promise<TestemunhasCaptacao | null> {
  const { data, error } = await db.rpc("exclusive_testemunha_gestor_escolher", {
    _id: captureId,
    _user: userId,
  });
  if (error) throw new Error(error.message);
  return parseTestemunhas(data);
}

/**
 * Registra quem foi impresso no PDF gerado (o envio pela Clicksign confere). `path` = caminho do
 * arquivo que ESTA tela acabou de subir: se outro PDF foi gerado no meio, o banco recusa.
 */
export async function fixarTestemunhasPdf(
  db: SupabaseClient,
  captureId: string,
  t: TestemunhasCaptacao,
  path: string,
): Promise<void> {
  const { error } = await db.rpc("exclusive_testemunhas_fixar", {
    _id: captureId,
    _corretor: t.corretor.id,
    _gestor: t.gestor?.id ?? null,
    _path: path,
    _dados: t.dados ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Testemunhas que vão impressas no contrato. Com as automáticas completas: nome e CPF do cadastro;
 * RG fica em branco (o cadastro não tem RG). Sem automáticas (imobiliária sem Clicksign ou cadastro
 * incompleto): as digitadas na captação, como antes.
 */
export function testemunhasParaPdf<
  F extends { testemunha_1: Record<string, unknown>; testemunha_2: Record<string, unknown> },
>(form: F, t: TestemunhasCaptacao | null): F {
  if (!usarTestemunhasAuto(t)) return form;
  const w = (p: TestemunhaPessoa) => ({ nome: p.nome, rg: "", cpf: p.cpf ?? "" });
  return { ...form, testemunha_1: w(t!.corretor), testemunha_2: w(t!.gestor!) } as F;
}

/** As automáticas valem e estão completas (com CPF visível para quem gera). */
export function usarTestemunhasAuto(t: TestemunhasCaptacao | null): boolean {
  return (
    !!t &&
    t.aplica &&
    t.ok &&
    !!t.gestor &&
    !!t.corretor.cpf &&
    !!t.gestor.cpf &&
    t.corretor.id !== t.gestor.id
  );
}

/** Texto curto de cada testemunha para a tela (sem e-mail nem CPF). */
export function rotuloTestemunha(p: TestemunhaPessoa | null, papel: string): string {
  if (!p) return `${papel}: não definida`;
  const nome = p.nome || "sem nome no cadastro";
  return p.ok ? `${papel}: ${nome}` : `${papel}: ${nome} (falta ${p.falta.join(", ")})`;
}

/** Mensagem da tela quando não há gestor padrão. */
export function avisoSemGestor(t: TestemunhasCaptacao): string | null {
  if (t.gestor) return null;
  return t.motivo === "corretor_e_lider"
    ? "O corretor é o próprio líder da equipe, então não pode ser as duas testemunhas. Escolha outro gestor ou team leader desta imobiliária."
    : "O corretor não está em nenhuma equipe. Escolha um gestor ou team leader desta imobiliária para ser a testemunha 2.";
}

export type SendDialogInput = {
  form: Record<string, unknown> | null | undefined;
  imobiliariaIds: string[];
  /** Testemunhas automáticas (null = não deu para conferir: bloqueia). */
  testemunhas: TestemunhasCaptacao | null;
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
  // Todos os proprietários assinam (t_58effd65): mesma lista do servidor (captureOwnerList).
  captureOwnerList(input.form).forEach((o, i) => {
    const label = `Proprietário ${i + 1}`;
    if (i > 1 && !ownerFilled(o)) {
      errors.push(`${label}: preencha os dados ou remova o proprietário`);
      return;
    }
    if (!validSignerName(o.nome_completo)) errors.push(`${label}: informe nome e sobrenome`);
    if (!validEmail(o.email)) errors.push(`${label}: e-mail ausente ou inválido no cadastro`);
    else emails.push([normEmail(o.email), label]);
  });
  if (input.imobiliariaIds.length < 1)
    errors.push("Escolha ao menos 1 pessoa para assinar pela imobiliária");
  // Testemunhas: corretor + gestor do cadastro (o e-mail delas não chega à tela; o servidor confere
  // repetição com proprietários/imobiliária).
  const t = input.testemunhas;
  if (!t) errors.push("Não foi possível conferir as testemunhas. Atualize a página.");
  else if (t.problemas.length) errors.push(...t.problemas);
  else if (!t.gestor) errors.push(avisoSemGestor(t) ?? "Testemunha 2: escolha um gestor");
  else if (input.imobiliariaIds.some((id) => id === t.gestor!.id || id === t.corretor.id))
    errors.push(
      "Quem já é testemunha (corretor ou gestor) não pode assinar também pela imobiliária. Desmarque essa pessoa ou troque a testemunha 2.",
    );
  else if (!t.pdfOk)
    errors.push(
      "As testemunhas impressas no PDF não são as atuais. Gere o PDF para assinatura de novo.",
    );
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
  input: { captureId: string; imobiliariaIds: string[] },
): Promise<SendResult> {
  // Testemunhas não vão no corpo: o servidor usa as do cadastro (t_e8078685).
  const { data, error } = await db.functions.invoke("clicksign-send", {
    body: { capture_id: input.captureId, imobiliaria_ids: input.imobiliariaIds },
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

// ---------- escolha Clicksign × papel na captação (t_e6f778ac) ----------

/**
 * Em em_assinatura: "clicksign" com envelope em envio/assinatura; senão é a assinatura manual
 * (papel). Fora dessa etapa: null. Mesma leitura do banco (clicksign_capture_authorize).
 */
export function modoAssinaturaCaptacao(
  status: string,
  envelope: ClicksignEnvelopeInfo | null,
): "clicksign" | "manual" | null {
  if (status !== "em_assinatura") return null;
  return canStartEnvelope(envelope) ? "manual" : "clicksign";
}

/** Cartão "Como vai ser assinado?": enviada, sem envelope ativo, e quem pode levar ao papel. */
export function mostrarEscolhaCaptacao(
  status: string,
  envelope: ClicksignEnvelopeInfo | null,
  podeManual: boolean,
): boolean {
  return status === "enviada" && podeManual && canStartEnvelope(envelope);
}

/**
 * Papel → Clicksign: em assinatura manual e sem o assinado no papel já anexado (aí é conferir e
 * aprovar). O banco confere de novo em clicksign_capture_authorize (sem envio em dobro).
 */
export function podeTrocarCaptacaoParaClicksign(
  config: ClicksignCaptureConfig,
  status: string,
  temAssinado: boolean,
): boolean {
  return (
    config.enabled &&
    config.can_send &&
    modoAssinaturaCaptacao(status, config.envelope) === "manual" &&
    !temAssinado
  );
}

/** Clicksign → papel: envelope em assinatura (running) e quem gerencia o envelope. */
export function podeTrocarCaptacaoParaPapel(
  config: ClicksignCaptureConfig,
  status: string,
): boolean {
  return status === "em_assinatura" && canManageEnvelope(config);
}

/** "Cancelar Clicksign e assinar no papel" da captação (edge clicksign-manage, cancel_papel). */
export async function cancelCaptureClicksignPapel(
  db: SupabaseClient,
  captureId: string,
): Promise<{ warning?: string }> {
  const d = await invokeManage(
    db,
    { capture_id: captureId, action: "cancel_papel" },
    "Não foi possível cancelar na Clicksign agora. Nada mudou; tente de novo.",
  );
  return typeof d.warning === "string" ? { warning: d.warning } : {};
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
 * Pode acompanhar a lista de signatários (só leitura, t_82e51349): quem recebe a config ligada já
 * vê a captação (o banco só liga para quem gerencia ou tem exclusive_can_view) e o envelope está
 * rodando. Editar/Reenviar continuam em canManageEnvelope.
 */
export function canFollowEnvelope(config: ClicksignCaptureConfig): boolean {
  return config.enabled && config.envelope?.status === "running";
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
    const base = papelLabel(s.papel) ?? PAPEL_LABEL[s.papel] ?? s.papel;
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
