// t_867f464c — e-mail do proprietário corrigido depois do envio: captação × Clicksign sincronizados,
// alerta de convite não entregue (tracking_notification_error). Só mock: sem rede, e-mails fictícios.
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../supabase/functions/_shared/clicksign.ts";
import {
  captureDiffs,
  handleManage,
  type ManageContext,
  type ManageDeps,
} from "../../supabase/functions/clicksign-manage/core.ts";
import { contatoErrors, ownerNumberOfPapel } from "./exclusive-clicksign";

const CAP = "11111111-1111-4111-8111-111111111111";
const ENV = "77777777-7777-4777-8777-777777777777";
const DOC = "66666666-6666-4666-8666-666666666666";
const S = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const people = [
  { papel: "proprietario_1", nome: "Luiz Exemplo", email: "antigo@example.com" },
  { papel: "proprietario_2", nome: "Maria Exemplo", email: "maria@example.com" },
  { papel: "testemunha", nome: "Tânia Testemunha", email: "tania@example.com" },
] as const;

/** Evento como a Clicksign v3 devolve (formato conferido por GET em 09/11, sem e-mail real). */
const bounce = (email: string) => ({
  attributes: {
    name: "tracking_notification_error",
    data: {
      signer: { key: "k", email, name: "X" },
      notification: { kind: "signature_reminder", last_status: "bounce" },
    },
  },
});

async function setup(
  opts: {
    ownerEmails?: string[];
    events?: unknown[];
    signed?: string[];
    sync?: (idx: number, email: string) => Promise<string>;
    doneFails?: boolean;
  } = {},
) {
  const stored = await Promise.all(
    people.map(async (p) => ({
      papel: p.papel,
      nome: p.nome,
      email_sha256: await sha256Hex(p.email),
    })),
  );
  const calls: string[] = [];
  const bodies: Record<string, unknown> = {};
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace(/^https:\/\/[^/]+\/api\/v3/, "").replace(/\?.*$/, "");
    const key = `${init.method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`;
    calls.push(key);
    if (init.body) bodies[key] = JSON.parse(String(init.body));
    if (key === "GET /envelopes/:id/signers")
      return Response.json({
        data: people.map((p, i) => ({
          id: S(i + 1),
          attributes: { name: p.nome, email: p.email },
        })),
      });
    if (key === "GET /envelopes/:id/documents/:id/events")
      return Response.json({
        data: [
          ...(opts.signed ?? []).map((e) => ({
            attributes: { name: "sign", data: { signer: { email: e } } },
          })),
          ...(opts.events ?? []),
        ],
      });
    if (key === "GET /envelopes/:id/events") return Response.json({ data: [] });
    if (key === "GET /envelopes/:id/requirements")
      return Response.json({
        data: [1, 2, 3].flatMap((i) =>
          [`a${i}`, `b${i}`].map((r) => ({
            id: r,
            attributes: { action: "agree" },
            relationships: { signer: { data: { id: S(i) } }, document: { data: { id: DOC } } },
          })),
        ),
      });
    if (key === "POST /envelopes/:id/signers")
      return Response.json({ data: { id: S(99) } }, { status: 201 });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ data: { attributes: {} } }, { status: 201 });
  });
  const done = vi.fn(async () => {
    if (opts.doneFails) throw new Error("done_failed");
  });
  const sync = vi.fn(async (_row: string, idx: number, email: string) =>
    opts.sync ? opts.sync(idx, email) : "ok",
  );
  const ctx: ManageContext = {
    envelopeRow: "row-1",
    envelopeKey: ENV,
    documentKey: DOC,
    isTest: false,
    signers: stored,
    testMode: false,
    allowlistSha256: [],
    token: "tok-fake",
    ownerEmails: opts.ownerEmails,
  };
  const deps: ManageDeps = {
    actorId: "actor",
    fetch,
    authorize: vi.fn(async () => ({ org: "org", envelope: "row-1" })),
    authorizeView: vi.fn(async () => ({ org: "org", envelope: "row-1", canManage: false })),
    loadContext: vi.fn(async () => ctx),
    lock: vi.fn(async () => "ok" as const),
    done,
    syncCaptureSigner: sync,
  };
  return { deps, calls, bodies, done, sync, ctx };
}

describe("status: alerta de convite não entregue", () => {
  it("marca só o signatário com tracking_notification_error no e-mail atual", async () => {
    const { deps } = await setup({ events: [bounce("antigo@example.com")] });
    const r = await handleManage(deps, { capture_id: CAP, action: "status" });
    expect(r.status).toBe(200);
    const s = r.body.signers as Array<Record<string, unknown>>;
    expect(s.map((x) => x.undelivered)).toEqual([true, false, false]);
    expect(JSON.stringify(r.body)).not.toMatch(/antigo@example\.com|maria@example\.com/);
  });
  it("bounce de um e-mail que já foi trocado não marca o novo; quem abriu não fica marcado", async () => {
    const { deps } = await setup({
      events: [
        bounce("outro-antigo@example.com"),
        bounce("maria@example.com"),
        {
          attributes: {
            name: "signature_started",
            data: { signer: { email: "maria@example.com" } },
          },
        },
      ],
    });
    const s = (await handleManage(deps, { capture_id: CAP, action: "status" })).body
      .signers as Array<Record<string, unknown>>;
    expect(s.map((x) => x.undelivered)).toEqual([false, false, false]);
  });
});

describe("status: captação × envelope", () => {
  it("proprietário com e-mail diferente na captação vem como 'falta aplicar', mascarado", async () => {
    const { deps } = await setup({
      ownerEmails: ["novo.certo@example.com", "maria@example.com"],
    });
    // Corretor só acompanha (canManage=false), mas vê a diferença.
    const s = (await handleManage(deps, { capture_id: CAP, action: "status" })).body
      .signers as Array<Record<string, unknown>>;
    expect(s[0]).toMatchObject({ capture_differs: true, capture_email: "no***@example.com" });
    expect(s[1]).not.toHaveProperty("capture_differs");
    expect(s[2]).not.toHaveProperty("capture_differs");
    expect(JSON.stringify(s)).not.toMatch(/novo\.certo@/);
  });
  it("captureDiffs ignora e-mail inválido/vazio e contexto sem captação (venda)", async () => {
    const { ctx } = await setup({ ownerEmails: ["", "x"] });
    expect((await captureDiffs(ctx)).size).toBe(0);
    expect((await captureDiffs({ ...ctx, ownerEmails: undefined })).size).toBe(0);
  });
});

describe("edit_signer: os dois sentidos", () => {
  it("'Aplicar na Clicksign' usa o e-mail da captação (a tela não manda e-mail) e sincroniza", async () => {
    const { deps, bodies, done, sync } = await setup({
      ownerEmails: ["novo.certo@example.com", "maria@example.com"],
    });
    const r = await handleManage(deps, {
      capture_id: CAP,
      action: "edit_signer",
      idx: 0,
      usar_captacao: true,
    });
    expect(r).toMatchObject({ status: 200, body: { ok: true, email: "no***@example.com" } });
    expect(r.body).not.toHaveProperty("warning");
    const created = bodies["POST /envelopes/:id/signers"] as {
      data: { attributes: { name: string; email: string } };
    };
    expect(created.data.attributes).toMatchObject({
      name: "Luiz Exemplo",
      email: "novo.certo@example.com",
    });
    const call = (
      done.mock.calls as unknown as Array<[string, { signers: Array<{ email_sha256: string }> }]>
    ).at(-1)!;
    expect(call[1].signers[0].email_sha256).toBe(await sha256Hex("novo.certo@example.com"));
    expect(sync).toHaveBeenCalledWith("row-1", 0, "novo.certo@example.com");
  });
  it("'Editar' com e-mail digitado também atualiza a captação (sync)", async () => {
    const { deps, sync } = await setup({
      ownerEmails: ["antigo@example.com", "maria@example.com"],
    });
    const r = await handleManage(deps, {
      capture_id: CAP,
      action: "edit_signer",
      idx: 0,
      nome: "Luiz Exemplo",
      email: "digitado@example.com",
    });
    expect(r.status).toBe(200);
    expect(sync).toHaveBeenCalledWith("row-1", 0, "digitado@example.com");
  });
  it("só nome mudou: não sincroniza e-mail", async () => {
    const { deps, sync } = await setup();
    const r = await handleManage(deps, {
      capture_id: CAP,
      action: "edit_signer",
      idx: 0,
      nome: "Luiz Exemplo Silva",
      email: "antigo@example.com",
    });
    expect(r.status).toBe(200);
    expect(sync).not.toHaveBeenCalled();
  });
  it("registro do envelope falhou: não sincroniza (evita captação diferente do envelope gravado)", async () => {
    const { deps, sync } = await setup({ doneFails: true });
    const r = await handleManage(deps, {
      capture_id: CAP,
      action: "edit_signer",
      idx: 0,
      nome: "Luiz Exemplo",
      email: "digitado@example.com",
    });
    expect(r.status).toBe(200);
    expect(String(r.body.warning)).toMatch(/registro no ADM MAX falhou/);
    expect(sync).not.toHaveBeenCalled();
  });
  it("sync falhou: a troca vale, com aviso claro (sem reverter nada na Clicksign)", async () => {
    const { deps, calls } = await setup({
      sync: async () => {
        throw new Error("x");
      },
    });
    const r = await handleManage(deps, {
      capture_id: CAP,
      action: "edit_signer",
      idx: 0,
      nome: "Luiz Exemplo",
      email: "digitado@example.com",
    });
    expect(r.status).toBe(200);
    expect(String(r.body.warning)).toMatch(/e-mail da captação não foi atualizado/);
    expect(calls.filter((c) => c.startsWith("DELETE"))).toHaveLength(1);
  });
  it("usar_captacao sem e-mail válido na captação: 422 sem chamar a Clicksign", async () => {
    const { deps, calls } = await setup({ ownerEmails: [""] });
    const r = await handleManage(deps, {
      capture_id: CAP,
      action: "edit_signer",
      idx: 0,
      usar_captacao: true,
    });
    expect(r.status).toBe(422);
    expect(calls).toHaveLength(0);
  });
  it("usar_captacao com captação igual ao envelope: 422 'Nada mudou'", async () => {
    const { deps, calls } = await setup({ ownerEmails: ["antigo@example.com"] });
    const r = await handleManage(deps, {
      capture_id: CAP,
      action: "edit_signer",
      idx: 0,
      usar_captacao: true,
    });
    expect(r.status).toBe(422);
    expect(String(r.body.error)).toMatch(/Nada mudou/);
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
  });
  it("usar_captacao não vale na venda (só captação)", async () => {
    const { deps } = await setup({ ownerEmails: ["novo.certo@example.com"] });
    const r = await handleManage(
      deps,
      { sale_id: CAP, action: "edit_signer", idx: 0, usar_captacao: true },
      "venda",
    );
    expect(r.status).toBe(422);
  });
  it("nunca reenvia nem cancela envelope por conta própria: status não chama POST/DELETE", async () => {
    const { deps, calls } = await setup({
      ownerEmails: ["novo.certo@example.com"],
      events: [bounce("antigo@example.com")],
    });
    await handleManage(deps, { capture_id: CAP, action: "status" });
    expect(calls.every((c) => c.startsWith("GET"))).toBe(true);
  });
});

describe("tela: validações", () => {
  it("contatoErrors: e-mail obrigatório, telefone opcional com 10 a 13 dígitos", () => {
    expect(contatoErrors("a@example.com", "")).toEqual([]);
    expect(contatoErrors("a@example.com", "(15) 99999-9999")).toEqual([]);
    expect(contatoErrors("x", "")).toEqual(["E-mail ausente ou inválido"]);
    expect(contatoErrors("a@example.com", "123")).toEqual(["Telefone inválido"]);
    expect(contatoErrors("a@example.com", "abc1234567890")).toEqual(["Telefone inválido"]);
  });
  it("ownerNumberOfPapel", () => {
    expect(ownerNumberOfPapel("proprietario_3")).toBe(3);
    expect(ownerNumberOfPapel("testemunha")).toBeNull();
  });
});
