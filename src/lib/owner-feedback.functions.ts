import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  AI_BAD_SUGGESTION,
  aiFacts,
  codeKey,
  groupByListing,
  pickAiSuggestion,
  similarAverage,
  type GeminiReply,
  type ListingContext,
  type ListingFeedback,
  type Snapshot,
} from "@/lib/owner-feedback";
import { AI_TIMEOUT_MESSAGE, AI_TIMEOUT_MS, isAiTimeoutError } from "@/lib/ai-timeout";

const MODEL = "gemini-flash-latest";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
/** O limite inclui o raciocínio interno do modelo; 400 cortava a resposta (t_e32ba130). */
const MAX_OUTPUT_TOKENS = 2048;

const Input = z.object({ code: z.string().min(3).max(60) });

const SYSTEM = [
  "Você ajuda um corretor da RE/MAX a escrever a recomendação de um relatório semanal para o proprietário de um imóvel à venda.",
  "Escreva SEMPRE em português do Brasil, tom humano, cordial e direto, em 2 ou 3 frases curtas e completas, terminadas com ponto, sem saudação e sem assinatura.",
  "Use apenas os números fornecidos; nunca invente números, prazos, preços ou valores.",
  "Não prometa venda nem resultado. Não cite números sem período confirmado.",
  "Nunca sugira um valor de preço nem percentual de desconto; o preço anunciado é só contexto e não deve ser citado.",
  "Se houver média da imobiliária, compare com cuidado (acima, parecido ou abaixo da média), sem exagero.",
  "Se a exposição for baixa, sugira reforçar fotos, título e destaque; se houver muitas visualizações e poucos contatos, sugira conversar sobre preço e primeiras fotos com cuidado;",
  "se houver bons contatos, diga que o corretor está acompanhando os interessados. Pode sugerir uma conversa rápida para alinhar próximos passos.",
  "Responda só com o texto da recomendação, sem markdown.",
].join(" ");

type Db = SupabaseClient;

/**
 * Contexto extra do imóvel (site RE/MAX) e média de imóveis parecidos da mesma imobiliária.
 * A imobiliária vem da linha que o próprio usuário enxerga pelo RLS; as tabelas do site só são
 * lidas pelo servidor, sempre filtradas por essa imobiliária, e só saem dados agregados.
 */
async function loadContext(
  orgId: string,
  listing: ListingFeedback,
): Promise<ListingContext | undefined> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as Db;
  const key = codeKey(listing.code);
  const { data: site } = await admin
    .from("remax_site_listings")
    .select("tipo, preco, area, quartos, bairro, cidade, publicado_em")
    .eq("organization_id", orgId)
    .eq("code_key", key)
    .eq("transacao", "venda")
    .maybeSingle();
  if (!site) return undefined;
  const s = site as {
    tipo: string | null;
    preco: number | null;
    area: number | null;
    quartos: number | null;
    bairro: string | null;
    cidade: string | null;
    publicado_em: string | null;
  };
  const ctx: ListingContext = {
    tipo: s.tipo,
    preco: s.preco,
    area: s.area,
    quartos: s.quartos,
    bairro: s.bairro,
    cidade: s.cidade,
    publicadoEm: s.publicado_em,
    hoje: new Date().toISOString(),
    comparacao: null,
  };

  // Comparação só com número de período confirmado (últimos 30 dias) e na mesma coleta.
  const line = listing.lines.find((l) => l.confirmed && l.periodText.startsWith("últimos 30 dias"));
  if (!line || !s.tipo || !s.cidade) return ctx;
  const [{ data: similar }, { data: snaps }] = await Promise.all([
    admin
      .from("remax_site_listings")
      .select("code_key")
      .eq("organization_id", orgId)
      .eq("transacao", "venda")
      .eq("tipo", s.tipo)
      .eq("cidade", s.cidade)
      .limit(2000),
    admin
      .from("portal_listing_snapshots")
      .select("listing_code, views, contacts")
      .eq("organization_id", orgId)
      .eq("portal", line.portal)
      .eq("collected_on", line.collectedOn)
      .eq("window_kind", "last30")
      .is("error", null)
      .limit(2000),
  ]);
  const keys = new Set(((similar ?? []) as Array<{ code_key: string }>).map((r) => r.code_key));
  const avg = similarAverage(
    key,
    (snaps ?? []) as Array<{ listing_code: string; views: number | null; contacts: number | null }>,
    keys,
  );
  if (avg)
    ctx.comparacao = {
      portal: line.portal,
      periodText: "últimos 30 dias",
      criterio: `${s.tipo} à venda em ${s.cidade}`,
      ...avg,
    };
  return ctx;
}

async function callGemini(apiKey: string, facts: string, thinking: boolean): Promise<Response> {
  return fetch(GEMINI_URL, {
    method: "POST",
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: facts }] }],
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.4,
        // Texto curto não precisa de raciocínio longo; mantém o limite para a resposta em si.
        ...(thinking ? { thinkingConfig: { thinkingLevel: "low", includeThoughts: false } } : {}),
      },
    }),
  });
}

/** Sugere a recomendação com IA (Gemini). O corretor revisa antes de enviar. */
export const suggestOwnerRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "IA indisponível no momento." };

    // Cliente do próprio usuário: o banco aplica corretor/time/admin, imobiliária e o módulo ligado.
    const db = context.supabase as unknown as Db;
    const { data: rows, error } = await db
      .from("portal_listing_snapshots")
      .select(
        "organization_id, portal, collected_on, listing_code, broker_id, window_kind, window_from, window_to, impressions, views, contacts, error",
      )
      .eq("listing_code", data.code)
      .order("collected_on", { ascending: false })
      .limit(40);
    if (error) return { ok: false as const, error: "Não foi possível ler os números." };
    const listing = groupByListing((rows ?? []) as Snapshot[])[0];
    if (!listing) return { ok: false as const, error: "Imóvel não encontrado." };
    const orgId = (rows?.[0] as { organization_id?: string } | undefined)?.organization_id;

    let ctx: ListingContext | undefined;
    try {
      ctx = orgId ? await loadContext(orgId, listing) : undefined;
    } catch {
      console.error("[feedback-ia] contexto do imóvel indisponível");
    }
    const facts = `Números do anúncio:\n${aiFacts(listing, ctx)}`;

    let res: Response;
    try {
      res = await callGemini(apiKey, facts, true);
      // Modelo sem suporte a thinkingLevel responde 400: repete sem a configuração.
      if (res.status === 400) res = await callGemini(apiKey, facts, false);
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
    const picked = pickAiSuggestion((await res.json()) as GeminiReply);
    if (!picked.ok) {
      console.error(`[feedback-ia] sugestão recusada: ${picked.reason}`);
      return { ok: false as const, error: AI_BAD_SUGGESTION };
    }
    return { ok: true as const, text: picked.text };
  });
