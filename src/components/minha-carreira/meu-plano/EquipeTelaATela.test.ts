// @vitest-environment jsdom
/**
 * Equipe · Abrir plano tela a tela (t_fb929978, Denis 23/11): o broker/TL entra na 1ª tela do corretor (ordem
 * única, sem a p52), navega com Anterior/Próxima, nada é editável, e depois da última tela vem o resumo
 * (O que falta, PDF, cockpit, pacto com "Assinar como broker"). O atalho "Ir direto ao resumo" pula para o fim.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";

const rpc = vi.fn();
const taxas = {
  select: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
};
vi.mock("@/lib/meu-plano-2027/modulo", async (orig) => ({
  ...(await orig<typeof import("@/lib/meu-plano-2027/modulo")>()),
  planoDb: { rpc: (...a: unknown[]) => rpc(...a), from: () => taxas },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "admin-1" }, roles: ["admin"] }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EquipePlano, TELAS_EQUIPE } from "./Equipe";
import { ORDEM } from "@/lib/meu-plano-2027/telas";

afterEach(cleanup);
// jsdom não implementa a rolagem (a tela volta ao topo ao trocar de passo).
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

const membro = {
  user_id: "u-ana",
  nome: "Ana Teste",
  trilha: null,
  ativacao_inicio: null,
  respostas: { "d.comissao": "200.000", "d.trans": "10", "p15.vgv": "100" },
  assinado_corretor_em: "2026-11-20T12:00:00Z",
  assinado_broker_em: null,
  meta_oficial_em: null,
  updated_at: "2026-11-20T12:00:00Z",
};

async function abrirPlano() {
  rpc.mockResolvedValue({ data: [membro], error: null });
  render(createElement(EquipePlano, { aberto: "u-ana", abrir: vi.fn(), broker: true }));
  return screen.findByTestId("broker-plano");
}

describe("Equipe · plano tela a tela, somente leitura", () => {
  it("a lista de telas é a ordem do corretor sem a p52 (cockpit fica no resumo)", () => {
    expect(TELAS_EQUIPE).toEqual(ORDEM.filter((id) => id !== "p52"));
    expect(TELAS_EQUIPE[0]).toBe(ORDEM[0]);
  });

  it("abre na tela 1 com a faixa de somente leitura e sem o resumo", async () => {
    await abrirPlano();
    expect(screen.getByTestId(`equipe-tela-${TELAS_EQUIPE[0]}`)).toBeTruthy();
    expect(screen.getByTestId("posicao-tela").textContent).toBe(`Tela 1 de ${TELAS_EQUIPE.length}`);
    expect(screen.getByTestId("faixa-somente-leitura").textContent).toMatch(
      /Somente leitura · plano de Ana Teste · \d+\/\d+ telas · \d+%/,
    );
    expect(screen.getByTestId("selo-tela")).toBeTruthy();
    expect(screen.queryByTestId("equipe-resumo")).toBeNull();
    expect(screen.queryByTestId("assinar-broker")).toBeNull();
    expect((screen.getByTestId("equipe-anterior") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Próxima e Anterior navegam; os campos ficam desabilitados", async () => {
    await abrirPlano();
    fireEvent.click(screen.getByTestId("equipe-proxima"));
    const t2 = screen.getByTestId(`equipe-tela-${TELAS_EQUIPE[1]}`);
    expect(screen.getByTestId("posicao-tela").textContent).toBe(`Tela 2 de ${TELAS_EQUIPE.length}`);
    // Tela 2 (p15) tem campos: todos travados pelo fieldset disabled.
    const campos = t2.querySelectorAll("input, textarea, select");
    expect(campos.length).toBeGreaterThan(0);
    for (const c of Array.from(campos)) expect(c.matches(":disabled")).toBe(true);
    expect(t2.querySelector("fieldset")!.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("equipe-anterior"));
    expect(screen.getByTestId(`equipe-tela-${TELAS_EQUIPE[0]}`)).toBeTruthy();
  });

  it("depois da última tela aparece o resumo com o botão de assinar como broker", async () => {
    await abrirPlano();
    for (let i = 0; i < TELAS_EQUIPE.length - 1; i++)
      fireEvent.click(screen.getByTestId("equipe-proxima"));
    expect(screen.getByTestId(`equipe-tela-${TELAS_EQUIPE.at(-1)}`)).toBeTruthy();
    expect(screen.getByTestId("equipe-proxima").textContent).toMatch(/Ver resumo/);
    fireEvent.click(screen.getByTestId("equipe-proxima"));
    const resumo = screen.getByTestId("equipe-resumo");
    expect(within(resumo).getByText("Cockpit (plano em uma página)")).toBeTruthy();
    expect(within(resumo).getByTestId("assinar-broker").textContent).toBe(
      "Assinar o pacto como broker",
    );
    expect(within(resumo).getByTestId("reabrir-plano")).toBeTruthy();
    expect(screen.getByTestId("posicao-tela").textContent).toBe("Resumo do plano");
    expect(screen.queryByTestId("equipe-proxima")).toBeNull();
    // Do resumo, Anterior volta para a última tela.
    fireEvent.click(screen.getByTestId("equipe-anterior"));
    expect(screen.getByTestId(`equipe-tela-${TELAS_EQUIPE.at(-1)}`)).toBeTruthy();
  });

  it("o atalho 'Ir direto ao resumo' leva ao resumo", async () => {
    await abrirPlano();
    fireEvent.click(screen.getByTestId("ir-resumo"));
    expect(screen.getByTestId("equipe-resumo")).toBeTruthy();
    expect(screen.getByTestId("assinar-broker")).toBeTruthy();
    expect(screen.queryByTestId("ir-resumo")).toBeNull();
  });

  it("a sanfona antiga 'Todas as respostas' saiu", async () => {
    await abrirPlano();
    fireEvent.click(screen.getByTestId("ir-resumo"));
    expect(screen.queryByText(/Todas as respostas, página por página/)).toBeNull();
  });
});
