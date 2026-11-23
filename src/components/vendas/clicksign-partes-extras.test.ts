// @vitest-environment jsdom
/**
 * Clicksign da venda — quadro "Partes extras" (t_bd3361f1, diagnóstico t_6f64d978, venda 631661014-4).
 * A: 2 anuentes incluídos = 2 linhas. B: pessoa digitada e não incluída bloqueia o envio, com aviso.
 * C: a confirmação lista nomes e papéis. D: com a janela aberta, nova referência de config.imobiliaria
 * não zera a lista. Nada chama a Clicksign: sendSaleToClicksign é substituído por um espião.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement as h } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

const send = vi.fn();
vi.mock("@/lib/sale-clicksign", async (orig) => ({
  ...(await orig<typeof import("@/lib/sale-clicksign")>()),
  sendSaleToClicksign: (...a: unknown[]) => send(...a),
  clicksignSaleCandidates: vi.fn(async () => []),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { EnvioDialog } from "./ClicksignVenda";
import { envioResumo, type ClicksignSaleConfig, type SaleParty } from "@/lib/sale-clicksign";

type Cfg = Extract<ClicksignSaleConfig, { enabled: true }>;
const cfg = (): Cfg => ({
  enabled: true,
  test_mode: true,
  can_send: true,
  witnesses: 2,
  deadline_days: 30,
  libera_assinatura: true,
  contrato: { id: "doc1", file_name: "contrato.pdf", size: 1000 },
  imobiliaria: [{ id: "im1", nome: "Gestora Única" }],
  corretores: [{ nome: "Carlos Corretor", email_ok: true }],
  envelope: null,
});
const parties = [
  { papel: "vendedor_1", nome: "Vera Vendedora", email: "vera@ex.com" },
  { papel: "comprador_1", nome: "Caio Comprador", email: "caio@ex.com" },
] as unknown as SaleParty[];

const props = (over: Partial<Parameters<typeof EnvioDialog>[0]> = {}) => ({
  db: {} as SupabaseClient,
  saleId: "s1",
  config: cfg(),
  parties,
  open: true,
  onOpenChange: vi.fn(),
  onIrParaParte: vi.fn(),
  onChanged: vi.fn(),
  ...over,
});

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const preencherTestemunhas = () => {
  type("Nome da testemunha 1", "Tereza Testemunha");
  type("E-mail da testemunha 1", "tereza@ex.com");
  type("Nome da testemunha 2", "Tiago Testemunha");
  type("E-mail da testemunha 2", "tiago@ex.com");
};
const incluirFora = (nome: string, email: string) => {
  type("Nome da pessoa de fora", nome);
  type("E-mail da pessoa de fora", email);
  fireEvent.click(screen.getByRole("button", { name: /Incluir esta pessoa/ }));
};
const enviarBtn = () =>
  screen.getByRole("button", { name: /Enviar pela Clicksign/ }) as HTMLButtonElement;
const linhasExtras = () =>
  within(screen.getByTestId("clicksign-extras-lista")).getAllByRole("listitem");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ signers: 9, is_test: true });
});

describe("Partes extras da Clicksign (venda)", () => {
  it("A: incluir 2 anuentes gera 2 linhas e o contador mostra 2", () => {
    render(h(EnvioDialog, props()));
    incluirFora("Ana Anuente", "ana@ex.com");
    incluirFora("Bia Anuente", "bia@ex.com");
    expect(linhasExtras()).toHaveLength(2);
    expect(screen.getByTestId("clicksign-fora-contador").textContent).toContain(
      "Pessoas de fora incluídas: 2",
    );
  });

  it("B: pessoa digitada e não incluída bloqueia o Enviar e mostra o aviso", () => {
    render(h(EnvioDialog, props()));
    preencherTestemunhas();
    expect(enviarBtn().disabled).toBe(false);
    type("Nome da pessoa de fora", "Bia Anuente");
    expect(enviarBtn().disabled).toBe(true);
    expect(screen.getByTestId("clicksign-fora-pendente").textContent).toContain(
      "Você digitou Bia Anuente mas não clicou em Incluir. Inclua ou limpe os campos antes de enviar.",
    );
    // Só o e-mail também conta como digitado.
    type("Nome da pessoa de fora", "");
    type("E-mail da pessoa de fora", "bia@ex.com");
    expect(enviarBtn().disabled).toBe(true);
    // Incluindo, libera.
    type("Nome da pessoa de fora", "Bia Anuente");
    fireEvent.click(screen.getByRole("button", { name: /Incluir esta pessoa/ }));
    expect(screen.queryByTestId("clicksign-fora-pendente")).toBeNull();
    expect(enviarBtn().disabled).toBe(false);
  });

  it("C: a confirmação lista nome e papel de todos os signatários antes de enviar", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(h(EnvioDialog, props()));
    preencherTestemunhas();
    incluirFora("Ana Anuente", "ana@ex.com");
    incluirFora("Bia Anuente", "bia@ex.com");
    fireEvent.click(enviarBtn());
    expect(confirm).toHaveBeenCalledTimes(1);
    const msg = String(confirm.mock.calls[0][0]);
    // 2 partes + corretor + imobiliária + 2 testemunhas + 2 anuentes.
    expect(msg).toContain("8 signatários");
    for (const nome of [
      "Vera Vendedora",
      "Caio Comprador",
      "Carlos Corretor",
      "Gestora Única",
      "Tereza Testemunha",
      "Tiago Testemunha",
      "Ana Anuente",
      "Bia Anuente",
    ])
      expect(msg).toContain(nome);
    expect(msg).toContain("Advogado(a): Ana Anuente");
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect((send.mock.calls[0][1] as { extras: unknown[] }).extras).toHaveLength(2);
    confirm.mockRestore();
  });

  it("C: cancelar a confirmação não envia", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(h(EnvioDialog, props()));
    preencherTestemunhas();
    fireEvent.click(enviarBtn());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("D: com a janela aberta, nova referência de config.imobiliaria não zera a lista", () => {
    const p = props();
    const { rerender } = render(h(EnvioDialog, p));
    incluirFora("Ana Anuente", "ana@ex.com");
    incluirFora("Bia Anuente", "bia@ex.com");
    rerender(h(EnvioDialog, { ...p, config: cfg() })); // mesmo conteúdo, nova referência
    expect(linhasExtras()).toHaveLength(2);
    // Fechar e abrir de novo começa do zero.
    rerender(h(EnvioDialog, { ...p, open: false }));
    rerender(h(EnvioDialog, { ...p, open: true }));
    expect(screen.queryByTestId("clicksign-extras-lista")).toBeNull();
  });

  it("envioResumo: nomes com papel, um por linha", () => {
    const r = envioResumo({
      parties,
      corretores: [{ nome: "Carlos Corretor", email_ok: true }],
      imobiliaria: [{ id: "im1", nome: "Gestora Única" }],
      testemunhas: [{ nome: "Tereza Testemunha", email: "t@ex.com" }],
      extras: [
        { origem: "externo", nome: "Ana Anuente", email: "a@ex.com", cpf: "", role: "consenting" },
      ],
    });
    expect(r).toEqual([
      "Vendedor(a): Vera Vendedora",
      "Comprador(a): Caio Comprador",
      "Corretor(a): Carlos Corretor",
      "Pela imobiliária: Gestora Única",
      "Testemunha: Tereza Testemunha",
      "Anuente: Ana Anuente",
    ]);
  });
});
