// Clicksign (captação) — testes só com mock: nenhuma rede, nenhum token real, e-mails fictícios.
import { describe, expect, it, vi } from "vitest";
import {
  buildCaptureSigners,
  buildEnvelope,
  ClicksignClient,
  constantTimeEqual,
  deadlineIso,
  hmacSha256Hex,
  safeDownloadUrl,
  sha256Hex,
  verifyContentHmac,
} from "../../supabase/functions/_shared/clicksign.ts";
import { handleSend, type SendDeps } from "../../supabase/functions/clicksign-send/core.ts";
import {
  handleWebhook,
  type WebhookDeps,
} from "../../supabase/functions/clicksign-webhook/core.ts";
import { canStartEnvelope, envelopeStatusLabel, sendDialogErrors } from "./exclusive-clicksign";

const CAP = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const IMOB_A = "33333333-3333-4333-8333-333333333333";
const IMOB_B = "44444444-4444-4444-8444-444444444444";
const DOC = "55555555-5555-4555-8555-555555555555";
const form = {
  proprietario_1: { nome_completo: "Ana Teste Silva", email: "ana@example.com" },
  proprietario_2: { nome_completo: "", email: "" },
};
const testemunhas = [
  { nome: "Tânia Testemunha", email: "t1@example.com" },
  { nome: "Otávio Testemunha", email: "t2@example.com" },
];
const corretor = { nome: "Carlos Corretor", email: "corretor@example.com" };
const imobList = [
  { id: IMOB_A, nome: "Vera Imobiliária", email: "vera@example.com" },
  { id: IMOB_B, nome: "Ivo Imobiliária", email: "ivo@example.com" },
];

/** Fetch falso da Clicksign: registra as chamadas e devolve ids; pode falhar num passo. */
function fakeClicksign(failOn?: string) {
  const calls: Array<{ method: string; path: string; auth: string | null }> = [];
  let n = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace(/^https:\/\/[^/]+\/api\/v3/, "");
    const method = init.method ?? "GET";
    const auth = (init.headers as Record<string, string>).Authorization ?? null;
    calls.push({ method, path, auth });
    const key = `${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`;
    if (failOn && key === failOn) {
      return new Response(JSON.stringify({ errors: [{ detail: "inválido x@example.com" }] }), {
        status: 422,
      });
    }
    if (method === "DELETE") return new Response(null, { status: 204 });
    n += 1;
    const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    return new Response(JSON.stringify({ data: { id } }), { status: 201 });
  });
  return { fetch, calls };
}

function sendDeps(over: Partial<SendDeps> = {}, failOn?: string) {
  const cs = fakeClicksign(failOn);
  const updates: Array<Record<string, unknown>> = [];
  const deps: SendDeps = {
    actorId: "actor",
    fetch: cs.fetch,
    authorize: vi.fn(async () => ORG),
    loadContext: vi.fn(async () => ({
      organizationId: ORG,
      form,
      corretor,
      imobiliaria: imobList,
      testMode: false,
      allowlistSha256: [],
      deadlineDays: 30,
      token: "tok-fake",
      gerado: { id: DOC, fileName: "c.pdf" },
    })),
    loadPdf: vi.fn(async () => new TextEncoder().encode("%PDF-1.4 TESTE")),
    insertEnvelope: vi.fn(async () => "row-1"),
    updateEnvelope: vi.fn(async (_id, patch) => {
      updates.push(patch);
    }),
    markSent: vi.fn(async () => undefined),
    ...over,
  };
  return { deps, cs, updates };
}
const body = { capture_id: CAP, imobiliaria_ids: [IMOB_A], testemunhas };

describe("signatários da captação", () => {
  it("monta proprietário, corretor, imobiliária e 2 testemunhas; proprietário 2 vazio fica de fora", () => {
    const r = buildCaptureSigners({ form, corretor, imobiliaria: [imobList[0]], testemunhas });
    expect(r.errors).toEqual([]);
    expect(r.signers.map((s) => s.papel)).toEqual([
      "proprietario_1",
      "corretor",
      "imobiliaria",
      "testemunha",
      "testemunha",
    ]);
  });
  it("exige 2 testemunhas, 1+ da imobiliária, e-mails válidos e sem repetição", () => {
    const r = buildCaptureSigners({
      form: { proprietario_1: { nome_completo: "Ana", email: "corretor@example.com" } },
      corretor,
      imobiliaria: [],
      testemunhas: [testemunhas[0]],
    });
    expect(r.errors).toEqual(
      expect.arrayContaining([
        "Proprietário 1: informe nome e sobrenome",
        "Escolha ao menos 1 pessoa para assinar pela imobiliária",
        "Informe exatamente 2 testemunhas",
        expect.stringMatching(/mesma pessoa/),
      ]),
    );
    expect(r.errors.join(" ")).not.toMatch(/@/);
  });
  it("a tela aplica as mesmas regras e trava o botão", () => {
    expect(
      sendDialogErrors({ form, corretorEmailOk: true, imobiliariaIds: [IMOB_A], testemunhas }),
    ).toEqual([]);
    const errs = sendDialogErrors({
      form,
      corretorEmailOk: false,
      imobiliariaIds: [],
      testemunhas: [testemunhas[0], { nome: "Tânia Outra", email: "t1@example.com" }],
    });
    expect(errs).toEqual(
      expect.arrayContaining([
        "Corretor: o cadastro do captador está sem e-mail",
        "Escolha ao menos 1 pessoa para assinar pela imobiliária",
        expect.stringMatching(/Testemunha 1 e Testemunha 2/),
      ]),
    );
  });
  it("status do envelope e reenvio", () => {
    const base = { is_test: true, created_at: "", error_code: null, signed: false };
    expect(canStartEnvelope(null)).toBe(true);
    expect(canStartEnvelope({ ...base, status: "running" })).toBe(false);
    expect(canStartEnvelope({ ...base, status: "error" })).toBe(true);
    expect(envelopeStatusLabel({ ...base, status: "running" })).toMatch(/TESTE/);
  });
});

describe("HMAC, prazo e URL do assinado", () => {
  it("Content-Hmac sha256 confere e rejeita alterado", async () => {
    const raw = new TextEncoder().encode('{"event":{"name":"sign"}}');
    const h = await hmacSha256Hex("segredo", raw);
    expect(await verifyContentHmac(raw, `sha256=${h}`, "segredo")).toBe(true);
    expect(await verifyContentHmac(raw, `sha256=${h}`, "outro")).toBe(false);
    expect(await verifyContentHmac(raw, h, "segredo")).toBe(false);
    expect(await verifyContentHmac(raw, null, "segredo")).toBe(false);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
  });
  it("prazo de 30 dias limitado a 1..90", () => {
    const now = new Date("2026-10-18T00:00:00Z");
    expect(deadlineIso(30, now)).toBe("2026-11-17T00:00:00.000Z");
    expect(deadlineIso(500, now)).toBe("2027-01-16T00:00:00.000Z");
  });
  it("só baixa o assinado de host Clicksign/S3 via https", () => {
    expect(safeDownloadUrl("https://app.clicksign.com/x.pdf")).not.toBeNull();
    expect(safeDownloadUrl("https://bucket.s3.amazonaws.com/x.pdf")).not.toBeNull();
    expect(safeDownloadUrl("http://app.clicksign.com/x.pdf")).toBeNull();
    expect(safeDownloadUrl("https://evil.example.com/x.pdf")).toBeNull();
    expect(safeDownloadUrl("https://clicksign.com.evil.io/x.pdf")).toBeNull();
  });
});

describe("cliente v3", () => {
  it("Authorization sem Bearer; rascunho sem ativação não faz PATCH", async () => {
    const cs = fakeClicksign();
    const client = new ClicksignClient("tok-fake", cs.fetch);
    const r = await buildEnvelope(
      client,
      {
        name: "TESTE",
        deadlineAt: deadlineIso(30),
        filename: "t.pdf",
        pdf: new Uint8Array([37, 80, 68, 70]),
        metadata: {},
        signers: [{ papel: "corretor", nome: "Carlos Corretor", email: "c@example.com" }],
      },
      { activate: false },
    );
    expect(r.activated).toBe(false);
    expect(cs.calls.every((c) => c.auth === "tok-fake")).toBe(true);
    expect(cs.calls.some((c) => c.method === "PATCH")).toBe(false);
    // envelope, documento, 1 signatário, 2 requisitos (qualificação + código por e-mail)
    expect(cs.calls.map((c) => c.method)).toEqual(["POST", "POST", "POST", "POST", "POST"]);
  });
});

describe("clicksign-send (core)", () => {
  it("envia: cria tudo, ativa, marca enviado; signatários guardados só com hash", async () => {
    const { deps, cs } = sendDeps();
    const r = await handleSend(deps, body);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, signers: 5 });
    expect(cs.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    // Ativar não envia e-mail na v3: notifica os signatários logo depois da ativação, uma vez.
    const keys = cs.calls.map((c) => `${c.method} ${c.path.replace(/[0-9a-f-]{36}/g, ":id")}`);
    expect(keys.slice(-2)).toEqual(["PATCH /envelopes/:id", "POST /envelopes/:id/notifications"]);
    expect(keys.filter((k) => k.endsWith("/notifications"))).toHaveLength(1);
    expect(r.body).not.toHaveProperty("warning");
    expect(deps.markSent).toHaveBeenCalledWith("row-1");
    const row = (deps.insertEnvelope as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(JSON.stringify(row)).not.toMatch(/@/);
    expect(row.signers[0].email_sha256).toBe(await sha256Hex("ana@example.com"));
  });
  it("captação inválida, não autorizado, sem chave", async () => {
    expect((await handleSend(sendDeps().deps, { capture_id: "x" })).status).toBe(400);
    const denied = sendDeps({
      authorize: vi.fn(async () => {
        throw new Error("Apenas gestor, jurídico ou admin");
      }),
    });
    expect(await handleSend(denied.deps, body)).toMatchObject({ status: 403 });
    expect(denied.cs.fetch).not.toHaveBeenCalled();
    const { deps } = sendDeps();
    const ctx = await deps.loadContext(ORG, CAP);
    deps.loadContext = vi.fn(async () => ({ ...ctx, token: null }));
    expect((await handleSend(deps, body)).status).toBe(503);
  });
  it("recusa signatário da imobiliária fora da lista e dados incompletos (422) sem chamar a API", async () => {
    const a = sendDeps();
    const r1 = await handleSend(a.deps, {
      ...body,
      imobiliaria_ids: ["99999999-9999-4999-8999-999999999999"],
    });
    expect(r1.status).toBe(422);
    const r2 = await handleSend(a.deps, { ...body, testemunhas: [testemunhas[0]] });
    expect(r2.status).toBe(422);
    expect(a.cs.fetch).not.toHaveBeenCalled();
  });
  it("modo teste: bloqueia e-mail fora da allowlist; libera quando todos estão nela", async () => {
    const { deps, cs } = sendDeps();
    const ctx = await deps.loadContext(ORG, CAP);
    deps.loadContext = vi.fn(async () => ({ ...ctx, testMode: true, allowlistSha256: [] }));
    expect((await handleSend(deps, body)).status).toBe(422);
    expect(cs.fetch).not.toHaveBeenCalled();
    const all = await Promise.all(
      [
        "ana@example.com",
        "corretor@example.com",
        "vera@example.com",
        "t1@example.com",
        "t2@example.com",
      ].map((e) => sha256Hex(e)),
    );
    deps.loadContext = vi.fn(async () => ({ ...ctx, testMode: true, allowlistSha256: all }));
    const ok = await handleSend(deps, body);
    expect(ok).toMatchObject({ status: 200, body: { is_test: true } });
  });
  it("409 quando já existe envio em andamento", async () => {
    const { deps, cs } = sendDeps({
      insertEnvelope: vi.fn(async () => {
        throw new Error("duplicate");
      }),
    });
    expect((await handleSend(deps, body)).status).toBe(409);
    expect(cs.fetch).not.toHaveBeenCalled();
  });
  it("falha no meio: exclui o rascunho, marca erro e não ativa", async () => {
    const { deps, cs, updates } = sendDeps({}, "POST /envelopes/:id/signers");
    const r = await handleSend(deps, body);
    expect(r.status).toBe(502);
    expect(r.body.code).toBe("signer:422");
    expect(JSON.stringify(r.body)).not.toMatch(/x@example\.com/);
    expect(cs.calls.some((c) => c.method === "DELETE")).toBe(true);
    expect(cs.calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(updates.at(-1)).toMatchObject({ status: "error", error_code: "signer:422" });
    expect(deps.markSent).not.toHaveBeenCalled();
  });
  it("document_key é gravado antes da ativação", async () => {
    const { deps, cs, updates } = sendDeps();
    const order: string[] = [];
    const baseFetch = cs.fetch.getMockImplementation()!;
    deps.fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === "PATCH") order.push("activate");
      return baseFetch(url, init);
    });
    deps.updateEnvelope = vi.fn(async (_id, patch) => {
      if ("document_key" in patch) order.push("document_key");
      updates.push(patch);
    });
    expect((await handleSend(deps, body)).status).toBe(200);
    expect(order).toEqual(["document_key", "activate"]);
  });
  it("markSent falha DEPOIS da ativação: não marca erro, não diz 'nada foi enviado', bloqueia reenvio", async () => {
    const { deps, cs, updates } = sendDeps({
      markSent: vi.fn(async () => {
        throw new Error("db fora");
      }),
    });
    const r = await handleSend(deps, body);
    expect(cs.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(cs.calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, warning: expect.stringMatching(/Não reenvie/) });
    expect(JSON.stringify(r.body)).not.toMatch(/Nada foi enviado/i);
    expect(updates.some((u) => u.status === "error")).toBe(false);
    expect(updates.some((u) => typeof u.document_key === "string")).toBe(true);
    expect(updates.at(-1)).toMatchObject({
      status: "running",
      error_code: "post_activate:mark_sent",
    });
    expect(
      canStartEnvelope({
        status: "running",
        is_test: false,
        created_at: "",
        error_code: "post_activate:mark_sent",
        signed: false,
      }),
    ).toBe(false);
  });
  it("ativação falha e o DELETE também: activate_unknown, fica 'sending' e o reenvio segue bloqueado", async () => {
    const { deps, cs, updates } = sendDeps({}, "PATCH /envelopes/:id");
    const baseFetch = cs.fetch.getMockImplementation()!;
    deps.fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === "DELETE") return new Response("{}", { status: 403 });
      return baseFetch(url, init);
    });
    const r = await handleSend(deps, body);
    expect(r.status).toBe(502);
    expect(r.body.code).toBe("activate_unknown");
    expect(JSON.stringify(r.body)).not.toMatch(/Nada foi enviado/i);
    expect(r.body.error).toMatch(/Não reenvie/);
    expect(updates.some((u) => u.status === "error")).toBe(false);
    expect(updates.at(-1)).toMatchObject({ error_code: "activate_unknown" });
    expect(updates.at(-1)).not.toHaveProperty("status");
    expect(deps.markSent).not.toHaveBeenCalled();
    const env = {
      status: "sending" as const,
      is_test: false,
      created_at: "",
      error_code: "activate_unknown",
      signed: false,
    };
    expect(canStartEnvelope(env)).toBe(false);
    expect(envelopeStatusLabel(env)).toMatch(/Não reenvie/);
  });
  it("ativação falha mas o rascunho é excluído: erro normal, reenvio liberado", async () => {
    const { deps, cs, updates } = sendDeps({}, "PATCH /envelopes/:id");
    const r = await handleSend(deps, body);
    expect(r.status).toBe(502);
    expect(r.body.code).toBe("activate:422");
    expect(cs.calls.some((c) => c.method === "DELETE")).toBe(true);
    expect(cs.calls.some((c) => c.path.endsWith("/notifications"))).toBe(false);
    expect(updates.at(-1)).toMatchObject({ status: "error" });
  });
  it("notificação falha DEPOIS da ativação: não reverte, não libera reenvio, registra e avisa", async () => {
    const { deps, cs, updates } = sendDeps({}, "POST /envelopes/:id/notifications");
    const r = await handleSend(deps, body);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      ok: true,
      status: "running",
      code: "notify_failed:notify:422",
      warning: "Enviado, mas a notificação falhou; use “Reenviar aviso” na captação.",
    });
    expect(JSON.stringify(r.body)).not.toMatch(/@/);
    expect(cs.calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(cs.calls.filter((c) => c.path.endsWith("/notifications"))).toHaveLength(1);
    expect(deps.markSent).toHaveBeenCalledWith("row-1");
    expect(updates.some((u) => u.status === "error")).toBe(false);
    expect(updates.at(-1)).toMatchObject({ error_code: "notify_failed:notify:422" });
    expect(updates.at(-1)).not.toHaveProperty("status");
    const env = {
      status: "running" as const,
      is_test: false,
      created_at: "",
      error_code: "notify_failed:notify:422",
      signed: false,
    };
    expect(canStartEnvelope(env)).toBe(false);
    expect(envelopeStatusLabel(env)).toMatch(/notificação falhou; use “Reenviar aviso”/);
  });
  it("notificação 201 com algum signatário notified=false conta como falha parcial", async () => {
    const { deps, cs } = sendDeps();
    const baseFetch = cs.fetch.getMockImplementation()!;
    deps.fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/notifications")) {
        const summary = [
          { signer_id: "a", notified: true },
          { signer_id: "b", notified: false },
        ];
        return new Response(JSON.stringify({ data: { attributes: { summary } } }), {
          status: 201,
        });
      }
      return baseFetch(url, init);
    });
    const r = await handleSend(deps, body);
    expect(r).toMatchObject({
      status: 200,
      body: { ok: true, code: "notify_failed:notify:partial" },
    });
  });
  it("notificação e markSent falham: aviso junta as duas mensagens, segue bloqueado", async () => {
    const { deps, updates } = sendDeps(
      {
        markSent: vi.fn(async () => {
          throw new Error("db fora");
        }),
      },
      "POST /envelopes/:id/notifications",
    );
    const r = await handleSend(deps, body);
    expect(r.status).toBe(200);
    expect(r.body.warning).toMatch(/Não reenvie/);
    expect(r.body.warning).toMatch(/notificação falhou/);
    expect(updates.at(-1)).toMatchObject({
      status: "running",
      error_code: "post_activate:mark_sent|notify_failed:notify:422",
    });
  });
});

describe("clicksign-webhook (core)", () => {
  const SLUG = "a".repeat(32);
  const SECRET = "segredo-webhook";
  const DOCKEY = "66666666-6666-4666-8666-666666666666";
  const env = {
    id: "row-1",
    envelope_key: "77777777-7777-4777-8777-777777777777",
    document_key: DOCKEY,
    capture_id: CAP,
    organization_id: ORG,
  };
  function hookDeps(opts: { seen?: boolean; pdf?: string; attach?: string } = {}) {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("/api/v3/")) {
        return new Response(
          JSON.stringify({
            data: { links: { files: { signed: "https://app.clicksign.com/s.pdf" } } },
          }),
          { status: 200 },
        );
      }
      return new Response(opts.pdf ?? "%PDF-1.7 assinado", { status: 200 });
    });
    const deps: WebhookDeps = {
      fetch,
      findOrg: vi.fn(async (s) =>
        s === SLUG ? { organizationId: ORG, secret: SECRET, token: "tok-fake" } : null,
      ),
      recordEvent: vi.fn(async () => ({ id: 1, fresh: !opts.seen })),
      finishEvent: vi.fn(async () => undefined),
      findEnvelope: vi.fn(async () => env),
      updateEnvelope: vi.fn(async () => undefined),
      storePdf: vi.fn(async () => `${ORG}/${CAP}/88888888-8888-4888-8888-888888888888.pdf`),
      attachSigned: vi.fn(async () => opts.attach ?? "attached"),
      removeObject: vi.fn(async () => undefined),
    };
    return deps;
  }
  async function signed(payload: unknown, secret = SECRET) {
    const raw = new TextEncoder().encode(JSON.stringify(payload));
    return { raw, hmac: `sha256=${await hmacSha256Hex(secret, raw)}` };
  }
  const closed = { event: { name: "document_closed" }, document: { key: DOCKEY } };

  it("HMAC inválido ou slug desconhecido: 401 sem registrar", async () => {
    const deps = hookDeps();
    const bad = await signed(closed, "errado");
    expect((await handleWebhook(deps, SLUG, bad.raw, { hmac: bad.hmac, event: null })).status).toBe(
      401,
    );
    const ok = await signed(closed);
    expect(
      (await handleWebhook(deps, "b".repeat(32), ok.raw, { hmac: ok.hmac, event: null })).status,
    ).toBe(401);
    expect((await handleWebhook(deps, "../x", ok.raw, { hmac: ok.hmac, event: null })).status).toBe(
      404,
    );
    expect(deps.recordEvent).not.toHaveBeenCalled();
  });
  it("evento repetido é ignorado (idempotência)", async () => {
    const deps = hookDeps({ seen: true });
    const s = await signed(closed);
    const r = await handleWebhook(deps, SLUG, s.raw, { hmac: s.hmac, event: null });
    expect(r.body).toMatchObject({ duplicate: true });
    expect(deps.storePdf).not.toHaveBeenCalled();
  });
  it("document_closed baixa o PDF e anexa como assinado (sem aprovar)", async () => {
    const deps = hookDeps();
    const s = await signed(closed);
    const r = await handleWebhook(deps, SLUG, s.raw, { hmac: s.hmac, event: null });
    expect(r).toMatchObject({ status: 200, body: { result: "signed:attached" } });
    expect(deps.attachSigned).toHaveBeenCalledWith(
      "row-1",
      expect.any(String),
      "contrato-assinado-clicksign.pdf",
    );
    expect(deps.removeObject).not.toHaveBeenCalled();
  });
  it("arquivo que não é PDF não é anexado (502 para a Clicksign reenviar)", async () => {
    const deps = hookDeps({ pdf: "<html>" });
    const s = await signed(closed);
    expect((await handleWebhook(deps, SLUG, s.raw, { hmac: s.hmac, event: null })).status).toBe(
      502,
    );
    expect(deps.storePdf).not.toHaveBeenCalled();
  });
  it("anexo recusado (captação devolvida) apaga o arquivo gravado", async () => {
    const deps = hookDeps({ attach: "stale" });
    const s = await signed(closed);
    await handleWebhook(deps, SLUG, s.raw, { hmac: s.hmac, event: null });
    expect(deps.removeObject).toHaveBeenCalled();
  });
  it("cancelamento marca o envelope como cancelado", async () => {
    const deps = hookDeps();
    const s = await signed({ event: { name: "cancel" }, document: { key: DOCKEY } });
    const r = await handleWebhook(deps, SLUG, s.raw, { hmac: s.hmac, event: null });
    expect(r.body.result).toBe("envelope:cancel");
    expect(deps.updateEnvelope).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({ status: "canceled" }),
    );
  });
});
