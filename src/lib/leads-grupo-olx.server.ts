// Recepção de leads do Grupo ZAP/OLX ("Receber leads no CRM" do Canal Pro). Card t_478b211e.
// Doc oficial: https://developers.grupozap.com/webhooks/integration_leads.html
//  - POST JSON, 1 lead por requisição; só o código HTTP vale (2xx = recebido; o resto = tenta de novo,
//    até 3 vezes e depois guarda por até 14 dias). Por isso: reenvio do mesmo lead = 2xx sem duplicar;
//    erro nosso = 5xx (o Grupo OLX reenvia).
//  - A imobiliária é identificada pelo token da URL; o banco guarda só o hash (lead_grupo_olx_receber).
// LGPD: NUNCA registrar em log o corpo, nome, telefone, e-mail, mensagem ou o token. Só o resultado.
import { GRUPO_OLX_TOKEN_RE } from "@/lib/leads";

/** Tamanho máximo do corpo (um lead tem ~2 KB; MCMV um pouco mais). */
export const GRUPO_OLX_MAX_BYTES = 20_000;

export type ResultadoBanco =
  "ok" | "duplicado" | "juntado" | "sem_contato" | "token" | "modulo" | "invalido" | "limite";

/** Código HTTP de cada resultado do banco. */
export const STATUS_POR_RESULTADO: Record<ResultadoBanco, number> = {
  ok: 200,
  duplicado: 200, // reenvio do Grupo OLX: já temos, confirma para ele parar de tentar
  juntado: 200, // t_82c89141: outro aviso do MESMO cliente (mesmo telefone) juntado ao lead aberto
  sem_contato: 200, // sem telefone nem e-mail válidos: não há o que atender; não adianta reenviar
  token: 401,
  modulo: 404,
  invalido: 400,
  limite: 429,
};

export type RpcReceber = (
  token: string,
  lead: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string } | null }>;

const resposta = (status: number, r: string) =>
  new Response(JSON.stringify({ r }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// shortcut: limite por instância do Worker (memória local), só contra excesso de token inválido;
// o limite real por imobiliária fica no banco (600/h). Instâncias diferentes não somam.
const falhasToken = new Map<string, { n: number; desde: number }>();
const JANELA_MS = 60_000;
const MAX_FALHAS_POR_IP = 30;

export function bloqueadoPorFalhas(ip: string | null, agora = Date.now()): boolean {
  if (!ip) return false;
  const f = falhasToken.get(ip);
  return !!f && agora - f.desde < JANELA_MS && f.n >= MAX_FALHAS_POR_IP;
}
export function registrarFalhaToken(ip: string | null, agora = Date.now()) {
  if (!ip) return;
  if (falhasToken.size > 5_000) falhasToken.clear();
  const f = falhasToken.get(ip);
  if (!f || agora - f.desde >= JANELA_MS) falhasToken.set(ip, { n: 1, desde: agora });
  else f.n++;
}
export function _zerarFalhasToken() {
  falhasToken.clear();
}

/** Lê o corpo com limite de tamanho, sem confiar no content-length. */
async function lerCorpo(request: Request): Promise<string | null> {
  const cl = Number(request.headers.get("content-length") ?? "0");
  if (cl > GRUPO_OLX_MAX_BYTES) return null;
  const buf = await request.arrayBuffer();
  if (buf.byteLength > GRUPO_OLX_MAX_BYTES) return null;
  return new TextDecoder().decode(buf);
}

/**
 * Trata o POST do Grupo OLX. Não registra dados do cliente em lugar nenhum fora do banco.
 * Decisão do piloto: lead de anúncio SEM clientListingId é aceito (vai para o rodízio, com o
 * originListingId guardado). A doc pede 4xx nesse caso, mas recusar faria o lead nunca chegar
 * enquanto os anúncios da conta nova não tiverem o código do CRM preenchido.
 */
export async function receberLeadGrupoOlx(
  request: Request,
  token: string,
  rpc: RpcReceber,
): Promise<Response> {
  if (request.method !== "POST") return resposta(405, "metodo");
  const ip = request.headers.get("cf-connecting-ip");
  if (bloqueadoPorFalhas(ip)) return resposta(429, "limite");
  if (!GRUPO_OLX_TOKEN_RE.test(token)) {
    registrarFalhaToken(ip);
    return resposta(401, "token");
  }
  const texto = await lerCorpo(request).catch(() => null);
  if (texto === null) return resposta(413, "grande");
  let lead: unknown;
  try {
    lead = JSON.parse(texto);
  } catch {
    return resposta(400, "invalido");
  }
  if (!lead || typeof lead !== "object" || Array.isArray(lead)) return resposta(400, "invalido");

  let data: unknown;
  try {
    const r = await rpc(token, lead as Record<string, unknown>);
    if (r.error) {
      // Só o código do erro (nunca a mensagem, que pode citar valores).
      console.error("leads grupo-olx: falha no banco", r.error.code ?? "sem_codigo");
      return resposta(503, "erro");
    }
    data = r.data;
  } catch {
    console.error("leads grupo-olx: falha inesperada");
    return resposta(503, "erro");
  }
  const r = (data as { r?: string } | null)?.r as ResultadoBanco | undefined;
  const status = r ? STATUS_POR_RESULTADO[r] : undefined;
  if (!status) {
    console.error("leads grupo-olx: resposta inesperada do banco");
    return resposta(503, "erro");
  }
  if (r === "token") registrarFalhaToken(ip);
  return resposta(status, r as string);
}

/** RPC real (service_role). Só o servidor importa este arquivo. */
export async function rpcReceberReal(): Promise<RpcReceber> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
  };
  return async (token, lead) =>
    await db.rpc("lead_grupo_olx_receber", { _token: token, _lead: lead });
}
