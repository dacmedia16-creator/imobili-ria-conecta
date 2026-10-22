import { describe, expect, it } from "vitest";
import {
  dataNascimentoMaxima,
  erroCampoDataNascimento,
  erroDataNascimento,
  hojeSaoPaulo,
  mensagemErroRpcNascimento,
} from "./data-nascimento";
import { modoCompletarPerfil, type PerfilParaCompletar } from "./completar-perfil";

// 22/10/2026 13:00 em São Paulo (16:00 UTC).
const AGORA = new Date("2026-10-22T16:00:00Z");

describe("data de nascimento — validação", () => {
  it("usa o dia de São Paulo, não o UTC", () => {
    // 23/10 01:00 UTC ainda é 22/10 em São Paulo.
    expect(hojeSaoPaulo(new Date("2026-10-23T01:00:00Z"))).toBe("2026-10-22");
  });

  it("aceita data válida e exatamente 16 anos", () => {
    expect(erroDataNascimento("1990-05-07", AGORA)).toBeNull();
    expect(dataNascimentoMaxima(AGORA)).toBe("2010-10-22");
    expect(erroDataNascimento("2010-10-22", AGORA)).toBeNull();
  });

  it("recusa menor de 16 anos", () => {
    expect(erroDataNascimento("2010-10-23", AGORA)).toBe("A idade mínima é 16 anos.");
  });

  it("recusa futuro, antes de 1900 e data que não existe", () => {
    expect(erroDataNascimento("2026-10-23", AGORA)).toMatch(/futuro/);
    expect(erroDataNascimento("1899-12-31", AGORA)).toMatch(/1900/);
    expect(erroDataNascimento("1900-01-01", AGORA)).toBeNull();
    expect(erroDataNascimento("1990-02-30", AGORA)).toMatch(/inválida/);
    expect(erroDataNascimento("07/05/1990", AGORA)).toMatch(/inválida/);
  });

  it("29/02 vira 28/02 quando 16 anos antes não é bissexto", () => {
    // 16 é múltiplo de 4: só acontece em virada de século (2100 não é bissexto). Igual ao Postgres.
    expect(dataNascimentoMaxima(new Date("2116-02-29T15:00:00Z"))).toBe("2100-02-28");
    expect(dataNascimentoMaxima(new Date("2028-02-29T15:00:00Z"))).toBe("2012-02-29");
  });

  it("vazio: erro só quando obrigatório", () => {
    expect(erroCampoDataNascimento("", true, AGORA)).toBe("Informe sua data de nascimento.");
    expect(erroCampoDataNascimento("  ", false, AGORA)).toBeNull();
    expect(erroCampoDataNascimento("2015-01-01", false, AGORA)).toMatch(/16 anos/);
  });

  it("traduz o erro do banco", () => {
    expect(mensagemErroRpcNascimento({ code: "22023" })).toMatch(/inválida/);
    expect(mensagemErroRpcNascimento({ code: "42501" })).toMatch(/permissão/);
    expect(mensagemErroRpcNascimento(null)).toMatch(/Tente de novo/);
  });
});

describe("data de nascimento — tela de completar perfil", () => {
  const completo: PerfilParaCompletar = {
    nome: "Amanda Rodrigues da Silva",
    telefone: "(15) 99123-4567",
    avatar_url: "https://x/avatars/a.jpg",
    cpf: "529.982.247-25",
    creci: "123456-F",
  };
  const base = {
    roles: ["corretor"],
    platformAdmin: false,
    emVisaoDaPlataforma: false,
    vendoComo: false,
    perfil: completo,
  };

  it("conta nova sem data vê a tela obrigatória, mesmo com o resto completo", () => {
    expect(
      modoCompletarPerfil({ ...base, createdAt: "2026-10-21T10:00:00Z", semDataNascimento: true }),
    ).toBe("obrigatorio");
  });

  it("conta nova com data e perfil completo entra direto", () => {
    expect(
      modoCompletarPerfil({ ...base, createdAt: "2026-10-21T10:00:00Z", semDataNascimento: false }),
    ).toBeNull();
  });

  it("conta antiga sem data NÃO é travada nem lembrada só por isso", () => {
    expect(
      modoCompletarPerfil({ ...base, createdAt: "2026-10-06T18:15:47Z", semDataNascimento: true }),
    ).toBeNull();
  });

  it("falha ao ler a data (undefined) não trava ninguém", () => {
    expect(modoCompletarPerfil({ ...base, createdAt: "2026-10-21T10:00:00Z" })).toBeNull();
  });
});
