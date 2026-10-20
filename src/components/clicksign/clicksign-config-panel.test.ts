// @vitest-environment jsdom
// Painel "Assinatura digital" (t_7508c6b6): botão Ligar bloqueado até tudo pronto, desligar pede
// confirmação, chave nunca aparece na tela. Dados fictícios.
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClicksignConfigPanel, type ConfigPanelProps } from "./ClicksignConfigPanel";
import type { ClicksignConfig } from "@/lib/clicksign-config";

afterEach(cleanup);

const cfg = (o: Partial<ClicksignConfig> = {}): ClicksignConfig => ({
  enabled: false,
  sale_enabled: false,
  test_mode: true,
  allowlist_count: 2,
  deadline_days: 30,
  signer_ids: [],
  valid_signers: 0,
  token: { configured: false, set_at: null },
  webhook: { configured: false, set_at: null, slug: "a".repeat(36) },
  webhook_url: "https://projeto.example.com/functions/v1/clicksign-webhook/" + "a".repeat(36),
  connection: { ok: null, checked_at: null },
  candidates: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      nome: "Diretora Fictícia",
      email: "di***@example.com",
      email_ok: true,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      nome: "Sem Email Fictício",
      email: "",
      email_ok: false,
    },
  ],
  audit: [],
  ...o,
});
const pronto = (o: Partial<ClicksignConfig> = {}) =>
  cfg({
    token: { configured: true, set_at: "2026-10-19T22:00:00Z" },
    webhook: { configured: true, set_at: "2026-10-19T22:01:00Z", slug: "a".repeat(36) },
    valid_signers: 1,
    signer_ids: ["11111111-1111-4111-8111-111111111111"],
    connection: { ok: true, checked_at: "2026-10-19T22:02:00Z" },
    ...o,
  });

function panel(config: ClicksignConfig, over: Partial<ConfigPanelProps> = {}) {
  const props: ConfigPanelProps = {
    config,
    busy: false,
    lastTest: null,
    onSaveSecret: vi.fn(async () => true),
    onSave: vi.fn(async () => true),
    onTest: vi.fn(),
    onSetEnabled: vi.fn(),
    onCopy: vi.fn(),
    ...over,
  };
  render(createElement(ClicksignConfigPanel, props));
  return props;
}

describe("ClicksignConfigPanel", () => {
  it("nada configurado: Ligar bloqueado, Testar bloqueado, lista do que falta", () => {
    panel(cfg());
    expect(
      (screen.getByRole("button", { name: "Ligar assinatura digital" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: /Testar conexão/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId("requisitos").textContent).toMatch(/Chave de API salva: falta/);
    expect(screen.getByText("Chave não configurada")).toBeTruthy();
  });

  it("teste reprovado mantém Ligar bloqueado", () => {
    panel(pronto({ connection: { ok: false, checked_at: "2026-10-19T22:02:00Z" } }));
    expect(
      (screen.getByRole("button", { name: "Ligar assinatura digital" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("tudo pronto: Ligar pede confirmação e só então liga", () => {
    const p = panel(pronto());
    const ligar = screen.getByRole("button", {
      name: "Ligar assinatura digital",
    }) as HTMLButtonElement;
    expect(ligar.disabled).toBe(false);
    fireEvent.click(ligar);
    expect(p.onSetEnabled).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sim, ligar" }));
    expect(p.onSetEnabled).toHaveBeenCalledWith(true);
  });

  it("ligada: Desligar pede confirmação; cancelar não desliga", () => {
    const p = panel(pronto({ enabled: true, sale_enabled: true }));
    fireEvent.click(screen.getByRole("button", { name: "Desligar assinatura digital" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(p.onSetEnabled).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Desligar assinatura digital" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, desligar" }));
    expect(p.onSetEnabled).toHaveBeenCalledWith(false);
  });

  it("chave configurada: só 'configurada' e data; campo vazio (nada mascarado)", () => {
    panel(pronto());
    expect(screen.getByText(/Chave configurada em/)).toBeTruthy();
    const input = screen.getByLabelText("Trocar chave") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.type).toBe("password");
    expect(document.body.textContent).not.toMatch(/\*\*\*\*/);
  });

  it("salvar chave limpa o campo depois de salva", async () => {
    const p = panel(cfg());
    const input = screen.getByLabelText("Colar chave") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "chave-ficticia-de-teste-0001" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Salvar" })[0]);
    expect(p.onSaveSecret).toHaveBeenCalledWith("access_token", "chave-ficticia-de-teste-0001");
    await vi.waitFor(() => expect(input.value).toBe(""));
  });

  it("mostra o endereço do webhook e copia", () => {
    const p = panel(cfg());
    const url = screen.getByLabelText("Endereço do webhook desta imobiliária") as HTMLInputElement;
    expect(url.value).toMatch(/\/functions\/v1\/clicksign-webhook\/a{36}$/);
    fireEvent.click(screen.getByRole("button", { name: /Copiar/ }));
    expect(p.onCopy).toHaveBeenCalledWith(url.value);
  });

  it("quem assina: usuário sem e-mail não pode ser marcado; salvar envia os ids", () => {
    const p = panel(cfg());
    expect((screen.getByLabelText(/Sem Email Fictício/) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Diretora Fictícia/));
    fireEvent.click(screen.getByRole("button", { name: "Salvar quem assina" }));
    expect(p.onSave).toHaveBeenCalledWith({ signer_ids: ["11111111-1111-4111-8111-111111111111"] });
  });

  it("allowlist: e-mail inválido bloqueia; lista nunca é mostrada, só a contagem", () => {
    panel(cfg());
    expect(screen.getByText(/2 e-mail\(s\) cadastrados/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("E-mails liberados no modo teste"), {
      target: { value: "ok@example.com, ruim" },
    });
    expect(screen.getByText(/E-mail inválido: ruim/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /Substituir lista/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
