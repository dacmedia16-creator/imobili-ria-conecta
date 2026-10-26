import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// createServerFn vira uma função comum, no mesmo padrão de ai-timeout.test.ts. Nada vai para a rede:
// fetch e o Supabase de service_role são mocks.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (i: unknown) => unknown = (i) => i;
    const b = {
      middleware: () => b,
      validator: (v: (i: unknown) => unknown) => {
        validate = v;
        return b;
      },
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

const adminState = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; rows: unknown }>,
  failuresLastHour: 0,
  alertsLast6h: 0,
}));

/** service_role falso: grava inserts em memória e devolve contagens configuráveis. */
function fakeAdmin() {
  return {
    from(table: string) {
      const filtros: Record<string, unknown> = {};
      const q: Record<string, unknown> = {
        insert: async (rows: unknown) => {
          adminState.inserts.push({ table, rows });
          return { error: null };
        },
        select: () => q,
        eq: (col: string, val: unknown) => {
          filtros[col] = val;
          return q;
        },
        gte: () => q,
        in: () => q,
        then: (ok: (v: unknown) => unknown) => {
          if (table === "activity_logs") {
            const count =
              filtros.acao === "ia_alerta_plataforma"
                ? adminState.alertsLast6h
                : adminState.failuresLastHour;
            return ok({ count, error: null });
          }
          if (table === "platform_admins")
            return ok({ data: [{ user_id: "admin-1" }, { user_id: "admin-2" }], error: null });
          if (table === "profiles")
            return ok({
              data: [
                { id: "admin-1", organization_id: "org-plataforma" },
                { id: "admin-2", organization_id: "org-plataforma" },
              ],
              error: null,
            });
          return ok({ data: [], error: null });
        },
      };
      return q;
    },
  };
}

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin() }));

import {
  AI_ALERT_ACTION,
  AI_FAILURE_ACTION,
  AI_UNAVAILABLE_MESSAGE,
  aiUnavailableCode,
  geminiHttpError,
  isAiUnavailableError,
  shouldAlert,
} from "./ai-indisponivel";
import { reportAiUnavailable } from "./ai-indisponivel.server";
import { extractCaptureDocument, extractSignedContract } from "./exclusive-captures-ai.functions";
import { extractDocument } from "./documents.functions";

type Fn = (arg: { data: unknown; context: unknown }) => Promise<Record<string, unknown>>;

const CAPTURE_ID = "11111111-1111-4111-8111-111111111111";
const DOC_ID = "22222222-2222-4222-8222-222222222222";
const PATH = `${CAPTURE_ID}/rg-frente.jpg`;
const CHAVE = "chave-secreta-de-teste";

/** Supabase do usuário (RLS): devolve um documento e grava os upserts de document_extractions. */
function fakeUserSupabase() {
  const writes: Array<{ table: string; row: unknown }> = [];
  const client = {
    from(table: string) {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
      q.maybeSingle = async () => ({
        data:
          table === "sale_documents"
            ? {
                id: DOC_ID,
                sale_id: "33333333-3333-4333-8333-333333333333",
                organization_id: "org-1",
                storage_path: "org-1/venda/rg.jpg",
                file_name: "rg.jpg",
                tipo: "rg",
                parte: "comprador",
              }
            : { id: "doc-1", kind: "rg", file_name: "rg.jpg", organization_id: "org-1" },
        error: null,
      });
      q.update = (row: unknown) => {
        writes.push({ table, row });
        return { eq: async () => ({ error: null }) };
      };
      q.upsert = async (row: unknown) => {
        writes.push({ table, row });
        return { error: null };
      };
      return q;
    },
    storage: { from: () => ({ download: async () => ({ data: new Blob(["x"]), error: null }) }) },
  };
  return { client, writes };
}

function geminiStatus(status: number) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: status,
            status: "RESOURCE_EXHAUSTED",
            message: "Your prepayment credits are depleted.",
          },
        }),
        { status },
      ),
  );
}

function geminiOk(obj: unknown) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { finishReason: "STOP", content: { parts: [{ text: JSON.stringify(obj) }] } },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  );
}

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", CHAVE);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  adminState.inserts = [];
  adminState.failuresLastHour = 0;
  adminState.alertsLast6h = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const logsDeFalha = () =>
  adminState.inserts.filter(
    (i) => i.table === "activity_logs" && (i.rows as { acao: string }).acao === AI_FAILURE_ACTION,
  );
const avisos = () => adminState.inserts.filter((i) => i.table === "notifications");

describe("classificação 402/429", () => {
  it("402 = sem crédito, 429 = cota; outros não", () => {
    expect(aiUnavailableCode(402)).toBe("IA_SEM_CREDITO");
    expect(aiUnavailableCode(429)).toBe("IA_COTA_EXCEDIDA");
    expect(aiUnavailableCode(500)).toBeNull();
    expect(aiUnavailableCode(400)).toBeNull();
  });
  it("402/429 não repetem; 5xx repete", () => {
    const e402 = geminiHttpError(402, "x");
    expect(isAiUnavailableError(e402)).toBe(true);
    expect(e402.retryable).toBe(false);
    expect(e402.message.startsWith("IA_SEM_CREDITO: Gemini 402")).toBe(true);
    expect(geminiHttpError(429).retryable).toBe(false);
    const e503 = geminiHttpError(503);
    expect(isAiUnavailableError(e503)).toBe(false);
    expect(e503.retryable).toBe(true);
  });
  it("regra do aviso: 3+ falhas em 1h e nenhum aviso nas últimas 6h", () => {
    expect(shouldAlert(2, 0)).toBe(false);
    expect(shouldAlert(3, 0)).toBe(true);
    expect(shouldAlert(10, 1)).toBe(false);
  });
});

describe("Vendas: extractDocument", () => {
  it.each([
    [402, "IA_SEM_CREDITO"],
    [429, "IA_COTA_EXCEDIDA"],
  ])("HTTP %i: mensagem clara, motivo gravado sem a chave, 1 chamada só", async (status, code) => {
    const f = geminiStatus(status);
    vi.stubGlobal("fetch", f);
    const { client, writes } = fakeUserSupabase();
    const res = await (extractDocument as unknown as Fn)({
      data: { documentId: DOC_ID },
      context: { supabase: client, userId: "user-1" },
    });
    expect(res).toEqual({ ok: false, error: AI_UNAVAILABLE_MESSAGE, aiUnavailable: true });
    expect(f).toHaveBeenCalledTimes(1);
    const falhou = writes.find(
      (w) =>
        w.table === "document_extractions" && (w.row as { status: string }).status === "failed",
    )?.row as { error: string };
    expect(falhou.error.startsWith(`${code}: Gemini ${status}`)).toBe(true);
    expect(JSON.stringify(writes)).not.toContain(CHAVE);
    expect(logsDeFalha()).toHaveLength(1);
    expect((logsDeFalha()[0].rows as { payload: Record<string, unknown> }).payload).toMatchObject({
      codigo: code,
      http_status: status,
      origem: "vendas",
    });
    expect(JSON.stringify(adminState.inserts)).not.toContain(CHAVE);
  });

  it("sucesso: grava done e não registra falha", async () => {
    vi.stubGlobal("fetch", geminiOk({ nome: "Fulano de Tal" }));
    const { client, writes } = fakeUserSupabase();
    const res = await (extractDocument as unknown as Fn)({
      data: { documentId: DOC_ID },
      context: { supabase: client, userId: "user-1" },
    });
    expect(res.ok).toBe(true);
    expect(
      writes.some(
        (w) =>
          w.table === "document_extractions" && (w.row as { status: string }).status === "done",
      ),
    ).toBe(true);
    expect(adminState.inserts).toHaveLength(0);
  });

  it("erro 500 continua com a mensagem genérica (sem aiUnavailable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x", { status: 500 })),
    );
    const { client } = fakeUserSupabase();
    const res = await (extractDocument as unknown as Fn)({
      data: { documentId: DOC_ID },
      context: { supabase: client, userId: "user-1" },
    });
    expect(res.ok).toBe(false);
    expect(res.aiUnavailable).toBeUndefined();
    expect(adminState.inserts).toHaveLength(0);
  });
});

describe("Captação: documento e contrato assinado", () => {
  it.each([402, 429])(
    "documento, HTTP %i: aiUnavailable sem timedOut, então a tela usa o plano B local",
    async (status) => {
      const f = geminiStatus(status);
      vi.stubGlobal("fetch", f);
      const res = await (extractCaptureDocument as unknown as Fn)({
        data: { captureId: CAPTURE_ID, storagePath: PATH, kind: "rg", scope: "owner" },
        context: { supabase: fakeUserSupabase().client, userId: "user-1" },
      });
      // timedOut=false: a tela (exclusividades.$id) só pula o plano B no tempo esgotado.
      expect(res).toEqual({
        ok: false,
        error: AI_UNAVAILABLE_MESSAGE,
        timedOut: false,
        aiUnavailable: true,
      });
      expect(f).toHaveBeenCalledTimes(1);
      expect(logsDeFalha()).toHaveLength(1);
      expect((logsDeFalha()[0].rows as { payload: Record<string, unknown> }).payload.origem).toBe(
        "captacao_documento",
      );
    },
  );

  it("contrato assinado, HTTP 402: mensagem clara", async () => {
    vi.stubGlobal("fetch", geminiStatus(402));
    const res = await (extractSignedContract as unknown as Fn)({
      data: { captureId: CAPTURE_ID, storagePath: `${CAPTURE_ID}/contrato.pdf` },
      context: { supabase: fakeUserSupabase().client, userId: "user-1" },
    });
    expect(res).toMatchObject({ ok: false, error: AI_UNAVAILABLE_MESSAGE, aiUnavailable: true });
    expect((logsDeFalha()[0].rows as { payload: Record<string, unknown> }).payload.origem).toBe(
      "captacao_contrato",
    );
  });

  it("documento, sucesso: devolve os campos, sem registrar falha", async () => {
    vi.stubGlobal("fetch", geminiOk({ nome: "Fulano de Tal" }));
    const res = await (extractCaptureDocument as unknown as Fn)({
      data: { captureId: CAPTURE_ID, storagePath: PATH, kind: "rg", scope: "owner" },
      context: { supabase: fakeUserSupabase().client, userId: "user-1" },
    });
    expect(res.ok).toBe(true);
    expect(adminState.inserts).toHaveLength(0);
  });
});

describe("aviso aos administradores da plataforma", () => {
  const ev = {
    orgId: "org-1",
    userId: "user-1",
    origem: "vendas" as const,
    code: "IA_SEM_CREDITO" as const,
    httpStatus: 402,
    documentId: DOC_ID,
  };
  const admin = () => fakeAdmin() as never;

  it("2 falhas na hora: só registra, sem aviso", async () => {
    adminState.failuresLastHour = 2;
    expect(await reportAiUnavailable(admin(), ev)).toEqual({ alerted: false });
    expect(avisos()).toHaveLength(0);
  });

  it("3 falhas na hora e nenhum aviso em 6h: avisa no sino cada super admin e marca", async () => {
    adminState.failuresLastHour = 3;
    expect(await reportAiUnavailable(admin(), ev)).toEqual({ alerted: true });
    const rows = avisos()[0].rows as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.user_id)).toEqual(["admin-1", "admin-2"]);
    expect(rows[0]).toMatchObject({
      tipo: "ia_leitura_indisponivel",
      organization_id: "org-plataforma",
    });
    expect(String(rows[0].mensagem)).toContain("402");
    expect(
      adminState.inserts.some(
        (i) => i.table === "activity_logs" && (i.rows as { acao: string }).acao === AI_ALERT_ACTION,
      ),
    ).toBe(true);
  });

  it("já avisou nas últimas 6h: não repete", async () => {
    adminState.failuresLastHour = 9;
    adminState.alertsLast6h = 1;
    expect(await reportAiUnavailable(admin(), ev)).toEqual({ alerted: false });
    expect(avisos()).toHaveLength(0);
  });

  it("nunca lança: falha do banco vira alerted=false", async () => {
    const quebrado = {
      from: () => {
        throw new Error("banco fora");
      },
    } as never;
    await expect(reportAiUnavailable(quebrado, ev)).resolves.toEqual({ alerted: false });
  });
});
