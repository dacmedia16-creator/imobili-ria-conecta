// Modelos de linguagem da IA de atendimento (card t_6f688b4b). Decisão de Denis (25/10): Gemini continua o
// padrão; OpenRouter é opcional, escolhido por imobiliária na tela (sem deploy para trocar de modelo).
//
// O modelo só ENTENDE a resposta do cliente (devolve JSON curto); nunca escreve a mensagem ao cliente.
// Os textos que saem continuam fixos (leads-ia.ts): o modelo não inventa preço nem condição.
//
// Plano B, nesta ordem, sem deixar o cliente sem resposta:
//   OpenRouter (se escolhido e com OPENROUTER_API_KEY) -> Gemini (LEADS_IA_MODELO=gemini + GEMINI_API_KEY)
//   -> só regras (leads-ia.ts).
// LGPD: vai ao modelo só a última fala do cliente (até 500 caracteres), com telefone e e-mail mascarados.
// No OpenRouter, só provedores que NÃO guardam nem treinam com os dados (data_collection "deny" + zdr).
// Nada de conteúdo em log; o uso (modelo, tokens, custo estimado) é registrado por conversa.
import { AI_TIMEOUT_MS } from "./ai-timeout";
import type { DadosQualificacao, Extrator, Passo } from "./leads-ia";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const ENV_OPENROUTER = "OPENROUTER_API_KEY";
export const GEMINI_MODELO = "gemini-flash-latest";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELO}:generateContent`;
/** Preço do Gemini Flash (US$ por milhão de tokens) até 31/12/2026: https://ai.google.dev/gemini-api/docs/pricing */
export const GEMINI_PRECO_USD_M = { entrada: 0.75, saida: 3.75 } as const;

/** Id de modelo do OpenRouter: "empresa/modelo" (igual à regra do banco em lead_ia_modelo_salvar). */
export const MODELO_RE = /^[a-z0-9][a-z0-9._-]{0,40}\/[a-z0-9][a-z0-9._:-]{0,80}$/;

/** Sugestões na tela (dá para digitar outro). Preços em leads-ia handoff, com link oficial. */
export const MODELOS_SUGERIDOS = [
  "anthropic/claude-haiku-5.5",
  "openai/gpt-6-luna",
  "google/gemini-3.8-flash",
  "x-ai/grok-4.7",
  "deepseek/deepseek-v4.1-flash",
] as const;

export type Provedor = "gemini" | "openrouter";

export type UsoModelo = {
  provedor: Provedor;
  modelo: string;
  ok: boolean;
  fallback: boolean;
  erro: string | null;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  custo_usd: number | null;
};

type Chamada = {
  ok: boolean;
  dados: Partial<DadosQualificacao> | null;
  erro: string | null;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  custo_usd: number | null;
};

const CAMPO: Partial<Record<Passo, string>> = {
  finalidade: '{"finalidade":"comprar"|"alugar"}',
  pagamento: '{"pagamento":["à vista"|"financiamento"|"permuta"|"FGTS"|"consórcio"]}',
  proximo_passo: '{"proximo_passo":"visita"|"contato"}',
  prazo: '{"prazo":"texto curto"}',
  faixa: '{"faixa":"texto curto, exatamente como o cliente disse"}',
  regiao: '{"regiao":"texto curto"}',
};
const instrucao = (passo: Passo) =>
  `Classifique a resposta de um cliente de imobiliária. Responda só JSON no formato ${CAMPO[passo]} ou {} se não der para saber. Não invente.`;

/** Tira e-mail e telefone do texto antes de mandar a qualquer modelo (mesma ideia de lead_ia_mascarar). */
export function mascararContato(t: string): string {
  return t
    .replace(/[^@\s]+@[^@\s]+/g, "[e-mail]")
    .replace(/\+?[0-9][0-9\s().-]{6,}[0-9]/g, "[número]")
    .slice(0, 500);
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

function lerJson(texto: string | undefined): Partial<DadosQualificacao> | null {
  try {
    const o = JSON.parse((texto ?? "{}").replace(/^```(json)?|```$/g, "").trim()) as unknown;
    return o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length ? (o as never) : null;
  } catch {
    return null;
  }
}

const falha = (erro: string): Chamada => ({
  ok: false,
  dados: null,
  erro,
  tokens_entrada: null,
  tokens_saida: null,
  custo_usd: null,
});

export async function chamarGemini(apiKey: string, passo: Passo, texto: string, fetchFn: typeof fetch = fetch): Promise<Chamada> {
  try {
    const res = await fetchFn(GEMINI_URL, {
      method: "POST",
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instrucao(passo) }] },
        contents: [{ role: "user", parts: [{ text: mascararContato(texto) }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 100 },
      }),
    });
    if (!res.ok) return falha(`http_${res.status}`);
    const j = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const ent = num(j.usageMetadata?.promptTokenCount);
    const sai = num(j.usageMetadata?.candidatesTokenCount);
    return {
      ok: true,
      dados: lerJson(j.candidates?.[0]?.content?.parts?.[0]?.text),
      erro: null,
      tokens_entrada: ent,
      tokens_saida: sai,
      custo_usd:
        ent === null && sai === null
          ? null
          : ((ent ?? 0) * GEMINI_PRECO_USD_M.entrada + (sai ?? 0) * GEMINI_PRECO_USD_M.saida) / 1e6,
    };
  } catch (e) {
    return falha((e as Error)?.name === "TimeoutError" ? "timeout" : "rede");
  }
}

export async function chamarOpenRouter(
  apiKey: string,
  modelo: string,
  passo: Passo,
  texto: string,
  fetchFn: typeof fetch = fetch,
): Promise<Chamada> {
  if (!MODELO_RE.test(modelo)) return falha("modelo_invalido");
  try {
    const res = await fetchFn(OPENROUTER_URL, {
      method: "POST",
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "ADM MAX - IA de atendimento",
      },
      body: JSON.stringify({
        model: modelo,
        messages: [
          { role: "system", content: instrucao(passo) },
          { role: "user", content: mascararContato(texto) },
        ],
        max_tokens: 100,
        temperature: 0,
        response_format: { type: "json_object" },
        // LGPD: só provedores que não guardam/treinam com os dados e com retenção zero.
        // Teto de preço (US$ por milhão de tokens): modelo caro demais não é usado (cai para o Gemini).
        provider: { data_collection: "deny", zdr: true, allow_fallbacks: true, max_price: { prompt: 3, completion: 15 } },
        reasoning: { exclude: true },
        usage: { include: true },
      }),
    });
    // 402 = crédito esgotado; 401/403 = chave; 429/5xx = fora do ar. Tudo cai para o Gemini.
    if (!res.ok) return falha(`http_${res.status}`);
    const j = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      error?: { code?: number };
    };
    if (j.error) return falha(`erro_${num(j.error.code) ?? "x"}`);
    return {
      ok: true,
      dados: lerJson(j.choices?.[0]?.message?.content),
      erro: null,
      tokens_entrada: num(j.usage?.prompt_tokens),
      tokens_saida: num(j.usage?.completion_tokens),
      custo_usd: num(j.usage?.cost),
    };
  } catch (e) {
    return falha((e as Error)?.name === "TimeoutError" ? "timeout" : "rede");
  }
}

export type EscolhaModelo = { provedor: Provedor; modelo: string | null };

/**
 * Monta o extrator conforme a escolha da imobiliária e as chaves do servidor. Cada chamada (com sucesso
 * ou falha) vira um registro de uso via `registrar`. undefined = sem modelo (só regras).
 */
export function montarExtrator(
  escolha: EscolhaModelo,
  env: Record<string, string | undefined>,
  registrar: (u: UsoModelo) => void,
  fetchFn: typeof fetch = fetch,
): Extrator | undefined {
  const orKey = env[ENV_OPENROUTER]?.trim();
  const usaOr = escolha.provedor === "openrouter" && !!orKey && !!escolha.modelo && MODELO_RE.test(escolha.modelo);
  const gKey = env.GEMINI_API_KEY?.trim();
  const usaGemini = env.LEADS_IA_MODELO === "gemini" && !!gKey;
  if (!usaOr && !usaGemini) return undefined;

  return async (passo, texto) => {
    if (!CAMPO[passo]) return null;
    if (usaOr) {
      const r = await chamarOpenRouter(orKey!, escolha.modelo!, passo, texto, fetchFn);
      registrar({ provedor: "openrouter", modelo: escolha.modelo!, fallback: false, ...semDados(r) });
      if (r.ok) return r.dados;
    }
    if (usaGemini) {
      const r = await chamarGemini(gKey!, passo, texto, fetchFn);
      registrar({ provedor: "gemini", modelo: GEMINI_MODELO, fallback: usaOr, ...semDados(r) });
      if (r.ok) return r.dados;
    }
    return null; // segue só com regras
  };
}

function semDados(r: Chamada) {
  return {
    ok: r.ok,
    erro: r.erro,
    tokens_entrada: r.tokens_entrada,
    tokens_saida: r.tokens_saida,
    custo_usd: r.custo_usd,
  };
}
