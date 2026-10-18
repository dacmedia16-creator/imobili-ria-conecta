// clicksign-manage (editar signatário / reenviar aviso / status) — só mock: sem rede, e-mails fictícios.
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../supabase/functions/_shared/clicksign.ts";
import { handleManage, type ManageDeps } from "../../supabase/functions/clicksign-manage/core.ts";
import {
  canManageEnvelope,
  clicksignCaptureSigned,
  currentSignedDoc,
  editSignerErrors,
  hasSignedStep,
  notifyWaitMinutes,
  signedOrigin,
  signedSignerLabels,
} from "./exclusive-clicksign";

const CAP = "11111111-1111-4111-8111-111111111111";
const ENV = "77777777-7777-4777-8777-777777777777";
const DOC = "66666666-6666-4666-8666-666666666666";
const S = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const people = [
  { papel: "proprietario_1", nome: "Ana Teste", email: "ana@example.com" },
  { papel: "corretor", nome: "Carlos Corretor", email: "corretor@example.com" },
  { papel: "testemunha", nome: "Tânia Testemunha", email: "errado@example.com" },
] as const;

async function setup(
  opts: {
    signed?: string[];
    failOn?: string;
    lock?: "ok" | "busy" | "cooldown";
    testMode?: boolean;
    allow?: string[];
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
    if (init.body)
      bodies[key] = {
        body: JSON.parse(String(init.body)),
        ct: (init.headers as Record<string, string>)["Content-Type"],
      };
    if (opts.failOn === key)
      return new Response(JSON.stringify({ errors: [{ detail: "x" }] }), { status: 422 });
    if (key === "GET /envelopes/:id/signers")
      return Response.json({
        data: people.map((p, i) => ({
          id: S(i + 1),
          attributes: { name: p.nome, email: p.email },
        })),
      });
    if (key === "GET /envelopes/:id/documents/:id/events")
      return Response.json({
        data: (opts.signed ?? []).map((e) => ({
          attributes: { name: "sign", data: { signer: { email: e } } },
        })),
      });
    if (key === "GET /envelopes/:id/requirements")
      return Response.json({
        data: [1, 2, 3].flatMap((i) =>
          [`a${i}`, `b${i}`].map((r) => ({
            id: `${r}`,
            relationships: { signer: { data: { id: S(i) } }, document: { data: { id: DOC } } },
          })),
        ),
      });
    if (key === "POST /envelopes/:id/signers")
      return Response.json({ data: { id: S(99) } }, { status: 201 });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ data: { attributes: {} } }, { status: 201 });
  });
  const done = vi.fn(async () => undefined);
  const deps: ManageDeps = {
    actorId: "actor",
    fetch,
    authorize: vi.fn(async () => ({ org: "org", envelope: "row-1" })),
    loadContext: vi.fn(async () => ({
      envelopeRow: "row-1",
      envelopeKey: ENV,
      documentKey: DOC,
      isTest: true,
      signers: stored,
      testMode: opts.testMode ?? false,
      allowlistSha256: opts.allow ?? [],
      token: "tok-fake",
    })),
    lock: vi.fn(async () => opts.lock ?? "ok"),
    done,
  };
  return { deps, calls, bodies, done, fetch };
}
const edit = {
  capture_id: CAP,
  action: "edit_signer",
  idx: 2,
  nome: "Tânia Testemunha",
  email: "certo@example.com",
};

describe("clicksign-manage: status", () => {
  it("marca quem assinou, mascara e-mail e só libera edição de proprietário/testemunha pendente", async () => {
    const { deps } = await setup({ signed: ["ana@example.com"] });
    const r = await handleManage(deps, { capture_id: CAP, action: "status" });
    expect(r.status).toBe(200);
    const s = r.body.signers as Array<Record<string, unknown>>;
    expect(s.map((x) => [x.signed, x.editable])).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);
    expect(JSON.stringify(r.body)).not.toMatch(/errado@example\.com|ana@example\.com/);
    expect(s[2].email).toBe("er***@example.com");
  });
  it("não autorizado: 403 sem chamar a Clicksign", async () => {
    const { deps, fetch } = await setup();
    deps.authorize = vi.fn(async () => {
      throw new Error("Apenas gestor");
    });
    expect((await handleManage(deps, { capture_id: CAP, action: "status" })).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("clicksign-manage: editar signatário", () => {
  it("cria o novo, troca requisitos em bulk (atomic), apaga o antigo, notifica e grava só hash", async () => {
    const { deps, calls, bodies, done } = await setup();
    const r = await handleManage(deps, edit);
    expect(r).toMatchObject({ status: 200, body: { ok: true } });
    expect(r.body).not.toHaveProperty("warning");
    const order = calls.filter((c) => !c.startsWith("GET"));
    expect(order).toEqual([
      "POST /envelopes/:id/signers",
      "POST /envelopes/:id/bulk_requirements",
      "DELETE /envelopes/:id/signers/:id",
      "POST /envelopes/:id/notifications",
    ]);
    const signer = bodies["POST /envelopes/:id/signers"] as {
      body: { data: { attributes: object } };
    };
    expect(signer.body.data.attributes).not.toHaveProperty("group");
    const bulk = bodies["POST /envelopes/:id/bulk_requirements"] as {
      body: {
        "atomic:operations": Array<{
          op: string;
          ref?: { id: string };
          data?: { attributes: Record<string, unknown> };
        }>;
      };
      ct: string;
    };
    expect(bulk.ct).toContain('ext="https://jsonapi.org/ext/atomic"');
    const ops = bulk.body["atomic:operations"];
    expect(ops.filter((o) => o.op === "remove").map((o) => o.ref?.id)).toEqual(["a3", "b3"]);
    expect(ops.filter((o) => o.op === "add").map((o) => o.data?.attributes)).toEqual([
      { action: "agree", role: "witness" },
      { action: "provide_evidence", auth: "email" },
    ]);
    const call = (
      done.mock.calls as unknown as Array<
        [string, { action: string; signers: Array<{ email_sha256?: string }> }]
      >
    ).at(-1)!;
    expect(call[1].action).toBe("clicksign_signatario");
    expect(call[1].signers[2].email_sha256).toBe(await sha256Hex("certo@example.com"));
    expect(JSON.stringify(call[1])).not.toMatch(/@/);
  });
  it("quem já assinou não pode ser editado (409) e nada é criado", async () => {
    const { deps, calls } = await setup({ signed: ["errado@example.com"] });
    expect((await handleManage(deps, edit)).status).toBe(409);
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
  });
  it("corretor não é editável; e-mail inválido, repetido ou fora da allowlist em teste: 422 sem API", async () => {
    const { deps, fetch } = await setup({ testMode: true });
    expect((await handleManage(deps, { ...edit, idx: 1 })).status).toBe(422);
    expect((await handleManage(deps, { ...edit, email: "x" })).status).toBe(422);
    expect((await handleManage(deps, { ...edit, email: "ana@example.com" })).status).toBe(422);
    const r = await handleManage(deps, edit);
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/Modo teste/);
    expect(fetch).not.toHaveBeenCalled();
    const ok = await setup({ testMode: true, allow: [await sha256Hex("certo@example.com")] });
    expect((await handleManage(ok.deps, edit)).status).toBe(200);
  });
  it("bulk falha: remove o signatário novo, mantém o antigo e solta a trava", async () => {
    const { deps, calls, done } = await setup({ failOn: "POST /envelopes/:id/bulk_requirements" });
    const r = await handleManage(deps, edit);
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/Nada foi alterado/);
    expect(calls.filter((c) => c.startsWith("DELETE"))).toHaveLength(1);
    expect(calls.some((c) => c.endsWith("/notifications"))).toBe(false);
    expect(
      (done.mock.calls as unknown as Array<[string, Record<string, unknown>]>).at(-1)![1].action,
    ).toBeNull();
  });
  it("troca feita mas aviso falha: 200 com aviso e histórico registra 'aviso NÃO enviado'", async () => {
    const { deps, done } = await setup({ failOn: "POST /envelopes/:id/notifications" });
    const r = await handleManage(deps, edit);
    expect(r.status).toBe(200);
    expect(r.body.warning).toMatch(/Reenviar aviso/);
    expect(
      (done.mock.calls as unknown as Array<[string, { detail: string }]>).at(-1)![1].detail,
    ).toMatch(/NÃO enviado/);
  });
  it("trava ocupada (duplo clique): 409 sem chamar a Clicksign para escrever", async () => {
    const { deps, calls } = await setup({ lock: "busy" });
    expect((await handleManage(deps, edit)).status).toBe(409);
    expect(calls.some((c) => !c.startsWith("GET"))).toBe(false);
  });
});

describe("clicksign-manage: reenviar aviso", () => {
  it("reenvia e registra no histórico", async () => {
    const { deps, calls, done } = await setup();
    const r = await handleManage(deps, { capture_id: CAP, action: "notify" });
    expect(r).toMatchObject({ status: 200, body: { ok: true } });
    expect(calls).toEqual(["POST /envelopes/:id/notifications"]);
    expect(
      (done.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0][1],
    ).toMatchObject({ action: "clicksign_aviso", notified: true });
  });
  it("dentro dos 10 min: 429 sem chamar a Clicksign", async () => {
    const { deps, fetch } = await setup({ lock: "cooldown" });
    const r = await handleManage(deps, { capture_id: CAP, action: "notify" });
    expect(r.status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("falha da Clicksign: 502, solta a trava e não marca aviso", async () => {
    const { deps, done } = await setup({ failOn: "POST /envelopes/:id/notifications" });
    expect((await handleManage(deps, { capture_id: CAP, action: "notify" })).status).toBe(502);
    expect((done.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0][1]).toEqual({
      action: null,
    });
  });
});

describe("tela: gestão e passo 5", () => {
  const env = {
    status: "running" as const,
    is_test: true,
    created_at: "",
    error_code: null,
    signed: false,
  };
  const cfg = {
    enabled: true as const,
    test_mode: true,
    can_send: true,
    witnesses: 2,
    deadline_days: 30,
    imobiliaria: [],
    corretor_email_ok: true,
    envelope: env,
  };
  it("gestão só para quem pode enviar com envelope running", () => {
    expect(canManageEnvelope(cfg)).toBe(true);
    expect(canManageEnvelope({ ...cfg, can_send: false })).toBe(false);
    expect(canManageEnvelope({ ...cfg, envelope: { ...env, status: "closed" } })).toBe(false);
  });
  it("contador do reenviar aviso e validação do formulário de edição", () => {
    const now = Date.parse("2026-10-18T10:00:00Z");
    expect(notifyWaitMinutes({ ...env, notify_available_at: "2026-10-18T10:04:10Z" }, now)).toBe(5);
    expect(notifyWaitMinutes({ ...env, notify_available_at: "2026-10-18T09:00:00Z" }, now)).toBe(0);
    expect(notifyWaitMinutes(env, now)).toBe(0);
    expect(editSignerErrors("Ana", "x")).toHaveLength(2);
    expect(editSignerErrors("Ana Silva", "ana@example.com")).toEqual([]);
  });
  describe("passo 5 segue a regra do banco (assinado >= gerado; sem gerado só aprovada)", () => {
    const T1 = "2026-10-01T10:00:00Z";
    const T2 = "2026-10-18T10:00:00Z";
    const gerado = (t: string) => ({ id: `g-${t}`, kind: "gerado", created_at: t });
    const assinado = (t: string) => ({ id: `a-${t}`, kind: "assinado", created_at: t });
    // ClicksignEnvio aparece no passo 4 quando `step === "revisao" && !signedStep`.
    const passos = (manual: boolean, status: string, docs: Parameters<typeof hasSignedStep>[1]) =>
      manual ? "manual" : hasSignedStep(manual, docs, status) ? 5 : 4;

    it("(a) assinado mais novo que o gerado → 5 passos, com esse assinado", () => {
      const docs = [gerado(T1), assinado(T2)];
      expect(passos(false, "em_assinatura", docs)).toBe(5);
      expect(currentSignedDoc(false, "em_assinatura", docs)?.id).toBe(`a-${T2}`);
      // mesmo instante também vale (>=, igual ao banco)
      expect(passos(false, "enviada", [gerado(T2), assinado(T2)])).toBe(5);
    });
    it("(b) assinado antigo + gerado novo (aprovada devolvida e reenviada) → 4 passos, Clicksign visível", () => {
      const docs = [assinado(T1), gerado(T2)];
      for (const status of ["devolvida", "enviada", "em_assinatura"]) {
        expect(passos(false, status, docs)).toBe(4);
        expect(currentSignedDoc(false, status, docs)).toBeNull();
      }
      // devolvida e ainda sem gerado novo: o assinado velho é só histórico
      expect(passos(false, "devolvida", [assinado(T1)])).toBe(4);
      expect(passos(false, "enviada", [assinado(T1)])).toBe(4);
      // novo assinado depois do gerado novo: volta a ter passo 5, com o contrato novo
      const novo = [assinado(T1), gerado("2026-10-10T10:00:00Z"), assinado(T2)];
      expect(currentSignedDoc(false, "em_assinatura", novo)?.id).toBe(`a-${T2}`);
    });
    it("(c) aprovada antiga só com assinado (sem gerado) → 5 passos", () => {
      expect(passos(false, "aprovada", [assinado(T1)])).toBe(5);
      expect(passos(false, "aprovada", [{ kind: "assinado" }])).toBe(5);
    });
    it("(d) cadastro manual → fluxo próprio, sem passo 5", () => {
      expect(passos(true, "enviada", [assinado(T2)])).toBe("manual");
      expect(hasSignedStep(true, [gerado(T1), assinado(T2)], "aprovada")).toBe(false);
      expect(currentSignedDoc(true, "aprovada", [assinado(T2)])).toBeNull();
    });
    it("sem assinado → 4 passos", () => {
      expect(passos(false, "em_assinatura", [gerado(T1)])).toBe(4);
      expect(passos(false, "rascunho", [])).toBe(4);
    });
  });
  it("origem: envelope assinado de outro documento (upload manual por cima) conta como manual", async () => {
    const info = {
      document_id: DOC,
      is_test: false,
      closed_at: "2026-10-18T10:00:00Z",
      signers: [],
    };
    const db = { rpc: vi.fn(async () => ({ data: info, error: null })) } as unknown as Parameters<
      typeof clicksignCaptureSigned
    >[0];
    expect(await clicksignCaptureSigned(db, CAP, "outro-doc")).toBeNull();
    expect(await clicksignCaptureSigned(db, CAP, DOC)).toMatchObject({ is_test: false });
    expect(signedOrigin(await clicksignCaptureSigned(db, CAP, "outro-doc"))).toMatch(
      /Upload manual/,
    );
  });
  it("origem e quem assinou", () => {
    expect(signedOrigin(null)).toMatch(/Upload manual/);
    expect(signedOrigin({ is_test: true, closed_at: "", signers: [] })).toMatch(
      /Clicksign \(TESTE\)/,
    );
    expect(signedOrigin("unknown", "contrato-assinado-clicksign.pdf")).toMatch(/Clicksign/);
    expect(signedOrigin("unknown", "meu.pdf")).toMatch(/Upload manual/);
    expect(
      signedSignerLabels([
        { papel: "proprietario_1", nome: "Ana" },
        { papel: "testemunha", nome: "T1" },
        { papel: "testemunha", nome: "T2" },
        { papel: "imobiliaria", nome: "Vera" },
      ]),
    ).toEqual(["Proprietário 1: Ana", "Testemunha 1: T1", "Testemunha 2: T2", "Imobiliária: Vera"]);
  });
});
