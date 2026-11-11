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
  it("flexiona o termo, o artigo e o verbo, sem reescrever a cláusula", () => {
    const origem =
      "O aluguel deve ser pago pelo LOCATÁRIO até o dia 10. O FIADOR assume a fiança. O imóvel destina-se à MORADIA do LOCATÁRIO.";
    const saida = aplicarPapeis(origem, "LOCADORA", "LOCATÁRIO", "FIADORES");
    expect(saida).toContain("pelo LOCATÁRIO");
    expect(saida).toContain("OS FIADORES assumem a fiança");
    expect(saida).toContain("do LOCATÁRIO");
    expect(saida).not.toMatch(/LOCADOR\s*\(\s*A\s*\)/);
  });
  it("troca formas duplas O(s) LOCATÁRIO(s) e LOCATÁRIO (S)", () => {
    const origem = "O(s) LOCATÁRIO(s) autorizam. O LOCATÁRIO (S), poderá ele mesmo contratar.";
    const saida = aplicarPapeis(origem, "LOCADOR", "LOCATÁRIAS", "FIADOR");
    expect(saida).toContain("AS LOCATÁRIAS autorizam");
    expect(saida).toContain("AS LOCATÁRIAS, poderão elas mesmas contratar");
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
  it("autorizam no singular quando há um locatário", () => {
    const origem = "O(s) LOCATÁRIO(s) autorizam.";
    expect(aplicarPapeis(origem, "LOCADOR", "LOCATÁRIO", "FIADOR")).toBe("O LOCATÁRIO autoriza.");
  });
});

const PAPEIS: {
  papel: "locador" | "locatario" | "fiador";
  sm: string;
  sf: string;
  pm: string;
  pf: string;
}[] = [
  { papel: "locador", sm: "LOCADOR", sf: "LOCADORA", pm: "LOCADORES", pf: "LOCADORAS" },
  { papel: "locatario", sm: "LOCATÁRIO", sf: "LOCATÁRIA", pm: "LOCATÁRIOS", pf: "LOCATÁRIAS" },
  { papel: "fiador", sm: "FIADOR", sf: "FIADORA", pm: "FIADORES", pf: "FIADORAS" },
];

describe("concordância de verbo por papel", () => {
  for (const p of PAPEIS) {
    it(`${p.papel}: singular masculino`, () => {
      const args =
        p.papel === "locador"
          ? ([p.sm, "LOCATÁRIO", "FIADOR"] as const)
          : p.papel === "locatario"
            ? (["LOCADOR", p.sm, "FIADOR"] as const)
            : (["LOCADOR", "LOCATÁRIO", p.sm] as const);
      const saida = aplicarPapeis(
        `O ${p.sm} assume a responsabilidade. O ${p.sm} declara ter.`,
        ...args,
      );
      expect(saida).toContain(`${p.sm} assume`);
      expect(saida).toContain(`${p.sm} declara`);
      expect(saida).not.toMatch(new RegExp(`${p.sm} assumem`));
    });
    it(`${p.papel}: singular feminino`, () => {
      const args =
        p.papel === "locador"
          ? ([p.sf, "LOCATÁRIO", "FIADOR"] as const)
          : p.papel === "locatario"
            ? (["LOCADOR", p.sf, "FIADOR"] as const)
            : (["LOCADOR", "LOCATÁRIO", p.sf] as const);
      const saida = aplicarPapeis(
        `O ${p.sm} assume a responsabilidade. O ${p.sm} declara ter.`,
        ...args,
      );
      expect(saida).toContain(`A ${p.sf} assume`);
      expect(saida).toContain(`A ${p.sf} declara`);
    });
    it(`${p.papel}: plural misto`, () => {
      const args =
        p.papel === "locador"
          ? ([p.pm, "LOCATÁRIO", "FIADOR"] as const)
          : p.papel === "locatario"
            ? (["LOCADOR", p.pm, "FIADOR"] as const)
            : (["LOCADOR", "LOCATÁRIO", p.pm] as const);
      const saida = aplicarPapeis(
        `O ${p.sm} assume a responsabilidade. O ${p.sm} declara ter. O ${p.sm} responderá pelas obrigações.`,
        ...args,
      );
      expect(saida).toContain(`OS ${p.pm} assumem`);
      expect(saida).toContain(`OS ${p.pm} declaram`);
      expect(saida).toContain(`OS ${p.pm} responderão`);
      expect(saida).not.toMatch(new RegExp(`OS ${p.pm} assume `));
      expect(saida).not.toMatch(new RegExp(`OS ${p.pm} declara `));
      expect(saida).not.toMatch(new RegExp(`OS ${p.pm} responderá `));
    });
    it(`${p.papel}: plural feminino`, () => {
      const args =
        p.papel === "locador"
          ? ([p.pf, "LOCATÁRIO", "FIADOR"] as const)
          : p.papel === "locatario"
            ? (["LOCADOR", p.pf, "FIADOR"] as const)
            : (["LOCADOR", "LOCATÁRIO", p.pf] as const);
      const saida = aplicarPapeis(
        `O ${p.sm} assume a responsabilidade. O ${p.sm} declara ter.`,
        ...args,
      );
      expect(saida).toContain(`AS ${p.pf} assumem`);
      expect(saida).toContain(`AS ${p.pf} declaram`);
    });
    it(`${p.papel}: PJ permanece singular`, () => {
      const args =
        p.papel === "locador"
          ? ([p.sm, "LOCATÁRIO", "FIADOR"] as const)
          : p.papel === "locatario"
            ? (["LOCADOR", p.sm, "FIADOR"] as const)
            : (["LOCADOR", "LOCATÁRIO", p.sm] as const);
      const saida = aplicarPapeis(`O ${p.sm} assume a responsabilidade.`, ...args);
      expect(saida).toContain(`O ${p.sm} assume`);
      expect(saida).not.toContain(`${p.sf}`);
      expect(saida).not.toContain(`${p.pm}`);
    });
  }

  it("fiador: os 4 exemplos reais do PDF v3", () => {
    const origem = [
      "O FIADOR assume a responsabilidade solidária",
      "O FIADOR declara ter pleno conhecimento",
      "O FIADOR declara possuir o imóvel",
      "O FIADOR responderá pelas obrigações",
    ].join(". ");
    const saida = aplicarPapeis(origem, "LOCADOR", "LOCATÁRIO", "FIADORES");
    expect(saida).toContain("OS FIADORES assumem a responsabilidade");
    expect(saida).toContain("OS FIADORES declaram ter");
    expect(saida).toContain("OS FIADORES declaram possuir");
    expect(saida).toContain("OS FIADORES responderão pelas");
  });

  it("locador: declara ser o/a legítimo(a) proprietário(a)", () => {
    const origem =
      "O LOCADOR declara ser o legítimo proprietário e/ou possuidor do Imóvel, figurando o LOCADOR como o único beneficiário.";
    expect(aplicarPapeis(origem, "LOCADORA", "LOCATÁRIO", "FIADOR")).toContain(
      "A LOCADORA declara ser a legítima proprietária e/ou possuidora",
    );
    expect(aplicarPapeis(origem, "LOCADORA", "LOCATÁRIO", "FIADOR")).toContain(
      "figurando a LOCADORA como a única beneficiária",
    );
    const pl = aplicarPapeis(origem, "LOCADORES", "LOCATÁRIO", "FIADOR");
    expect(pl).toContain("OS LOCADORES declaram ser os legítimos proprietários e/ou possuidores");
    expect(pl).toContain("figurando os LOCADORES como os únicos beneficiários");
  });

  it("locatário: Caso...deverá, ele mesmo, a ele, recebeu", () => {
    const caso = "Caso o LOCATÁRIO não receba o boleto, deverá entrar em contato.";
    expect(aplicarPapeis(caso, "LOCADOR", "LOCATÁRIAS", "FIADOR")).toBe(
      "Caso as LOCATÁRIAS não recebam o boleto, deverão entrar em contato.",
    );
    expect(
      aplicarPapeis(
        "encargos locatícios expressamente atribuídos a ele neste contrato",
        "LOCADOR",
        "LOCATÁRIAS",
        "FIADOR",
      ),
    ).toContain("atribuídos a elas");
    expect(
      aplicarPapeis(
        "O LOCATÁRIO declara receber o imóvel em que o recebeu.",
        "LOCADOR",
        "LOCATÁRIOS",
        "FIADOR",
      ),
    ).toContain("em que o receberam");
    expect(
      aplicarPapeis(
        "Considera-se em mora o LOCATÁRIO se não efetuar o pagamento.",
        "LOCADOR",
        "LOCATÁRIAS",
        "FIADOR",
      ),
    ).toContain("Consideram-se em mora as LOCATÁRIAS");
  });

  it("não flexiona verbo de outro sujeito nem o mesmo (imóvel)", () => {
    const origem =
      "O aluguel deve ser pago pelo LOCATÁRIO até o dia 10. Compete ao LOCADOR realizar os reparos. vistoria no mesmo a fim de ficar constatado.";
    const saida = aplicarPapeis(origem, "LOCADORES", "LOCATÁRIAS", "FIADORES");
    expect(saida).toContain("pago pelas LOCATÁRIAS");
    expect(saida).toContain("Compete aos LOCADORES realizar");
    expect(saida).toContain("vistoria no mesmo");
    expect(saida).not.toContain("o/a");
  });

  it("cláusula de PJ do locatário não leva o verbo ao plural", () => {
    const origem =
      "Em se tratando de LOCATÁRIO pessoa jurídica, que seja obrigado ao pagamento, compromete-se o LOCATÁRIO a apresentar os comprovantes.";
    const saida = aplicarPapeis(origem, "LOCADOR", "LOCATÁRIAS", "FIADOR");
    expect(saida).toContain("LOCATÁRIO pessoa jurídica");
    expect(saida).toContain("compromete-se as LOCATÁRIAS");
    expect(saida).not.toContain("comprometem-se");
  });
  it("permanecendo responsável concorda em número com o papel do parágrafo", () => {
    expect(
      aplicarPapeis(
        "O FIADOR deverá observar os prazos, permanecendo responsável pelas obrigações.",
        "LOCADOR",
        "LOCATÁRIO",
        "FIADORES",
      ),
    ).toContain("permanecendo responsáveis");
    expect(
      aplicarPapeis(
        "Caso o LOCATÁRIO não receba o boleto, deverá entrar em contato, permanecendo responsável pelo pagamento.",
        "LOCADOR",
        "LOCATÁRIAS",
        "FIADOR",
      ),
    ).toContain("permanecendo responsáveis");
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
