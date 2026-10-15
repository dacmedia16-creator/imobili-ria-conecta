import { describe, expect, it } from "vitest";
import {
  areaDivergente,
  avisoDescricaoCurta,
  avisoMatriculaDivergente,
  avisosPartes,
  dadosDaCertidaoParaParte,
  extracoesAtivas,
  mesmoNome,
  type ExtracaoDocumento,
} from "./conferencia-documentos-venda";
import { sugerirAreas } from "./ficha-imovel";

const mat = (
  raw: Record<string, unknown>,
  deleted_at: string | null = null,
): ExtracaoDocumento => ({
  tipo: "matricula",
  parte: "imovel",
  deleted_at,
  raw,
});
const ident = (parte: string, raw: Record<string, unknown>, deleted_at: string | null = null) => ({
  tipo: "cnh",
  parte,
  deleted_at,
  raw,
});

describe("extracoesAtivas", () => {
  it("ignora leitura de documento excluído", () => {
    const l = [mat({ matricula: "1" }), mat({ matricula: "2" }, "2026-10-13T13:18:00Z")];
    expect(extracoesAtivas(l).map((e) => e.raw?.matricula)).toEqual(["1"]);
  });
  it("documento excluído não gera aviso de matrícula", () => {
    const l = [mat({ matricula: "158.399" }, "2026-10-13T13:18:00Z")];
    expect(avisoMatriculaDivergente("119.249", l)).toBeNull();
  });
});

describe("avisoMatriculaDivergente", () => {
  it("compara só os dígitos", () => {
    expect(avisoMatriculaDivergente("240694", [mat({ matricula: "240.694" })])).toBeNull();
    expect(avisoMatriculaDivergente("10.790   ", [mat({ matricula: "10.790" })])).toBeNull();
  });
  it("avisa quando o número é outro (caso real 119.249 x 158.399)", () => {
    expect(avisoMatriculaDivergente("119.249", [mat({ matricula: "158.399" })])).toEqual({
      venda: "119.249",
      documento: "158.399",
    });
  });
  it("basta uma das matrículas enviadas bater", () => {
    const l = [mat({ matricula: "115.185" }), mat({ matricula: "115.363" })];
    expect(avisoMatriculaDivergente("115.185", l)).toBeNull();
  });
  it("sem número na venda ou no documento, não avisa", () => {
    expect(avisoMatriculaDivergente("", [mat({ matricula: "1" })])).toBeNull();
    expect(avisoMatriculaDivergente("123", [mat({ matricula: null })])).toBeNull();
  });
});

describe("avisoDescricaoCurta", () => {
  const longa = "x".repeat(980);
  it("avisa 44 contra 980 caracteres", () => {
    expect(avisoDescricaoCurta("y".repeat(44), [mat({ observacoes_imovel: longa })])).toEqual({
      venda: 44,
      matricula: 980,
    });
  });
  it("avisa descrição vazia", () => {
    expect(avisoDescricaoCurta(null, [mat({ observacoes_imovel: longa })])?.venda).toBe(0);
  });
  it("não avisa quando a descrição é parecida ou a matrícula não tem descrição longa", () => {
    expect(avisoDescricaoCurta("y".repeat(900), [mat({ observacoes_imovel: longa })])).toBeNull();
    expect(avisoDescricaoCurta("", [mat({ observacoes_imovel: "curta" })])).toBeNull();
  });
});

describe("áreas separadas (venda 630601173-52)", () => {
  const raw = {
    area_privativa: "64,845 m²",
    area_total: "69,0925 m²",
    area_construida: "69,0925 m²",
    observacoes_imovel: "Apartamento nº 52...",
  };
  it("sugere a privativa como útil e mostra o total à parte", () => {
    const s = sugerirAreas([{ tipo: "matricula", raw }], "Apartamento");
    expect(s.area_util_m2).toBe(64.85);
    expect(s.matricula_total_m2).toBe(69.09);
  });
  it("casa sem privativa continua usando a construída", () => {
    const s = sugerirAreas(
      [{ tipo: "matricula", raw: { area_total: "250,00 m²", area_construida: "175,50 m²" } }],
      "Casa",
    );
    expect(s.area_util_m2).toBe(175.5);
    expect(s.area_construida_m2).toBe(175.5);
  });
  it("avisa 69 digitado contra 64,85 da matrícula; tolera arredondamento", () => {
    expect(areaDivergente(69, 64.85)).toBe(true);
    expect(areaDivergente(61, 61.27)).toBe(false);
    expect(areaDivergente("119", 119.8)).toBe(false);
    expect(areaDivergente(null, 64.85)).toBe(false);
  });
});

describe("avisosPartes", () => {
  const ana = { nome: "ANA PAULA SOUZA", cpf: "111.111.111-11" };
  const joao = { nome: "JOÃO CARLOS LIMA", cpf: "222.222.222-22" };

  it("documento do 2º comprador com a pessoa do 1º sugere a parte certa", () => {
    const avisos = avisosPartes([ident("comprador_2", joao)], {
      comprador_1: { nome: "João Carlos Lima", cpf_cnpj: "22222222222" },
      comprador_2: { nome: "Ana Paula Souza", cpf_cnpj: "11111111111" },
    });
    expect(
      avisos.some((a) => a.mensagem.includes("JOÃO CARLOS LIMA, que está como comprador 1")),
    ).toBe(true);
  });
  it("aponta quando a pessoa está como cônjuge (caso 630601173-52)", () => {
    const avisos = avisosPartes([ident("comprador_1", ana)], {
      comprador_1: {
        nome: "João Carlos Lima",
        cpf_cnpj: "22222222222",
        conjuge_nome: "Ana Paula Souza",
        conjuge_cpf: "11111111111",
      },
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0].mensagem).toContain("cônjuge do comprador 1");
  });
  it("não avisa quando bate (CPF ou nome) nem quando a parte está vazia", () => {
    expect(
      avisosPartes([ident("comprador_1", joao)], {
        comprador_1: { nome: "Joao C. Lima", cpf_cnpj: "222.222.222-22" },
      }),
    ).toEqual([]);
    expect(avisosPartes([ident("comprador_2", joao)], { comprador_2: { nome: "" } })).toEqual([]);
    expect(
      avisosPartes([ident("vendedor_1", { nome: "Maria de Fátima Rocha" })], {
        vendedor_1: { nome: "MARIA FATIMA ROCHA" },
      }),
    ).toEqual([]);
  });
  it("nome completo igual com CPF lido errado não avisa (falso positivo da simulação)", () => {
    expect(
      avisosPartes([ident("comprador_1", { nome: "JOÃO CARLOS LIMA", cpf: "222.222.222-29" })], {
        comprador_1: { nome: "João Carlos Lima", cpf_cnpj: "22222222222" },
      }),
    ).toEqual([]);
  });
  it("ignora documento excluído e documento que não é de identidade", () => {
    const partes = { comprador_1: { nome: "Outra Pessoa", cpf_cnpj: "33333333333" } };
    expect(avisosPartes([ident("comprador_1", joao, "2026-10-13")], partes)).toEqual([]);
    expect(avisosPartes([{ tipo: "certidao", parte: "comprador_1", raw: joao }], partes)).toEqual(
      [],
    );
  });
  it("avisa o mesmo CPF em duas partes", () => {
    const avisos = avisosPartes([], {
      comprador_1: { nome: "A", cpf_cnpj: "22222222222" },
      comprador_2: { nome: "A", cpf_cnpj: "222.222.222-22" },
    });
    expect(avisos[0].mensagem).toContain("comprador 1 e comprador 2");
  });
  it("mesmoNome tolera acento, partícula e nome do meio", () => {
    expect(mesmoNome("José da Silva", "JOSE ANTONIO SILVA")).toBe(true);
    expect(mesmoNome("José Silva", "Josefa Silva")).toBe(false);
  });
});

describe("dadosDaCertidaoParaParte", () => {
  const certidao = [
    {
      nome: "Maria Souza Lima",
      cpf: "111.222.333-44",
      profissao: "Professora",
      nacionalidade: "brasileira",
    },
    { nome: "João Pedro Lima", cpf: null, profissao: "Engenheiro", nacionalidade: "português" },
  ];
  it("grava só os dados da pessoa que bate com a parte (CPF)", () => {
    expect(dadosDaCertidaoParaParte(certidao, { nome: "Outro", cpf_cnpj: "11122233344" })).toEqual({
      profissao: "Professora",
      nacionalidade: "brasileira",
    });
  });
  it("bate por primeiro e último nome quando falta CPF", () => {
    expect(dadosDaCertidaoParaParte(certidao, { nome: "JOAO LIMA" })?.profissao).toBe("Engenheiro");
  });
  it("não atribui dado do cônjuge quando ninguém bate", () => {
    expect(
      dadosDaCertidaoParaParte(certidao, { nome: "Carlos Alves", cpf_cnpj: "99988877766" }),
    ).toBeNull();
  });
  it("parte vazia ou certidão sem lista não devolve nada", () => {
    expect(dadosDaCertidaoParaParte(certidao, {})).toBeNull();
    expect(dadosDaCertidaoParaParte(undefined, { nome: "Maria Lima" })).toBeNull();
  });
  it("duas pessoas batendo (ambíguo) não devolve nada", () => {
    const amb = [
      { nome: "Ana Lima", profissao: "A" },
      { nome: "Ana Maria Lima", profissao: "B" },
    ];
    expect(dadosDaCertidaoParaParte(amb, { nome: "Ana Lima" })).toBeNull();
  });
});
