import { describe, expect, it } from "vitest";
import {
  enderecoDaExtracao,
  separarEnderecoTexto,
  combinarComCep,
  normalizarCep,
} from "./endereco-imovel";

describe("separarEnderecoTexto", () => {
  it("separa rua, número, complemento, bairro, cidade e UF", () => {
    expect(
      separarEnderecoTexto(
        "Rua Luiz Celestino Bertanha, 386, Lote 28, Quadra C, Jardim Astro, Sorocaba - SP",
      ),
    ).toMatchObject({
      logradouro: "Rua Luiz Celestino Bertanha",
      numero: "386",
      complemento: "Lote 28, Quadra C",
      bairro: "Jardim Astro",
      cidade: "Sorocaba",
      uf: "SP",
    });
  });
  it("lê CEP com ponto e número colado na rua", () => {
    const p = separarEnderecoTexto("Rua Capitão Grandino 432- apto 121, CEP 18.087-657");
    expect(p.cep).toBe("18087657");
    expect(p.logradouro).toBe("Rua Capitão Grandino");
    expect(p.numero).toBe("432");
  });
  it("ignora zona fiscal do IPTU como bairro", () => {
    expect(
      separarEnderecoTexto("AVENIDA SAO PAULO, 1.662 - BAIRRO REGIAO LESTE").bairro,
    ).toBeNull();
  });
  it("texto vazio devolve tudo nulo", () => {
    expect(separarEnderecoTexto(null).logradouro).toBeNull();
  });
});

describe("enderecoDaExtracao", () => {
  it("partes devolvidas pela IA têm prioridade sobre o texto", () => {
    const p = enderecoDaExtracao({
      endereco_imovel: "Rua A, 10, Vila X, Sorocaba - SP",
      endereco_bairro: "Jardim Y",
      endereco_cep: "18087-657",
    });
    expect(p.bairro).toBe("Jardim Y");
    expect(p.cep).toBe("18087657");
    expect(p.numero).toBe("10");
  });
});

describe("combinarComCep", () => {
  it("CEP manda em rua/bairro/cidade, número fica do documento", () => {
    const p = combinarComCep(
      separarEnderecoTexto("Rua X, 12, Bairro do Itanguá ou Cerrado, Sorocaba - SP"),
      {
        cep: "18087657",
        logradouro: "Rua Eurides Pereira Bueno",
        bairro: "Jardim Residencial Villa Amato",
        cidade: "Sorocaba",
        uf: "SP",
      },
    );
    expect(p).toMatchObject({ numero: "12", bairro: "Jardim Residencial Villa Amato" });
  });
  it("normaliza CEP", () => {
    expect(normalizarCep("18.087-657")).toBe("18087657");
    expect(normalizarCep("1808")).toBeNull();
  });
});

describe("casos reais", () => {
  it("número com ponto de milhar", () => {
    expect(
      separarEnderecoTexto("Avenida Ipanema, nº 5.867, apartamento 22, Sorocaba - SP").numero,
    ).toBe("5867");
  });
  it("cidade sem vírgula no fim", () => {
    expect(separarEnderecoTexto("rua jose marte, 11 Jd Piazza di Roma Sorocaba SP")).toMatchObject({
      cidade: "Sorocaba",
      uf: "SP",
    });
  });
  it("CEP de outra rua não sobrescreve", () => {
    const p = combinarComCep(
      separarEnderecoTexto("Rua Zulmira Garcia dos Reis, Quadra G, lote 21"),
      {
        cep: "18087180",
        logradouro: "Avenida Três de Março",
        bairro: "Aparecidinha",
        cidade: "Sorocaba",
        uf: "SP",
      },
    );
    expect(p.cep).toBeNull();
    expect(p.bairro).not.toBe("Aparecidinha");
  });
});
