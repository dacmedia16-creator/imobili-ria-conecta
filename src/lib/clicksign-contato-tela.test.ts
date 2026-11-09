// @vitest-environment jsdom
// t_867f464c — tela Signatários: alerta de não entregue, "falta aplicar", Corrigir contato (corretor
// avisa o gestor; gestor aplica). Só mock: sem rede, dados fictícios.
import { createElement } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClicksignGestaoEnvelope } from "@/components/exclusividades/ClicksignGestaoEnvelope";
import type { ClicksignEnvelopeInfo } from "./exclusive-clicksign";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
afterEach(cleanup);

const CAP = "11111111-1111-4111-8111-111111111111";
const env = {
  id: "e",
  status: "running",
  last_notified_at: null,
} as unknown as ClicksignEnvelopeInfo;
const signers = [
  {
    idx: 0,
    papel: "proprietario_1",
    label: "Proprietário 1",
    nome: "Luiz Exemplo",
    email: "an***@example.com",
    signed: false,
    found: true,
    editable: true,
    undelivered: true,
  },
  {
    idx: 1,
    papel: "proprietario_2",
    label: "Proprietário 2",
    nome: "Maria Exemplo",
    email: "ma***@example.com",
    signed: false,
    found: true,
    editable: true,
    capture_email: "no***@example.com",
    capture_differs: true,
  },
  {
    idx: 2,
    papel: "testemunha",
    label: "Testemunha 1",
    nome: "Tânia T",
    email: "ta***@example.com",
    signed: true,
    found: true,
    editable: false,
  },
];

function fakeDb(rpcResult: Record<string, unknown>) {
  const invoke = vi.fn(async (_fn: string, opts: { body: Record<string, unknown> }) =>
    opts.body.action === "status"
      ? { data: { ok: true, signers }, error: null }
      : { data: { ok: true }, error: null },
  );
  const rpc = vi.fn(async () => ({ data: rpcResult, error: null }));
  return { db: { functions: { invoke }, rpc } as unknown as SupabaseClient, invoke, rpc };
}

describe("Signatários (captação em assinatura)", () => {
  it("corretor: vê alerta de não entregue, 'falta aplicar', Corrigir contato e aviso do gestor", async () => {
    const { db, invoke, rpc } = fakeDb({
      mudou: true,
      pode_aplicar: false,
      envelope_ativo: true,
      precisa_aplicar: true,
      avisados: 1,
    });
    render(
      createElement(ClicksignGestaoEnvelope, {
        db,
        captureId: CAP,
        envelope: env,
        testMode: false,
        canManage: false,
        podeCorrigirContato: true,
        onChanged: vi.fn(),
      }),
    );
    await waitFor(() => expect(screen.getByTestId("signer-nao-entregue")).toBeTruthy());
    expect(screen.getByTestId("signer-nao-entregue").textContent).toMatch(
      /e-mail possivelmente errado/,
    );
    expect(screen.getByTestId("signer-falta-aplicar").textContent).toMatch(
      /gestor precisa aplicar/,
    );
    expect(screen.queryByTestId("signer-aplicar")).toBeNull();
    expect(screen.queryByRole("button", { name: /Corrigir contato Testemunha/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Corrigir contato Proprietário 1/ }));
    fireEvent.change(screen.getByLabelText("E-mail correto"), {
      target: { value: "novo@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Salvar e avisar o gestor/ }));
    await waitFor(() => expect(screen.getByTestId("aviso-peca-gestor")).toBeTruthy());
    expect(screen.getByTestId("aviso-peca-gestor").textContent).toMatch(
      /O documento já foi enviado/,
    );
    expect(rpc).toHaveBeenCalledWith(
      "exclusive_contato_assinatura_salvar",
      expect.objectContaining({ _id: CAP, _owner: 1, _email: "novo@example.com" }),
    );
    expect(invoke.mock.calls.every((c) => c[1].body.action === "status")).toBe(true);
  });
  it("gestor: 'Aplicar na Clicksign' chama edit_signer com usar_captacao (sem e-mail na tela)", async () => {
    const { db, invoke } = fakeDb({});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      createElement(ClicksignGestaoEnvelope, {
        db,
        captureId: CAP,
        envelope: env,
        testMode: false,
        canManage: true,
        podeCorrigirContato: true,
        onChanged: vi.fn(),
      }),
    );
    await waitFor(() => expect(screen.getByTestId("signer-aplicar")).toBeTruthy());
    fireEvent.click(screen.getByTestId("signer-aplicar"));
    await waitFor(() =>
      expect(invoke.mock.calls.some((c) => c[1].body.action === "edit_signer")).toBe(true),
    );
    const call = invoke.mock.calls.find((c) => c[1].body.action === "edit_signer")!;
    expect(call[1].body).toEqual({
      capture_id: CAP,
      action: "edit_signer",
      idx: 1,
      usar_captacao: true,
    });
  });
});
