import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { AI_READABLE_KINDS, buildCapturePrompt, sanitizeCaptureAi } from "./exclusive-captures-ai";

const MODEL = "gemini-flash-latest";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const Input = z.object({
  captureId: z.string().uuid(),
  storagePath: z.string().min(10).max(300),
  kind: z.enum(AI_READABLE_KINDS),
  scope: z.enum(["owner", "property"]),
});

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

function parseJson(text: string): Record<string, unknown> | null {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  for (const candidate of [t, t.match(/\{[\s\S]*\}/)?.[0]]) {
    if (!candidate) continue;
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return parsed as Record<string, unknown>;
    } catch {
      // tenta o próximo formato
    }
  }
  return null;
}

/**
 * Lê um documento da captação com a mesma IA das Vendas e devolve SUGESTÕES de campos.
 * O acesso ao arquivo passa pelo RLS do próprio usuário; nada do documento é gravado.
 */
export const extractCaptureDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "Leitura por IA não configurada" };
    const supabase = context.supabase;

    // Confirma que o documento pertence à captação e que o usuário enxerga (RLS).
    const { data: doc, error: docErr } = await supabase
      .from("exclusive_documents")
      .select("id, kind, file_name")
      .eq("capture_id", data.captureId)
      .eq("storage_path", data.storagePath)
      .maybeSingle();
    if (docErr || !doc) return { ok: false as const, error: "Documento não encontrado" };

    const { data: blob, error: dlErr } = await supabase.storage
      .from("exclusive-captures")
      .download(data.storagePath);
    if (dlErr || !blob) return { ok: false as const, error: "Falha ao baixar o documento" };

    const ext = (data.storagePath.split(".").pop() ?? "").toLowerCase();
    const mime =
      ext === "pdf"
        ? "application/pdf"
        : ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : "image/jpeg";
    const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64");

    const call = async () => {
      const res = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: "Você extrai dados de documentos brasileiros (RG, CPF, CNH, comprovantes, IPTU, matrícula de imóvel). Responda APENAS com JSON válido.",
              },
            ],
          },
          contents: [
            {
              role: "user",
              parts: [
                { text: buildCapturePrompt(data.kind, data.scope) },
                { inline_data: { mime_type: mime, data: b64 } },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4096 },
        }),
      });
      if (!res.ok)
        throw Object.assign(new Error(`Gemini ${res.status}`), { retry: res.status >= 500 });
      const json = (await res.json()) as GeminiResponse;
      const parsed = parseJson(json.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
      if (!parsed) throw Object.assign(new Error("Resposta inválida da IA"), { retry: true });
      return parsed;
    };

    try {
      let raw: Record<string, unknown>;
      try {
        raw = await call();
      } catch (err) {
        if (!(err as { retry?: boolean }).retry) throw err;
        raw = await call();
      }
      return { ok: true as const, values: sanitizeCaptureAi(raw, data.scope) };
    } catch (err) {
      // Sem conteúdo do documento no log: só o código do erro.
      console.error(`extractCaptureDocument falhou (doc ${doc.id}):`, (err as Error).message);
      return { ok: false as const, error: "Não foi possível ler o documento por IA" };
    }
  });
