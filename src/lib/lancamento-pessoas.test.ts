import { describe, it, expect } from "vitest";
import {
  mesclarPessoasAtivas,
  resolverSelecaoBeneficiario,
  SEM_CADASTRO_VALUE,
} from "./lancamento-pessoas";

describe("mesclarPessoasAtivas", () => {
  it("combina as 3 listas sem duplicar por id", () => {
    const r = mesclarPessoasAtivas(
      [{ id: "1", nome: "Ana" }],
      [{ id: "2", nome: "Bruno" }],
      [{ id: "3", nome: "Carla" }],
    );
    expect(r).toHaveLength(3);
  });
  it("mesmo id em papéis diferentes conta uma vez só, mantém a 1ª ocorrência", () => {
    const r = mesclarPessoasAtivas(
      [{ id: "1", nome: "Gustavo (como corretor)" }],
      [],
      [{ id: "1", nome: "Gustavo (como team leader)" }],
    );
    expect(r).toEqual([{ id: "1", nome: "Gustavo (como corretor)" }]);
  });
  it("ordena por nome", () => {
    const r = mesclarPessoasAtivas([{ id: "1", nome: "Zeca" }], [{ id: "2", nome: "Ana" }], []);
    expect(r.map((p) => p.nome)).toEqual(["Ana", "Zeca"]);
  });
  it("3 listas vazias não quebram, retorna vazio", () => {
    expect(mesclarPessoasAtivas([], [], [])).toEqual([]);
  });
});

describe("resolverSelecaoBeneficiario", () => {
  const pessoas = [
    { id: "12c887f7", nome: "Gustavo Fuentes" },
    { id: "e8f6eb73", nome: "Virginia Aranha" },
  ];

  it("escolher SEM_CADASTRO_VALUE limpa o vínculo, preserva o nome já digitado e confirma sem cadastro", () => {
    const r = resolverSelecaoBeneficiario(SEM_CADASTRO_VALUE, pessoas, "Wilson Grecchi");
    expect(r).toEqual({ user_id: null, nome: "Wilson Grecchi", sem_cadastro_confirmado: true });
  });
  it("escolher uma pessoa da lista grava o user_id, troca o nome pro cadastrado e limpa a confirmação", () => {
    const r = resolverSelecaoBeneficiario("12c887f7", pessoas, "nome antigo digitado");
    expect(r).toEqual({
      user_id: "12c887f7",
      nome: "Gustavo Fuentes",
      sem_cadastro_confirmado: false,
    });
  });
  it("id selecionado que não está mais na lista (ex. ficou inativo) preserva o nome atual em vez de apagar", () => {
    const r = resolverSelecaoBeneficiario("id-nao-existe", pessoas, "Nome Antigo");
    expect(r).toEqual({
      user_id: "id-nao-existe",
      nome: "Nome Antigo",
      sem_cadastro_confirmado: false,
    });
  });
});
