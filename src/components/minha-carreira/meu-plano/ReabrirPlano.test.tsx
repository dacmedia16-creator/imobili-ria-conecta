// @vitest-environment jsdom
/**
 * "Reabrir plano" (t_495e4305): a confirmação exige motivo (5–300 letras), chama carreira_plano_reabrir só ao
 * confirmar, com o motivo sem espaços nas pontas, e recarrega a tela depois. Cancelar não chama nada.
 * Quem pode reabrir é decidido no banco (suíte supabase/tests/meu_plano_reabrir.sql).
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";

const rpc = vi.fn();
vi.mock("@/lib/meu-plano-2027/modulo", async (orig) => ({
  ...(await orig<typeof import("@/lib/meu-plano-2027/modulo")>()),
  planoDb: { rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BotaoReabrirPlano } from "./ReabrirPlano";
import { motivoValido } from "@/lib/meu-plano-2027/reabrir";
import { erroPlano } from "@/lib/meu-plano-2027/modulo";

afterEach(cleanup);
beforeEach(() => rpc.mockReset());

describe("motivo", () => {
  it("aceita de 5 a 300 letras, sem contar espaços nas pontas", () => {
    expect(motivoValido("")).toBe(false);
    expect(motivoValido("   abcd   ")).toBe(false);
    expect(motivoValido("abcde")).toBe(true);
    expect(motivoValido("x".repeat(300))).toBe(true);
    expect(motivoValido("x".repeat(301))).toBe(false);
  });
});

describe("botão Reabrir plano", () => {
  it("abre a confirmação, exige motivo e chama a RPC com o motivo limpo", async () => {
    rpc.mockResolvedValue({ data: { status: "reaberto" }, error: null });
    const aoReabrir = vi.fn();
    render(createElement(BotaoReabrirPlano, { userId: "u1", nome: "Ana", aoReabrir }));
    expect(screen.queryByTestId("reabrir-confirmar")).toBeNull();
    fireEvent.click(screen.getByTestId("reabrir-plano"));
    expect(screen.getByText("Reabrir o plano de Ana?")).toBeTruthy();
    const ok = screen.getByTestId("reabrir-ok") as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("reabrir-motivo"), { target: { value: "abc" } });
    expect(ok.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("reabrir-motivo"), {
      target: { value: "  corrigir transações  " },
    });
    expect(ok.disabled).toBe(false);
    fireEvent.click(ok);
    await waitFor(() => expect(aoReabrir).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith("carreira_plano_reabrir", {
      _corretor: "u1",
      _ano: 2027,
      _motivo: "corrigir transações",
    });
  });

  it("cancelar não chama o banco; erro do banco não recarrega", async () => {
    const aoReabrir = vi.fn();
    render(createElement(BotaoReabrirPlano, { userId: "u1", nome: "Ana", aoReabrir }));
    fireEvent.click(screen.getByTestId("reabrir-plano"));
    fireEvent.click(screen.getByText("Cancelar"));
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({
      data: null,
      error: { message: "Só o gestor, o administrador ou o líder da equipe reabre o plano" },
    });
    fireEvent.click(screen.getByTestId("reabrir-plano"));
    fireEvent.change(screen.getByTestId("reabrir-motivo"), { target: { value: "motivo ok" } });
    fireEvent.click(screen.getByTestId("reabrir-ok"));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(aoReabrir).not.toHaveBeenCalled();
  });

  it("mensagens do banco viram texto simples", () => {
    expect(erroPlano("Você não pode reabrir o seu próprio plano")).toMatch(/próprio plano/);
    expect(erroPlano("Só o gestor, o administrador ou o líder da equipe reabre o plano")).toMatch(
      /líder da equipe do corretor/,
    );
    expect(erroPlano("Informe o motivo da reabertura (5 a 300 caracteres)")).toMatch(/motivo/);
    expect(erroPlano("Este plano não está assinado")).toMatch(/em preenchimento/);
  });
});

describe("onde o botão aparece", () => {
  it("só para plano assinado e nunca no próprio plano (Equipe e painel de metas)", () => {
    const eq = readFileSync("src/components/minha-carreira/meu-plano/Equipe.tsx", "utf8");
    expect(eq).toMatch(
      /m\.assinado_corretor_em && m\.user_id !== user\?\.id \? \(\s*<div className="pt-2">\s*<BotaoReabrirPlano/,
    );
    const pg = readFileSync("src/components/metas-2027/PainelMetasGestor.tsx", "utf8");
    expect(pg).toMatch(/assinado && c\.userId !== user\?\.id \? \(\s*<BotaoReabrirPlano/);
    expect(pg).toMatch(/aoReabrir=\{recarregar\}/);
  });
});
