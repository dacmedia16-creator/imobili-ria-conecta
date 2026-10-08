import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiFacts, cleanAiText, groupByListing, type Snapshot } from "@/lib/owner-feedback";
import { AI_TIMEOUT_MESSAGE, AI_TIMEOUT_MS, isAiTimeoutError } from "@/lib/ai-timeout";

const MODEL = "gemini-flash-latest";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const Input = z.object({ code: z.string().min(3).max(60) });

const SYSTEM = [
  "Você ajuda um corretor da RE/MAX a escrever a recomendação de um relatório semanal para o proprietário de um imóvel à venda.",
  "Escreva em português do Brasil, tom humano, cordial e direto, em 2 ou 3 frases curtas, sem saudação e sem assinatura.",
  "Use apenas os números fornecidos; nunca invente números, prazos, preços ou valores.",
  "Não prometa venda nem resultado. Não cite números sem período confirmado.",
  "Se a exposição for baixa, sugira reforçar fotos, título e destaque; se houver muitas visualizações e poucos contatos, sugira rever preço e primeiras fotos com cuidado;",
  "se houver bons contatos, diga que o corretor está acompanhando os interessados. Pode sugerir uma conversa rápida para alinhar próximos passos.",
  "Responda só com o texto da recomendação, sem markdown.",
].join(" ");

/** Sugere a recomendação com IA (Gemini). O corretor revisa antes de enviar. */
export const suggestOwnerRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "IA indisponível no momento." };

    // Cliente do próprio usuário: o banco aplica corretor/time/admin e o módulo ligado.
    const db = context.supabase as unknown as SupabaseClient;
    const { data: rows, error } = await db
      .from("portal_listing_snapshots")
      .select(
        "portal, collected_on, listing_code, broker_id, window_kind, window_from, window_to, impressions, views, contacts, error",
      )
      .eq("listing_code", data.code)
      .order("collected_on", { ascending: false })
      .limit(40);
    if (error) return { ok: false as const, error: "Não foi possível ler os números." };
    const listing = groupByListing((rows ?? []) as Snapshot[])[0];
    if (!listing) return { ok: false as const, error: "Imóvel não encontrado." };

    let res: Response;
    try {
      res = await fetch(GEMINI_URL, {
        method: "POST",
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [
            { role: "user", parts: [{ text: `Números do anúncio:\n${aiFacts(listing)}` }] },
          ],
          generationConfig: { maxOutputTokens: 400, temperature: 0.4 },
        }),
      });
    } catch (err) {
      if (isAiTimeoutError(err)) {
        console.error("[feedback-ia] Gemini tempo-limite");
        return { ok: false as const, error: AI_TIMEOUT_MESSAGE };
      }
      console.error("[feedback-ia] Gemini falha de rede");
      return { ok: false as const, error: "A IA não respondeu agora. Tente de novo em instantes." };
    }
    if (!res.ok) {
      console.error(`[feedback-ia] Gemini ${res.status}`);
      return { ok: false as const, error: "A IA não respondeu agora. Tente de novo em instantes." };
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = cleanAiText(
      (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(" "),
    );
    if (!text) return { ok: false as const, error: "A IA não trouxe sugestão. Tente de novo." };
    return { ok: true as const, text };
  });
