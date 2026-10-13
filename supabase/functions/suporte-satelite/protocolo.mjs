/**
 * Contrato da ponte Ajuda e sugestões (ADM, Estudo e Visita).
 * As três cópias deste arquivo precisam ser iguais: a assinatura é o corpo cru, não um JSON reordenado.
 * O navegador nunca escolhe o usuário do ADM nem o sistema. Isso fica no servidor do satélite.
 */

export const SISTEMAS = ["estudo", "visita"];
export const ACOES = ["abrir", "meus", "thread", "responder", "resolver", "nao_lidas", "print"];
export const JANELA_SEG = 60;
export const CABECALHO = "x-suporte-assinatura";
export const LIMITE_PRINT = 1_500_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function filaDe(origem) {
  if (origem === "visita") return "visita";
  if (origem === "adm" || origem === "estudo") return "adm";
  return null;
}

export function nomeOrigem(origem) {
  if (origem === "estudo") return "Estudo de Mercado";
  if (origem === "visita") return "Visita MAX";
  if (origem === "adm") return "ADM MAX";
  return null;
}

export function ondeVerResposta(origem) {
  if (origem === "estudo") return "Abra o Estudo de Mercado e toque em Ajuda e sugestões.";
  if (origem === "visita") return "Abra o Visita MAX e toque em Ajuda e sugestões.";
  return "Abra o ADM MAX para ver a resposta.";
}

function uuidOk(v) {
  return typeof v === "string" && UUID.test(v);
}

function texto(v, max) {
  return String(v ?? "").trim().slice(0, max);
}

export async function hmacHex(secret, body) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function assinaturaConfere(esperadaHex, recebida) {
  const r = String(recebida ?? "");
  if (!r.startsWith("v1=")) return false;
  const hex = r.slice(3);
  if (hex.length !== esperadaHex.length || !/^[0-9a-f]+$/.test(hex)) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ esperadaHex.charCodeAt(i);
  return diff === 0;
}

export async function assinarPedido(secret, pedido, agoraSeg, jti) {
  const corpo = JSON.stringify({ ...pedido, iat: agoraSeg, jti });
  return { corpo, assinatura: `v1=${await hmacHex(secret, corpo)}` };
}

/** Monta o pedido assinado. Ignora sistema e adm_user_id vindos do navegador. */
export function montarPedidoSatelite({ sistema, admUserId, body, jti }) {
  if (!SISTEMAS.includes(sistema)) return { erro: "Sistema inválido." };
  if (!uuidOk(admUserId) || !uuidOk(jti)) return { erro: "Pedido inválido." };
  const acao = body?.acao;
  if (!ACOES.includes(acao)) return { erro: "Ação inválida." };
  const base = { acao, sistema, adm_user_id: admUserId };
  if (acao === "meus" || acao === "nao_lidas") return { pedido: base };
  if (acao === "thread" || acao === "resolver" || acao === "print") {
    if (!uuidOk(body?.ticket_id)) return { erro: "Chamado inválido." };
    return { pedido: { ...base, ticket_id: body.ticket_id } };
  }
  if (acao === "responder") {
    const msg = texto(body?.texto, 4000);
    if (!uuidOk(body?.ticket_id)) return { erro: "Chamado inválido." };
    if (msg.length < 1) return { erro: "Escreva a mensagem." };
    return { pedido: { ...base, ticket_id: body.ticket_id, texto: msg } };
  }
  const tipo = body?.tipo;
  const msg = texto(body?.texto, 4000);
  if (!["erro", "duvida", "sugestao"].includes(tipo)) return { erro: "Escolha Erro, Dúvida ou Ideia." };
  if (msg.length < 5) return { erro: "Escreva pelo menos 5 caracteres." };
  const pedido = {
    ...base,
    tipo,
    texto: msg,
    tela_rota: texto(body?.tela_rota, 300),
    tela_nome: texto(body?.tela_nome, 120),
    user_agent: texto(body?.user_agent, 400),
  };
  if (body?.print_base64) {
    const conferido = conferirPrint(body.print_base64, body.print_tipo);
    if (!conferido.ok) return { erro: conferido.erro };
    pedido.print_base64 = body.print_base64;
    pedido.print_tipo = conferido.tipo;
  }
  return { pedido };
}

function bytesDe(base64) {
  const limpo = String(base64).replace(/\s/g, "");
  if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(limpo, "base64"));
  const bin = atob(limpo);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function conferirPrint(base64, tipo) {
  if (typeof base64 !== "string" || base64.length < 16) return { ok: false, erro: "Print inválido." };
  if (base64.length > Math.ceil(LIMITE_PRINT * 4 / 3) + 64) return { ok: false, erro: "Print acima de 1,5 MB. Tire um recorte menor." };
  let bytes;
  try {
    bytes = bytesDe(base64);
  } catch {
    return { ok: false, erro: "Print inválido." };
  }
  if (bytes.length > LIMITE_PRINT) return { ok: false, erro: "Print acima de 1,5 MB. Tire um recorte menor." };
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const real = png ? "image/png" : jpg ? "image/jpeg" : webp ? "image/webp" : null;
  if (!real || real !== tipo) return { ok: false, erro: "O print deve ser PNG, JPG ou WEBP." };
  return { ok: true, tipo: real, bytes };
}

export function validarEnvelope(obj, agoraSeg) {
  if (!obj || typeof obj !== "object") return "corpo_invalido";
  if (!SISTEMAS.includes(obj.sistema)) return "sistema_invalido";
  if (!ACOES.includes(obj.acao)) return "acao_invalida";
  if (!uuidOk(obj.adm_user_id) || !uuidOk(obj.jti)) return "pedido_invalido";
  if (typeof obj.iat !== "number" || Math.abs(agoraSeg - obj.iat) > JANELA_SEG) return "pedido_expirado";
  return null;
}

export function segredoDaOrigem(origem, segredos) {
  const s = origem === "estudo" ? segredos?.estudo : origem === "visita" ? segredos?.visita : null;
  return typeof s === "string" && s.length >= 32 ? s : null;
}

/** Confere a assinatura do corpo cru. Não chama o banco. */
export async function receberPedido({ corpo, assinatura, agoraSeg, segredos }) {
  let obj;
  try {
    obj = JSON.parse(corpo);
  } catch {
    return { status: 400, body: { error: "Pedido inválido." } };
  }
  const erro = validarEnvelope(obj, agoraSeg);
  if (erro === "pedido_expirado") return { status: 401, body: { error: "Pedido expirado. Tente de novo." } };
  if (erro) return { status: 401, body: { error: "Pedido inválido." } };
  const secret = segredoDaOrigem(obj.sistema, segredos);
  if (!secret) return { status: 503, body: { error: "A ajuda ainda não está ligada. Avise o suporte." } };
  const hex = await hmacHex(secret, corpo);
  if (!assinaturaConfere(hex, assinatura)) return { status: 401, body: { error: "Assinatura inválida." } };
  return { status: 200, payload: obj };
}

/**
 * Porta do satélite. O usuário logado vira o vínculo gravado; o corpo do navegador não escolhe a conta ADM.
 */
export async function tratarPedido({
  method,
  authorization,
  body,
  sistema,
  agoraSeg,
  novoJti,
  lerUsuario,
  buscarVinculo,
  enviar,
  segredo,
}) {
  if (method === "OPTIONS") return { status: 204, body: null };
  if (method !== "POST") return { status: 405, body: { error: "Método não permitido." } };
  if (!segredo || String(segredo).length < 32) {
    return { status: 503, body: { error: "A ajuda ainda não está ligada. Avise o suporte." } };
  }
  const user = await lerUsuario(authorization);
  if (!user?.id) return { status: 401, body: { error: "Faça login para abrir um chamado." } };
  const admUserId = await buscarVinculo(user.id);
  if (!admUserId) {
    return { status: 403, body: { error: "Sua conta ainda não está ligada ao ADM MAX. Peça o acesso ao gestor." } };
  }
  const jti = novoJti();
  const montado = montarPedidoSatelite({ sistema, admUserId, body, jti });
  if (montado.erro) return { status: 400, body: { error: montado.erro } };
  const assinado = await assinarPedido(segredo, montado.pedido, agoraSeg, jti);
  return enviar(assinado.corpo, assinado.assinatura);
}
