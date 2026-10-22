// E-mail de boas-vindas do MAX HUB (t_30cf354f) — regras do robô, sem dependências do Deno
// (testável no vitest). O SMTP (nodemailer + Zoho) e o banco entram por injeção em index.ts.
// O TEXTO do e-mail vem SÓ de ../_shared/email-boas-vindas (conteudo.ts + render.ts).
import { renderEmailBoasVindas } from "../_shared/email-boas-vindas/render.ts";

export const REMETENTE = "no-reply@somosmaxhub.com.br";
export const NOME_REMETENTE = "UniHub";
export const DOMINIO_MESSAGE_ID = "somosmaxhub.com.br";

export type Modo = "off" | "dry_run" | "live";
export type Config = { modo: Modo; allowlist: string[] };
export type ItemFila = { id: number; user_id: string | null; tipo: string };
export type Dados = {
  email: string | null;
  nome: string | null;
  imobiliaria: string | null;
  apto: boolean;
};
export type Mensagem = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
  headers: Record<string, string>;
};

export interface Banco {
  config(): Promise<Config>;
  pegar(limite: number): Promise<ItemFila[]>;
  dados(userId: string): Promise<Dados | null>;
  concluir(
    id: number,
    resultado: "enviado" | "simulado" | "cancelado" | "erro",
    erro?: string,
    messageId?: string,
  ): Promise<string>;
  testeReservar(userId: string): Promise<number | null>;
  testeFicticioReservar(destino: string): Promise<number>;
}
export type Smtp = (m: Mensagem) => Promise<string>;

export function normalizarEmail(e: string | null | undefined): string {
  return String(e ?? "")
    .trim()
    .toLowerCase();
}

export function emailValido(e: string): boolean {
  return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(e);
}

export function naAllowlist(email: string, allowlist: string[]): boolean {
  const e = normalizarEmail(email);
  return !!e && allowlist.map(normalizarEmail).includes(e);
}

/** Tira do erro qualquer credencial, e-mail ou detalhe pessoal antes de gravar/logar. */
export function mascararErro(e: unknown, segredos: Array<string | undefined> = []): string {
  let m = String((e as { message?: string })?.message ?? e ?? "erro");
  for (const s of segredos) if (s && s.length >= 4) m = m.split(s).join("***");
  m = m.replace(/[^\s@<>"']+@[^\s@<>"']+/g, "<email>");
  m = m.replace(/(pass(word)?|senha|auth)[^\s]*\s*[:=]\s*\S+/gi, "$1=***");
  const code = (e as { responseCode?: number; code?: string }) ?? {};
  const prefixo = code.responseCode
    ? `smtp_${code.responseCode}: `
    : code.code
      ? `${code.code}: `
      : "";
  return (prefixo + m).replace(/\s+/g, " ").slice(0, 300);
}

/** Message-ID fixo por usuário: se o Gmail receber 2 iguais, agrupa como o mesmo e-mail. */
export function messageIdBoasVindas(userId: string): string {
  return `<boas_vindas.${userId}@${DOMINIO_MESSAGE_ID}>`;
}

export function montarMensagem(
  para: string,
  d: { nome: string | null; imobiliaria: string | null },
  messageId: string,
): Mensagem {
  const r = renderEmailBoasVindas({
    primeiroNome: d.nome ?? "",
    imobiliaria: d.imobiliaria ?? "",
    email: para,
  });
  return {
    from: `"${NOME_REMETENTE}" <${REMETENTE}>`,
    to: para,
    subject: r.subject.replace(/[\r\n]+/g, " "),
    text: r.text,
    html: r.html,
    messageId,
    headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" },
  };
}

type Resultado = { id: number; status: string };

async function enviarItem(
  banco: Banco,
  smtp: Smtp,
  item: { id: number; user_id: string },
  simular: boolean,
  segredos: Array<string | undefined>,
): Promise<Resultado> {
  try {
    const d = await banco.dados(item.user_id);
    const email = normalizarEmail(d?.email);
    if (!d || !d.apto || !emailValido(email))
      return {
        id: item.id,
        status: await banco.concluir(item.id, "cancelado", "inapto_ou_sem_email"),
      };
    const msg = montarMensagem(email, d, messageIdBoasVindas(item.user_id));
    if (simular) return { id: item.id, status: await banco.concluir(item.id, "simulado") };
    let mid: string;
    try {
      mid = await smtp(msg);
    } catch (e) {
      return {
        id: item.id,
        status: await banco.concluir(item.id, "erro", mascararErro(e, segredos)),
      };
    }
    return {
      id: item.id,
      status: await banco.concluir(item.id, "enviado", undefined, mid || msg.messageId),
    };
  } catch (e) {
    // Falha de banco/montagem: tenta registrar; nunca propaga.
    const erro = mascararErro(e, segredos);
    try {
      return { id: item.id, status: await banco.concluir(item.id, "erro", erro) };
    } catch {
      return { id: item.id, status: "erro_registro" };
    }
  }
}

/** Robô (pg_cron): processa a fila. Com a chave 'off' não faz nada. */
export async function processarFila(
  banco: Banco,
  smtp: Smtp,
  segredos: Array<string | undefined> = [],
) {
  const cfg = await banco.config();
  if (cfg.modo === "off")
    return { ok: true, modo: cfg.modo, skipped: "desligado", itens: [] as Resultado[] };
  const itens = await banco.pegar(20);
  const res: Resultado[] = [];
  for (const it of itens) {
    if (!it.user_id) {
      res.push({ id: it.id, status: await banco.concluir(it.id, "cancelado", "sem_usuario") });
      continue;
    }
    res.push(
      await enviarItem(
        banco,
        smtp,
        { id: it.id, user_id: it.user_id },
        cfg.modo === "dry_run",
        segredos,
      ),
    );
  }
  return { ok: true, modo: cfg.modo, itens: res };
}

/**
 * Teste manual com usuário real cujo e-mail está na allowlist. Funciona com a chave 'off'.
 * Idempotente: a 2ª chamada para o mesmo usuário não reenvia (unique user_id+tipo no banco).
 */
export async function testeUsuario(
  banco: Banco,
  smtp: Smtp,
  userId: string,
  segredos: Array<string | undefined> = [],
) {
  const cfg = await banco.config();
  const d = await banco.dados(userId);
  if (!d || !naAllowlist(normalizarEmail(d.email), cfg.allowlist))
    return { ok: false, error: "fora_da_allowlist" };
  const id = await banco.testeReservar(userId);
  if (id == null) return { ok: true, skipped: "ja_enviado" };
  const r = await enviarItem(banco, smtp, { id, user_id: userId }, false, segredos);
  return { ok: r.status === "enviado", ...r };
}

/** Teste manual com dados fictícios, só para destino da allowlist (padrão: o 1º da lista). */
export async function testeFicticio(
  banco: Banco,
  smtp: Smtp,
  destino: string | undefined,
  dados: { nome?: string; imobiliaria?: string },
  segredos: Array<string | undefined> = [],
) {
  const cfg = await banco.config();
  const para = normalizarEmail(destino || cfg.allowlist[0]);
  if (!emailValido(para) || !naAllowlist(para, cfg.allowlist))
    return { ok: false, error: "fora_da_allowlist" };
  const id = await banco.testeFicticioReservar(para);
  const msg = montarMensagem(
    para,
    { nome: dados.nome || "Denis", imobiliaria: dados.imobiliaria || "RE/MAX Única Escolha" },
    `<teste.${id}@${DOMINIO_MESSAGE_ID}>`,
  );
  try {
    const mid = await smtp(msg);
    await banco.concluir(id, "enviado", undefined, mid || msg.messageId);
    return { ok: true, id, status: "enviado" };
  } catch (e) {
    const erro = mascararErro(e, segredos);
    await banco.concluir(id, "erro", erro);
    return { ok: false, id, status: "falhou", error: erro };
  }
}

/** Comparação em tempo constante do segredo interno do cron (>= 32 caracteres). */
export function segredoInternoOk(recebido: string | null, esperado: string | undefined): boolean {
  if (!esperado || esperado.length < 32 || !recebido || recebido.length !== esperado.length)
    return false;
  let r = 0;
  for (let i = 0; i < esperado.length; i++) r |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return r === 0;
}

/** Chamada manual: só com a chave do servidor (service_role / secret key) no Authorization ou apikey. */
export function chaveServidorOk(
  headers: { get(n: string): string | null },
  chaves: Array<string | undefined>,
): boolean {
  const validas = chaves.filter((c): c is string => !!c && c.length >= 20);
  if (!validas.length) return false;
  const bearer = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const apikey = headers.get("apikey") ?? "";
  return validas.some((c) => c === bearer || c === apikey);
}
