import { describe, expect, it } from "vitest";
import {
  aplicarPapeis,
  flexionarQualificacao,
  pessoasFiador,
  pessoasLocador,
  pessoasLocatario,
  termoPapel,
} from "./locacao-concordancia";

describe("flexionarQualificacao", () => {
  it("escolhe a forma feminina das duplas", () => {
    expect(flexionarQualificacao("brasileiro(a), solteiro/solteira, casado(a)", true)).toBe(
      "brasileira, solteira, casada",
    );
    expect(flexionarQualificacao("viúvo(a), portador/a, inscrito, domiciliado", true)).toBe(
      "viúva, portadora, inscrita, domiciliada",
    );
  });
  it("escolhe a forma masculina das duplas", () => {
    expect(flexionarQualificacao("brasileira, solteiro(a), divorciada", false)).toBe(
      "brasileiro, solteiro, divorciado",
    );
  });
  it("não mexe em união estável", () => {
    expect(flexionarQualificacao("união estável", true)).toBe("união estável");
    expect(flexionarQualificacao("união estável", false)).toBe("união estável");
  });
});

describe("termoPapel", () => {
  it("1 locador homem", () => {
    expect(termoPapel("locador", [{ sexo: "masculino" }])).toBe("LOCADOR");
  });
  it("1 locadora mulher", () => {
    expect(termoPapel("locador", [{ sexo: "feminino" }])).toBe("LOCADORA");
  });
  it("casal locador H+M → LOCADORES", () => {
    expect(termoPapel("locador", [{ sexo: "masculino" }, { sexo: "feminino" }])).toBe("LOCADORES");
  });
  it("duas locatárias → LOCATÁRIAS", () => {
    expect(termoPapel("locatario", [{ sexo: "feminino" }, { sexo: "feminino" }])).toBe(
      "LOCATÁRIAS",
    );
  });
  it("fiador e fiadora → FIADORES", () => {
    expect(termoPapel("fiador", [{ sexo: "masculino" }, { sexo: "feminino" }])).toBe("FIADORES");
  });
  it("locador PJ sem flexão por sexo", () => {
    expect(termoPapel("locador", [{ pj: true }])).toBe("LOCADOR");
  });
  it("duas fiadoras → FIADORAS", () => {
    expect(termoPapel("fiador", [{ sexo: "feminino" }, { sexo: "feminino" }])).toBe("FIADORAS");
  });
});

describe("aplicarPapeis", () => {
  it("flexiona só o termo do papel e o artigo colado, sem reescrever a cláusula", () => {
    const origem =
      "O aluguel deve ser pago pelo LOCATÁRIO até o dia 10. O FIADOR assume a fiança. O imóvel destina-se à MORADIA do LOCATÁRIO.";
    const saida = aplicarPapeis(origem, "LOCADORA", "LOCATÁRIO", "FIADORES");
    expect(saida).toContain("pelo LOCATÁRIO");
    expect(saida).toContain("OS FIADORES assume a fiança");
    expect(saida).toContain("do LOCATÁRIO");
    expect(saida).not.toMatch(/LOCADOR\s*\(\s*A\s*\)/);
  });
  it("troca formas duplas O(s) LOCATÁRIO(s) e LOCATÁRIO (S)", () => {
    const origem = "O(s) LOCATÁRIO(s) autorizam. O LOCATÁRIO (S), poderá ele mesmo contratar.";
    const saida = aplicarPapeis(origem, "LOCADOR", "LOCATÁRIAS", "FIADOR");
    expect(saida).toContain("AS LOCATÁRIAS autorizam");
    expect(saida).toContain("AS LOCATÁRIAS, poderá");
    expect(saida).not.toMatch(/\(s\)/i);
    expect(saida).not.toMatch(/\(S\)/);
  });
  it("não altera o tipo da garantia", () => {
    const origem = "Contrato de Garantia: FIADOR\nO FIADOR declara.";
    expect(aplicarPapeis(origem, "LOCADOR", "LOCATÁRIO", "FIADORA")).toBe(
      "Contrato de Garantia: FIADOR\nA FIADORA declara.",
    );
  });
  it("locatário minúsculo na cláusula 12", () => {
    const origem = "O locatário obriga-se a providenciar a transferência.";
    expect(aplicarPapeis(origem, "LOCADOR", "LOCATÁRIA", "FIADOR")).toBe(
      "A locatária obriga-se a providenciar a transferência.",
    );
  });
});

describe("pessoas do lado", () => {
  it("conta cônjuge e adicionais no lado do locador", () => {
    const p = pessoasLocador(
      false,
      {
        prop_sexo: "masculino",
        prop_conj_sexo: "feminino",
        locadores_adicionais: "Terceira pessoa (fictícia)",
        locadores_adicionais_sexo: "feminino",
      },
      { prop_conj_nome: "Cônjuge Fictícia" },
    );
    expect(termoPapel("locador", p)).toBe("LOCADORES");
  });
  it("PJ não usa sexo do campo", () => {
    const p = pessoasLocador(true, { prop_sexo: "feminino" }, {});
    expect(termoPapel("locador", p)).toBe("LOCADOR");
  });
  it("duas locatárias pelo campo adicional", () => {
    const p = pessoasLocatario(false, {
      loc_sexo: "feminino",
      locatarios_adicionais: "Segunda Locatária (fictícia)",
      locatarios_adicionais_sexo: "feminino",
    });
    expect(termoPapel("locatario", p)).toBe("LOCATÁRIAS");
  });
  it("casal de fiadores", () => {
    const p = pessoasFiador(
      false,
      { fia_sexo: "masculino", fia_conj_sexo: "feminino" },
      { fia_conj_nome: "Fiadora Cônjuge (fictícia)" },
    );
    expect(termoPapel("fiador", p)).toBe("FIADORES");
  });
});
