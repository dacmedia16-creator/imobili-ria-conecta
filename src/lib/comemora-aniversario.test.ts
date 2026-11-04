// @vitest-environment jsdom
/**
 * "Você comemora aniversário?" junto da data de nascimento (t_2d5f0ab6, pedido de Denis em 04/11/2026).
 * - campo Sim/Não aparece só com data, já marcado em "Sim";
 * - "Não" mostra o aviso e vai para as RPCs (própria pessoa, gestão e ficha);
 * - sem data, a escolha não é enviada (a linha some no banco);
 * - mural: o filtro é no banco (achievement_birthdays); aqui confere a montagem da lista e do card.
 * Dados fictícios.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const rpc = vi.fn();
const maybeSingle = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }) }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ComemoraAniversarioCampo } from "@/components/ComemoraAniversarioCampo";
import { FichaColaboradorForm } from "@/components/ficha/FichaColaboradorForm";
import { textoComemora } from "@/lib/data-nascimento";
import {
  infoNascimentoDoUsuario,
  minhaInfoNascimento,
  salvarDataNascimentoDoUsuario,
  salvarMinhaDataNascimento,
} from "@/lib/data-nascimento-db";
import { formDaSituacao, paramsSalvarFicha, type SituacaoFicha } from "@/lib/ficha-colaborador";

afterEach(() => {
  cleanup();
  rpc.mockReset();
  maybeSingle.mockReset();
});

const situacao = (o: Partial<Extract<SituacaoFicha, { aplica: true }>> = {}): SituacaoFicha => ({
  aplica: true,
  completa: true,
  obrigatoria_a_partir_de: "2026-10-30T04:30:00Z",
  bloqueia: false,
  data_nascimento: "1990-05-17",
  ficha: {
    qtd_filhos: 0,
    filhos_faixas: [],
    tem_plano_saude: false,
    plano_saude: null,
    emergencia_nome: "Maria Exemplo",
    emergencia_parentesco: "Mãe",
    emergencia_telefone: "(15) 99123-4567",
    hospital_preferencia: "Hospital Exemplo",
    religiao: null,
    aceite_em: "2026-10-29T10:00:00Z",
  },
  ...o,
});

describe("textoComemora", () => {
  it("Sim / Não / vazio sem data", () => {
    expect(textoComemora(true)).toBe("Sim");
    expect(textoComemora(false)).toBe("Não");
    expect(textoComemora(null)).toBe("");
    expect(textoComemora(undefined)).toBe("");
  });
});

describe("campo Sim/Não", () => {
  it("vem marcado em Sim, sem aviso; Não mostra o aviso e avisa quem chama", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      createElement(ComemoraAniversarioCampo, { id: "t", value: true, onChange }),
    );
    expect(screen.getByText("Você comemora aniversário?")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Sim" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Não" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByTestId("t-aviso-nao")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Não" }));
    expect(onChange).toHaveBeenCalledWith(false);

    rerender(createElement(ComemoraAniversarioCampo, { id: "t", value: false, onChange }));
    expect(screen.getByTestId("t-aviso-nao").textContent).toMatch(
      /não aparece nos Aniversariantes/,
    );
  });

  it("gestão: pergunta e aviso na 3ª pessoa", () => {
    render(
      createElement(ComemoraAniversarioCampo, {
        id: "g",
        value: false,
        onChange: () => {},
        paraGestao: true,
      }),
    );
    expect(screen.getByText("A pessoa comemora aniversário?")).toBeTruthy();
    expect(screen.getByTestId("g-aviso-nao").textContent).toMatch(/para a pessoa e a gestão/);
  });
});

describe("camada de dados (RPCs)", () => {
  it("própria pessoa: grava data + escolha; sem data não manda escolha", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await salvarMinhaDataNascimento("1990-05-07", false);
    expect(rpc).toHaveBeenLastCalledWith("profile_set_birthdate", {
      _data: "1990-05-07",
      _comemora: false,
    });
    await salvarMinhaDataNascimento("1990-05-07");
    expect(rpc).toHaveBeenLastCalledWith("profile_set_birthdate", {
      _data: "1990-05-07",
      _comemora: true,
    });
    await salvarMinhaDataNascimento(null, false);
    expect(rpc).toHaveBeenLastCalledWith("profile_set_birthdate", { _data: null, _comemora: null });
  });

  it("gestão: grava pela RPC por pessoa e lê data + escolha", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await salvarDataNascimentoDoUsuario("u-1", "1985-03-15", false);
    expect(rpc).toHaveBeenLastCalledWith("profile_birthdate_set_for_user", {
      _user: "u-1",
      _data: "1985-03-15",
      _comemora: false,
    });
    rpc.mockResolvedValue({
      data: { data_nascimento: "1985-03-15", comemora_aniversario: false },
      error: null,
    });
    expect(await infoNascimentoDoUsuario("u-1")).toEqual({ data: "1985-03-15", comemora: false });
    expect(rpc).toHaveBeenLastCalledWith("profile_birthdate_info_for_user", { _user: "u-1" });
    rpc.mockResolvedValue({
      data: { data_nascimento: null, comemora_aniversario: true },
      error: null,
    });
    expect(await infoNascimentoDoUsuario("u-2")).toEqual({ data: null, comemora: true });
  });

  it("leitura própria: quem não tem linha ou não tem a coluna fica Sim", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await minhaInfoNascimento("u")).toEqual({ data: null, comemora: true });
    maybeSingle.mockResolvedValue({ data: { data_nascimento: "1990-01-10" }, error: null });
    expect(await minhaInfoNascimento("u")).toEqual({ data: "1990-01-10", comemora: true });
    maybeSingle.mockResolvedValue({
      data: { data_nascimento: "1990-01-10", comemora_aniversario: false },
      error: null,
    });
    expect(await minhaInfoNascimento("u")).toEqual({ data: "1990-01-10", comemora: false });
  });

  it("erro de permissão vira texto amigável", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Sem permissao" } });
    await expect(salvarDataNascimentoDoUsuario("u", "1985-03-15", true)).rejects.toThrow(
      /não tem permissão/,
    );
  });
});

describe("Ficha do colaborador", () => {
  it("form: padrão Sim; lê Não salvo; manda a escolha para a RPC", () => {
    expect(formDaSituacao(situacao()).comemora_aniversario).toBe(true);
    expect(formDaSituacao(situacao({ comemora_aniversario: false })).comemora_aniversario).toBe(
      false,
    );
    const f = formDaSituacao(situacao({ comemora_aniversario: false }));
    expect(paramsSalvarFicha(f)._comemora_aniversario).toBe(false);
  });

  it("tela: pergunta aparece com a data, some sem ela, e o Não vai para ficha_salvar_minha", async () => {
    rpc.mockResolvedValue({ data: situacao({ comemora_aniversario: false }), error: null });
    render(createElement(FichaColaboradorForm, { situacao: situacao(), onSalvo: () => {} }));

    expect(screen.getByTestId("fc-comemora")).toBeTruthy();
    expect(
      within(screen.getByTestId("fc-comemora"))
        .getByRole("radio", { name: "Sim" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    const nasc = screen.getByLabelText(/Data de nascimento/) as HTMLInputElement;
    fireEvent.change(nasc, { target: { value: "" } });
    expect(screen.queryByTestId("fc-comemora")).toBeNull();
    fireEvent.change(nasc, { target: { value: "1990-05-17" } });
    expect(screen.getByTestId("fc-comemora")).toBeTruthy();

    fireEvent.click(within(screen.getByTestId("fc-comemora")).getByRole("radio", { name: "Não" }));
    fireEvent.click(screen.getByTestId("ficha-salvar"));
    await vi.waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc.mock.calls[0][0]).toBe("ficha_salvar_minha");
    expect(rpc.mock.calls[0][1]).toMatchObject({
      _data_nascimento: "1990-05-17",
      _comemora_aniversario: false,
    });
  });
});
