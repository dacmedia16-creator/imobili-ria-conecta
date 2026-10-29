// Testemunhas automáticas da captação (t_e8078685): testemunha 1 = corretor da captação (só como
// testemunha, nunca como parte), testemunha 2 = gestor da equipe dele. Só mock: sem rede, e-mails
// fictícios.
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../supabase/functions/_shared/clicksign.ts";
import {
  handleSend,
  type SendDeps,
  TESTEMUNHAS_PDF_MSG,
  testemunhasDoBanco,
} from "../../supabase/functions/clicksign-send/core.ts";
import { handleManage, type ManageDeps } from "../../supabase/functions/clicksign-manage/core.ts";
import {
  avisoSemGestor,
  parseTestemunhas,
  rotuloTestemunha,
  sendDialogErrors,
  testemunhasParaPdf,
  usarTestemunhasAuto,
} from "./exclusive-clicksign";

const CAP = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const IMOB = "33333333-3333-4333-8333-333333333333";
const DOC = "55555555-5555-4555-8555-555555555555";
const form = { proprietario_1: { nome_completo: "Ana Teste Silva", email: "ana@example.com" } };
const corretor = { nome: "Carlos Corretor", email: "corretor@example.com" };
const gestor = { nome: "Gina Gestora", email: "gestor@example.com" };

/** Resposta do banco (exclusive_testemunhas_resolver), formato real. */
const resolverOk = {
  ok: true,
  corretor: { id: "c1", ...corretor },
  gestor: { id: "g1", ...gestor },
  problemas: [],
  pdf_ok: true,
};

function deps(raw: unknown, over: Partial<SendDeps> = {}) {
  const posted: Array<{ key: string; body: unknown }> = [];
  let n = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace(/^https:\/\/[^/]+\/api\/v3/, "").replace(/[0-9a-f-]{36}/g, ":id");
    const key = `${init.method ?? "GET"} ${path}`;
    if (init.body && typeof init.body === "string")
      posted.push({ key, body: JSON.parse(init.body) });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    n += 1;
    return Response.json(
      { data: { id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` } },
      { status: 201 },
    );
  });
  const d: SendDeps = {
    actorId: "actor",
    fetch,
    authorize: vi.fn(async () => ORG),
    loadContext: vi.fn(async () => ({
      organizationId: ORG,
      form,
      testemunhas: testemunhasDoBanco(raw),
      imobiliaria: [{ id: IMOB, nome: "Vera Imobiliária", email: "vera@example.com" }],
      testMode: false,
      allowlistSha256: [],
      deadlineDays: 30,
      token: "tok-fake",
      gerado: { id: DOC, fileName: "c.pdf" },
    })),
    loadPdf: vi.fn(async () => new TextEncoder().encode("%PDF-1.4 TESTE")),
    insertEnvelope: vi.fn(async () => "row-1"),
    updateEnvelope: vi.fn(async () => undefined),
    markSent: vi.fn(async () => undefined),
    ...over,
  };
  return { d, fetch, posted };
}

// A tela tenta mandar outras testemunhas: o servidor ignora.
const body = {
  capture_id: CAP,
  imobiliaria_ids: [IMOB],
  testemunhas: [
    { nome: "Intrusa Digitada", email: "intrusa@example.com" },
    { nome: "Outro Digitado", email: "outro@example.com" },
  ],
};

describe("envio: signatários montados pelo banco", () => {
  it("corretor só como testemunha 1, gestor da equipe como testemunha 2, nenhum papel 'corretor'", async () => {
    const { d, posted } = deps(resolverOk);
    const r = await handleSend(d, body);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, signers: 4 });
    const row = (d.insertEnvelope as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      signers: Array<{ papel: string; nome: string; email_sha256: string; cadastro?: boolean }>;
    };
    expect(row.signers.map((s) => s.papel)).toEqual([
      "proprietario_1",
      "imobiliaria",
      "testemunha",
      "testemunha",
    ]);
    expect(row.signers.some((s) => s.papel === "corretor")).toBe(false);
    expect(row.signers[2]).toMatchObject({
      nome: "Carlos Corretor",
      email_sha256: await sha256Hex("corretor@example.com"),
      cadastro: true,
    });
    expect(row.signers[3]).toMatchObject({
      nome: "Gina Gestora",
      email_sha256: await sha256Hex("gestor@example.com"),
      cadastro: true,
    });
    // O corretor entra UMA vez na Clicksign, com qualificação de testemunha.
    const signerPosts = posted.filter((p) => p.key === "POST /envelopes/:id/signers");
    const emails = signerPosts.map(
      (p) => (p.body as { data: { attributes: { email: string } } }).data.attributes.email,
    );
    expect(emails.filter((e) => e === "corretor@example.com")).toHaveLength(1);
    expect(emails).not.toContain("intrusa@example.com");
    const roles = posted
      .filter((p) => p.key === "POST /envelopes/:id/requirements")
      .map((p) => (p.body as { data: { attributes: { role?: string } } }).data.attributes.role)
      .filter(Boolean);
    expect(roles).toEqual(["contractor", "contractee", "witness", "witness"]);
    expect(roles).not.toContain("real_estate_broker");
  });

  it("sem gestor válido: 422 com o motivo do banco e nada vai à Clicksign", async () => {
    const casos = [
      {
        ...resolverOk,
        ok: false,
        gestor: null,
        problemas: ["O corretor não está em nenhuma equipe"],
      },
      {
        ...resolverOk,
        ok: false,
        gestor: null,
        problemas: ["O corretor é o próprio líder da equipe"],
      },
      { ...resolverOk, ok: false, problemas: ["Testemunha 2 (Gina Gestora): falta CPF"] },
      { ...resolverOk, ok: false, problemas: ["Testemunha 2 (Gina Gestora): falta e-mail"] },
    ];
    for (const raw of casos) {
      const { d, fetch } = deps(raw);
      const r = await handleSend(d, body);
      expect(r.status).toBe(422);
      expect(r.body.code).toBe("testemunhas");
      expect(r.body.details).toEqual(raw.problemas);
      expect(fetch).not.toHaveBeenCalled();
      expect(d.insertEnvelope).not.toHaveBeenCalled();
    }
  });

  it("resposta ausente/estranha do banco = bloqueia (nunca testemunha vazia)", async () => {
    for (const raw of [null, undefined, "x", {}, { ok: true }, { ok: true, corretor: null }]) {
      const tw = testemunhasDoBanco(raw);
      expect(tw.problemas.length).toBeGreaterThan(0);
      const { d, fetch } = deps(raw);
      expect((await handleSend(d, body)).status).toBe(422);
      expect(fetch).not.toHaveBeenCalled();
    }
    // ok:true sem gestor também bloqueia
    const { d } = deps({ ...resolverOk, gestor: null });
    expect((await handleSend(d, body)).body.code).toBe("testemunhas");
  });

  it("PDF gerado com outras testemunhas: 422 pedindo para gerar de novo", async () => {
    const { d, fetch } = deps({ ...resolverOk, pdf_ok: false });
    const r = await handleSend(d, body);
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ error: TESTEMUNHAS_PDF_MSG, code: "testemunhas:pdf" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("gestor com o mesmo e-mail do proprietário: recusa (mesma pessoa duas vezes)", async () => {
    const { d } = deps({
      ...resolverOk,
      gestor: { id: "g1", nome: "Ana Teste Silva", email: "ana@example.com" },
    });
    const r = await handleSend(d, body);
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body.details)).toMatch(/mesma pessoa/);
  });
});

describe("clicksign-manage: testemunha do cadastro não se edita pelo envelope", () => {
  it("edit_signer em testemunha com cadastro:true → 422 sem chamar a Clicksign", async () => {
    const signers = [
      { papel: "proprietario_1", nome: "Ana", email_sha256: await sha256Hex("ana@example.com") },
      {
        papel: "testemunha",
        nome: "Carlos Corretor",
        email_sha256: await sha256Hex("corretor@example.com"),
        cadastro: true,
      },
    ];
    const fetch = vi.fn();
    const md: ManageDeps = {
      actorId: "actor",
      fetch: fetch as never,
      authorize: vi.fn(async () => ({ org: "org", envelope: "row-1" })),
      loadContext: vi.fn(async () => ({
        envelopeRow: "row-1",
        envelopeKey: "77777777-7777-4777-8777-777777777777",
        documentKey: DOC,
        isTest: true,
        signers,
        testMode: false,
        allowlistSha256: [],
        token: "tok-fake",
      })),
      lock: vi.fn(async () => "ok" as const),
      done: vi.fn(async () => undefined),
    };
    const r = await handleManage(md, {
      capture_id: CAP,
      action: "edit_signer",
      idx: 1,
      nome: "Carlos Corretor",
      email: "novo@example.com",
    });
    expect(r.status).toBe(422);
    expect(String(r.body.error)).toMatch(/vem do cadastro/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("tela: testemunhas automáticas", () => {
  const raw = {
    aplica: true,
    corretor: { id: "c1", nome: "Carlos Corretor", cpf: "52998224725", ok: true, falta: [] },
    gestor: {
      id: "g1",
      nome: "Gina Gestora",
      cpf: "11144477735",
      ok: true,
      falta: [],
      origem: "equipe",
    },
    gestor_equipe: { id: "g1", nome: "Gina Gestora" },
    motivo: null,
    escolhido: false,
    problemas: [],
    ok: true,
    pdf_gerado: true,
    pdf_ok: true,
    pode_gerir: true,
  };

  it("lê a resposta do banco; formato inesperado = null (bloqueia)", () => {
    const t = parseTestemunhas(raw)!;
    expect(t).toMatchObject({ aplica: true, ok: true, pdfOk: true, podeGerir: true });
    expect(t.gestor?.origem).toBe("equipe");
    expect(parseTestemunhas(null)).toBeNull();
    expect(parseTestemunhas({ corretor: null })).toBeNull();
  });

  it("PDF: nome + CPF do cadastro, RG em branco; sem automáticas, mantém as digitadas", () => {
    const f = {
      testemunha_1: { nome: "Digitada", rg: "1", cpf: "2" },
      testemunha_2: { nome: "Digitada 2", rg: "3", cpf: "4" },
      outro: "x",
    };
    const t = parseTestemunhas(raw)!;
    expect(testemunhasParaPdf(f, t)).toEqual({
      outro: "x",
      testemunha_1: { nome: "Carlos Corretor", rg: "", cpf: "52998224725" },
      testemunha_2: { nome: "Gina Gestora", rg: "", cpf: "11144477735" },
    });
    // imobiliária sem Clicksign, cadastro incompleto, sem CPF visível ou mesma pessoa: não troca
    expect(testemunhasParaPdf(f, null)).toBe(f);
    expect(testemunhasParaPdf(f, { ...t, aplica: false })).toBe(f);
    expect(testemunhasParaPdf(f, { ...t, ok: false })).toBe(f);
    expect(testemunhasParaPdf(f, { ...t, gestor: null })).toBe(f);
    expect(usarTestemunhasAuto({ ...t, gestor: { ...t.gestor!, cpf: undefined } })).toBe(false);
    expect(usarTestemunhasAuto({ ...t, gestor: { ...t.gestor!, id: "c1" } })).toBe(false);
  });

  it("avisos claros: sem equipe, corretor líder, falta de dado", () => {
    const t = parseTestemunhas(raw)!;
    expect(avisoSemGestor(t)).toBeNull();
    expect(avisoSemGestor({ ...t, gestor: null, motivo: "sem_equipe" })).toMatch(
      /não está em nenhuma equipe/,
    );
    expect(avisoSemGestor({ ...t, gestor: null, motivo: "corretor_e_lider" })).toMatch(
      /próprio líder/,
    );
    expect(
      rotuloTestemunha(
        { id: "g", nome: "Gina", ok: false, falta: ["CPF", "e-mail"] },
        "Testemunha 2",
      ),
    ).toBe("Testemunha 2: Gina (falta CPF, e-mail)");
    expect(rotuloTestemunha(null, "Testemunha 2")).toBe("Testemunha 2: não definida");
  });

  it("botão de envio trava sem gestor, com problema ou com PDF desatualizado", () => {
    const t = parseTestemunhas(raw)!;
    const base = { form, imobiliariaIds: [IMOB] };
    expect(sendDialogErrors({ ...base, testemunhas: t })).toEqual([]);
    expect(
      sendDialogErrors({
        ...base,
        testemunhas: { ...t, gestor: null, motivo: "corretor_e_lider" },
      })[0],
    ).toMatch(/próprio líder/);
    expect(sendDialogErrors({ ...base, imobiliariaIds: [IMOB, "g1"], testemunhas: t })[0]).toMatch(
      /não pode assinar também pela imobiliária/,
    );
    expect(sendDialogErrors({ ...base, testemunhas: { ...t, pdfOk: false } })[0]).toMatch(
      /Gere o PDF/,
    );
    expect(
      sendDialogErrors({ ...base, testemunhas: { ...t, problemas: ["Testemunha 1: falta CPF"] } }),
    ).toEqual(["Testemunha 1: falta CPF"]);
  });
});
