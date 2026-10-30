// @vitest-environment jsdom
/**
 * Faixa de idade dos filhos na ficha (t_27d37c57, pedido de Denis em 30/10/2026).
 * Lógica pura + tela de verdade (FichaColaboradorForm renderizado no jsdom):
 * com filhos mostra as faixas; 0/vazio esconde e limpa; é opcional e vai para a RPC.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  FAIXAS_FILHOS,
  alternarFaixa,
  camposFichaFaltando,
  filhosComFaixas,
  formDaSituacao,
  linhaExport,
  mensagemErroFicha,
  normalizarFaixas,
  paramsSalvarFicha,
  temFilhos,
  textoFaixas,
  type Colaborador,
  type FichaForm,
  type SituacaoFicha,
} from "@/lib/ficha-colaborador";
import { FichaColaboradorForm } from "@/components/ficha/FichaColaboradorForm";

const valido = (o: Partial<FichaForm> = {}): FichaForm => ({
  data_nascimento: "1990-05-17",
  qtd_filhos: "2",
  filhos_faixas: [],
  tem_plano_saude: "nao",
  plano_saude: "",
  emergencia_nome: "Maria Exemplo",
  emergencia_parentesco: "Mãe",
  emergencia_telefone: "(15) 99123-4567",
  hospital_preferencia: "Hospital Exemplo",
  religiao: "",
  ciente: true,
  ...o,
});

const situacao = (qtd: number, faixas: string[] | undefined): SituacaoFicha => ({
  aplica: true,
  completa: true,
  obrigatoria_a_partir_de: "2026-10-30T04:30:00Z",
  bloqueia: false,
  data_nascimento: "1990-05-17",
  ficha: {
    qtd_filhos: qtd,
    filhos_faixas: faixas,
    tem_plano_saude: false,
    plano_saude: null,
    emergencia_nome: "Maria Exemplo",
    emergencia_parentesco: "Mãe",
    emergencia_telefone: "(15) 99123-4567",
    hospital_preferencia: "Hospital Exemplo",
    religiao: null,
    aceite_em: "2026-10-29T10:00:00Z",
  },
});

describe("lógica das faixas", () => {
  it("as 4 faixas pedidas por Denis, nesta ordem", () => {
    expect(FAIXAS_FILHOS.map((f) => f.rotulo)).toEqual([
      "0 a 5 anos",
      "6 a 10 anos",
      "11 a 15 anos",
      "16 anos ou mais",
    ]);
  });
  it("tem filhos = quantidade 1 ou mais", () => {
    expect(temFilhos("1")).toBe(true);
    expect(temFilhos("12")).toBe(true);
    expect(temFilhos("0")).toBe(false);
    expect(temFilhos("")).toBe(false);
    expect(temFilhos("00")).toBe(false);
  });
  it("múltipla escolha: liga/desliga, ordena e descarta valores desconhecidos", () => {
    expect(alternarFaixa(["11-15"], "0-5")).toEqual(["0-5", "11-15"]);
    expect(alternarFaixa(["0-5", "11-15"], "0-5")).toEqual(["11-15"]);
    expect(normalizarFaixas(["16+", "x", "6-10", "6-10"])).toEqual(["6-10", "16+"]);
    expect(normalizarFaixas(null)).toEqual([]);
    expect(textoFaixas(["11-15", "0-5"])).toBe("0 a 5 anos, 11 a 15 anos");
  });
  it("opcional: com filhos e sem faixa não falta nada", () => {
    expect(camposFichaFaltando(valido(), () => null)).toEqual([]);
  });
  it("RPC: com filhos manda as faixas; com 0 manda lista vazia (limpa)", () => {
    expect(paramsSalvarFicha(valido({ filhos_faixas: ["0-5", "16+"] }))._filhos_faixas).toEqual([
      "0-5",
      "16+",
    ]);
    expect(
      paramsSalvarFicha(valido({ qtd_filhos: "0", filhos_faixas: ["0-5"] }))._filhos_faixas,
    ).toEqual([]);
  });
  it("carrega do banco; banco antigo sem o campo vira lista vazia; 0 filhos ignora faixas", () => {
    expect(formDaSituacao(situacao(2, ["6-10"])).filhos_faixas).toEqual(["6-10"]);
    expect(formDaSituacao(situacao(2, undefined)).filhos_faixas).toEqual([]);
    expect(formDaSituacao(situacao(0, ["6-10"])).filhos_faixas).toEqual([]);
  });
  it("erro do banco vira mensagem amigável", () => {
    expect(
      mensagemErroFicha({ code: "22023", message: "Faixa de idade dos filhos invalida" }),
    ).toBe("Faixa de idade dos filhos inválida.");
    expect(mensagemErroFicha({ code: "22023", message: "Quantidade de filhos invalida" })).toBe(
      "Quantidade de filhos inválida.",
    );
  });
  it("staff/Excel/PDF: quantidade com as faixas na mesma coluna", () => {
    expect(filhosComFaixas({ qtd_filhos: 2, filhos_faixas: ["0-5", "11-15"] })).toBe(
      "2 (0 a 5 anos, 11 a 15 anos)",
    );
    expect(filhosComFaixas({ qtd_filhos: 1, filhos_faixas: [] })).toBe("1");
    expect(filhosComFaixas({ qtd_filhos: 0, filhos_faixas: null })).toBe("0");
    expect(filhosComFaixas({ qtd_filhos: null })).toBe("");
    const c = {
      qtd_filhos: 3,
      filhos_faixas: ["16+"],
      papeis: [],
      equipes: [],
    } as unknown as Colaborador;
    expect(linhaExport(c, {})[6]).toBe("3 (16 anos ou mais)");
  });
});

describe("tela (FichaColaboradorForm)", () => {
  afterEach(() => {
    cleanup();
    rpc.mockReset();
  });
  const qtd = () => screen.getByLabelText(/Quantidade de filhos/) as HTMLInputElement;
  const bloco = () => screen.queryByTestId("ficha-filhos-faixas");

  it("SIM mostra as 4 faixas; NÃO esconde e limpa; salva o que ficou", async () => {
    rpc.mockResolvedValue({ data: situacao(0, []), error: null });
    render(
      createElement(FichaColaboradorForm, { situacao: situacao(2, ["6-10"]), onSalvo: () => {} }),
    );

    // Já tem 2 filhos e "6 a 10" salvo: campo aparece com a faixa marcada.
    expect(bloco()).not.toBeNull();
    for (const f of FAIXAS_FILHOS) expect(screen.getByText(f.rotulo)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "6 a 10 anos" }).getAttribute("aria-checked")).toBe(
      "true",
    );

    // Marca mais uma (múltipla escolha).
    fireEvent.click(screen.getByRole("checkbox", { name: "0 a 5 anos" }));
    expect(screen.getByRole("checkbox", { name: "0 a 5 anos" }).getAttribute("aria-checked")).toBe(
      "true",
    );

    // Responde 0 (não tem filhos): campo some.
    fireEvent.change(qtd(), { target: { value: "0" } });
    expect(bloco()).toBeNull();

    // Volta para 1: campo reaparece LIMPO (as marcações foram descartadas).
    fireEvent.change(qtd(), { target: { value: "1" } });
    expect(bloco()).not.toBeNull();
    for (const f of FAIXAS_FILHOS)
      expect(screen.getByRole("checkbox", { name: f.rotulo }).getAttribute("aria-checked")).toBe(
        "false",
      );

    // Vazio também esconde.
    fireEvent.change(qtd(), { target: { value: "" } });
    expect(bloco()).toBeNull();

    // Salva com 0: a RPC recebe lista vazia (o banco limpa as faixas salvas).
    fireEvent.change(qtd(), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("ficha-salvar"));
    await vi.waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc.mock.calls[0][0]).toBe("ficha_salvar_minha");
    expect(rpc.mock.calls[0][1]).toMatchObject({ _qtd_filhos: 0, _filhos_faixas: [] });
  });

  it("com filhos e faixas marcadas, salva as faixas; sem marcar nada também salva (opcional)", async () => {
    rpc.mockResolvedValue({ data: situacao(2, ["0-5", "16+"]), error: null });
    render(createElement(FichaColaboradorForm, { situacao: situacao(0, []), onSalvo: () => {} }));
    expect(bloco()).toBeNull(); // 0 filhos: escondido

    fireEvent.change(qtd(), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "16 anos ou mais" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "0 a 5 anos" }));
    fireEvent.click(screen.getByTestId("ficha-salvar"));
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc.mock.calls[0][1]).toMatchObject({ _qtd_filhos: 2, _filhos_faixas: ["0-5", "16+"] });

    // Espera terminar o primeiro "Salvando…" (botão volta a ficar habilitado).
    await vi.waitFor(() =>
      expect((screen.getByTestId("ficha-salvar") as HTMLButtonElement).disabled).toBe(false),
    );
    // Desmarca as duas e salva de novo: opcional, não bloqueia.
    fireEvent.click(screen.getByRole("checkbox", { name: "16 anos ou mais" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "0 a 5 anos" }));
    fireEvent.click(screen.getByTestId("ficha-salvar"));
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(rpc.mock.calls[1][1]).toMatchObject({ _qtd_filhos: 2, _filhos_faixas: [] });
  });
});
