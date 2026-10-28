// Retorno ZionTalk -> ADM: a Nicole responde quando o cliente escreve no WhatsApp. Card t_6f688b4b.
//
// Contrato de entrada: a doc oficial da ZionTalk (https://ziontalk.com.br/docs) só descreve o ENVIO. O formato
// do webhook segue o adaptador já em uso na VPS (relay ZionTalk -> MAX) e a skill max-configurar-numero-ziontalk:
// JSON ou formulário, com contato.telefone / mensagem.texto / mensagem.tipo / mensagem.arquivo_url / evento /
// id (com alternativas comuns). A ZionTalk não assina o corpo: a origem é provada pelo token secreto na URL
// (/api/leads/ziontalk/<token>); o banco guarda só o hash. Confirmar o formato real no 1º teste autorizado.
//
// Fluxo: POST -> token (formato) -> corpo limitado -> normaliza -> RPC lead_ia_retorno_receber (o BANCO confere
// token, IA ligada, canal, dedup pelo id, lista de liberados, lead da imobiliária, SAIR, limites) -> responde
// 200 rápido -> em segundo plano: espera curta "humana" -> IA (OpenRouter/Gemini/regras) -> lead_ia_aplicar ->
// envia as mensagens pendentes pela ZionTalk (só com LEADS_IA_ENVIO_REAL=on + chave própria).
// LGPD: nunca registrar em log telefone, texto, token ou corpo. Só códigos de resultado.
import type { SupabaseClient } from "@supabase/supabase-js";
import { escolherCanal, linkAnuncioDoLead, primeiraComLinkProibido } from "./leads-ia-canal";
import {
  argsBusca,
  argsCaracteristica,
  argsParecidos,
  normalizarCaracteristica,
  normalizarParecidos,
  type FiltroCaracteristicaBusca,
  type ResultadoCaracteristica,
  type FiltroBusca,
  proximaResposta,
  respostaMidia,
  type ContextoIa,
  type FiltroParecido,
  type ImovelEncontrado,
  type ResultadoParecidos,
} from "./leads-ia";
import { montarExtrator, type EscolhaModelo, type UsoModelo } from "./leads-ia-modelo";
import { AVISO_SEM_RESPOSTA, falasSemResposta, historicoDb, modoValidadorDb, redacaoLigadaDb, redigirResposta, type FalaHistorico, type ModoValidador } from "./leads-ia-redacao";

export const RETORNO_MAX_BYTES = 50_000;
export const RETORNO_TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;
/** Espera antes de responder (parece gente, não robô instantâneo). Curta para caber no tempo do Worker. */
export const ESPERA_HUMANA_MS = { min: 2_000, max: 6_000 } as const;
/** Mensagens pendentes enviadas por evento (resposta + eventual aviso do sistema). */
const MAX_ENVIOS_POR_EVENTO = 3;

export type MensagemZion = {
  id: string;
  telefone: string;
  texto: string;
  tipo: "texto" | "midia";
  grupo: boolean;
  status: boolean;
  proprio: boolean;
};

type Obj = Record<string, unknown>;
function valor(o: unknown, caminho: string): unknown {
  let v: unknown = o;
  for (const p of caminho.split(".")) {
    if (!v || typeof v !== "object") return undefined;
    v = (v as Obj)[p];
  }
  return v;
}
function primeiro(o: unknown, caminhos: string[]): string {
  for (const c of caminhos) {
    const v = valor(o, c);
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}
const verdade = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";

/** Normaliza o payload da ZionTalk (só aqui dentro existe o formato do provedor). */
export function normalizarZionTalk(p: unknown, corpoBruto: string): MensagemZion | null {
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const jid = primeiro(p, ["key.remoteJid", "data.key.remoteJid", "remoteJid", "chat.id", "data.chat_id", "chat_id"]);
  const telBruto = primeiro(p, [
    "contato.telefone", "contato.celular", "contact.phone", "contact.mobile_phone", "sender.phone",
    "sender.mobile_phone", "data.sender.phone", "data.contact.phone", "data.chat.phone", "mobile_phone", "phone",
    "from", "remoteJid", "key.remoteJid", "data.key.remoteJid",
  ]);
  const telefone = telBruto.replace(/@.*$/, "").replace(/\D/g, "");
  const texto = primeiro(p, [
    "mensagem.texto", "mensagem.conteudo", "mensagem.legenda", "message.text", "message.body", "message.caption",
    "data.message.text", "data.message.body", "data.text", "text", "body", "msg",
  ]);
  const tipoBruto = primeiro(p, ["mensagem.tipo", "message.type", "data.message.type", "message_type", "type"]).toLowerCase();
  const arquivo = primeiro(p, ["mensagem.arquivo_url", "mensagem.url", "message.mediaUrl", "message.media_url", "mediaUrl", "media_url"]);
  const evento = primeiro(p, ["evento", "event", "event_type"]).toLowerCase();
  const ehMidia = !!arquivo || /(audio|ptt|voice|imag|video|document|arquivo|sticker|figurinha|file)/.test(tipoBruto);
  // Só campos que são, sem dúvida, id da MENSAGEM. O "id" solto na raiz fica de fora até confirmar o formato
  // real da ZionTalk: se fosse o id do contato, toda mensagem depois da 1ª viraria "duplicado".
  const id = primeiro(p, ["mensagem.id", "mensagem.message_id", "message.id", "data.message.id", "data.message_id", "key.id", "data.key.id", "message_id", "messageId"]);
  return {
    // Sem id do provedor: id determinístico pelo corpo (reenvio idêntico = mesmo id). Nunca só horário.
    id: id || `h:${corpoBruto.length}:${hashSimples(corpoBruto)}`,
    telefone,
    texto: texto.slice(0, 1000),
    tipo: ehMidia && !texto ? "midia" : "texto",
    grupo:
      /@g\.us$/.test(jid) || /@g\.us$/.test(telBruto) ||
      verdade(valor(p, "grupo")) || verdade(valor(p, "is_group")) || verdade(valor(p, "isGroup")) ||
      verdade(valor(p, "mensagem.grupo")) || verdade(valor(p, "chat.isGroup")),
    status:
      /status@broadcast/.test(jid) || /status@broadcast/.test(telBruto) ||
      /(status|ack|entreg|lid[ao]|read|delivered|sent|enviad)/.test(evento),
    proprio:
      verdade(valor(p, "fromMe")) || verdade(valor(p, "from_me")) || verdade(valor(p, "key.fromMe")) ||
      verdade(valor(p, "data.fromMe")) || verdade(valor(p, "data.key.fromMe")) ||
      /^(saida|enviada|outgoing|out)$/.test(primeiro(p, ["mensagem.direcao", "direcao", "direction"]).toLowerCase()),
  };
}

/** FNV-1a 64 bits em hex: só para gerar um id estável quando a ZionTalk não manda id. */
function hashSimples(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16);
}

export type ResultadoRetorno =
  | "ok" | "duplicado" | "ignorado" | "fora_lista" | "desconhecido" | "token" | "desligada" | "invalido";

/** Código HTTP. 2xx = a ZionTalk não precisa reenviar. Erro nosso = 503 (reenvio é seguro: há dedup). */
export const STATUS_RETORNO: Record<ResultadoRetorno, number> = {
  ok: 200,
  duplicado: 200,
  ignorado: 200,
  fora_lista: 200,
  desconhecido: 200,
  token: 401,
  desligada: 403,
  invalido: 400,
};

export type RespostaBanco = {
  r: ResultadoRetorno;
  responder?: boolean;
  lead_id?: string;
  tipo?: "texto" | "midia";
  organization_id?: string;
  ia_modelo_provedor?: "gemini" | "openrouter";
  ia_modelo?: string | null;
  ctx?: ContextoIa;
};

/** O que o handler precisa do mundo de fora (o teste troca por simulações). */
export type DepsRetorno = {
  receber: (token: string, msg: MensagemZion) => Promise<{ data: unknown; error: { code?: string } | null }>;
  aplicar: (args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
  reservar: (leadId: string) => Promise<{ data: unknown; error: { code?: string } | null }>;
  resultado: (msgId: string, ok: boolean) => Promise<unknown>;
  /** Link do anúncio do imóvel do lead no XML da própria imobiliária (trava da 1ª mensagem). Sem = nenhum link. */
  linkAnuncio?: (leadId: string) => Promise<string | null>;
  registrarUso: (orgId: string, conversaId: string, u: UsoModelo) => Promise<unknown>;
  /** Imóvel pelo código do anúncio que o cliente informou (lead_ia_imovel_por_codigo). Opcional. */
  buscarImovel?: (conversaId: string, codigo: string) => Promise<ImovelEncontrado | null>;
  /** Imóvel parecido do XML da própria imobiliária (lead_ia_imoveis_parecidos, t_232e13cb). Opcional. */
  buscarParecidos?: (conversaId: string, filtro: FiltroParecido) => Promise<ResultadoParecidos | null>;
  /** Busca nova no XML da própria imobiliária (lead_ia_imoveis_busca, t_5b493bc9). Opcional. */
  buscarImoveis?: (conversaId: string, filtro: FiltroBusca) => Promise<ResultadoParecidos | null>;
  /** Busca por característica (suítes, quartos, vagas...) no XML da própria imobiliária (t_a9f1b447). Opcional. */
  buscarCaracteristica?: (conversaId: string, filtro: FiltroCaracteristicaBusca) => Promise<ResultadoCaracteristica | null>;
  /** Chave da imobiliária: o modelo escreve a resposta (lead_config.ia_redige, padrão desligado, t_7b59589c). */
  redacaoLigada?: (orgId: string) => Promise<boolean>;
  /** Modo do validador da imobiliária (lead_config.ia_validador_modo, t_3a4bf078). Sem ele ou com erro = "bloquear". */
  modoValidador?: (orgId: string) => Promise<ModoValidador>;
  /** Modo observar: o modelo falhou 2 vezes. Grava o aviso "Sem resposta da IA" na conversa (não vai ao cliente). */
  avisoSemResposta?: (orgId: string, conversaId: string) => Promise<unknown>;
  /** Últimas falas da conversa (para o modelo; mascaradas antes de sair do servidor). */
  historico?: (conversaId: string) => Promise<FalaHistorico[]>;
  env: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
  esperar?: (ms: number) => Promise<void>;
  rand?: () => number;
  /** Cloudflare: request.waitUntil. Sem ele (testes), o trabalho é aguardado antes de responder. */
  emSegundoPlano?: (p: Promise<unknown>) => void;
};

const json = (status: number, r: string) =>
  new Response(JSON.stringify({ r }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// shortcut: limite por instância do Worker (memória local), só contra excesso de token inválido.
const falhas = new Map<string, { n: number; desde: number }>();
export function _zerarFalhasRetorno() {
  falhas.clear();
}
function bloqueado(ip: string | null, agora = Date.now()) {
  const f = ip ? falhas.get(ip) : undefined;
  return !!f && agora - f.desde < 60_000 && f.n >= 30;
}
function falhou(ip: string | null, agora = Date.now()) {
  if (!ip) return;
  if (falhas.size > 5_000) falhas.clear();
  const f = falhas.get(ip);
  if (!f || agora - f.desde >= 60_000) falhas.set(ip, { n: 1, desde: agora });
  else f.n++;
}

/** Lê o corpo cortando no limite (não confia no content-length nem carrega tudo na memória). */
async function lerCorpo(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? "0") > RETORNO_MAX_BYTES) return null;
  if (!request.body) return "";
  const leitor = request.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > RETORNO_MAX_BYTES) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    partes.push(value);
  }
  const buf = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    buf.set(p, pos);
    pos += p.byteLength;
  }
  return new TextDecoder().decode(buf);
}

const CHAVE_PROIBIDA = new Set(["__proto__", "constructor", "prototype"]);

function parse(texto: string, ct: string): unknown {
  if (ct.includes("application/x-www-form-urlencoded")) {
    // Objetos sem protótipo e chaves perigosas recusadas: o payload nunca altera Object.prototype.
    const o: Obj = Object.create(null) as Obj;
    for (const [k, v] of new URLSearchParams(texto)) {
      // "contato[telefone]" ou "contato.telefone" -> {contato:{telefone}}
      const partes = k.replace(/\]/g, "").split(/[[.]/).slice(0, 4);
      if (partes.some((p) => !p || CHAVE_PROIBIDA.has(p))) continue;
      let alvo = o;
      partes.forEach((p, i) => {
        if (i === partes.length - 1) {
          alvo[p] = v;
          return;
        }
        const prox = Object.prototype.hasOwnProperty.call(alvo, p) ? alvo[p] : undefined;
        if (!prox || typeof prox !== "object") alvo[p] = Object.create(null) as Obj;
        alvo = alvo[p] as Obj;
      });
    }
    return o;
  }
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

export async function receberRetornoZionTalk(request: Request, token: string, deps: DepsRetorno): Promise<Response> {
  if (request.method !== "POST") return json(405, "metodo");
  const ip = request.headers.get("cf-connecting-ip");
  if (bloqueado(ip)) return json(429, "limite");
  if (!RETORNO_TOKEN_RE.test(token)) {
    falhou(ip);
    return json(401, "token");
  }
  const corpo = await lerCorpo(request).catch(() => null);
  if (corpo === null) return json(413, "grande");
  const msg = normalizarZionTalk(parse(corpo, String(request.headers.get("content-type") ?? "")), corpo);
  // Corpo ilegível (ex.: teste do painel): 202 sem gravar, mas o token ainda é conferido no banco abaixo.
  const alvo: MensagemZion = msg ?? { id: "", telefone: "", texto: "", tipo: "texto", grupo: false, status: false, proprio: false };

  let banco: RespostaBanco;
  try {
    const r = await deps.receber(token, alvo);
    if (r.error) {
      console.error("leads ia retorno: falha no banco", r.error.code ?? "sem_codigo");
      return json(503, "erro");
    }
    banco = r.data as RespostaBanco;
  } catch {
    console.error("leads ia retorno: falha inesperada");
    return json(503, "erro");
  }
  const status = banco?.r ? STATUS_RETORNO[banco.r] : undefined;
  if (!status) {
    console.error("leads ia retorno: resposta inesperada do banco");
    return json(503, "erro");
  }
  if (banco.r === "token") falhou(ip);
  if (banco.r === "invalido" && !msg) return json(202, "ignorado");
  if (banco.r === "ok" && banco.lead_id) {
    const trabalho = responderEEnviar(banco, alvo, deps).catch(() => {
      console.error("leads ia retorno: falha ao responder");
    });
    if (deps.emSegundoPlano) deps.emSegundoPlano(trabalho);
    else await trabalho;
  }
  return json(status, banco.r);
}

/** Gera a resposta (se for o caso) e envia as mensagens pendentes do lead. */
export async function responderEEnviar(banco: RespostaBanco, msg: MensagemZion, deps: DepsRetorno) {
  const leadId = banco.lead_id!;
  if (banco.responder && banco.ctx && banco.ctx.estado === "ativa") {
    const espera = deps.esperar ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
    const rand = deps.rand ?? Math.random;
    await espera(Math.round(ESPERA_HUMANA_MS.min + rand() * (ESPERA_HUMANA_MS.max - ESPERA_HUMANA_MS.min)));
    const c = banco.ctx;
    const ctx: ContextoIa = { ...c, dados: c.dados ?? {} };
    const escolha: EscolhaModelo = {
      provedor: banco.ia_modelo_provedor === "openrouter" ? "openrouter" : "gemini",
      modelo: banco.ia_modelo ?? null,
    };
    const usos: UsoModelo[] = [];
    let semResposta = false;
    const buscarParecidos = deps.buscarParecidos ? (f: FiltroParecido) => deps.buscarParecidos!(c.conversa_id, f) : undefined;
    // t_37cf21e3: histórico lido 1 vez; as falas do cliente que chegaram juntas (sem resposta) dizem de qual busca ele fala.
    const historico = banco.tipo !== "midia" && deps.historico ? await deps.historico(c.conversa_id).catch(() => []) : [];
    let r =
      banco.tipo === "midia"
        ? respostaMidia(ctx)
        : await proximaResposta(ctx, msg.texto, montarExtrator(escolha, deps.env, (u) => usos.push(u), deps.fetchFn), {
            buscarImovel: deps.buscarImovel ? (cod) => deps.buscarImovel!(c.conversa_id, cod) : undefined,
            buscarParecidos,
            buscarImoveis: deps.buscarImoveis ? (f) => deps.buscarImoveis!(c.conversa_id, f) : undefined,
            buscarCaracteristica: deps.buscarCaracteristica ? (f) => deps.buscarCaracteristica!(c.conversa_id, f) : undefined,
            falasAntes: falasSemResposta(historico, msg.texto),
          });
    // t_7b59589c: com a chave da imobiliária ligada, o modelo escreve; o roteiro acima é o plano B.
    if (banco.tipo !== "midia" && deps.redacaoLigada && (await deps.redacaoLigada(banco.organization_id!).catch(() => false))) {
      const modo: ModoValidador = deps.modoValidador
        ? await deps.modoValidador(banco.organization_id!).catch(() => "bloquear" as const)
        : "bloquear";
      const red = await redigirResposta(ctx, msg.texto, r, { escolha, env: deps.env, historico, buscarParecidos, registrar: (u) => usos.push(u), fetchFn: deps.fetchFn, modo });
      semResposta = !!red.sem_resposta;
      r = red;
    }
    for (const u of usos) await deps.registrarUso(banco.organization_id!, c.conversa_id, u).catch(() => undefined);
    // _resposta_falha: o banco só diz "encaminhei" se gravou o registro e o aviso (t_fc4d9b27).
    const { error } = await deps.aplicar({
      _conversa: c.conversa_id,
      _versao: c.versao,
      _passo: r.passo,
      _dados: r.dados,
      _resposta: r.resposta,
      _fim: r.fim,
      _resumo: r.resumo,
      _resposta_falha: r.resposta_falha,
    });
    if (error) console.error("leads ia retorno: lead_ia_aplicar falhou", error.code ?? "sem_codigo");
    else if (semResposta && deps.avisoSemResposta)
      await deps.avisoSemResposta(banco.organization_id!, c.conversa_id).catch(() => {
        console.error("leads ia retorno: aviso sem resposta falhou");
      });
  }
  await enviarPendentes(leadId, deps);
}

/** Envia o que estiver pendente para o lead (o banco confere lista de liberados, opt-out, limites). */
export async function enviarPendentes(
  leadId: string,
  deps: Pick<DepsRetorno, "reservar" | "resultado" | "env" | "fetchFn" | "linkAnuncio">,
): Promise<number> {
  const canal = escolherCanal(deps.env, deps.fetchFn);
  if (canal.nome !== "ziontalk") return 0; // envio real desligado: fica "aguardando envio"
  let enviadas = 0;
  for (let i = 0; i < MAX_ENVIOS_POR_EVENTO; i++) {
    const { data, error } = await deps.reservar(leadId);
    if (error) {
      console.error("leads ia retorno: reservar falhou", error.code ?? "sem_codigo");
      break;
    }
    const m = (data as Array<{ msg_id: string; telefone: string; texto: string; primeira: boolean }> | null)?.[0];
    if (!m) break;
    // Só o link do anúncio do próprio imóvel no XML da imobiliária (t_25fe1197).
    const link = m.primeira ? await (deps.linkAnuncio?.(leadId) ?? Promise.resolve(null)).catch(() => null) : null;
    if (m.primeira && primeiraComLinkProibido(m.texto, link)) {
      await deps.resultado(m.msg_id, false);
      break;
    }
    const r = await canal.enviar(m.telefone, m.texto);
    await deps.resultado(m.msg_id, r.status === "enviada");
    if (r.status !== "enviada") {
      console.error("leads ia retorno: envio ZionTalk falhou", r.status === "falhou" ? r.erro : r.status);
      break; // nunca repete sozinho
    }
    enviadas++;
  }
  return enviadas;
}

// --- Reengajamento em 2 toques (t_fc4d9b27) ----------------------------------------------------------
// DESLIGADO por padrão (lead_config.ia_reengajar = false) e SEM agendamento nesta entrega: ligar = outro "sim"
// de Denis (agendar a chamada a cada ~5 min). Cada chamada prepara NO MÁXIMO 1 toque (o banco escolhe,
// respeitando lista de liberados, opt-out, limite diário, horário comercial e intervalo aleatório) e envia
// pelo mesmo caminho das respostas (enviarPendentes, que exige LEADS_IA_ENVIO_REAL=on + chave própria).
export const ENV_REENGAJAR_SEGREDO = "LEADS_IA_REENGAJAR_SEGREDO";

export type DepsReengajar = Pick<DepsRetorno, "reservar" | "resultado" | "env" | "fetchFn" | "linkAnuncio"> & {
  reengajarReservar: () => Promise<{ data: unknown; error: { code?: string } | null }>;
};

/** Prepara e envia no máximo 1 toque. Devolve o que aconteceu (sem telefone nem texto). */
export async function reengajarUmaVez(deps: DepsReengajar): Promise<{ r: "nada" | "erro" | "preparado"; enviadas?: number; toque?: number }> {
  const { data, error } = await deps.reengajarReservar();
  if (error) {
    console.error("leads ia reengajar: reservar falhou", error.code ?? "sem_codigo");
    return { r: "erro" };
  }
  const t = (data as Array<{ lead_id: string; toque: number }> | null)?.[0];
  if (!t) return { r: "nada" };
  const enviadas = await enviarPendentes(t.lead_id, deps);
  return { r: "preparado", enviadas, toque: t.toque };
}

// --- Resposta de espera depois do repasse (t_82c89141 item 6b) ---------------------------------------------
// O banco (lead_ia_espera_preparar) escolhe as conversas já passadas ao corretor em que o cliente escreveu e
// ninguém da equipe respondeu em lead_config.ia_espera_min (padrão 10; 0 = desligado), no máximo 1 a cada 2 h,
// grava a resposta curta (pendente) e avisa o corretor de novo pelo sininho. Aqui só envia pelo MESMO caminho
// das respostas (enviarPendentes: lista de liberados, opt-out e LEADS_IA_ENVIO_REAL=on). Fila e WhatsApp dos
// corretores não mudam.
export type DepsEspera = Pick<DepsRetorno, "reservar" | "resultado" | "env" | "fetchFn" | "linkAnuncio"> & {
  esperaPreparar: () => Promise<{ data: unknown; error: { code?: string } | null }>;
};

export async function esperaUmaRodada(
  deps: DepsEspera,
): Promise<{ r: "nada" | "erro" | "preparado"; leads?: number; enviadas?: number }> {
  const { data, error } = await deps.esperaPreparar();
  if (error) {
    console.error("leads ia espera: preparar falhou", error.code ?? "sem_codigo");
    return { r: "erro" };
  }
  const leads = [...new Set(((data as Array<{ lead_id: string }> | null) ?? []).map((x) => x.lead_id))];
  if (!leads.length) return { r: "nada" };
  let enviadas = 0;
  for (const l of leads) enviadas += await enviarPendentes(l, deps).catch(() => 0);
  return { r: "preparado", leads: leads.length, enviadas };
}

/** Dependências reais da espera (service_role). */
export async function depsEsperaReais(): Promise<DepsEspera> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as SupabaseClient;
  return {
    reservar: async (leadId) => await db.rpc("lead_ia_envio_reservar", { _lead: leadId }),
    resultado: async (msgId, ok) => await db.rpc("lead_ia_envio_resultado", { _msg: msgId, _ok: ok }),
    linkAnuncio: (leadId) => linkAnuncioDoLead(db, leadId),
    env: process.env as Record<string, string | undefined>,
    esperaPreparar: async () => await db.rpc("lead_ia_espera_preparar"),
  };
}

/** Comparação em tempo constante (não vaza o segredo pelo tempo de resposta). */
export function segredoConfere(recebido: string | null, esperado: string | undefined): boolean {
  if (!esperado || esperado.length < 32 || !recebido) return false;
  let dif = recebido.length ^ esperado.length;
  for (let i = 0; i < esperado.length; i++) dif |= (recebido.charCodeAt(i) || 0) ^ esperado.charCodeAt(i);
  return dif === 0;
}

export async function receberReengajar(request: Request, deps: DepsReengajar): Promise<Response> {
  if (request.method !== "POST") return json(405, "metodo");
  // Sem segredo configurado no servidor = rota desligada.
  if (!segredoConfere(request.headers.get("x-leads-ia-segredo"), deps.env[ENV_REENGAJAR_SEGREDO]?.trim()))
    return json(404, "desligado");
  const r = await reengajarUmaVez(deps).catch(() => ({ r: "erro" as const }));
  return json(r.r === "erro" ? 503 : 200, r.r);
}

export async function depsReengajarReais(request: Request): Promise<DepsReengajar> {
  const base = await depsReais(request);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as SupabaseClient;
  return { ...base, reengajarReservar: async () => await db.rpc("lead_ia_reengajar_reservar") };
}

/** Dependências reais (service_role). Só o servidor importa este arquivo. */
export async function depsReais(request: Request): Promise<DepsRetorno> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as SupabaseClient;
  const wu = (request as Request & { waitUntil?: (p: Promise<unknown>) => void }).waitUntil;
  return {
    receber: async (token, msg) => await db.rpc("lead_ia_retorno_receber", { _token: token, _msg: msg }),
    aplicar: async (args) => await db.rpc("lead_ia_aplicar", args),
    reservar: async (leadId) => await db.rpc("lead_ia_envio_reservar", { _lead: leadId }),
    resultado: async (msgId, ok) => await db.rpc("lead_ia_envio_resultado", { _msg: msgId, _ok: ok }),
    linkAnuncio: (leadId) => linkAnuncioDoLead(db, leadId),
    registrarUso: async (orgId, conversaId, u) =>
      await db.from("lead_ia_uso").insert({ organization_id: orgId, conversa_id: conversaId, ...u }),
    buscarImovel: async (conversaId, codigo) => {
      const { data, error } = await db.rpc("lead_ia_imovel_por_codigo", { _conversa: conversaId, _codigo: codigo });
      return error ? null : ((data as ImovelEncontrado | null) ?? null);
    },
    buscarParecidos: async (conversaId, filtro) => {
      const { data, error } = await db.rpc("lead_ia_imoveis_parecidos", argsParecidos(conversaId, filtro));
      return error ? null : normalizarParecidos(data);
    },
    // Função nova (migration 20261027110000): enquanto não for aplicada, o erro vira "vou procurar" + passagem.
    buscarImoveis: async (conversaId, filtro) => {
      const { data, error } = await db.rpc("lead_ia_imoveis_busca", argsBusca(conversaId, filtro));
      return error ? null : normalizarParecidos(data);
    },
    // Função nova (migration 20261027140000): enquanto não for aplicada, o erro vira "vou procurar com 3 suítes".
    buscarCaracteristica: async (conversaId, filtro) => {
      const { data, error } = await db.rpc("lead_ia_imoveis_caracteristica", argsCaracteristica(conversaId, filtro));
      return error ? null : normalizarCaracteristica(data);
    },
    redacaoLigada: (orgId) => redacaoLigadaDb(db, orgId),
    modoValidador: (orgId) => modoValidadorDb(db, orgId),
    avisoSemResposta: async (orgId, conversaId) => {
      const { error } = await db.from("lead_mensagens").insert({
        organization_id: orgId,
        conversa_id: conversaId,
        autor: "sistema",
        texto: AVISO_SEM_RESPOSTA,
        status: "nao_enviada",
      });
      if (error) throw new Error(error.code ?? "erro");
    },
    historico: (conversaId) => historicoDb(db, conversaId),
    env: process.env as Record<string, string | undefined>,
    emSegundoPlano: typeof wu === "function" ? (p) => wu.call(request, p) : undefined,
  };
}
