import { describe, expect, it } from "vitest";
import { applySuggestedFields, emptyForm } from "./exclusive-captures";
import { parseCaptureSuggestions, validCpf, validCreci } from "./exclusive-captures-ocr";
import { clicksignConfig, sendToClicksign } from "./exclusive-clicksign";

describe("leitura assistida local — dados sintéticos", () => {
  it("alinha CPF e CRECI às regras do banco", () => {
    expect(validCpf("529.982.247-25")).toBe(true);
    expect(validCpf("52998224725")).toBe(true);
    expect(validCpf("529 982 247 25")).toBe(false);
    expect(validCpf("111.111.111-11")).toBe(false);
    expect(validCpf("52998224726")).toBe(false);
    expect(validCreci("12345-F")).toBe(true);
    expect(validCreci(" 12345-F ")).toBe(true);
    expect(validCreci("x; DROP TABLE")).toBe(false);
  });
  it("sugere somente dados rotulados sem alterar campo já confirmado", () => {
    const values = parseCaptureSuggestions(
      "NOME: Maria Silva\nCPF: 529.982.247-25\nRG: 12345678-9\nTelefone: (15) 99999-8888",
      "owner",
    );
    expect(values).toEqual({
      nome_completo: "Maria Silva",
      cpf: "529.982.247-25",
      rg: "12345678-9",
      telefone_1: "(15) 99999-8888",
    });
    const form = emptyForm();
    form.proprietario_1.nome_completo = "Nome conferido";
    const updated = applySuggestedFields(form, "proprietario_1", values);
    expect(updated.proprietario_1.nome_completo).toBe("Nome conferido");
    expect(updated.proprietario_1.cpf).toBe("529.982.247-25");
  });
  it("não confunde CPF inválido ou imóvel com proprietário", () => {
    expect(parseCaptureSuggestions("CPF: 111.111.111-11\ntexto ilegível", "owner")).toEqual({});
    expect(
      parseCaptureSuggestions(
        "Matrícula: 12345\nInscrição imobiliária: 98637.11\nEndereço: Rua Teste 123",
        "property",
      ),
    ).toEqual({
      numero_matricula: "12345",
      classificacao_fiscal_iptu: "98637.11",
      endereco: "Rua Teste 123",
    });
  });
  it("lê documentos reais com rótulo numa linha e valor na linha seguinte", () => {
    const cnh =
      "REPUBLICA FEDERATIVA DO BRASIL\nCARTEIRA NACIONAL DE HABILITAÇÃO\n2 e 1 NOME E SOBRENOME\nJOAO DA SILVA SANTOS\n4c DOC. IDENTIDADE / ORG. EMISSOR / UF\n12345678 SSP SP\nCPF DATA NASCIMENTO\n529.982.247-25 10/02/1980";
    expect(parseCaptureSuggestions(cnh, "owner")).toEqual({
      nome_completo: "JOAO DA SILVA SANTOS",
      cpf: "529.982.247-25",
      rg: "12345678",
    });
    const rg =
      "REGISTRO GERAL 12.345.678-9 DATA DE EXPEDIÇÃO 01/01/2010\nNOME\nMARIA APARECIDA SOUZA\nFILIAÇÃO\nJOSE SOUZA";
    expect(parseCaptureSuggestions(rg, "owner")).toEqual({
      nome_completo: "MARIA APARECIDA SOUZA",
      rg: "12.345.678-9",
    });
    const iptu =
      "PREFEITURA DE SOROCABA\nInscrição Imobiliária\n44.21.33.0123.00.000\nEndereço do Imóvel\nRUA DAS FLORES, 123 - JARDIM EUROPA";
    expect(parseCaptureSuggestions(iptu, "property")).toEqual({
      classificacao_fiscal_iptu: "44.21.33.0123.00.000",
      endereco: "RUA DAS FLORES, 123 - JARDIM EUROPA",
    });
    const matricula = "MATRÍCULA Nº\n98.765\nCartório\n2º Oficial de Registro de Imóveis de Sorocaba";
    expect(parseCaptureSuggestions(matricula, "property")).toEqual({
      numero_matricula: "98.765",
      cartorio_registro: "2º Oficial de Registro de Imóveis de Sorocaba",
    });
  });
  it("bloqueia qualquer envio automático à Clicksign independentemente da configuração", async () => {
    expect(clicksignConfig.mode).toBe("disabled");
    await expect(sendToClicksign("test", { mode: "disabled" })).rejects.toThrow(/desativada/);
    await expect(sendToClicksign("test", { mode: "manual" })).rejects.toThrow(/desativada/);
  });
});

import { buildCapturePrompt, sanitizeCaptureAi, isAiReadableKind } from "./exclusive-captures-ai";

describe("leitura por IA da captação — dados sintéticos", () => {
  it("só documentos de dados vão para a IA", () => {
    expect(isAiReadableKind("matricula")).toBe(true);
    expect(isAiReadableKind("cnh")).toBe(true);
    expect(isAiReadableKind("gerado")).toBe(false);
    expect(isAiReadableKind("assinado")).toBe(false);
  });
  it("prompt pede todos os campos do contrato", () => {
    const owner = buildCapturePrompt("cnh", "owner");
    for (const k of [
      "nome_completo",
      "rg",
      "cpf",
      "nacionalidade",
      "estado_civil",
      "endereco_completo",
    ])
      expect(owner).toContain(`"${k}"`);
    const prop = buildCapturePrompt("matricula", "property");
    for (const k of [
      "tipo_imovel",
      "bairro",
      "municipio",
      "estado",
      "numero_matricula",
      "cartorio_registro",
    ])
      expect(prop).toContain(`"${k}"`);
  });
  it("filtra resposta da IA: chaves estranhas, CPF inválido, nulos e UF", () => {
    expect(
      sanitizeCaptureAi(
        {
          nome_completo: "  Maria   Silva ",
          cpf: "52998224725",
          rg: null,
          nacionalidade: "brasileira",
          estado_civil: "casada",
          telefone_1: "123",
          hack: "x",
        },
        "owner",
      ),
    ).toEqual({
      nome_completo: "Maria Silva",
      cpf: "529.982.247-25",
      nacionalidade: "brasileira",
      estado_civil: "casada",
    });
    expect(sanitizeCaptureAi({ cpf: "111.111.111-11" }, "owner")).toEqual({});
    expect(
      sanitizeCaptureAi(
        { estado: "SP", municipio: "Sorocaba", numero_matricula: 12345 },
        "property",
      ),
    ).toEqual({ estado: "São Paulo", municipio: "Sorocaba", numero_matricula: "12345" });
  });
});
