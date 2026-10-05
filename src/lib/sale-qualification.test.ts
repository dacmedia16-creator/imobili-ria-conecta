import { describe, expect, it } from "vitest";
import { bankMode, sharedBank } from "./sale-bank-mode";
import { qualificacaoCompleta, listaDocumentos } from "./sale-qualification";
import type { BankAccountRow, PartyRow } from "./database.types";

const banco = (parte: string, conta: string): BankAccountRow => ({
  id: parte, sale_id: "sale", organization_id: "org", created_at: "", parte,
  titular: "Pessoa", banco: "Banco", agencia: "1", conta, pix: null,
});

describe("conta de recebimento legada", () => {
  it("usa conta única com uma conta preenchida sem alterar linhas", () => {
    const rows = { vendedor_1: banco("vendedor_1", "11") };
    expect(bankMode(null, rows)).toBe("unica");
    expect(sharedBank(rows)).toBe(rows.vendedor_1);
    expect(Object.keys(rows)).toEqual(["vendedor_1"]);
  });
  it("deduz contas distintas; idênticas são compartilhadas", () => {
    expect(bankMode(null, { vendedor_1: banco("vendedor_1", "11"), vendedor_2: banco("vendedor_2", "22") })).toBe("por_vendedor");
    expect(bankMode(null, { vendedor_1: banco("vendedor_1", "11"), vendedor_2: banco("vendedor_2", "11") })).toBe("unica");
  });
  it("respeita opção explícita e prioriza nova linha de recebimento", () => {
    const rows = { vendedor_1: banco("vendedor_1", "11"), vendedor_2: banco("vendedor_2", "22"), recebimento: banco("recebimento", "33") };
    expect(bankMode(false, rows)).toBe("unica");
    expect(bankMode(true, rows)).toBe("por_vendedor");
    expect(sharedBank(rows)?.conta).toBe("33");
  });
});

const parte = (papel: string, fields: Partial<PartyRow>): PartyRow => ({
  id: papel, sale_id: "sale", organization_id: "org", created_at: "", papel,
  nome: null, tipo_pessoa: "fisica", cpf_cnpj: null, cnpj: null, razao_social: null,
  rg: null, profissao: null, email: null, telefone: null, endereco: null,
  regime_casamento: null, nacionalidade: null, estado_civil: null,
  conjuge_nome: null, conjuge_nacionalidade: null, conjuge_profissao: null,
  conjuge_rg: null, conjuge_cpf: null, conjuge_endereco: null, cliente_id: null,
  ...fields,
});

describe("qualificação para minuta", () => {
  it("ordena vendedores, cônjuges e compradores sem trechos vazios", () => {
    const text = qualificacaoCompleta({
      comprador_1: parte("comprador_1", { nome: "Ciclano", cpf_cnpj: "222" }),
      vendedor_2: parte("vendedor_2", { nome: "Beltrano", endereco: "Rua B" }),
      vendedor_1: parte("vendedor_1", {
        nome: "Fulano", nacionalidade: "brasileiro", estado_civil: "casado",
        regime_casamento: "comunhão parcial", rg: "123", cpf_cnpj: "111",
        conjuge_nome: "Maria", conjuge_cpf: "333",
      }),
    });
    expect(text.indexOf("Fulano")).toBeLessThan(text.indexOf("Maria"));
    expect(text.indexOf("Maria")).toBeLessThan(text.indexOf("Beltrano"));
    expect(text.indexOf("Beltrano")).toBeLessThan(text.indexOf("Ciclano"));
    expect(text).toContain("casado sob o regime de comunhão parcial");
    expect(text).not.toMatch(/RG nº\s*[,\.]/);
    expect(text).not.toMatch(/CPF sob nº\s*[,\.]/);
  });
  it("não inventa RG/CPF e qualifica pessoa jurídica", () => {
    const text = qualificacaoCompleta({ vendedor_1: parte("vendedor_1", {
      tipo_pessoa: "juridica", razao_social: "Empresa X", cnpj: "000", nome: "Representante",
      endereco: "Rua A", cpf_cnpj: "111",
    }) });
    expect(text).toContain("Empresa X, inscrita no CNPJ sob nº 000, com sede em Rua A, representada por Representante, CPF nº 111.");
    expect(text).not.toContain("RG nº");
  });
  it("lista nome e status dos documentos", () => {
    expect(listaDocumentos([{ parte: "vendedor_1", tipo: "rg", file_name: "foto.pdf", status: "aprovado" }], x => x.toUpperCase(), x => x))
      .toBe("vendedor_1 — RG (foto.pdf): Aprovado");
  });
});
