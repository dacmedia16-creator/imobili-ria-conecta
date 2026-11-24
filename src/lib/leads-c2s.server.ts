// Recepção de leads do C2S (Contact2Sale) no ADM. Card t_32f5458d (Denis 24/11/2026, tópico 6238).
// Doc oficial: https://docs-api-leads.c2sapp.com/docs.html (Webhooks: POST /integration/api/subscribe,
// hook_action on_create_lead; o C2S manda "as informações do lead no momento em que ele é criado").
//  - A imobiliária é identificada pelo token da URL (/api/leads/c2s/<token>); o banco guarda só o hash.
//  - O corpo do webhook não tem exemplo na doc. Aceitamos o formato do GET /leads/:id ({data:{id,attributes,messages}})
//    ou o lead direto. Se vier só o id, buscamos o lead completo no C2S (precisa de C2S_API_TOKEN no servidor).
//  - Reenvio do mesmo lead = 2xx sem duplicar; erro nosso = 5xx (para o C2S tentar de novo).
// LGPD: NUNCA registrar em log o corpo, nome, telefone, e-mail, mensagens ou o token. Só o resultado.
import { GRUPO_OLX_TOKEN_RE } from "@/lib/leads";

/** Um lead do C2S com ~15 mensagens tem poucos KB; folga para históricos longos. */
export const C2S_MAX_BYTES = 200_000;
export const C2S_API_BASE = "https://api.contact2sale.com/integration";
export const ENV_C2S_TOKEN = "C2S_API_TOKEN";

export type ResultadoC2s =
  "ok" | "duplicado" | "antigo" | "sem_contato" | "token" | "modulo" | "invalido";

export const STATUS_C2S: Record<ResultadoC2s, number> = {
  ok: 200,
  duplicado: 200, // reenvio: já temos
  antigo: 200, // criado antes de lead_config.c2s_desde (Denis 24/11: sem estoque antigo)
  sem_contato: 200, // sem telefone nem e-mail: não adianta reenviar
  token: 401,
  modulo: 404,
  invalido: 400,
};

export type RpcC2s = (
  token: string,
  lead: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string } | null }>;

/** Busca o lead completo no C2S pelo id (GET /leads/:id). null = não deu. */
export type BuscarLeadC2s = (id: string) => Promise<Record<string, unknown> | null>;

const resposta = (status: number, r: string) =>
  new Response(JSON.stringify({ r }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function lerCorpo(request: Request): Promise<string | null> {
  const cl = Number(request.headers.get("content-length") ?? "0");
  if (cl > C2S_MAX_BYTES) return null;
  const buf = await request.arrayBuffer();
  if (buf.byteLength > C2S_MAX_BYTES) return null;
  return new TextDecoder().decode(buf);
}

const ehObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Lead do C2S dentro do corpo: {data:{...}}, {lead:{...}} ou o próprio objeto. */
export function extrairLead(corpo: unknown): Record<string, unknown> | null {
  if (!ehObj(corpo)) return null;
  for (const k of ["data", "lead"]) if (ehObj(corpo[k])) return corpo[k] as Record<string, unknown>;
  return corpo;
}

/** Id do lead (string/number), aceito como o C2S manda (criptografado). */
export function idDoLead(lead: Record<string, unknown>): string | null {
  const v = lead.id ?? lead.lead_id;
  const s = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  return /^[A-Za-z0-9_-]{1,200}$/.test(s) ? s : null;
}

export async function receberLeadC2s(
  request: Request,
  token: string,
  rpc: RpcC2s,
  buscar?: BuscarLeadC2s,
): Promise<Response> {
  if (request.method !== "POST") return resposta(405, "metodo");
  if (!GRUPO_OLX_TOKEN_RE.test(token)) return resposta(401, "token");
  const texto = await lerCorpo(request).catch(() => null);
  if (texto === null) return resposta(413, "grande");
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return resposta(400, "invalido");
  }
  let lead = extrairLead(corpo);
  if (!lead) return resposta(400, "invalido");
  // Só o id (sem atributos): busca o lead completo no C2S.
  if (!ehObj(lead.attributes)) {
    const id = idDoLead(lead);
    if (!id || !buscar) return resposta(400, "invalido");
    const completo = await buscar(id).catch(() => null);
    const l = extrairLead(completo);
    if (!l || !ehObj(l.attributes)) {
      console.error("leads c2s: lead não encontrado no C2S");
      return resposta(503, "erro");
    }
    lead = l;
  }
  let data: unknown;
  try {
    const r = await rpc(token, lead);
    if (r.error) {
      console.error("leads c2s: falha no banco", r.error.code ?? "sem_codigo");
      return resposta(503, "erro");
    }
    data = r.data;
  } catch {
    console.error("leads c2s: falha inesperada");
    return resposta(503, "erro");
  }
  const r = (data as { r?: string } | null)?.r as ResultadoC2s | undefined;
  const status = r ? STATUS_C2S[r] : undefined;
  if (!status) {
    console.error("leads c2s: resposta inesperada do banco");
    return resposta(503, "erro");
  }
  return resposta(status, r as string);
}

/** GET /leads/:id no C2S com o token do servidor. Sem token = não busca. */
export function buscarLeadC2sReal(
  env: Record<string, string | undefined>,
  fetchFn: typeof fetch = fetch,
): BuscarLeadC2s | undefined {
  const tok = env[ENV_C2S_TOKEN]?.trim();
  if (!tok) return undefined;
  return async (id) => {
    const r = await fetchFn(`${C2S_API_BASE}/leads/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${tok}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  };
}

/** RPC real (service_role). Só o servidor importa este arquivo. */
export async function rpcC2sReal(): Promise<RpcC2s> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
  };
  return async (token, lead) => await db.rpc("lead_c2s_receber", { _token: token, _lead: lead });
}
