import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// createServerFn vira uma função comum (valida a entrada e chama o handler), para testar a lógica
// das server functions sem subir o servidor. Nada vai para a rede: fetch é mock.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (i: unknown) => unknown = (i) => i;
    const b = {
      middleware: () => b,
      inputValidator: (v: (i: unknown) => unknown) => {
        validate = v;
        return b;
      },
      handler:
        (h: (a: { data: unknown; context: unknown }) => unknown) =>
        (arg: { data: unknown; context: unknown }) =>
          h({ data: validate(arg.data), context: arg.context }),
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

import { AI_TIMEOUT_MESSAGE, AI_TIMEOUT_MS, isAiTimeoutError } from "./ai-timeout";
import { extractCaptureDocument, extractSignedContract } from "./exclusive-captures-ai.functions";
import { suggestOwnerRecommendation } from "./owner-feedback.functions";

type Fn = (arg: { data: unknown; context: unknown }) => Promise<Record<string, unknown>>;

const CAPTURE_ID = "11111111-1111-4111-8111-111111111111";
const PATH = `${CAPTURE_ID}/rg-frente.jpg`;

/** Cliente Supabase falso: devolve um documento e um arquivo pequeno; aceita qualquer filtro. */
function fakeSupabase(rows: unknown[] = []) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
  q.maybeSingle = async () => ({
    data: { id: "doc-1", kind: "rg", file_name: "rg.jpg" },
    error: null,
  });
  q.then = (ok: (v: unknown) => unknown) => ok({ data: rows, error: null });
  return {
    from: () => q,
    storage: { from: () => ({ download: async () => ({ data: new Blob(["x"]), error: null }) }) },
  };
}

/** fetch que só termina quando o sinal aborta (simula a IA travada). */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        const s = init?.signal;
        if (!s) return; // sem sinal: ficaria pendurado para sempre (o defeito antigo)
        if (s.aborted) return rej(s.reason);
        s.addEventListener("abort", () => rej(s.reason));
      }),
  );
}

function geminiOk(text: string) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

describe("tempo-limite da IA (MÉDIO-2)", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "teste");
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Encurta o tempo-limite real para o teste não esperar 25 s, mas confere o valor pedido.
    const real = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      expect(ms).toBe(AI_TIMEOUT_MS);
      return real(20);
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("usa 25 segundos e reconhece TimeoutError/AbortError", () => {
    expect(AI_TIMEOUT_MS).toBe(25_000);
    expect(isAiTimeoutError(new DOMException("t", "TimeoutError"))).toBe(true);
    expect(isAiTimeoutError(new DOMException("a", "AbortError"))).toBe(true);
    expect(isAiTimeoutError(new Error("Gemini 500"))).toBe(false);
    expect(isAiTimeoutError(null)).toBe(false);
  });

  it("leitura de documento da captação: estoura, não repete e devolve a mensagem", async () => {
    const f = hangingFetch();
    vi.stubGlobal("fetch", f);
    const res = await (extractCaptureDocument as unknown as Fn)({
      data: { captureId: CAPTURE_ID, storagePath: PATH, kind: "rg", scope: "owner" },
      context: { supabase: fakeSupabase() },
    });
    expect(res).toEqual({ ok: false, error: AI_TIMEOUT_MESSAGE, timedOut: true });
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("leitura do contrato assinado: estoura e devolve a mensagem", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const res = await (extractSignedContract as unknown as Fn)({
      data: { captureId: CAPTURE_ID, storagePath: `${CAPTURE_ID}/contrato.pdf` },
      context: { supabase: fakeSupabase() },
    });
    expect(res).toEqual({ ok: false, error: AI_TIMEOUT_MESSAGE, timedOut: true });
  });

  it("leitura de documento com IA respondendo: devolve os campos (mock)", async () => {
    vi.stubGlobal("fetch", geminiOk(JSON.stringify({ nome: "Fulano de Tal" })));
    const res = await (extractCaptureDocument as unknown as Fn)({
      data: { captureId: CAPTURE_ID, storagePath: PATH, kind: "rg", scope: "owner" },
      context: { supabase: fakeSupabase() },
    });
    expect(res.ok).toBe(true);
    expect(res).toHaveProperty("values");
  });

  it("erro 500 da IA continua com a mensagem antiga (sem timedOut)", async () => {
    const f = vi.fn(async () => new Response("x", { status: 500 }));
    vi.stubGlobal("fetch", f);
    const res = await (extractCaptureDocument as unknown as Fn)({
      data: { captureId: CAPTURE_ID, storagePath: PATH, kind: "rg", scope: "owner" },
      context: { supabase: fakeSupabase() },
    });
    expect(res).toEqual({
      ok: false,
      error: "Não foi possível ler o documento por IA",
      timedOut: false,
    });
    expect(f).toHaveBeenCalledTimes(2); // 5xx mantém a nova tentativa
  });

  it("sugestão do Feedback ao proprietário: estoura e devolve a mensagem", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const rows = [
      {
        portal: "zap",
        collected_on: "2026-10-01",
        listing_code: "ABC123",
        broker_id: "b1",
        window_kind: "7d",
        window_from: "2026-09-24",
        window_to: "2026-10-01",
        impressions: 100,
        views: 10,
        contacts: 1,
        error: null,
      },
    ];
    const res = await (suggestOwnerRecommendation as unknown as Fn)({
      data: { code: "ABC123" },
      context: { supabase: fakeSupabase(rows) },
    });
    expect(res).toEqual({ ok: false, error: AI_TIMEOUT_MESSAGE });
  });
});
