// t_37cf21e3: conversa de teste de Denis (d8907e38, ZZ, VIP0027) — os 6 pontos, nas funções puras do roteiro.
import { describe, expect, it } from "vitest";
import {
  DISSE_QUE_GOSTOU,
  fraseAmbiguaTipo,
  mesmoBairro,
  pediuFotos,
  quartosParecidos,
  querTipo,
  regiaoPedida,
  SO_GOSTARIA,
  textoForaRegiao,
  valorFaixa,
} from "./leads-ia";

describe("1. opção parecida = quartos parecidos (±1)", () => {
  const ficha = { quartos: "3" };
  it("casa de 3 quartos não aceita parecido de 1 quarto (VIP0141)", () => {
    expect(quartosParecidos({ quartos: "1" }, ficha)).toBe(false);
  });
  it("aceita 2, 3 e 4 quartos", () => {
    for (const q of ["2", "3", "4"]) expect(quartosParecidos({ quartos: q }, ficha)).toBe(true);
  });
  it("pedido próprio do cliente (\"3 suítes\") manda", () => {
    expect(quartosParecidos({ quartos: "1" }, ficha, { suites: 3 })).toBe(true);
  });
});

describe("2. região pedida sem imóvel: avisa antes de mostrar outro bairro", () => {
  it("lê o bairro e entende \"nesta região\"", () => {
    expect(regiaoPedida("oq mais vc tem nesta região?", "Central Parque")).toBe("Central Parque");
    expect(mesmoBairro("Parque Campolim", "campolim")).toBe(true);
    expect(mesmoBairro("Centro", "campolim")).toBe(false);
  });
  it("texto diz que no bairro pedido não tem e que fica em outro bairro", () => {
    const t = textoForaRegiao(
      { codigo: "VIP0015", tipo: "casa", bairro: "Centro", quartos: "3", preco: "650000", url: "https://x/1" } as never,
      "campolim",
      "casa",
    );
    expect(t).toMatch(/^No Campolim não tenho casas/);
    expect(t).toMatch(/Centro/);
    expect(t).toMatch(/outro bairro/);
    expect(t).toContain("https://x/1");
  });
});

describe("3. duas buscas: \"até 1200\" do filho é R$ 1,2 mi só na busca dele", () => {
  it("na compra, número solto vira milhar", () => {
    expect(valorFaixa("3 suites ate 1200", true)?.max).toBe(1_200_000);
  });
  it("sem a opção, continua como antes", () => {
    expect(valorFaixa("ate 400 mil")?.max).toBe(400_000);
  });
});

describe("4. frase ambígua \"não quero casa mesmo\"", () => {
  it("é ambígua e pede confirmação do tipo", () => {
    expect(fraseAmbiguaTipo("não quero casa mesmo")).toBe("casa");
  });
  it("com vírgula ou dito claro não é ambígua", () => {
    expect(fraseAmbiguaTipo("não, quero casa mesmo")).toBeNull();
    expect(querTipo("não, quero casa mesmo")).toBe("casa");
    expect(querTipo("eu disse q quero casa")).toBe("casa");
  });
});

describe("5. \"Gostaria\" não é \"gostei\"", () => {
  it("Gostaria sozinho", () => {
    expect(SO_GOSTARIA.test("gostaria")).toBe(true);
    expect(DISSE_QUE_GOSTOU.test("gostaria")).toBe(false);
    expect(DISSE_QUE_GOSTOU.test("gostei muito")).toBe(true);
  });
});

describe("6. fotos = link do anúncio", () => {
  it("detecta pedido de fotos/vídeo", () => {
    expect(pediuFotos("me manda mais fotos")).toBe(true);
    expect(pediuFotos("me manda as fotos primeiro")).toBe(true);
    expect(pediuFotos("tem video?")).toBe(true);
    expect(pediuFotos("quero visitar")).toBe(false);
  });
});
