// Nome do documento enviado à Clicksign (t_aa274590) — só mock: sem rede, e-mails fictícios.
/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON:API capturados do fetch falso */
import { describe, expect, it, vi } from "vitest";
import { nomeDocumentoClicksign, sha256Hex } from "../../supabase/functions/_shared/clicksign.ts";
import { handleSend, type SendDeps } from "../../supabase/functions/clicksign-send/core.ts";
import { handleSale, type SaleDeps } from "../../supabase/functions/clicksign-sale/core.ts";

const CAP = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const IMOB = "33333333-3333-4333-8333-333333333333";
const DOC = "55555555-5555-4555-8555-555555555555";
const SALE = "66666666-6666-4666-8666-666666666666";

/** Fetch falso: guarda o corpo de cada chamada pela chave "MÉTODO /caminho". */
function fakeFetch() {
  const bodies: Record<string, any> = {};
  let n = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace(/^https:\/\/[^/]+\/api\/v3/, "").replace(/\?.*$/, "");
    const key = `${init.method ?? "GET"} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`;
    if (init.body && !bodies[key]) bodies[key] = JSON.parse(String(init.body));
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    if (key === "GET /envelopes/:id/documents/:id")
      return Response.json({ data: { attributes: { status: "running" } } });
    n += 1;
    const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    return Response.json({ data: { id, attributes: {} } }, { status: 201 });
  });
  return { fetch, bodies };
}
const envName = (b: Record<string, any>) => b["POST /envelopes"].data.attributes.name as string;
const fileName = (b: Record<string, any>) =>
  b["POST /envelopes/:id/documents"].data.attributes.filename as string;

describe("nomeDocumentoClicksign", () => {
  it("junta título e trechos com travessão e põe a extensão só no arquivo", () => {
    expect(
      nomeDocumentoClicksign("Contrato de Exclusividade", ["Ana Silva", "Centro", "Carlos"], "pdf"),
    ).toEqual({
      name: "Contrato de Exclusividade – Ana Silva – Centro – Carlos",
      filename: "Contrato de Exclusividade – Ana Silva – Centro – Carlos.pdf",
    });
  });
  it("omite trecho vazio, nulo ou indefinido sem traço duplo nem 'undefined'", () => {
    const r = nomeDocumentoClicksign("Contrato", ["", null, undefined, "  ", "Carlos", 42], "pdf");
    expect(r.name).toBe("Contrato – Carlos");
    expect(r.name).not.toMatch(/undefined|null|– –|––/);
  });
  it("remove caracteres inválidos para nome de arquivo e espaços repetidos", () => {
    const r = nomeDocumentoClicksign("Contrato", ['Ana/Silva: "A"*?<>|\\x', "Vila\tNova\n"], "PDF");
    expect(r.name).toBe("Contrato – Ana Silva A x – Vila Nova");
    expect(r.filename).toBe("Contrato – Ana Silva A x – Vila Nova.pdf");
    // eslint-disable-next-line no-control-regex -- confere que não sobrou caractere de controle
    expect(r.filename).not.toMatch(/[\\/:*?"<>|\u0000-\u001f]/);
  });
  it("trecho só de traços/pontos some; traço do código do imóvel é mantido", () => {
    expect(nomeDocumentoClicksign("Contrato", ["-", "...", "630601113-27"], "pdf").name).toBe(
      "Contrato – 630601113-27",
    );
  });
  it("acima de 100 caracteres corta na última palavra inteira, sem traço solto no fim", () => {
    const r = nomeDocumentoClicksign(
      "Contrato de Exclusividade",
      ["Fulano de Tal Teste", "Jardim São Paulo", "Corretor Fictício Conferência"],
      "pdf",
      "TESTE - ",
    );
    expect(r.name).toBe(
      "TESTE - Contrato de Exclusividade – Fulano de Tal Teste – Jardim São Paulo – Corretor Fictício",
    );
    expect(r.name.length).toBeLessThanOrEqual(100);
    const r2 = nomeDocumentoClicksign("C", ["a".repeat(96), "Bairro"], "pdf");
    expect(r2.name).toBe(`C – ${"a".repeat(96)}`);
  });
  it("prefixo do modo teste e teto de 100 caracteres no nome", () => {
    const r = nomeDocumentoClicksign("Contrato", ["x".repeat(200)], "docx", "TESTE - ");
    expect(r.name.startsWith("TESTE - Contrato – ")).toBe(true);
    expect(r.name.length).toBeLessThanOrEqual(100);
    expect(r.filename.endsWith(".docx")).toBe(true);
  });
});

function sendDeps(form: Record<string, unknown>, testMode = false) {
  const cs = fakeFetch();
  const deps: SendDeps = {
    actorId: "actor",
    fetch: cs.fetch,
    authorize: vi.fn(async () => ORG),
    loadContext: vi.fn(async () => ({
      organizationId: ORG,
      form,
      testemunhas: {
        corretor: { nome: "Carlos Corretor", email: "corretor@example.com" },
        gestor: { nome: "Gina Gestora", email: "gestor@example.com" },
        problemas: [],
        pdfOk: true,
      },
      imobiliaria: [{ id: IMOB, nome: "Vera Imobiliária", email: "vera@example.com" }],
      testMode,
      allowlistSha256: [],
      deadlineDays: 30,
      token: "tok-fake",
      gerado: { id: DOC, fileName: "c.pdf" },
    })),
    loadPdf: vi.fn(async () => new TextEncoder().encode("%PDF-1.4 TESTE")),
    insertEnvelope: vi.fn(async () => "row-1"),
    updateEnvelope: vi.fn(async () => undefined),
    markSent: vi.fn(async () => undefined),
  };
  return { deps, bodies: cs.bodies };
}
const owner = (nome: string) => ({ nome_completo: nome, email: "ana@example.com" });

describe("clicksign-send: nome do contrato de exclusividade", () => {
  it("Contrato de Exclusividade – Proprietário 1 – Bairro – Corretor", async () => {
    const { deps, bodies } = sendDeps({
      proprietario_1: owner("Ana Teste Silva"),
      imovel: { bairro: "Jardim Europa" },
    });
    const r = await handleSend(deps, { capture_id: CAP, imobiliaria_ids: [IMOB] });
    expect(r.status).toBe(200);
    const esperado =
      "Contrato de Exclusividade – Ana Teste Silva – Jardim Europa – Carlos Corretor";
    expect(envName(bodies)).toBe(esperado);
    expect(fileName(bodies)).toBe(`${esperado}.pdf`);
  });
  it("sem bairro: omite o trecho e envia normalmente", async () => {
    const { deps, bodies } = sendDeps({ proprietario_1: owner("Ana Teste Silva"), imovel: {} });
    expect((await handleSend(deps, { capture_id: CAP, imobiliaria_ids: [IMOB] })).status).toBe(200);
    expect(envName(bodies)).toBe("Contrato de Exclusividade – Ana Teste Silva – Carlos Corretor");
  });
  it("modo teste mantém o prefixo TESTE", async () => {
    const emails = [
      "ana@example.com",
      "vera@example.com",
      "corretor@example.com",
      "gestor@example.com",
    ];
    const { deps, bodies } = sendDeps(
      { proprietario_1: owner("Ana Teste Silva"), imovel: { bairro: "Centro" } },
      true,
    );
    const base = await deps.loadContext(ORG, CAP);
    deps.loadContext = vi.fn(async () => ({
      ...base,
      allowlistSha256: await Promise.all(emails.map((e) => sha256Hex(e))),
    }));
    expect((await handleSend(deps, { capture_id: CAP, imobiliaria_ids: [IMOB] })).status).toBe(200);
    expect(envName(bodies)).toBe(
      "TESTE - Contrato de Exclusividade – Ana Teste Silva – Centro – Carlos Corretor",
    );
  });
});

function saleDeps(corretores: Array<{ nome: string; email: string }>, imovel: string) {
  const cs = fakeFetch();
  const deps = {
    actorId: "actor",
    fetch: cs.fetch,
    authorizeSend: vi.fn(async () => ({ org: ORG, contrato: DOC })),
    loadSendContext: vi.fn(async () => ({
      parties: [
        { papel: "vendedor_1", nome: "Vitor Vendedor", email: "vitor@example.com" },
        { papel: "comprador_1", nome: "Clara Compradora", email: "clara@example.com" },
      ],
      corretores,
      imobiliaria: [{ id: IMOB, nome: "Edson Imobiliaria", email: "edson@example.com" }],
      saleEnabled: true,
      testMode: false,
      allowlistSha256: [],
      deadlineDays: 30,
      token: "tok-fake",
      contrato: { id: DOC, fileName: "contrato.docx" },
      imovel,
    })),
    resolveExtras: vi.fn(async () => []),
    loadFile: vi.fn(async () => new TextEncoder().encode("arquivo do jurídico")),
    insertEnvelope: vi.fn(async () => "row-1"),
    updateEnvelope: vi.fn(async () => undefined),
    markSent: vi.fn(async () => undefined),
    cancelReason: vi.fn(async () => null),
    markCanceled: vi.fn(async () => "canceled"),
  } as unknown as SaleDeps;
  return { deps, bodies: cs.bodies };
}
const saleBody = {
  sale_id: SALE,
  action: "send",
  imobiliaria_ids: [IMOB],
  testemunhas: [
    { nome: "Tânia Testemunha", email: "t1@example.com" },
    { nome: "Otávio Testemunha", email: "t2@example.com" },
  ],
  extras: [],
};

describe("clicksign-sale: nome do contrato de compra e venda", () => {
  it("Contrato de Compra e Venda – ID do imóvel – Corretor (extensão do arquivo do jurídico)", async () => {
    const { deps, bodies } = saleDeps(
      [{ nome: "Carlos Corretor", email: "carlos@example.com" }],
      "630601113-27",
    );
    const r = await handleSale(deps, saleBody);
    expect(r.status).toBe(200);
    expect(envName(bodies)).toBe("Contrato de Compra e Venda – 630601113-27 – Carlos Corretor");
    expect(fileName(bodies)).toBe(
      "Contrato de Compra e Venda – 630601113-27 – Carlos Corretor.docx",
    );
  });
  it("captador e vendedor diferentes: os dois, em ordem alfabética; sem ID do imóvel, omite", async () => {
    const { deps, bodies } = saleDeps(
      [
        { nome: "Paula Vendedora", email: "paula@example.com" },
        { nome: "Bruno Captador", email: "bruno@example.com" },
      ],
      "",
    );
    expect((await handleSale(deps, saleBody)).status).toBe(200);
    expect(envName(bodies)).toBe("Contrato de Compra e Venda – Bruno Captador e Paula Vendedora");
  });
});
