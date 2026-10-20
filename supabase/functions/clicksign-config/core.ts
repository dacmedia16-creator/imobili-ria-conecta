// Tela "Assinatura digital" (t_7508c6b6): configuração da Clicksign da PRÓPRIA imobiliária pelo
// super admin, sem Deno (testável com mock). A org vem SEMPRE do banco (authorize com o JWT de quem
// pede, só super_admin); o corpo da requisição nunca escolhe a organização. Chave de API e segredo
// do webhook vão para o Vault e nunca voltam na resposta (nem mascarados). Logs/auditoria: só
// códigos, nunca chave, segredo ou e-mail.
import { ClicksignClient, ClicksignError, type FetchLike } from "../_shared/clicksign.ts";

export const SECRET_MIN = 16;
export const SECRET_MAX = 512;
export const MAX_SIGNERS = 10;
export const MAX_ALLOWLIST = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type ConfigAction = "view" | "save_secret" | "save" | "test" | "set_enabled";

export type ConfigDeps = {
  actorId: string;
  fetch: FetchLike;
  clicksignBase?: string;
  /** clicksign_config_authorize() com o JWT do usuário; lança Error se não for super_admin. */
  authorize(): Promise<string>;
  view(org: string): Promise<Record<string, unknown>>;
  storeSecret(org: string, kind: "access_token" | "webhook", value: string): Promise<void>;
  save(
    org: string,
    p: { testMode?: boolean; signerIds?: string[]; allowlist?: string[]; deadlineDays?: number },
  ): Promise<void>;
  /** Chave salva no Vault (só para o teste de conexão; nunca devolvida). */
  token(org: string): Promise<string | null>;
  recordTest(org: string, ok: boolean, code: string | null): Promise<void>;
  setEnabled(org: string, on: boolean): Promise<void>;
  /** Endereço público do webhook desta org (.../functions/v1/clicksign-webhook/<slug>). */
  webhookUrl(slug: string): string;
};

export type ConfigResult = { status: number; body: Record<string, unknown> };
const r = (status: number, body: Record<string, unknown>): ConfigResult => ({ status, body });

/** Mensagem do banco que pode ir para a tela (validações e "Para ligar falta: ..."). */
function dbMessage(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : "";
  if (
    /^(Para ligar falta|O prazo|Escolha no máximo|A lista de e-mails|Com a assinatura|Signatário da imobiliária|Segredo inválido|Lista de signatários)/.test(
      m,
    )
  )
    return m;
  return fallback;
}

/** Valida a chave/segredo como o banco (16 a 512 caracteres, sem espaço). Devolve o valor limpo. */
export function cleanSecret(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length < SECRET_MIN || s.length > SECRET_MAX || /\s/.test(s)) return null;
  return s;
}

/** Lê e valida a parte "save" do corpo. Devolve erros em português ou os campos limpos. */
export type SaveInput = {
  testMode?: boolean;
  signerIds?: string[];
  allowlist?: string[];
  deadlineDays?: number;
};
type ParsedSave = { ok: true; value: SaveInput } | { ok: false; errors: string[] };

export function parseSave(body: Record<string, unknown>): ParsedSave {
  const errors: string[] = [];
  const value: SaveInput = {};
  if (body.test_mode !== undefined) {
    if (typeof body.test_mode !== "boolean") errors.push("Modo teste inválido");
    else value.testMode = body.test_mode;
  }
  if (body.signer_ids !== undefined) {
    const ids = body.signer_ids;
    if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string" || !UUID_RE.test(i)))
      errors.push("Lista de quem assina pela imobiliária inválida");
    else if (new Set(ids).size > MAX_SIGNERS)
      errors.push(`Escolha no máximo ${MAX_SIGNERS} pessoas para assinar pela imobiliária`);
    else value.signerIds = [...new Set(ids as string[])];
  }
  if (body.allowlist !== undefined) {
    const list = body.allowlist;
    if (!Array.isArray(list) || list.some((e) => typeof e !== "string"))
      errors.push("Lista de e-mails de teste inválida");
    else {
      const clean = [
        ...new Set((list as string[]).map((e) => e.trim().toLowerCase()).filter(Boolean)),
      ];
      const bad = clean.filter((e) => !EMAIL_RE.test(e));
      if (bad.length) errors.push(`E-mail de teste inválido (${bad.length})`);
      else if (clean.length > MAX_ALLOWLIST)
        errors.push(`A lista de e-mails de teste aceita no máximo ${MAX_ALLOWLIST} e-mails`);
      else value.allowlist = clean;
    }
  }
  if (body.deadline_days !== undefined) {
    const d = body.deadline_days;
    if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > 90)
      errors.push("O prazo precisa ficar entre 1 e 90 dias");
    else value.deadlineDays = d;
  }
  if (!errors.length && !Object.keys(value).length) errors.push("Nada para salvar");
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

/** Código curto (vai para a auditoria) e mensagem simples do teste de conexão. */
export function connectionFailure(e: unknown): { code: string; message: string } {
  if (e instanceof ClicksignError) {
    if (e.status === 401 || e.status === 403)
      return {
        code: "chave_recusada",
        message:
          "A Clicksign recusou a chave. Confira se copiou a chave de API inteira, da conta de produção (não do sandbox), e se ela não foi apagada.",
      };
    if (e.status === 429)
      return {
        code: "limite",
        message: "A Clicksign pediu para esperar um pouco. Tente de novo em 1 minuto.",
      };
    if (e.status >= 500)
      return {
        code: "clicksign_indisponivel",
        message: "A Clicksign está fora do ar agora. Tente de novo mais tarde.",
      };
    return {
      code: `http_${e.status}`,
      message: `A Clicksign respondeu com erro (código ${e.status}).`,
    };
  }
  return {
    code: "sem_resposta",
    message: "Não foi possível falar com a Clicksign. Tente de novo em instantes.",
  };
}

/**
 * Teste de conexão SOMENTE LEITURA: lista 1 envelope da conta (GET /envelopes?page[size]=1).
 * Não cria, não altera e não envia nada.
 */
export async function probeConnection(token: string, fetch: FetchLike, base?: string) {
  const client = new ClicksignClient(token, fetch, base);
  await client.call("test_connection", "GET", "/envelopes?page[size]=1");
}

export async function handleConfig(deps: ConfigDeps, body: unknown): Promise<ConfigResult> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const action = b.action as ConfigAction;
  if (!["view", "save_secret", "save", "test", "set_enabled"].includes(action))
    return r(400, { error: "Ação inválida" });

  let org: string;
  try {
    org = await deps.authorize();
  } catch {
    return r(403, { error: "Apenas o super admin da imobiliária configura a assinatura digital" });
  }
  if (!org || !UUID_RE.test(org)) return r(403, { error: "Imobiliária não identificada" });

  const view = async (extra: Record<string, unknown> = {}) => {
    const v = await deps.view(org);
    const slug = (v.webhook as { slug?: string } | undefined)?.slug ?? "";
    return r(200, {
      ok: true,
      ...extra,
      config: { ...v, webhook_url: slug ? deps.webhookUrl(slug) : null },
    });
  };

  if (action === "view") return view();

  if (action === "save_secret") {
    const kind = b.kind;
    if (kind !== "access_token" && kind !== "webhook") return r(400, { error: "Tipo inválido" });
    const value = cleanSecret(b.value);
    if (!value)
      return r(400, {
        error:
          kind === "access_token"
            ? "Chave de API inválida: cole a chave inteira, sem espaços (16 a 512 caracteres)."
            : "Segredo do webhook inválido: cole o segredo inteiro, sem espaços (16 a 512 caracteres).",
      });
    try {
      await deps.storeSecret(org, kind, value);
    } catch (e) {
      return r(400, { error: dbMessage(e, "Não foi possível salvar. Nada foi alterado.") });
    }
    return view();
  }

  if (action === "save") {
    const p = parseSave(b);
    if (!p.ok) return r(400, { error: p.errors[0], details: p.errors });
    try {
      await deps.save(org, p.value);
    } catch (e) {
      return r(400, { error: dbMessage(e, "Não foi possível salvar. Nada foi alterado.") });
    }
    return view();
  }

  if (action === "test") {
    const token = await deps.token(org);
    if (!token) return r(400, { error: "Salve a chave de API antes de testar a conexão." });
    let test: { ok: boolean; code: string | null; message: string };
    try {
      await probeConnection(token, deps.fetch, deps.clicksignBase);
      test = { ok: true, code: null, message: "Conexão com a Clicksign funcionando." };
    } catch (e) {
      const f = connectionFailure(e);
      test = { ok: false, code: f.code, message: f.message };
    }
    await deps.recordTest(org, test.ok, test.code);
    return view({ test });
  }

  // set_enabled
  if (typeof b.on !== "boolean") return r(400, { error: "Informe ligar ou desligar" });
  try {
    await deps.setEnabled(org, b.on);
  } catch (e) {
    return r(400, { error: dbMessage(e, "Não foi possível alterar. Nada foi alterado.") });
  }
  return view();
}
