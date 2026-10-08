import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  AI_READABLE_KINDS,
  buildCapturePrompt,
  buildSignedContractPrompt,
  sanitizeCaptureAi,
  sanitizeSignedContractAi,
} from "./exclusive-captures-ai";

const MODEL = "gemini-flash-latest";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const Input = z.object({
  captureId: z.string().uuid(),
  storagePath: z.string().min(10).max(300),
  kind: z.enum(AI_READABLE_KINDS),
  scope: z.enum(["owner", "property"]),
});
const ContractInput = z.object({
  captureId: z.string().uuid(),
  storagePath: z.string().min(10).max(300),
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

type Supa = SupabaseClient;

/**
 * Baixa o documento pela RLS do próprio usuário (confere que é da captação e que ele enxerga) e
 * pergunta à mesma IA das Vendas (GEMINI_API_KEY, gemini-flash-latest). Uma nova tentativa em erro
 * 5xx ou JSON inválido. Nada do documento é gravado nem vai para o log.
 */
async function readWithGemini(
  supabase: Supa,
  args: { captureId: string; storagePath: string; kind?: string },
  system: string,
  prompt: string,
  maxOutputTokens: number,
): Promise<{ ok: true; raw: Record<string, unknown> } | { ok: false; error: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "Leitura por IA não configurada" };

  let q = supabase
    .from("exclusive_documents")
    .select("id, kind, file_name")
    .eq("capture_id", args.captureId)
    .eq("storage_path", args.storagePath);
  if (args.kind) q = q.eq("kind", args.kind);
  const { data: doc, error: docErr } = await q.maybeSingle();
  if (docErr || !doc) return { ok: false, error: "Documento não encontrado" };

  const { data: blob, error: dlErr } = await supabase.storage
    .from("exclusive-captures")
    .download(args.storagePath);
  if (dlErr || !blob) return { ok: false, error: "Falha ao baixar o documento" };

  const ext = (args.storagePath.split(".").pop() ?? "").toLowerCase();
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
        systemInstruction: { parts: [{ text: system }] },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }],
          },
        ],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens },
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
    try {
      return { ok: true, raw: await call() };
    } catch (err) {
      if (!(err as { retry?: boolean }).retry) throw err;
      return { ok: true, raw: await call() };
    }
  } catch (err) {
    // Sem conteúdo do documento no log: só o código do erro.
    console.error(`leitura IA da captação falhou (doc ${doc.id}):`, (err as Error).message);
    return { ok: false, error: "Não foi possível ler o documento por IA" };
  }
}

/**
 * Lê um documento da captação com a mesma IA das Vendas e devolve SUGESTÕES de campos.
 * O acesso ao arquivo passa pelo RLS do próprio usuário; nada do documento é gravado.
 */
export const extractCaptureDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const res = await readWithGemini(
      context.supabase as unknown as Supa,
      data,
      "Você extrai dados de documentos brasileiros (RG, CPF, CNH, comprovantes, IPTU, matrícula de imóvel). Responda APENAS com JSON válido.",
      buildCapturePrompt(data.kind, data.scope),
      4096,
    );
    if (!res.ok) return { ok: false as const, error: res.error };
    return { ok: true as const, values: sanitizeCaptureAi(res.raw, data.scope) };
  });

/**
 * Cadastro manual: lê o contrato de exclusividade JÁ ASSINADO (PDF ou foto) de uma vez — proprietários,
 * imóvel, prazo, comissão, foro e data de assinatura. Mesma IA/chave das Vendas; o resultado são
 * sugestões que o corretor confere. Se falhar, o preenchimento manual continua.
 */
export const extractSignedContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ContractInput.parse(input))
  .handler(async ({ data, context }) => {
    const res = await readWithGemini(
      context.supabase as unknown as Supa,
      { ...data, kind: "assinado" },
      "Você extrai dados de contratos imobiliários brasileiros. Responda APENAS com JSON válido.",
      buildSignedContractPrompt(),
      8192,
    );
    if (!res.ok) return { ok: false as const, error: res.error };
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
      new Date(),
    );
    return { ok: true as const, values: sanitizeSignedContractAi(res.raw, today) };
  });
