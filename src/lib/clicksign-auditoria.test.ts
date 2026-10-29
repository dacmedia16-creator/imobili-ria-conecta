// Pacote de correções da auditoria Clicksign (t_eb3f23e0) — só mock: sem rede, sem chamada real à
// Clicksign, e-mails fictícios (example.com) e CPF de teste.
import { describe, expect, it, vi } from "vitest";
import {
  buildEnvelope,
  ClicksignClient,
  MAX_CLICKSIGN_FILE_BYTES,
  rateLimitWaitMs,
  sanitizeErrorDetail,
  sendFailure,
  ClicksignError,
} from "../../supabase/functions/_shared/clicksign.ts";
import {
  handleReconcile,
  type ReconcileDeps,
} from "../../supabase/functions/_shared/clicksign-reconcile.ts";
import { handleSale, type SaleDeps } from "../../supabase/functions/clicksign-sale/core.ts";
import { handleSend, type SendDeps } from "../../supabase/functions/clicksign-send/core.ts";
import {
  handleWebhook,
  type WebhookDeps,
} from "../../supabase/functions/clicksign-webhook/core.ts";
import { hmacSha256Hex } from "../../supabase/functions/_shared/clicksign.ts";
import { canReconcile, saleEnvelopeStatusLabel, saleSendCheck } from "./sale-clicksign";
import { envelopeStatusLabel, sendDialogErrors } from "./exclusive-clicksign";

const SALE = "22222222-2222-4222-8222-222222222222";
const CAP = "11111111-1111-4111-8111-111111111111";
const ORG = "00000000-0000-4000-8000-000000000001";
const DOC = "66666666-6666-4666-8666-666666666666";
const ENV = "77777777-7777-4777-8777-777777777777";
const IMOB = "33333333-3333-4333-8333-333333333333";
const BIG = MAX_CLICKSIGN_FILE_BYTES + 1;

type Route = (key: string, init: RequestInit) => Response | undefined;
/** Fetch falso: registra "MÉTODO /caminho" (ids viram :id) e responde pela rota ou 201 com id. */
function fake(route?: Route) {
  const calls: string[] = [];
  const bodies: Record<string, unknown> = {};
  let n = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace(/^https:\/\/[^/]+\/api\/v3/, "").replace(/\?.*$/, "");
    const key = `${init.method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`;
    calls.push(key);
    if (init.body) bodies[key] = JSON.parse(String(init.body));
    const r = route?.(key, init);
    if (r) return r;
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    n += 1;
    return Response.json(
      { data: { id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`, attributes: {} } },
      { status: 201 },
    );
  });
  return { fetch, calls, bodies };
}
const r429 = (reset: string | null) =>
  new Response(JSON.stringify({ errors: [{ detail: "Too Many Requests" }] }), {
    status: 429,
    headers: reset ? { "X-Rate-Limit-Reset": reset } : {},
  });

// ---------------------------------------------------------------- A) R6
describe("R6: prazo vencido com assinatura parcial", () => {
  it("createEnvelope envia deadline_partial_signature_action = canceled", async () => {
    const { fetch, bodies } = fake();
    await buildEnvelope(
      new ClicksignClient("tok-fake", fetch),
      {
        name: "Teste",
        deadlineAt: "2026-11-17T00:00:00.000Z",
        filename: "a.pdf",
        pdf: new TextEncoder().encode("%PDF-1.4"),
        metadata: {},
        signers: [],
      },
      { activate: false },
    );
    const attrs = (bodies["POST /envelopes"] as { data: { attributes: Record<string, unknown> } })
      .data.attributes;
    expect(attrs.deadline_partial_signature_action).toBe("canceled");
    expect(attrs.deadline_at).toBe("2026-11-17T00:00:00.000Z");
  });

  it("webhook: deadline e depois document_closed (padrão antigo) → RPC devolve stale, PDF removido, nada anexado", async () => {
    const secret = "segredo-de-teste-123456";
    const slug = "a".repeat(32);
    const removed: string[] = [];
    const attach = vi.fn(async () => "stale");
    const saleCanceled = vi.fn(async () => "canceled");
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("/documents/"))
        return Response.json({
          data: { links: { files: { signed: "https://app.clicksign.com/x.pdf" } } },
        });
      return new Response(new TextEncoder().encode("%PDF-1.7 parcial"), { status: 200 });
    });
    let ids = 0;
    const deps: WebhookDeps = {
      findOrg: async () => ({ organizationId: ORG, secret, token: "tok-fake" }),
      recordEvent: async () => ({ id: ++ids, fresh: true }),
      finishEvent: async () => undefined,
      findEnvelope: async () => ({
        id: "row-1",
        envelope_key: ENV,
        document_key: DOC,
        capture_id: null,
        organization_id: ORG,
        origem: "venda",
        sale_id: SALE,
      }),
      updateEnvelope: async () => undefined,
      storePdf: async () => "path/x.pdf",
      attachSigned: attach,
      removeObject: async (p: string) => {
        removed.push(p);
      },
      saleCanceled,
      fetch,
    };
    const post = async (name: string) => {
      const raw = new TextEncoder().encode(
        JSON.stringify({ event: { name, occurred_at: name }, document: { key: DOC } }),
      );
      return handleWebhook(deps, slug, raw, {
        hmac: `sha256=${await hmacSha256Hex(secret, raw)}`,
        event: name,
      });
    };
    expect((await post("deadline")).body.result).toBe("envelope:deadline:canceled");
    const closed = await post("document_closed");
    expect(closed.body.result).toBe("signed:stale");
    expect(attach).toHaveBeenCalledTimes(1);
    expect(removed).toEqual(["path/x.pdf"]);
  });
});

// ---------------------------------------------------------------- C) R4
describe("R4: nova tentativa em HTTP 429", () => {
  const NOW = 1_800_000_000_000;
  it("espera até o X-Rate-Limit-Reset (Unix s) e repete UMA vez", async () => {
    let first = true;
    const { fetch, calls } = fake((key) => {
      if (key === "POST /envelopes" && first) {
        first = false;
        return r429(String(NOW / 1000 + 4));
      }
      return undefined;
    });
    const sleep = vi.fn(async () => undefined);
    const c = new ClicksignClient("tok-fake", fetch, undefined, { sleep, now: () => NOW });
    const r = await c.createEnvelope({ name: "x" });
    expect(r.data.id).toBeTruthy();
    expect(calls).toEqual(["POST /envelopes", "POST /envelopes"]);
    expect(sleep).toHaveBeenCalledWith(4250);
  });
  it("429 de novo na repetição: falha com 429 (não insiste)", async () => {
    const { fetch, calls } = fake((key) => (key === "POST /envelopes" ? r429(null) : undefined));
    const sleep = vi.fn(async () => undefined);
    const c = new ClicksignClient("tok-fake", fetch, undefined, { sleep, now: () => NOW });
    await expect(c.createEnvelope({ name: "x" })).rejects.toMatchObject({ status: 429 });
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(3000);
  });
  it("reset acima do teto (10 s): não repete", async () => {
    const { fetch, calls } = fake(() => r429(String(NOW / 1000 + 60)));
    const sleep = vi.fn(async () => undefined);
    const c = new ClicksignClient("tok-fake", fetch, undefined, { sleep, now: () => NOW });
    await expect(c.getEnvelope(ENV)).rejects.toMatchObject({ status: 429 });
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });
  it("5xx e erro de rede NUNCA são repetidos (estado incerto, poderia duplicar)", async () => {
    const { fetch, calls } = fake(() => new Response("x", { status: 503 }));
    const c = new ClicksignClient("tok-fake", fetch, undefined, { sleep: async () => undefined });
    await expect(c.activate(ENV)).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(1);
  });
  it("orçamento de espera por envio: depois de ~20 s esperando, para de repetir", async () => {
    const { fetch } = fake(() => r429(String(NOW / 1000 + 9)));
    const sleep = vi.fn(async () => undefined);
    const c = new ClicksignClient("tok-fake", fetch, undefined, { sleep, now: () => NOW });
    for (let i = 0; i < 4; i += 1) await c.getEnvelope(ENV).catch(() => undefined);
    expect(sleep).toHaveBeenCalledTimes(2); // 9,25 s + 9,25 s; a 3ª passaria de 20 s
  });
  it("rateLimitWaitMs: sem header = 3 s; reset no passado = mínimo; acima do teto = null", () => {
    expect(rateLimitWaitMs(null, NOW)).toBe(3000);
    expect(rateLimitWaitMs("abc", NOW)).toBe(3000);
    expect(rateLimitWaitMs(String(NOW / 1000 - 5), NOW)).toBe(500);
    expect(rateLimitWaitMs(String(NOW / 1000 + 11), NOW)).toBeNull();
  });
  it("envio da venda: 429 no meio (signatário) repete só aquela chamada; sem signatário duplicado", async () => {
    let hit = false;
    const { fetch, calls } = fake((key) => {
      if (key === "POST /envelopes/:id/signers" && !hit) {
        hit = true;
        return r429(null);
      }
      return undefined;
    });
    const { deps } = saleDeps({ fetch });
    const r = await handleSale(deps, saleSend);
    expect(r.status).toBe(200);
    const signers = calls.filter((c) => c === "POST /envelopes/:id/signers").length;
    // 3 partes + corretor + imobiliária + 2 testemunhas = 7 signatários, +1 repetição do 429
    expect(signers).toBe(8);
    expect(calls.filter((c) => c === "POST /envelopes")).toHaveLength(1);
  }, 10_000);
});

// ---------------------------------------------------------------- D) R3
describe("R3: detalhe da recusa gravado sem dados pessoais", () => {
  it("sanitizeErrorDetail tira e-mail, CPF e nomes; corta em 120", () => {
    const d = sanitizeErrorDetail(
      "/data/attributes/email bruno@example.com inválido; signatário Bruno Comprador CPF 529.982.247-25 recusado; " +
        "x".repeat(200),
      ["Bruno Comprador", "Vera Vendedora"],
    );
    expect(d).not.toMatch(/@|bruno|comprador|529/i);
    expect(d).toContain("<email>");
    expect(d).toContain("<nome>");
    expect(d).toContain("<doc>");
    expect(d.length).toBeLessThanOrEqual(120);
  });
  it("sendFailure: 400 e 422 têm detalhe; 401/429/500 não", () => {
    expect(sendFailure(new ClicksignError("signer", 400, "nome inválido"), []).detail).toBe(
      "nome inválido",
    );
    expect(sendFailure(new ClicksignError("signer", 422, "x"), []).detail).toBe("x");
    expect(sendFailure(new ClicksignError("envelope", 401, "token"), []).detail).toBeNull();
    expect(sendFailure(new Error("x"), []).code).toBe("internal");
  });
  it("venda: HTTP 400 grava error_detail limpo e a tela recebe o detalhe (antes só 422)", async () => {
    const { fetch } = fake((key) =>
      key === "POST /envelopes/:id/signers"
        ? new Response(
            JSON.stringify({
              errors: [
                {
                  source: { pointer: "/data/attributes/name" },
                  detail: "Valter Vendedor valter@example.com não é válido",
                },
              ],
            }),
            { status: 400 },
          )
        : undefined,
    );
    const { deps } = saleDeps({ fetch });
    const r = await handleSale(deps, saleSend);
    expect(r.status).toBe(502);
    expect(r.body.code).toBe("signer:400");
    expect((r.body.details as string[])[0]).toContain("não é válido");
    expect(JSON.stringify(r.body)).not.toMatch(/@/);
    const patch = (deps.updateEnvelope as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[1] as Record<string, unknown>)
      .find((p) => p.status === "error")!;
    expect(patch.error_code).toBe("signer:400");
    expect(patch.error_detail).toBe("/data/attributes/name <nome> <email> não é válido");
  });
  it("status na tela mostra o motivo gravado", () => {
    const e = {
      status: "error" as const,
      is_test: false,
      created_at: "",
      error_code: "signer:422",
      error_detail: "documentation inválido",
      signed: false,
    };
    expect(saleEnvelopeStatusLabel(e)).toContain(
      "Motivo informado pela Clicksign: documentation inválido",
    );
    expect(envelopeStatusLabel(e)).toContain(
      "Motivo informado pela Clicksign: documentation inválido",
    );
    expect(saleEnvelopeStatusLabel({ ...e, error_detail: null })).not.toContain("Motivo");
  });
});

// ---------------------------------------------------------------- B) R7
describe("R7: teto de 10 MB", () => {
  it("venda: contrato acima de 10 MB → 422 em português, sem envelope e sem Clicksign", async () => {
    const { fetch, calls } = fake();
    const { deps } = saleDeps({ fetch, fileBytes: BIG });
    const r = await handleSale(deps, saleSend);
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(
      /O contrato do jurídico tem 10,0 MB e a Clicksign aceita no máximo 10 MB/,
    );
    expect(r.body.code).toBe("file:too_big");
    expect(deps.insertEnvelope).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
  it("venda: exatamente 10 MB passa", async () => {
    const { deps } = saleDeps({ fileBytes: MAX_CLICKSIGN_FILE_BYTES });
    expect((await handleSale(deps, saleSend)).status).toBe(200);
  });
  it("captação: PDF acima de 10 MB → 422, sem envelope e sem Clicksign", async () => {
    const { fetch, calls } = fake();
    const deps: SendDeps = {
      actorId: "actor",
      fetch,
      authorize: vi.fn(async () => ORG),
      loadContext: vi.fn(async () => ({
        organizationId: ORG,
        form: {
          proprietario_1: { nome_completo: "Ana Teste Silva", email: "ana@example.com" },
        },
        testemunhas: {
          corretor: { nome: "Carlos Corretor", email: "carlos@example.com" },
          gestor: { nome: "Gina Gestora", email: "gina@example.com" },
          problemas: [],
          pdfOk: true,
        },
        imobiliaria: [{ id: IMOB, nome: "Vera Imobiliaria", email: "vera@example.com" }],
        testMode: false,
        allowlistSha256: [],
        deadlineDays: 30,
        token: "tok-fake",
        gerado: { id: DOC, fileName: "g.pdf" },
      })),
      loadPdf: vi.fn(async () => new Uint8Array(BIG)),
      insertEnvelope: vi.fn(async () => "row-1"),
      updateEnvelope: vi.fn(async () => undefined),
      markSent: vi.fn(async () => undefined),
    };
    const r = await handleSend(deps, {
      capture_id: CAP,
      imobiliaria_ids: [IMOB],
      testemunhas: [
        { nome: "Tania Testemunha", email: "tania@example.com" },
        { nome: "Tiago Testemunha", email: "tiago@example.com" },
      ],
    });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(
      /O PDF do contrato tem .* MB e a Clicksign aceita no máximo 10 MB/,
    );
    expect(deps.insertEnvelope).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
  it("tela: avisa antes de abrir o envio (venda e captação)", () => {
    const venda = saleSendCheck({
      parties: [],
      corretores: [],
      liberaAssinatura: true,
      contratoSize: BIG,
      imobiliariaIds: [],
      testemunhas: [],
      extras: [],
    });
    expect(venda.errors[0]).toMatch(/máximo 10 MB/);
    const cap = sendDialogErrors({
      form: {},
      imobiliariaIds: [],
      testemunhas: null,
      pdfSize: BIG,
    });
    expect(cap[0]).toMatch(/máximo 10 MB/);
    expect(
      sendDialogErrors({ form: {}, imobiliariaIds: [], testemunhas: null }).some((e) =>
        /MB/.test(e),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------- F) R5
function reconcileDeps(
  remote: Route,
  over: Partial<ReconcileDeps> = {},
  errorCode = "activate_unknown",
) {
  const { fetch, calls } = fake(remote);
  const deps: ReconcileDeps = {
    fetch,
    reconcileAuthorize: vi.fn(async () => ({ org: ORG, envelope: "row-1" })),
    reconcileContext: vi.fn(async () => ({ envelopeKey: ENV, errorCode, token: "tok-fake" })),
    reconcileApply: vi.fn(async (_row: string, st: string) =>
      st === "running" ? "sent" : st === "draft" || st === "missing" ? "released" : "manual",
    ),
    updateEnvelope: vi.fn(async () => undefined),
    ...over,
  };
  return { deps, calls };
}
const envStatus = (status: string) => (key: string) =>
  key === "GET /envelopes/:id" ? Response.json({ data: { attributes: { status } } }) : undefined;

describe("R5: Conferir na Clicksign (envio sem confirmação)", () => {
  it("running + activate_unknown → marca enviado e avisa os signatários (o aviso nunca saiu)", async () => {
    const { deps, calls } = reconcileDeps(envStatus("running"));
    const r = await handleReconcile(deps, "venda", SALE);
    expect(r.status).toBe(200);
    expect(r.body.result).toBe("sent");
    expect(deps.reconcileApply).toHaveBeenCalledWith("row-1", "running");
    expect(calls).toEqual(["GET /envelopes/:id", "POST /envelopes/:id/notifications"]);
  });
  it("running sem activate_unknown (sending parado) → não reenvia aviso sozinho, só orienta", async () => {
    const { deps, calls } = reconcileDeps(envStatus("running"), {}, "");
    const r = await handleReconcile(deps, "captacao", CAP);
    expect(r.body.result).toBe("sent");
    expect(r.body.warning).toMatch(/Reenviar aviso/);
    expect(calls).toEqual(["GET /envelopes/:id"]);
  });
  it("draft → exclui o rascunho e libera novo envio", async () => {
    const { deps, calls } = reconcileDeps(envStatus("draft"));
    const r = await handleReconcile(deps, "venda", SALE);
    expect(r.body.result).toBe("released");
    expect(calls).toEqual(["GET /envelopes/:id", "DELETE /envelopes/:id"]);
  });
  it("404 → libera (envelope não existe)", async () => {
    const { deps } = reconcileDeps((key) =>
      key === "GET /envelopes/:id" ? new Response("{}", { status: 404 }) : undefined,
    );
    const r = await handleReconcile(deps, "venda", SALE);
    expect(deps.reconcileApply).toHaveBeenCalledWith("row-1", "missing");
    expect(r.body.result).toBe("released");
  });
  it("closed/canceled → pede conferência manual, sem mexer na Clicksign", async () => {
    const { deps, calls } = reconcileDeps(envStatus("closed"));
    const r = await handleReconcile(deps, "venda", SALE);
    expect(r.body.result).toBe("manual");
    expect(calls).toEqual(["GET /envelopes/:id"]);
  });
  it("Clicksign fora (500) → 502, nada aplicado", async () => {
    const { deps } = reconcileDeps(() => new Response("x", { status: 500 }));
    const r = await handleReconcile(deps, "venda", SALE);
    expect(r.status).toBe(502);
    expect(deps.reconcileApply).not.toHaveBeenCalled();
  });
  it("sem permissão → 403 com a mensagem do banco, sem Clicksign", async () => {
    const { deps, calls } = reconcileDeps(envStatus("running"), {
      reconcileAuthorize: vi.fn(async () => {
        throw new Error("Não há envio sem confirmação para conferir");
      }),
    });
    const r = await handleReconcile(deps, "venda", SALE);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("Não há envio sem confirmação para conferir");
    expect(calls).toEqual([]);
  });
  it("clicksign-sale encaminha action=reconcile", async () => {
    const { fetch } = fake(envStatus("running"));
    const { deps } = saleDeps({ fetch });
    deps.reconcileAuthorize = vi.fn(async () => ({ org: ORG, envelope: "row-1" }));
    deps.reconcileContext = vi.fn(async () => ({ envelopeKey: ENV, errorCode: null, token: "t" }));
    deps.reconcileApply = vi.fn(async () => "sent");
    const r = await handleSale(deps, { sale_id: SALE, action: "reconcile" });
    expect(r.body.result).toBe("sent");
    expect(deps.reconcileAuthorize).toHaveBeenCalledWith("venda", SALE);
  });
  it("botão só para quem envia, em sending com activate_unknown ou parado há mais de 5 min", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    const base = { status: "sending", error_code: null, updated_at: "2026-10-19T11:58:00Z" };
    expect(canReconcile(true, base, now)).toBe(false);
    expect(canReconcile(true, { ...base, updated_at: "2026-10-19T11:50:00Z" }, now)).toBe(true);
    expect(canReconcile(true, { ...base, error_code: "activate_unknown" }, now)).toBe(true);
    expect(canReconcile(false, { ...base, error_code: "activate_unknown" }, now)).toBe(false);
    expect(
      canReconcile(true, { ...base, status: "running", error_code: "activate_unknown" }, now),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------- helpers da venda
type Opts = { fetch?: ReturnType<typeof fake>["fetch"]; fileBytes?: number };
function saleDeps(opts: Opts = {}) {
  const deps: SaleDeps = {
    actorId: "actor",
    fetch: opts.fetch ?? fake().fetch,
    authorizeSend: vi.fn(async () => ({ org: ORG, contrato: DOC })),
    loadSendContext: vi.fn(async () => ({
      parties: [
        { papel: "comprador_1", nome: "Bruno Comprador", email: "bruno@example.com" },
        { papel: "vendedor_1", nome: "Valter Vendedor", email: "valter@example.com" },
        { papel: "vendedor_2", nome: "Vera Vendedora", email: "vera@example.com" },
      ],
      corretores: [{ nome: "Carlos Corretor", email: "carlos@example.com" }],
      imobiliaria: [{ id: IMOB, nome: "Edson Imobiliaria", email: "edson@example.com" }],
      saleEnabled: true,
      testMode: false,
      allowlistSha256: [],
      deadlineDays: 30,
      token: "tok-fake",
      contrato: { id: DOC, fileName: "contrato.pdf" },
      imovel: "AP-101",
    })),
    resolveExtras: vi.fn(async () => []),
    loadFile: vi.fn(async () =>
      opts.fileBytes ? new Uint8Array(opts.fileBytes) : new TextEncoder().encode("%PDF-1.4"),
    ),
    insertEnvelope: vi.fn(async () => "row-1"),
    updateEnvelope: vi.fn(async () => undefined),
    markSent: vi.fn(async () => undefined),
    cancelReason: vi.fn(async () => null),
    markCanceled: vi.fn(async () => "canceled"),
    authorize: vi.fn(async () => ({ org: ORG, envelope: "row-1" })),
    loadContext: vi.fn(),
    lock: vi.fn(async () => "ok" as const),
    done: vi.fn(async () => undefined),
  };
  return { deps };
}
const saleSend = {
  sale_id: SALE,
  action: "send",
  imobiliaria_ids: [IMOB],
  testemunhas: [
    { nome: "Tania Testemunha", email: "tania@example.com" },
    { nome: "Tiago Testemunha", email: "tiago@example.com" },
  ],
  extras: [],
};
