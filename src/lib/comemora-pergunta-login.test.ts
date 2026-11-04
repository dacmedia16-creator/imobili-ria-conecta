// @vitest-environment jsdom
/**
 * Pergunta "Você comemora aniversário?" depois do login (t_05a37081, Denis 04/11/2026).
 * - aparece só quando o banco diz que está pendente;
 * - Sim/Não gravam pela RPC comemora_responder e fecham a janela;
 * - erro ao ler = não aparece; erro ao gravar = aviso e fecha (não trava);
 * - visão da plataforma e "Entrar como": nem consulta.
 * Dados fictícios.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));
let auth: Record<string, unknown> = {};
vi.mock("@/lib/auth", () => ({ useAuth: () => auth }));

import { ComemoraAniversarioPergunta } from "@/components/ComemoraAniversarioPergunta";
import {
  MSG_ERRO_RESPOSTA_COMEMORA,
  perguntaComemoraPendente,
  responderComemora,
} from "@/lib/data-nascimento-db";

const AUTH_OK = {
  user: { id: "11111111-1111-4111-8111-111111111111" },
  loading: false,
  platformReady: true,
  platformContext: null,
  impersonation: null,
};

beforeEach(() => {
  auth = { ...AUTH_OK };
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  rpc.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

const pendente = (v: unknown, error: unknown = null) =>
  rpc.mockImplementation((fn: string) =>
    fn === "comemora_pergunta_pendente"
      ? Promise.resolve({ data: v, error })
      : Promise.resolve({ data: true, error: null }),
  );

describe("perguntaComemoraPendente / responderComemora", () => {
  it("true só quando o banco devolve true", async () => {
    pendente(true);
    expect(await perguntaComemoraPendente()).toBe(true);
    pendente(false);
    expect(await perguntaComemoraPendente()).toBe(false);
    pendente(null, { code: "PGRST202", message: "function not found" });
    expect(await perguntaComemoraPendente()).toBe(false);
    rpc.mockImplementation(() => Promise.reject(new Error("rede")));
    expect(await perguntaComemoraPendente()).toBe(false);
  });

  it("responder envia a escolha e traduz o erro", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await responderComemora(false);
    expect(rpc).toHaveBeenCalledWith("comemora_responder", { _comemora: false });
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "Sem data" } });
    await expect(responderComemora(true)).rejects.toThrow(MSG_ERRO_RESPOSTA_COMEMORA);
  });
});

describe("<ComemoraAniversarioPergunta />", () => {
  const abre = async () => {
    render(createElement(ComemoraAniversarioPergunta));
    return screen.findByTestId("comemora-pergunta");
  };

  it("pendente: mostra a pergunta e o aviso", async () => {
    pendente(true);
    const d = await abre();
    expect(d.textContent).toContain("Você comemora aniversário?");
    expect(d.textContent).toContain(
      "Se marcar Não, seu nome não aparece no mural de aniversariantes.",
    );
    expect(screen.getByTestId("comemora-pergunta-sim").textContent).toBe("Sim");
    expect(screen.getByTestId("comemora-pergunta-nao").textContent).toBe("Não");
  });

  it("Não: grava false, avisa e fecha", async () => {
    pendente(true);
    await abre();
    fireEvent.click(screen.getByTestId("comemora-pergunta-nao"));
    await waitFor(() => expect(screen.queryByTestId("comemora-pergunta")).toBeNull());
    expect(rpc).toHaveBeenCalledWith("comemora_responder", { _comemora: false });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("Sim: grava true e fecha", async () => {
    pendente(true);
    await abre();
    fireEvent.click(screen.getByTestId("comemora-pergunta-sim"));
    await waitFor(() => expect(screen.queryByTestId("comemora-pergunta")).toBeNull());
    expect(rpc).toHaveBeenCalledWith("comemora_responder", { _comemora: true });
  });

  it("erro ao gravar: mostra a mensagem e deixa seguir", async () => {
    rpc.mockImplementation((fn: string) =>
      fn === "comemora_pergunta_pendente"
        ? Promise.resolve({ data: true, error: null })
        : Promise.resolve({ data: null, error: { code: "57014", message: "timeout" } }),
    );
    await abre();
    fireEvent.click(screen.getByTestId("comemora-pergunta-sim"));
    await waitFor(() => expect(screen.queryByTestId("comemora-pergunta")).toBeNull());
    expect(toastError).toHaveBeenCalledWith(MSG_ERRO_RESPOSTA_COMEMORA);
    // No mesmo login não volta (nem ao recarregar); em outro login pergunta de novo.
    cleanup();
    rpc.mockClear();
    render(createElement(ComemoraAniversarioPergunta));
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comemora-pergunta")).toBeNull();
  });

  it("erro ao gravar com login identificado: volta só no próximo login", async () => {
    const jwt = (sid: string) =>
      `x.${btoa(JSON.stringify({ session_id: sid })).replace(/=+$/, "")}.y`;
    rpc.mockImplementation((fn: string) =>
      fn === "comemora_pergunta_pendente"
        ? Promise.resolve({ data: true, error: null })
        : Promise.resolve({ data: null, error: { message: "falhou" } }),
    );
    auth = { ...AUTH_OK, session: { access_token: jwt("login-1") } };
    await abre();
    fireEvent.click(screen.getByTestId("comemora-pergunta-nao"));
    await waitFor(() => expect(screen.queryByTestId("comemora-pergunta")).toBeNull());
    cleanup();
    render(createElement(ComemoraAniversarioPergunta));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("comemora-pergunta")).toBeNull();
    cleanup();
    auth = { ...AUTH_OK, session: { access_token: jwt("login-2") } };
    await abre();
    expect(screen.getByTestId("comemora-pergunta")).toBeTruthy();
  });

  it("Esc não fecha sem responder", async () => {
    pendente(true);
    const d = await abre();
    fireEvent.keyDown(d, { key: "Escape" });
    expect(screen.getByTestId("comemora-pergunta")).toBeTruthy();
  });

  it.each([
    ["não pendente", () => pendente(false)],
    ["erro ao ler", () => pendente(null, { message: "falhou" })],
  ])("%s: não aparece", async (_n, prep) => {
    prep();
    render(createElement(ComemoraAniversarioPergunta));
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledWith("comemora_pergunta_pendente");
    expect(screen.queryByTestId("comemora-pergunta")).toBeNull();
  });

  it.each([
    ["visão da plataforma", { platformContext: { org: "x" } }],
    ["Entrar como", { impersonation: { alvo: "y" } }],
    ["carregando login", { loading: true }],
    ["sem usuário", { user: null }],
  ])("%s: nem consulta o banco", async (_n, extra) => {
    auth = { ...AUTH_OK, ...extra };
    pendente(true);
    render(createElement(ComemoraAniversarioPergunta));
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comemora-pergunta")).toBeNull();
  });
});
