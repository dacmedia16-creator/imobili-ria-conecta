import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AI_TIMEOUT_MS, isAiTimeoutError } from "@/lib/ai-timeout";
import { geminiHttpError, isAiUnavailableError } from "@/lib/ai-indisponivel";
import { reportAiUnavailableSafe } from "@/lib/ai-indisponivel.server";
import {
  promptDoDocumento,
  SISTEMA_IA,
  sugestoesDoDocumento,
  tipoDoItem,
  type ErroLeitura,
  type GrupoDoc,
} from "@/lib/locacao-ia";

/**
 * Leitura de um documento da locação por IA (t_127811ca). MESMA IA e MESMA chave do módulo de Vendas
 * (GEMINI_API_KEY, gemini-flash-latest; chave no cabeçalho, nunca na URL), mesma regra de nova tentativa
 * (uma só, em 5xx ou JSON inválido) e mesmo aviso à plataforma quando a IA fica sem crédito/cota.
 *
 * 1) `locacao_leitura_preparar` com o login de quem clicou: o banco confere imobiliária, módulo, corretor, etapa
 *    e documento, e marca "IA lendo".
 * 2) O arquivo é baixado do bucket privado pela chave de serviço (o bucket não tem política para o navegador).
 * 3) A resposta da IA vira sugestões LIMPAS (locacao-ia.ts) e `locacao_leitura_gravar` (só service_role) preenche
 *    APENAS campo vazio. Nada do documento vai para o log: só o código do erro.
 * Se a IA falhar ou estiver fora do ar, o selo fica "IA falhou" e o corretor digita; a leitura nunca bloqueia.
 */
const MODEL = "gemini-flash-latest";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const BUCKET = "locacao-documentos";
const GRUPOS = new Set<GrupoDoc>([
  "locatario",
  "fiador",
  "proprietario",
  "caucao",
  "seguro_fianca",
  "outro",
]);

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

async function admin(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

export function lerJson(text: string): Record<string, unknown> | null {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  for (const c of [t, t.match(/\{[\s\S]*\}/)?.[0]]) {
    if (!c) continue;
    try {
      const p: unknown = JSON.parse(c);
      if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
    } catch {
      // tenta o próximo formato
    }
  }
  return null;
}

function mimeDe(path: string): string {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

export type ResultadoLeitura =
  | { ok: true; status: "ok"; preenchidos: number }
  | { ok: true; status: "sem_leitura" }
  | { ok: false; status: "falhou"; erro: ErroLeitura };

export const lerDocumentoLocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ documentoId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ResultadoLeitura> => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: prep, error } = await user.rpc("locacao_leitura_preparar", {
      _doc: data.documentoId,
    });
    if (error) throw new Error(error.message);
    const p = (prep ?? {}) as {
      path?: unknown;
      item?: unknown;
      grupo?: unknown;
      valores?: unknown;
    };
    const path = typeof p.path === "string" ? p.path : "";
    const item = typeof p.item === "string" ? p.item : "";
    const grupo: GrupoDoc = GRUPOS.has(p.grupo as GrupoDoc) ? (p.grupo as GrupoDoc) : "outro";
    const atuais: Record<string, string> = {};
    if (p.valores && typeof p.valores === "object")
      for (const [k, v] of Object.entries(p.valores as Record<string, unknown>))
        if (typeof v === "string") atuais[k] = v;
    if (!path || !item) throw new Error("Documento indisponível.");

    const sb = await admin();
    const gravar = async (
      status: "ok" | "falhou" | "sem_leitura",
      erro: ErroLeitura | null,
      sug = {},
    ) => {
      const { data: g, error: e } = await sb.rpc("locacao_leitura_gravar", {
        _doc: data.documentoId,
        _uid: context.userId,
        _status: status,
        _erro: erro,
        _sugestoes: sug,
      });
      if (e) throw new Error("Não foi possível registrar a leitura.");
      return Number((g as { preenchidos?: unknown } | null)?.preenchidos ?? 0) || 0;
    };

    const tipo = tipoDoItem(item);
    if (tipo === "outro") {
      await gravar("sem_leitura", null);
      return { ok: true, status: "sem_leitura" };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await gravar("falhou", "NAO_CONFIGURADA");
      return { ok: false, status: "falhou", erro: "NAO_CONFIGURADA" };
    }

    const { data: blob, error: dlErr } = await sb.storage.from(BUCKET).download(path);
    if (dlErr || !blob) {
      await gravar("falhou", "FALHA");
      return { ok: false, status: "falhou", erro: "FALHA" };
    }
    const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
    const prompt = promptDoDocumento(tipo, grupo, item);

    const chamar = async (): Promise<Record<string, unknown>> => {
      const res = await fetch(GEMINI_URL, {
        method: "POST",
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SISTEMA_IA }] },
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }, { inline_data: { mime_type: mimeDe(path), data: b64 } }],
            },
          ],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4096 },
        }),
      });
      if (!res.ok) {
        // Só o status: o corpo da resposta do Google não vai para log nem para o banco.
        const err = geminiHttpError(res.status);
        throw Object.assign(err, { retry: err.retryable });
      }
      const json = (await res.json()) as GeminiResponse;
      const parsed = lerJson(json.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
      if (!parsed) throw Object.assign(new Error("Resposta inválida da IA"), { retry: true });
      return parsed;
    };

    let raw: Record<string, unknown>;
    try {
      try {
        raw = await chamar();
      } catch (err) {
        // Tempo esgotado e 402/429 não repetem na hora.
        if (!(err as { retry?: boolean }).retry) throw err;
        raw = await chamar();
      }
    } catch (err) {
      let erro: ErroLeitura = "FALHA";
      if (isAiTimeoutError(err)) erro = "TEMPO";
      else if (isAiUnavailableError(err)) {
        erro = err.aiUnavailable;
        const { data: doc } = await sb
          .from("locacao_documentos")
          .select("organization_id")
          .eq("id", data.documentoId)
          .maybeSingle();
        const org = (doc as { organization_id?: string } | null)?.organization_id;
        if (org)
          await reportAiUnavailableSafe({
            orgId: org,
            userId: context.userId,
            origem: "locacao_documento",
            code: err.aiUnavailable,
            httpStatus: err.httpStatus,
            documentId: data.documentoId,
          });
      }
      console.error(`leitura IA da locação falhou (doc ${data.documentoId}): ${erro}`);
      await gravar("falhou", erro);
      return { ok: false, status: "falhou", erro };
    }

    const sug = sugestoesDoDocumento(tipo, grupo, raw, atuais);
    const preenchidos = await gravar("ok", null, sug);
    return { ok: true, status: "ok", preenchidos };
  });
