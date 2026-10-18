// Clicksign na VENDA — só mock: sem rede, sem chamada real à Clicksign, e-mails fictícios (example.com).
import { describe, expect, it, vi } from "vitest";
import { sha256Hex, signerStates } from "../../supabase/functions/_shared/clicksign.ts";
import {
  buildSaleSigners,
  formatCpf,
  missingPartyEmails,
  type SaleParty,
} from "../../supabase/functions/_shared/clicksign-venda.ts";
import {
  handleSale,
  parseExtras,
  type SaleDeps,
} from "../../supabase/functions/clicksign-sale/core.ts";
import {
  handleWebhook,
  type WebhookDeps,
} from "../../supabase/functions/clicksign-webhook/core.ts";
import { hmacSha256Hex } from "../../supabase/functions/_shared/clicksign.ts";

const SALE = "22222222-2222-4222-8222-222222222222";
const ORG = "00000000-0000-4000-8000-000000000001";
const DOC = "66666666-6666-4666-8666-666666666666";
const ENV = "77777777-7777-4777-8777-777777777777";
const IMOB = "33333333-3333-4333-8333-333333333333";
const REF = "corretor:44444444-4444-4444-8444-444444444444";

const parties: SaleParty[] = [
  { papel: "comprador_1", nome: "Bruno Comprador", email: "bruno@example.com" },
  { papel: "vendedor_2", nome: "Vera Vendedora", email: "vera@example.com" },
  { papel: "vendedor_1", nome: "Valter Vendedor", email: "valter@example.com" },
];
const base = {
  parties,
  corretores: [{ nome: "Carlos Corretor", email: "carlos@example.com" }],
  imobiliaria: [{ nome: "Edson Imobiliaria", email: "edson@example.com" }],
  testemunhas: [
    { nome: "Tania Testemunha", email: "tania@example.com" },
    { nome: "Tiago Testemunha", email: "tiago@example.com" },
  ],
  extras: [],
};

describe("signatários da venda", () => {
  it("padrão: todas as partes (vendedores antes, pela numeração), corretor, imobiliária e 2 testemunhas", () => {
    const { signers, errors } = buildSaleSigners(base);
    expect(errors).toEqual([]);
    expect(signers.map((s) => [s.label, s.role])).toEqual([
      ["Vendedor 1", "seller"],
      ["Vendedor 2", "seller"],
      ["Comprador 1", "buyer"],
      ["Corretor", "real_estate_broker"],
      ["Imobiliária 1", "intermediary"],
      ["Testemunha 1", "witness"],
      ["Testemunha 2", "witness"],
    ]);
  });
  it("extras: advogado = lawyer, cônjuge = Anuente (consenting), CPF opcional formatado", () => {
    const { signers, errors } = buildSaleSigners({
      ...base,
      extras: [
        { origem: "externo", nome: "Laura Advogada", email: "laura@example.com", role: "lawyer" },
        {
          origem: "externo",
          nome: "Clara Conjuge",
          email: "clara@example.com",
          role: "consenting",
          cpf: "52998224725",
        },
        {
          origem: "sistema",
          nome: "Paulo Parceiro",
          email: "paulo@example.com",
          role: "intermediary",
        },
      ],
    });
    expect(errors).toEqual([]);
    const extras = signers.slice(-3);
    expect(extras.map((s) => [s.papel, s.role, s.label])).toEqual([
      ["extra_externo", "lawyer", "Parte extra 1 (Advogado(a))"],
      ["extra_externo", "consenting", "Parte extra 2 (Anuente)"],
      ["extra_sistema", "intermediary", "Parte extra 3 (Intermediário(a))"],
    ]);
    expect(extras[1].documentation).toBe("529.982.247-25");
    expect(extras[0].documentation).toBeUndefined();
  });
  it("e-mail repetido é recusado com os dois rótulos (sem mostrar o e-mail)", () => {
    const { errors } = buildSaleSigners({
      ...base,
      extras: [
        { origem: "externo", nome: "Outro Nome", email: "BRUNO@example.com ", role: "party" },
      ],
    });
    expect(errors).toContain(
      "A mesma pessoa não pode assinar duas vezes (Comprador 1 e Parte extra 1 (Parte))",
    );
    expect(errors.join(" ")).not.toMatch(/@/);
  });
  it("papel e CPF inválidos na parte extra", () => {
    const { errors } = buildSaleSigners({
      ...base,
      extras: [
        { origem: "externo", nome: "Xis Ypsilon", email: "x@example.com", role: "dono" },
        { origem: "externo", nome: "Zeca Zan", email: "z@example.com", role: "party", cpf: "111" },
      ],
    });
    expect(errors).toContain("Parte extra 1: papel inválido");
    expect(errors).toContain("Parte extra 2 (Parte): CPF inválido (ou deixe em branco)");
    expect(formatCpf("")).toBeNull();
    expect(formatCpf("111.111.111-11")).toBe("invalid");
  });
  it("venda antiga sem e-mail: bloqueia com 'Preencha o e-mail de X na aba Partes' e não inventa nada", () => {
    const old: SaleParty[] = [
      { papel: "vendedor_1", nome: "Valter Vendedor", email: "" },
      { papel: "comprador_1", nome: "Bruno Comprador", email: null },
    ];
    expect(missingPartyEmails(old).map((m) => m.parte)).toEqual(["vendedor_1", "comprador_1"]);
    const { signers, errors, missingEmail } = buildSaleSigners({ ...base, parties: old });
    expect(missingEmail).toHaveLength(2);
    expect(errors).toContain("Preencha o e-mail de Vendedor 1 (Valter Vendedor) na aba Partes");
    expect(signers.some((s) => s.papel === "vendedor" || s.papel === "comprador")).toBe(false);
  });
  it("sem vendedor ou sem comprador", () => {
    const { errors } = buildSaleSigners({ ...base, parties: [parties[0]] });
    expect(errors).toContain("Cadastre ao menos 1 vendedor na aba Partes");
  });
  it("parseExtras: ref do sistema precisa ser válida; origem desconhecida é recusada", () => {
    expect(parseExtras([{ origem: "sistema", ref: REF, role: "lawyer" }]).invalid).toBe(false);
    expect(parseExtras([{ origem: "sistema", ref: "x", role: "lawyer" }]).invalid).toBe(true);
    expect(parseExtras([{ origem: "outro" }]).invalid).toBe(true);
  });
});

describe("status por signatário (Enviado / Abriu o contrato / Assinou)", () => {
  it("signature_started = abriu; sign = assinou; sem evento = enviado", async () => {
    const stored = await Promise.all(
      ["a@example.com", "b@example.com", "c@example.com"].map(async (e, i) => ({
        papel: "testemunha",
        nome: `Pessoa ${i}`,
        email_sha256: await sha256Hex(e),
      })),
    );
    const signersResp = {
      data: ["a@example.com", "b@example.com", "c@example.com"].map((e, i) => ({
        id: String(i),
        attributes: { name: `Pessoa ${i}`, email: e },
      })),
    };
    const docEvents = {
      data: [{ attributes: { name: "sign", data: { signer: { email: "a@example.com" } } } }],
    };
    const opened = {
      data: [
        { attributes: { name: "signature_started", data: { signer: { email: "b@example.com" } } } },
      ],
    };
    const st = await signerStates(stored, signersResp, docEvents, opened);
    expect(st.map((s) => s.status)).toEqual(["assinou", "abriu", "enviado"]);
    // Envelope antigo (sem eventos de abertura): só Enviado/Assinou, sem erro.
    const old = await signerStates(stored, signersResp, docEvents, null);
    expect(old.map((s) => s.status)).toEqual(["assinou", "enviado", "enviado"]);
  });
});

// ---------- edge function (core) com Clicksign mockada ----------
type Opts = {
  parties?: SaleParty[];
  authorizeError?: string;
  fileName?: string;
  failOn?: string;
  cancelReason?: "nova_versao" | "status_mudou" | null;
  testMode?: boolean;
  allow?: string[];
  saleEnabled?: boolean;
};
function saleDeps(opts: Opts = {}) {
  const calls: string[] = [];
  const bodies: Record<string, unknown> = {};
  let n = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace(/^https:\/\/[^/]+\/api\/v3/, "").replace(/\?.*$/, "");
    const key = `${init.method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`;
    calls.push(key);
    if (init.body) bodies[key] = JSON.parse(String(init.body));
    if (opts.failOn === key)
      return new Response(JSON.stringify({ errors: [{ detail: "falhou" }] }), { status: 422 });
    if (key === "GET /envelopes/:id/documents/:id")
      return Response.json({ data: { attributes: { status: "running" } } });
    n += 1;
    const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
    return Response.json({ data: { id, attributes: {} } }, { status: 201 });
  });
  const deps: SaleDeps = {
    actorId: "actor",
    fetch,
    authorizeSend: vi.fn(async () => {
      if (opts.authorizeError) throw new Error(opts.authorizeError);
      return { org: ORG, contrato: DOC };
    }),
    loadSendContext: vi.fn(async () => ({
      parties: opts.parties ?? parties,
      corretores: base.corretores,
      imobiliaria: [{ id: IMOB, nome: "Edson Imobiliaria", email: "edson@example.com" }],
      saleEnabled: opts.saleEnabled ?? true,
      testMode: opts.testMode ?? false,
      allowlistSha256: opts.allow ?? [],
      deadlineDays: 30,
      token: "tok-fake",
      contrato: { id: DOC, fileName: opts.fileName ?? "contrato.docx" },
      imovel: "AP-101",
    })),
    resolveExtras: vi.fn(async () => [
      { ref: REF, nome: "Paulo Parceiro", email: "paulo@example.com" },
    ]),
    loadFile: vi.fn(async () => new TextEncoder().encode("arquivo do jurídico")),
    insertEnvelope: vi.fn(async () => "row-1"),
    updateEnvelope: vi.fn(async () => undefined),
    markSent: vi.fn(async () => undefined),
    cancelReason: vi.fn(async () => opts.cancelReason ?? null),
    markCanceled: vi.fn(async () => "canceled"),
    authorize: vi.fn(async () => ({ org: ORG, envelope: "row-1" })),
    loadContext: vi.fn(async () => ({
      envelopeRow: "row-1",
      envelopeKey: ENV,
      documentKey: DOC,
      isTest: false,
      signers: [],
      testMode: false,
      allowlistSha256: [],
      token: "tok-fake",
    })),
    lock: vi.fn(async () => "ok" as const),
    done: vi.fn(async () => undefined),
  };
  return { deps, calls, bodies, fetch };
}
const send = {
  sale_id: SALE,
  action: "send",
  imobiliaria_ids: [IMOB],
  testemunhas: base.testemunhas,
  extras: [
    { origem: "externo", nome: "Laura Advogada", email: "laura@example.com", role: "lawyer" },
    { origem: "sistema", ref: REF, role: "intermediary" },
  ],
};

describe("clicksign-sale: enviar", () => {
  it("monta o envelope com o contrato do jurídico (docx), qualificação por papel, sem ordem, e marca enviado", async () => {
    const { deps, calls, bodies } = saleDeps();
    const r = await handleSale(deps, send);
    expect(r).toMatchObject({ status: 200, body: { ok: true, signers: 9 } });
    expect(calls.filter((c) => c === "POST /envelopes/:id/signers")).toHaveLength(9);
    const doc = bodies["POST /envelopes/:id/documents"] as {
      data: { attributes: { content_base64: string } };
    };
    expect(doc.data.attributes.content_base64).toMatch(
      /^data:application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document;base64,/,
    );
    const env = bodies["POST /envelopes"] as { data: { attributes: Record<string, unknown> } };
    expect(env.data.attributes).not.toHaveProperty("sequence_enabled");
    expect(calls).toContain("PATCH /envelopes/:id");
    expect(calls).toContain("POST /envelopes/:id/notifications");
    expect(deps.markSent).toHaveBeenCalledWith("row-1");
    const row = (deps.insertEnvelope as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(row).toMatchObject({ origem: "venda", sale_id: SALE, source_document_id: DOC });
    expect(JSON.stringify(row)).not.toMatch(/@/);
  });
  it("bloqueio do jurídico (ou status errado): 403 sem chamar a Clicksign", async () => {
    const { deps, fetch } = saleDeps({
      authorizeError: "O jurídico bloqueou a assinatura deste contrato",
    });
    const r = await handleSale(deps, send);
    expect(r).toMatchObject({
      status: 403,
      body: { error: "O jurídico bloqueou a assinatura deste contrato" },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(deps.insertEnvelope).not.toHaveBeenCalled();
  });
  it("org sem Clicksign ligada: 403 sem chamar a Clicksign nem criar envelope", async () => {
    const { deps, fetch } = saleDeps({
      authorizeError: "Envio pela Clicksign não está habilitado para esta imobiliária",
    });
    const r = await handleSale(deps, send);
    expect(r.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect(deps.insertEnvelope).not.toHaveBeenCalled();
    expect(deps.markSent).not.toHaveBeenCalled();
  });
  it("captação ligada e venda desligada (sale_enabled=false): 403 sem Clicksign nem envelope", async () => {
    const { deps, fetch } = saleDeps({ saleEnabled: false });
    const r = await handleSale(deps, send);
    expect(r).toMatchObject({
      status: 403,
      body: { error: "Envio pela Clicksign não está habilitado para esta imobiliária" },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(deps.loadFile).not.toHaveBeenCalled();
    expect(deps.insertEnvelope).not.toHaveBeenCalled();
    expect(deps.markSent).not.toHaveBeenCalled();
  });
  it("parte sem e-mail: 422 com a lista para o atalho da aba Partes, sem envelope", async () => {
    const { deps, fetch } = saleDeps({
      parties: [{ papel: "vendedor_1", nome: "Valter Vendedor", email: "" }, parties[0]],
    });
    const r = await handleSale(deps, send);
    expect(r.status).toBe(422);
    expect(r.body.missing_email).toEqual([
      { parte: "vendedor_1", label: "Vendedor 1", nome: "Valter Vendedor" },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("e-mail repetido entre parte e extra: 422", async () => {
    const { deps, fetch } = saleDeps();
    const r = await handleSale(deps, {
      ...send,
      extras: [
        { origem: "externo", nome: "Bruno Outro", email: "bruno@example.com", role: "party" },
      ],
    });
    expect(r.status).toBe(422);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("arquivo do jurídico em formato não aceito: 422", async () => {
    const { deps } = saleDeps({ fileName: "contrato.odt" });
    expect((await handleSale(deps, send)).status).toBe(422);
  });
  it("modo teste: signatário fora da allowlist bloqueia", async () => {
    const { deps, fetch } = saleDeps({ testMode: true, allow: [] });
    const r = await handleSale(deps, send);
    expect(r.status).toBe(422);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("falha antes de ativar: apaga o rascunho e marca erro (nada enviado)", async () => {
    const { deps, calls } = saleDeps({ failOn: "POST /envelopes/:id/requirements" });
    const r = await handleSale(deps, send);
    expect(r.status).toBe(502);
    expect(calls).toContain("DELETE /envelopes/:id");
    expect(deps.updateEnvelope).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({ status: "error" }),
    );
    expect(deps.markSent).not.toHaveBeenCalled();
  });
});

describe("clicksign-sale: cancelar", () => {
  it("botão: cancela o documento na Clicksign e devolve a venda (motivo manual)", async () => {
    const { deps, calls, bodies } = saleDeps();
    const r = await handleSale(deps, { sale_id: SALE, action: "cancel" });
    expect(r).toMatchObject({ status: 200, body: { ok: true, reason: "manual" } });
    expect(calls).toContain("PATCH /envelopes/:id/documents/:id");
    expect(bodies["PATCH /envelopes/:id/documents/:id"]).toMatchObject({
      data: { attributes: { status: "canceled" } },
    });
    expect(deps.markCanceled).toHaveBeenCalledWith("row-1", "manual");
  });
  it("nova versão do contrato: o motivo vem do banco (nova_versao), nunca do navegador", async () => {
    const { deps } = saleDeps({ cancelReason: "nova_versao" });
    const r = await handleSale(deps, { sale_id: SALE, action: "cancel", reason: "status_mudou" });
    expect(r.body.reason).toBe("nova_versao");
    expect(deps.markCanceled).toHaveBeenCalledWith("row-1", "nova_versao");
  });
  it("Clicksign recusa e o documento segue rodando: 502 e nada é registrado", async () => {
    const { deps } = saleDeps({ failOn: "PATCH /envelopes/:id/documents/:id" });
    const r = await handleSale(deps, { sale_id: SALE, action: "cancel" });
    expect(r.status).toBe(502);
    expect(deps.markCanceled).not.toHaveBeenCalled();
    expect(deps.done).toHaveBeenCalledWith("row-1", { action: null });
  });
  it("sem permissão (corretor): 403", async () => {
    const { deps, fetch } = saleDeps();
    deps.authorize = vi.fn(async () => {
      throw new Error(
        "Apenas gestor, jurídico ou admin da imobiliária pode gerenciar a assinatura",
      );
    });
    expect((await handleSale(deps, { sale_id: SALE, action: "cancel" })).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("clicksign-webhook: envelope da venda", () => {
  const SLUG = "a".repeat(32);
  const SECRET = "segredo-webhook";
  const env = {
    id: "row-v",
    envelope_key: ENV,
    document_key: DOC,
    capture_id: null,
    organization_id: ORG,
    origem: "venda" as const,
    sale_id: SALE,
  };
  function hookDeps(attach = "attached") {
    const deps: WebhookDeps = {
      fetch: vi.fn(async (url: string) =>
        url.includes("/api/v3/")
          ? Response.json({
              data: { links: { files: { signed: "https://app.clicksign.com/s.pdf" } } },
            })
          : new Response("%PDF-1.7 assinado", { status: 200 }),
      ),
      findOrg: vi.fn(async () => ({ organizationId: ORG, secret: SECRET, token: "tok-fake" })),
      recordEvent: vi.fn(async () => ({ id: 1, fresh: true })),
      finishEvent: vi.fn(async () => undefined),
      findEnvelope: vi.fn(async () => env),
      updateEnvelope: vi.fn(async () => undefined),
      storePdf: vi.fn(async () => `${ORG}/${SALE}/outros/contrato_assinado/x.pdf`),
      attachSigned: vi.fn(async () => attach),
      removeObject: vi.fn(async () => undefined),
      saleCanceled: vi.fn(async () => "canceled"),
    };
    return deps;
  }
  async function signed(payload: unknown) {
    const raw = new TextEncoder().encode(JSON.stringify(payload));
    return { raw, hmac: `sha256=${await hmacSha256Hex(SECRET, raw)}` };
  }
  it("document_closed: anexa pela RPC da venda e marca sozinho", async () => {
    const deps = hookDeps();
    const s = await signed({ event: { name: "document_closed" }, document: { key: DOC } });
    const r = await handleWebhook(deps, SLUG, s.raw, { hmac: s.hmac, event: null });
    expect(r.body.result).toBe("signed:attached");
    expect(deps.attachSigned).toHaveBeenCalledWith(
      "row-v",
      expect.any(String),
      "contrato-assinado-clicksign.pdf",
      "venda",
    );
    expect(deps.removeObject).not.toHaveBeenCalled();
  });
  it("marcação automática falhou (attached_only): o PDF fica", async () => {
    const deps = hookDeps("attached_only");
    const s = await signed({ event: { name: "document_closed" }, document: { key: DOC } });
    await handleWebhook(deps, SLUG, s.raw, { hmac: s.hmac, event: null });
    expect(deps.removeObject).not.toHaveBeenCalled();
  });
  it("webhook repetido (already): apaga o PDF duplicado, não marca de novo", async () => {
    const deps = hookDeps("already");
    const s = await signed({ event: { name: "document_closed" }, document: { key: DOC } });
    const r = await handleWebhook(deps, SLUG, s.raw, { hmac: s.hmac, event: null });
    expect(r.body.result).toBe("signed:already");
    expect(deps.removeObject).toHaveBeenCalledWith(expect.any(String), "venda");
  });
  it("cancel/deadline/refusal: RPC da venda (devolve ao gestor)", async () => {
    const deps = hookDeps();
    const s = await signed({ event: { name: "deadline" }, document: { key: DOC } });
    const r = await handleWebhook(deps, SLUG, s.raw, { hmac: s.hmac, event: null });
    expect(r.body.result).toBe("envelope:deadline:canceled");
    expect(deps.saleCanceled).toHaveBeenCalledWith("row-v", "deadline");
    expect(deps.updateEnvelope).not.toHaveBeenCalled();
  });
});
