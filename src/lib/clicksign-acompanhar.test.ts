// @vitest-environment jsdom
// Corretor acompanha a assinatura Clicksign (só leitura) na captação e na venda — t_82e51349.
// Só mock: sem rede, e-mails fictícios.
import { createElement } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../supabase/functions/_shared/clicksign.ts";
import { handleManage, type ManageDeps } from "../../supabase/functions/clicksign-manage/core.ts";
import { ClicksignGestaoEnvelope } from "@/components/exclusividades/ClicksignGestaoEnvelope";
import { ClicksignVenda } from "@/components/vendas/ClicksignVenda";
import {
  canFollowEnvelope,
  canManageEnvelope,
  type ClicksignCaptureConfig,
  type ClicksignEnvelopeInfo,
  type ManagedSigner,
} from "./exclusive-clicksign";
import type { ClicksignSaleConfig } from "./sale-clicksign";

afterEach(cleanup);

const CAP = "11111111-1111-4111-8111-111111111111";
const SALE = "22222222-2222-4222-8222-222222222222";
const ENV = "77777777-7777-4777-8777-777777777777";
const DOC = "66666666-6666-4666-8666-666666666666";
const S = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const people = [
  { papel: "proprietario_1", nome: "Ana Teste", email: "ana@example.com" },
  { papel: "corretor", nome: "Carlos Corretor", email: "corretor@example.com" },
  { papel: "testemunha", nome: "Tânia Testemunha", email: "tania@example.com" },
] as const;

async function deps(): Promise<ManageDeps & { fetch: ReturnType<typeof vi.fn> }> {
  const stored = await Promise.all(
    people.map(async (p) => ({
      papel: p.papel,
      nome: p.nome,
      email_sha256: await sha256Hex(p.email),
    })),
  );
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace(/^https:\/\/[^/]+\/api\/v3/, "").replace(/\?.*$/, "");
    const key = `${init.method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`;
    if (key === "GET /envelopes/:id/signers")
      return Response.json({
        data: people.map((p, i) => ({
          id: S(i + 1),
          attributes: { name: p.nome, email: p.email },
        })),
      });
    if (key === "GET /envelopes/:id/documents/:id/events")
      return Response.json({
        data: [{ attributes: { name: "sign", data: { signer: { email: "ana@example.com" } } } }],
      });
    return Response.json({ data: [] });
  });
  return {
    actorId: "actor",
    fetch,
    authorize: vi.fn(async () => {
      throw new Error(
        "Apenas gestor, team leader, jurídico ou admin da imobiliária pode gerenciar a assinatura",
      );
    }),
    authorizeView: vi.fn(async () => ({ org: "org", envelope: "row-1", canManage: false })),
    loadContext: vi.fn(async () => ({
      envelopeRow: "row-1",
      envelopeKey: ENV,
      documentKey: DOC,
      isTest: true,
      signers: stored,
      testMode: false,
      allowlistSha256: [],
      token: "tok-fake",
    })),
    lock: vi.fn(async () => "ok" as const),
    done: vi.fn(async () => undefined),
  };
}

describe("edge clicksign-manage/clicksign-sale: corretor só acompanha", () => {
  it("status usa a leitura (authorizeView): lista com e-mail mascarado e NADA editável", async () => {
    const d = await deps();
    for (const [kind, body] of [
      ["captacao", { capture_id: CAP, action: "status" }],
      ["venda", { sale_id: SALE, action: "status" }],
    ] as const) {
      const r = await handleManage(d, body, kind);
      expect(r.status).toBe(200);
      const s = r.body.signers as Array<Record<string, unknown>>;
      expect(s.map((x) => [x.nome, x.signed, x.editable])).toEqual([
        ["Ana Teste", true, false],
        ["Carlos Corretor", false, false],
        ["Tânia Testemunha", false, false],
      ]);
      expect(JSON.stringify(r.body)).not.toMatch(/ana@example\.com|tania@example\.com|tok-fake/);
      expect(s[2].email).toBe("ta***@example.com");
    }
    expect(d.authorize).not.toHaveBeenCalled();
  });

  it("escrita (notify, edit_signer, cancel_papel) continua no authorize de quem gerencia: 403", async () => {
    const d = await deps();
    for (const body of [
      { capture_id: CAP, action: "notify" },
      {
        capture_id: CAP,
        action: "edit_signer",
        idx: 2,
        nome: "Outra Pessoa",
        email: "x@example.com",
      },
      { capture_id: CAP, action: "cancel_papel" },
    ]) {
      const r = await handleManage({ ...d, markCanceledPapel: vi.fn() }, body);
      expect(r.status).toBe(403);
    }
    const venda = await handleManage(d, { sale_id: SALE, action: "notify" }, "venda");
    expect(venda.status).toBe(403);
    expect(d.authorizeView).not.toHaveBeenCalled();
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.lock).not.toHaveBeenCalled();
  });

  it("outra equipe/outra imobiliária: a leitura nega (403) e a Clicksign nem é chamada", async () => {
    const d = await deps();
    d.authorizeView = vi.fn(async () => {
      throw new Error("Sem acesso a esta captação");
    });
    const r = await handleManage(d, { capture_id: CAP, action: "status" });
    // Leitura negada cai no authorize de quem gerencia, que também nega: 403 sem Clicksign.
    expect(r.status).toBe(403);
    expect(d.authorize).toHaveBeenCalledTimes(1);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("leitura indisponível (RPC nova ainda não aplicada): gestor continua vendo pela regra antiga", async () => {
    const d = await deps();
    d.authorizeView = vi.fn(async () => {
      throw new Error("function public.clicksign_capture_view_authorize(uuid) does not exist");
    });
    d.authorize = vi.fn(async () => ({ org: "org", envelope: "row-1" }));
    const r = await handleManage(d, { capture_id: CAP, action: "status" });
    expect(r.status).toBe(200);
    const s = r.body.signers as Array<Record<string, unknown>>;
    expect(s.map((x) => x.editable)).toEqual([false, false, true]);
  });

  it("gestor (can_manage=true) continua com proprietário/testemunha pendente editável", async () => {
    const d = await deps();
    d.authorizeView = vi.fn(async () => ({ org: "org", envelope: "row-1", canManage: true }));
    const r = await handleManage(d, { capture_id: CAP, action: "status" });
    const s = r.body.signers as Array<Record<string, unknown>>;
    expect(s.map((x) => x.editable)).toEqual([false, false, true]);
  });
});

// ---------- telas ----------

const signers: ManagedSigner[] = [
  {
    idx: 0,
    papel: "proprietario_1",
    label: "Proprietário 1",
    nome: "Ana Teste",
    email: "an***@example.com",
    signed: true,
    status: "assinou",
    found: true,
    editable: false,
  },
  {
    idx: 1,
    papel: "corretor",
    label: "Corretor",
    nome: "Carlos Corretor",
    email: "co***@example.com",
    signed: false,
    opened: true,
    status: "abriu",
    found: true,
    editable: false,
  },
  {
    idx: 2,
    papel: "testemunha",
    label: "Testemunha 1",
    nome: "Tânia Testemunha",
    email: "ta***@example.com",
    signed: false,
    status: "enviado",
    found: true,
    editable: true,
  },
];
const env: ClicksignEnvelopeInfo = {
  status: "running",
  is_test: false,
  created_at: "2026-10-28T10:00:00Z",
  error_code: null,
  signed: false,
};
function fakeDb() {
  const invoke = vi.fn(async (_fn: string, opts: { body: { action: string } }) =>
    opts.body.action === "status"
      ? { data: { ok: true, signers }, error: null }
      : { data: null, error: new Error("não deveria escrever") },
  );
  return { db: { functions: { invoke } } as unknown as SupabaseClient, invoke };
}

function expectReadOnly() {
  expect(screen.getByText(/faltam 2/)).toBeTruthy();
  expect(screen.getByText(/Ana Teste/)).toBeTruthy();
  expect(screen.getByText("ta***@example.com")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Atualizar/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Editar/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Reenviar aviso/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Cancelar/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Conferir na Clicksign/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /papel/i })).toBeNull();
}

describe("tela da captação (passo 4)", () => {
  const base = {
    enabled: true as const,
    test_mode: false,
    witnesses: 2,
    deadline_days: 30,
    imobiliaria: [],
    corretor_email_ok: true,
    envelope: env,
  };
  it("regra: corretor acompanha (canFollow) mas não gerencia; gestor faz os dois", () => {
    const corretor: ClicksignCaptureConfig = { ...base, can_send: false };
    const gestor: ClicksignCaptureConfig = { ...base, can_send: true };
    expect([canFollowEnvelope(corretor), canManageEnvelope(corretor)]).toEqual([true, false]);
    expect([canFollowEnvelope(gestor), canManageEnvelope(gestor)]).toEqual([true, true]);
    expect(canFollowEnvelope({ enabled: false })).toBe(false);
    expect(canFollowEnvelope({ ...corretor, envelope: { ...env, status: "closed" } })).toBe(false);
  });

  it("corretor dono vê a lista e 'faltam N', sem Editar nem Reenviar aviso", async () => {
    const { db, invoke } = fakeDb();
    render(
      createElement(ClicksignGestaoEnvelope, {
        db,
        captureId: CAP,
        envelope: env,
        testMode: false,
        canManage: false,
        onChanged: vi.fn(),
      }),
    );
    await waitFor(() => expect(screen.getByText(/faltam 2/)).toBeTruthy());
    expectReadOnly();
    expect(screen.getByText(/Assinou/)).toBeTruthy();
    expect(screen.getByText(/Abriu/)).toBeTruthy();
    expect(invoke.mock.calls.every((c) => c[1].body.action === "status")).toBe(true);
  });

  it("gestor continua vendo Editar e Reenviar aviso", async () => {
    const { db } = fakeDb();
    render(
      createElement(ClicksignGestaoEnvelope, {
        db,
        captureId: CAP,
        envelope: env,
        testMode: false,
        onChanged: vi.fn(),
      }),
    );
    await waitFor(() => expect(screen.getByText(/faltam 2/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /Editar Testemunha 1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reenviar aviso/ })).toBeTruthy();
  });
});

describe("tela da venda", () => {
  const cfg = (can_send: boolean): ClicksignSaleConfig => ({
    enabled: true,
    test_mode: false,
    can_send,
    witnesses: 2,
    deadline_days: 30,
    libera_assinatura: true,
    contrato: null,
    imobiliaria: [],
    corretores: [],
    envelope: { ...env, contrato_atual: true },
  });
  const venda = (can_send: boolean, db: SupabaseClient) =>
    render(
      createElement(ClicksignVenda, {
        db,
        saleId: SALE,
        status: "aguardando_assinatura",
        config: cfg(can_send),
        parties: [],
        sendOpen: false,
        onSendOpenChange: vi.fn(),
        onIrParaParte: vi.fn(),
        signedDoc: null,
        onOpenSignedDoc: vi.fn(),
        onChanged: vi.fn(),
      }),
    );

  it("corretor vê a lista e 'faltam N', sem Editar, Reenviar, Cancelar ou trocar para papel", async () => {
    const { db, invoke } = fakeDb();
    venda(false, db);
    await waitFor(() => expect(screen.getByText(/faltam 2/)).toBeTruthy());
    expectReadOnly();
    expect(invoke.mock.calls.every((c) => c[1].body.action === "status")).toBe(true);
  });

  it("gestor continua com Editar, Reenviar aviso e Cancelar assinatura", async () => {
    const { db } = fakeDb();
    venda(true, db);
    await waitFor(() => expect(screen.getByText(/faltam 2/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /Editar Testemunha 1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reenviar aviso/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Cancelar assinatura/ })).toBeTruthy();
  });
});
