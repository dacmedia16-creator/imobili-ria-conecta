// @vitest-environment jsdom
/**
 * Método Denis no diálogo do CRM (t_ab39e04e): mover para Acompanhamento pós-dossiê já vem com hoje + 7 e o
 * motivo sugerido; no funil de venda, proposta recusada / visita não realizada traz atalhos 7/10/15 (padrão 7).
 * É só sugestão: o corretor altera e a data + motivo continuam obrigatórios (o banco repete a regra).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";

const moverLead = vi.fn();
const salvarProximo = vi.fn();
vi.mock("@/lib/crm-db", () => ({
  moverLead: (...a: unknown[]) => moverLead(...a),
  salvarProximo: (...a: unknown[]) => salvarProximo(...a),
  converterCaptacao: vi.fn(),
  converterVenda: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/crm", async (orig) => ({
  ...(await orig<typeof import("@/lib/crm")>()),
  hojeSP: () => "2026-11-27",
}));

import { CrmMoverDialog } from "./CrmMoverDialog";
import type { Lead } from "@/lib/leads";

afterEach(cleanup);
beforeEach(() => {
  moverLead.mockReset().mockResolvedValue(undefined);
  salvarProximo.mockReset().mockResolvedValue(undefined);
});

const lead = (p: Record<string, unknown>) =>
  ({
    id: "L1",
    nome: "Cliente",
    etapa: "em_atendimento",
    funil: "captacao",
    proximo_contato_em: null,
    proximo_contato_motivo: null,
    ...p,
  }) as unknown as Lead;

const abrir = (pedido: Parameters<typeof CrmMoverDialog>[0]["pedido"]) =>
  render(
    createElement(CrmMoverDialog, {
      pedido,
      motivos: [],
      captacaoLigada: true,
      unidades: [],
      onClose: vi.fn(),
      onDone: vi.fn(),
    }),
  );
const campoData = () => document.querySelector('input[type="date"]') as HTMLInputElement;
const campoMotivo = () => screen.getByPlaceholderText(/ligar para confirmar/i) as HTMLInputElement;

describe("captação: Acompanhamento pós-dossiê (+7 dias)", () => {
  it("mover da 2ª visita para o acompanhamento já vem com 04/12 e o motivo sugerido", async () => {
    abrir({ lead: lead({ etapa: "proposta" }), para: "acompanhamento", tipo: "proximo" });
    expect(screen.getByText("Mover para Acompanhamento pós-dossiê")).toBeTruthy();
    await waitFor(() => expect(campoData().value).toBe("2026-12-04"));
    expect(campoMotivo().value).toBe("Perguntar como está a procura pelo imóvel");
    expect(screen.getByTestId("crm-sugestao-acompanhamento")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mover" }));
    await waitFor(() =>
      expect(moverLead).toHaveBeenCalledWith("L1", "acompanhamento", {
        proximoEm: "2026-12-04",
        proximoMotivo: "Perguntar como está a procura pelo imóvel",
      }),
    );
  });

  it("registrar contato e continuar no acompanhamento sugere +7 de novo; corretor pode trocar", async () => {
    abrir({
      lead: lead({
        etapa: "acompanhamento",
        proximo_contato_em: "2026-11-27",
        proximo_contato_motivo: "x",
      }),
      para: null,
      tipo: "proximo",
    });
    await waitFor(() => expect(campoData().value).toBe("2026-12-04"));
    fireEvent.change(campoData(), { target: { value: "2026-12-10" } });
    fireEvent.change(campoMotivo(), { target: { value: "Levar nova avaliação" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(salvarProximo).toHaveBeenCalledWith("L1", "2026-12-10", "Levar nova avaliação"),
    );
  });

  it("motivo apagado: botão fica travado (data + motivo obrigatórios)", async () => {
    abrir({ lead: lead({ etapa: "proposta" }), para: "acompanhamento", tipo: "proximo" });
    await waitFor(() => expect(campoMotivo().value).not.toBe(""));
    fireEvent.change(campoMotivo(), { target: { value: "  " } });
    expect((screen.getByRole("button", { name: "Mover" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("outras etapas da captação: comportamento de antes (amanhã, sem motivo)", async () => {
    abrir({ lead: lead({ etapa: "em_atendimento" }), para: "avaliacao", tipo: "proximo" });
    await waitFor(() => expect(campoData().value).toBe("2026-11-28"));
    expect(campoMotivo().value).toBe("");
    expect(screen.queryByTestId("crm-sugestao-acompanhamento")).toBeNull();
  });
});

describe("venda: retorno sugerido 7/10/15", () => {
  it("proposta recusada (Proposta → Em contato): padrão 7 e atalhos trocam a data", async () => {
    abrir({
      lead: lead({ funil: "venda", etapa: "proposta" }),
      para: "em_atendimento",
      tipo: "proximo",
    });
    await waitFor(() => expect(campoData().value).toBe("2026-12-04"));
    expect(campoMotivo().value).toBe("");
    const b7 = screen.getByRole("button", { name: "7 dias" });
    expect(b7.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "15 dias" }));
    expect(campoData().value).toBe("2026-12-12");
    fireEvent.click(screen.getByRole("button", { name: "10 dias" }));
    expect(campoData().value).toBe("2026-12-07");
    fireEvent.change(campoMotivo(), { target: { value: "Ver se ainda procura" } });
    fireEvent.click(screen.getByRole("button", { name: "Mover" }));
    await waitFor(() =>
      expect(moverLead).toHaveBeenCalledWith("L1", "em_atendimento", {
        proximoEm: "2026-12-07",
        proximoMotivo: "Ver se ainda procura",
      }),
    );
  });

  it("visita não realizada (Visita → Em contato) também mostra os atalhos", async () => {
    abrir({
      lead: lead({ funil: "venda", etapa: "visita_agendada" }),
      para: "em_atendimento",
      tipo: "proximo",
    });
    await waitFor(() => expect(screen.getByTestId("crm-atalhos-retorno")).toBeTruthy());
  });

  it("avançar (Em contato → Visita) não mostra atalhos", async () => {
    abrir({
      lead: lead({ funil: "venda", etapa: "em_atendimento" }),
      para: "visita_agendada",
      tipo: "proximo",
    });
    await waitFor(() => expect(campoData().value).toBe("2026-11-28"));
    expect(screen.queryByTestId("crm-atalhos-retorno")).toBeNull();
  });
});
