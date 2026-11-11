// Ajuda MAX na Locação — fatia 1/2 (t_b037935e). Função de servidor própria: não usa o pipeline da Nicole nem a
// leitura de documentos. A IA recebe só o manual, a pergunta mascarada e as últimas mensagens do balão.
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AI_TIMEOUT_MS, isAiTimeoutError } from "@/lib/ai-timeout";
import {
  HISTORICO_MAX,
  HISTORICO_TEXTO_MAX,
  PERGUNTA_MAX,
  PERGUNTA_MIN,
} from "@/lib/ajuda-max-locacao";
import {
  lerRetornoGemini,
  responderPergunta,
  type ChamadaIA,
  type RetornoIA,
} from "@/lib/ajuda-max-locacao-fluxo";
import { origemDaTela, textoDoEnvio } from "@/lib/ajuda-max-locacao-sugestoes";

const MODEL = "gemini-flash-latest";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
/** Inclui o raciocínio interno do modelo; a resposta em si tem no máximo ~120 palavras. */
const MAX_OUTPUT_TOKENS = 1024;

const Input = z.object({
  pergunta: z.string().trim().min(PERGUNTA_MIN).max(PERGUNTA_MAX),
  tela: z.enum(["lista", "detalhe"]),
  historico: z
    .array(
      z.object({
        papel: z.enum(["usuario", "assistente"]),
        texto: z.string().max(HISTORICO_TEXTO_MAX * 2),
      }),
    )
    .max(HISTORICO_MAX * 2)
    .default([]),
});

async function postGemini(apiKey: string, c: ChamadaIA, thinking: boolean): Promise<Response> {
  return fetch(GEMINI_URL, {
    method: "POST",
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: c.sistema }] },
      contents: c.conteudos,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        ...(thinking ? { thinkingConfig: { thinkingLevel: "low", includeThoughts: false } } : {}),
      },
    }),
  });
}

function chamarGemini(apiKey: string) {
  return async (c: ChamadaIA): Promise<RetornoIA> => {
    let res: Response;
    try {
      res = await postGemini(apiKey, c, true);
      // Modelo sem suporte a thinkingLevel responde 400: repete sem a configuração.
      if (res.status === 400) res = await postGemini(apiKey, c, false);
    } catch (err) {
      return { ok: false, erro: isAiTimeoutError(err) ? "tempo" : "rede" };
    }
    if (!res.ok) {
      console.error(`[ajuda-max] Gemini ${res.status}`);
      return { ok: false, erro: "status" };
    }
    return { ok: true, ...lerRetornoGemini(await res.json()) };
  };
}

/** Pergunta ao Ajuda MAX. Reserva 1 do limite diário com o login de quem pergunta; o banco confere chave e Locação. */
export const perguntarAjudaMaxLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as SupabaseClient;
    const userId = context.userId as string;
    const apiKey = process.env.GEMINI_API_KEY;
    return responderPergunta(data, {
      reservar: async () => {
        const { data: r, error } = await db.rpc("ajuda_max_locacao_reservar");
        if (error) throw new Error("desligado");
        return r;
      },
      fechar: async (org, dia, resultado, entrada, saida) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as unknown as SupabaseClient;
        const { error } = await admin.rpc("ajuda_max_locacao_fechar", {
          _org: org,
          _uid: userId,
          _dia: dia,
          _resultado: resultado,
          _entrada: entrada,
          _saida: saida,
        });
        if (error) throw new Error("fechar");
      },
      chamarIA: apiKey ? chamarGemini(apiKey) : null,
      log: (m) => console.log(m),
      // Fatia 2/2 (t_365484dc): pergunta sem resposta vira "dúvida sem resposta" com o login de quem perguntou.
      registrarDuvida: async (pergunta) => {
        const origem = origemDaTela(data.tela);
        const { data: r, error } = await db.rpc("ajuda_max_locacao_registrar", {
          _tipo: "duvida",
          _texto: textoDoEnvio("duvida", pergunta),
          _tela_rota: origem.telaRota,
          _tela_nome: origem.telaNome,
        });
        const reg = (r ?? {}) as { numero?: unknown };
        if (error) throw new Error("registrar");
        return typeof reg.numero === "number" ? reg.numero : null;
      },
    });
  });
