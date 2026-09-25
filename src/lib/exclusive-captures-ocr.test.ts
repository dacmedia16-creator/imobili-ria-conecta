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
  it("bloqueia qualquer envio automático à Clicksign independentemente da configuração", async () => {
    expect(clicksignConfig.mode).toBe("disabled");
    await expect(sendToClicksign("test", { mode: "disabled" })).rejects.toThrow(/desativada/);
    await expect(sendToClicksign("test", { mode: "manual" })).rejects.toThrow(/desativada/);
  });
});
