import { describe, expect, it } from "vitest";
import { unitProblems, unitSaveErrorMessage } from "./exclusive-captures";

const ok = {
  nome: "Teste REMAX",
  creci: "3625414",
  razao_social: "TESTE REMAX Negocios",
  cnpj: "13.662.631/0001-18",
  endereco: "Rua Teste Teste",
  cidade: "Sorocaba",
  estado: "São Paulo",
  nome_comercial: "RE/MAX TESTE",
};

describe("validação da unidade", () => {
  it("aceita cadastro correto, com ou sem pontuação", () => {
    expect(unitProblems(ok)).toEqual([]);
    expect(unitProblems({ ...ok, cnpj: "13662631000118" })).toEqual([]);
  });
  it("explica CNPJ com 12 números (caso do print)", () => {
    expect(unitProblems({ ...ok, cnpj: "325444455588" })).toEqual([
      "CNPJ: tem 12 números, mas precisa ter 14 (ex.: 13.662.631/0001-18).",
    ]);
  });
  it("explica dígito verificador errado e letras", () => {
    expect(unitProblems({ ...ok, cnpj: "13.662.631/0001-19" })[0]).toMatch(/dígitos verificadores/);
    expect(unitProblems({ ...ok, cnpj: "13.662.631/0001-1A" })[0]).toMatch(/só números/);
  });
  it("lista vários problemas de uma vez", () => {
    const p = unitProblems({ ...ok, estado: "", cidade: "X", cnpj: "1" });
    expect(p).toHaveLength(3);
    expect(p.join(" ")).toMatch(/Estado: campo obrigatório/);
    expect(p.join(" ")).toMatch(/Cidade: muito curto/);
  });
  it("traduz erros do banco", () => {
    expect(
      unitSaveErrorMessage(
        'new row for relation "exclusive_units" violates check constraint "exclusive_units_cnpj_check"',
      ),
    ).toMatch(/14 números/);
    expect(
      unitSaveErrorMessage(
        'duplicate key value violates unique constraint "exclusive_units_organization_id_nome_key"',
      ),
    ).toMatch(/mesmo nome|esse nome/);
  });
});
