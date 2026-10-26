// @vitest-environment jsdom
// t_71832765: Denis trocou o nome da IA para "Nicole" e o banco continuou com o nome antigo. Os registros
// de acesso mostraram que só "Salvar prazos" (lead_config_salvar) foi chamado; "Salvar IA" nunca chegou.
// Agora o botão do rodapé grava também a IA quando há alteração não salva nela, e a seção avisa.
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chamadas: string[] = [];
const iaGravada: { nome?: string } = {};
const falharIa = { on: false };

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/leads-db", () => ({
  lerIaConfig: async () => ({
    ia_ativa: true,
    ia_nome: "Emanuella",
    ia_boas_vindas: null,
    ia_canal: "teste",
    ia_primeira_msg: null,
    ia_reengajar: false,
  }),
  nomeImobiliaria: async () => "Imobiliária Teste",
  salvarIaConfig: async (c: { ia_nome: string }) => {
    chamadas.push("lead_ia_config_salvar");
    if (falharIa.on) throw new Error("falhou");
    iaGravada.nome = c.ia_nome.trim();
  },
  salvarRoteiroIa: async () => {
    chamadas.push("lead_ia_roteiro_salvar");
  },
  salvarConfig: async () => {
    chamadas.push("lead_config_salvar");
  },
  configurarFormulario: vi.fn(),
  tokenGrupoOlx: vi.fn(),
  lerIaRetornoConfig: async () => ({ ia_retorno_token_em: null, ia_modelo_provedor: "gemini", ia_modelo: null }),
  tokenRetornoIa: vi.fn(),
  salvarModeloIa: vi.fn(),
}));

const { LeadsConfigDialog } = await import("@/components/leads/LeadsConfigDialog");
const { CONFIG_PADRAO } = await import("@/lib/leads");
const { iaConfigMudou } = await import("@/lib/leads-ia");

function abrir(onOpenChange = vi.fn()) {
  render(
    createElement(LeadsConfigDialog, {
      open: true,
      onOpenChange,
      config: CONFIG_PADRAO,
      onSaved: vi.fn(),
      admin: true,
    }),
  );
  return onOpenChange;
}

async function digitarNome(nome: string) {
  const campo = (await screen.findByLabelText("Nome com que a IA se apresenta")) as HTMLInputElement;
  expect(campo.value).toBe("Emanuella");
  fireEvent.change(campo, { target: { value: nome } });
}

beforeEach(() => {
  chamadas.length = 0;
  delete iaGravada.nome;
  falharIa.on = false;
});
afterEach(cleanup);

describe("Configuração dos leads — nome da IA não se perde (t_71832765)", () => {
  it("nome trocado + 'Salvar prazos' grava a IA antes de fechar", async () => {
    const fechar = abrir();
    await digitarNome("Nicole");
    expect(screen.getByText("Alterações da IA ainda não salvas.")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Salvar prazos" })));
    await waitFor(() => expect(fechar).toHaveBeenCalledWith(false));
    expect(chamadas).toEqual(["lead_ia_config_salvar", "lead_ia_roteiro_salvar", "lead_config_salvar"]);
    expect(iaGravada.nome).toBe("Nicole");
  });

  it("'Salvar IA' grava o nome e o aviso some", async () => {
    abrir();
    await digitarNome("  Nicole ");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Salvar IA" })));
    await waitFor(() => expect(iaGravada.nome).toBe("Nicole"));
    expect(screen.queryByText("Alterações da IA ainda não salvas.")).toBeNull();
    expect(chamadas).toEqual(["lead_ia_config_salvar", "lead_ia_roteiro_salvar"]);
  });

  it("sem mudança na IA, 'Salvar prazos' grava só os prazos (como antes)", async () => {
    abrir();
    await screen.findByLabelText("Nome com que a IA se apresenta");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Salvar prazos" })));
    await waitFor(() => expect(chamadas).toEqual(["lead_config_salvar"]));
  });

  it("se a IA falhar ao salvar, os prazos não são gravados e a janela continua aberta", async () => {
    falharIa.on = true;
    const fechar = abrir();
    await digitarNome("Nicole");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Salvar prazos" })));
    await waitFor(() => expect(chamadas).toEqual(["lead_ia_config_salvar"]));
    expect(fechar).not.toHaveBeenCalled();
  });
});

describe("iaConfigMudou", () => {
  const base = { ia_ativa: true, ia_nome: "Emanuella", ia_primeira_msg: null, ia_reengajar: false };
  it("detecta nome, 1ª mensagem, liga/desliga e lembrete", () => {
    expect(iaConfigMudou(base, base)).toBe(false);
    expect(iaConfigMudou(base, { ...base, ia_nome: " Emanuella " })).toBe(false);
    expect(iaConfigMudou(base, { ...base, ia_primeira_msg: "  " })).toBe(false);
    expect(iaConfigMudou(base, { ...base, ia_nome: "Nicole" })).toBe(true);
    expect(iaConfigMudou(base, { ...base, ia_primeira_msg: "Oi?" })).toBe(true);
    expect(iaConfigMudou(base, { ...base, ia_ativa: false })).toBe(true);
    expect(iaConfigMudou(base, { ...base, ia_reengajar: true })).toBe(true);
  });
});
