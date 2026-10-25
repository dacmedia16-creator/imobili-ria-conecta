import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AI_TIMEOUT_MS } from "./ai-timeout";
import { proximaResposta, type ContextoIa, type Extrator, type Passo } from "./leads-ia";

/**
 * Tela de teste da IA (card t_8046ecb0): o gestor responde COMO SE FOSSE o cliente.
 * Fluxo: botão -> esta função (login do gestor) -> RPC lead_ia_cliente_simular (o BANCO confere gestor,
 * imobiliária, módulo, modo teste e trata o SAIR) -> roteiro de qualificação (leads-ia.ts, textos fixos)
 * -> RPC lead_ia_aplicar pelo servidor (service_role; idempotente pela versão da conversa).
 * Nada é enviado para fora do ADM. O modelo de linguagem é OPCIONAL e fica desligado
 * (LEADS_IA_MODELO=gemini liga; usa a GEMINI_API_KEY que o ADM já tem e gera custo por uso).
 */
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

const MODEL = "gemini-flash-latest";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/** Extrator com Gemini: só ENTENDE a resposta (devolve JSON curto); nunca escreve a mensagem ao cliente. */
export function extratorGemini(apiKey: string, fetchFn: typeof fetch = fetch): Extrator {
  return async (passo: Passo, texto: string) => {
    const campo: Record<string, string> = {
      finalidade: '{"finalidade":"comprar"|"alugar"}',
      pagamento: '{"pagamento":["financiamento"|"à vista"|"FGTS"|"consórcio"]}',
      proximo_passo: '{"proximo_passo":"visita"|"contato"}',
      prazo: '{"prazo":"texto curto"}',
      faixa: '{"faixa":"texto curto, exatamente como o cliente disse"}',
      regiao: '{"regiao":"texto curto"}',
    };
    if (!campo[passo]) return null;
    const res = await fetchFn(GEMINI_URL, {
      method: "POST",
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: `Classifique a resposta de um cliente de imobiliária. Responda só JSON no formato ${campo[passo]} ou {} se não der para saber. Não invente.`,
            },
          ],
        },
        contents: [{ role: "user", parts: [{ text: texto.slice(0, 500) }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 100 },
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try {
      const o = JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}") as Record<string, unknown>;
      return Object.keys(o).length ? (o as never) : null;
    } catch {
      return null;
    }
  };
}

function escolherExtrator(): Extrator | undefined {
  const key = process.env.GEMINI_API_KEY;
  return process.env.LEADS_IA_MODELO === "gemini" && key ? extratorGemini(key) : undefined;
}

const Input = z.object({
  leadId: z.string().uuid(),
  texto: z.string().trim().min(1).max(1000),
});

export const responderComoCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: ctx, error } = await user.rpc("lead_ia_cliente_simular", {
      _lead: data.leadId,
      _texto: data.texto,
    });
    if (error) return { ok: false as const, erro: error.message };
    const c = ctx as ContextoIa;
    if (c.estado !== "ativa") return { ok: true as const, estado: c.estado };
    const r = await proximaResposta({ ...c, dados: c.dados ?? {} }, data.texto, escolherExtrator());
    const { data: ap, error: e2 } = await (await admin()).rpc("lead_ia_aplicar", {
      _conversa: c.conversa_id,
      _versao: c.versao,
      _passo: r.passo,
      _dados: r.dados,
      _resposta: r.resposta,
      _fim: r.fim,
      _resumo: r.resumo,
    });
    // Sem conteúdo da conversa no log.
    if (e2) {
      console.error("lead_ia_aplicar falhou:", e2.code);
      return { ok: false as const, erro: "falha" };
    }
    return { ok: true as const, estado: r.fim ? "passada" : "ativa", aplicado: (ap as { ok?: boolean })?.ok === true };
  });
