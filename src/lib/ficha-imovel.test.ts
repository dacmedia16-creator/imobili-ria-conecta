import { describe, expect, it } from "vitest";
import {
  TIPOS_IMOVEL,
  anoConstrucaoDoTexto,
  areaM2DoTexto,
  areaPrivativaDaDescricao,
  campoVisivel,
  fichaFaltando,
  inteiroDoTexto,
  precoM2,
  sugerirAreas,
  tipoImovelDaDescricao,
  tipoImovelDoTexto,
} from "./ficha-imovel";

describe("lista de tipos (igual ao Estudo de Mercado)", () => {
  it("mesmos valores e mesma ordem de estudodemercadomax/app.novo-estudo.tsx", () => {
    expect([...TIPOS_IMOVEL]).toEqual([
      "Apartamento",
      "Casa",
      "Terreno",
      "Comercial",
      "Cobertura",
      "Studio",
    ]);
  });
});

describe("areaM2DoTexto", () => {
  it.each([
    ["52,23", 52.23],
    ["250,00 metros quadrados", 250],
    ["198.78400000 m2", 198.78],
    ["21,58842064 m2", 21.59],
    ["89,123800 m2", 89.12],
    ["16.312,09", 16312.09],
    ["3.061,38", 3061.38],
    ["1.250 m²", 1250],
    ["546,40 m²", 546.4],
    ["144,0822 m²", 144.08],
    ["150,000000 m2", 150],
    ["área de 61,78 metros quadrados", 61.78],
    ["1,250,000", 1250000],
    [120, 120],
  ])("%s → %s", (txt, esperado) => {
    expect(areaM2DoTexto(txt)).toBe(esperado);
  });
  it.each([["0,00 m²"], [""], ["sem área"], [null], [undefined], [-5], ["99999999"]])(
    "%s → null",
    (txt) => {
      expect(areaM2DoTexto(txt)).toBeNull();
    },
  );
});

describe("números da ficha", () => {
  it("inteiros", () => {
    expect(inteiroDoTexto("2")).toBe(2);
    expect(inteiroDoTexto("03 quartos")).toBe(3);
    expect(inteiroDoTexto("0")).toBe(0);
    expect(inteiroDoTexto("")).toBeNull();
    expect(inteiroDoTexto("abc")).toBeNull();
    expect(inteiroDoTexto("150")).toBeNull();
  });
  it("ano", () => {
    const hoje = new Date("2026-10-08T12:00:00Z");
    expect(anoConstrucaoDoTexto("2015", hoje)).toBe(2015);
    expect(anoConstrucaoDoTexto("2027", hoje)).toBe(2027);
    expect(anoConstrucaoDoTexto("2028", hoje)).toBeNull();
    expect(anoConstrucaoDoTexto("1750", hoje)).toBeNull();
  });
});

describe("tipo do imóvel", () => {
  it("texto livre da captação → lista", () => {
    expect(tipoImovelDoTexto("APARTAMENTO")).toBe("Apartamento");
    expect(tipoImovelDoTexto("casa")).toBe("Casa");
    expect(tipoImovelDoTexto("Casa em condomínio")).toBe("Casa");
    expect(tipoImovelDoTexto("Escritório  Comercial ")).toBe("Comercial");
    expect(tipoImovelDoTexto("sala comercial")).toBe("Comercial");
    expect(tipoImovelDoTexto("Lote")).toBe("Terreno");
    expect(tipoImovelDoTexto("Cobertura duplex")).toBe("Cobertura");
    expect(tipoImovelDoTexto("kitnet")).toBe("Studio");
    // ambíguos ficam para o corretor
    expect(tipoImovelDoTexto("Residencial")).toBeNull();
    expect(tipoImovelDoTexto("Predial")).toBeNull();
    expect(tipoImovelDoTexto("")).toBeNull();
  });
  it("descrição da matrícula", () => {
    expect(
      tipoImovelDaDescricao("APARTAMENTO nº 12, do Condomínio X, construído no lote 5..."),
    ).toBe("Apartamento");
    expect(tipoImovelDaDescricao("Um prédio residencial com sala, cozinha e 2 dormitórios")).toBe(
      "Casa",
    );
    expect(tipoImovelDaDescricao("Um terreno constituído pelo lote 10 da quadra B")).toBe("Terreno");
    expect(tipoImovelDaDescricao("A sala comercial nº 3 do Edifício Y")).toBe("Comercial");
    expect(tipoImovelDaDescricao(null)).toBeNull();
  });
  it("área privativa na descrição", () => {
    expect(
      areaPrivativaDaDescricao("com a área privativa de 54,80 metros quadrados, área comum de 7,0"),
    ).toBe(54.8);
    expect(areaPrivativaDaDescricao("área real privativa: 46,2200 m²")).toBe(46.22);
    expect(areaPrivativaDaDescricao("área construída de 120 m²")).toBeNull();
  });
});

describe("sugerirAreas (regras do pedido)", () => {
  const ap = {
    tipo: "matricula",
    raw: {
      area_total: "61,78 metros quadrados",
      area_construida: "61,78 metros quadrados",
      observacoes_imovel: "APARTAMENTO nº 21 ... área privativa de 54,80 m², área comum ...",
    },
  };
  const iptuAp = { tipo: "iptu", raw: { area_total: "21,58842064 m2", area_construida: "89,123800 m2" } };

  it("apartamento: área útil = privativa da matrícula; nunca a fração ideal do IPTU", () => {
    const s = sugerirAreas([ap, iptuAp]);
    expect(s.tipo_sugerido).toBe("Apartamento");
    expect(s.area_util_m2).toBe(54.8);
    expect(s.area_util_fonte).toBe("área privativa da matrícula");
    expect(s.area_terreno_m2).toBeNull(); // 21,59 é fração ideal
  });
  it("campo area_privativa novo do prompt tem prioridade", () => {
    const s = sugerirAreas([{ tipo: "matricula", raw: { ...ap.raw, area_privativa: "55,10 m²" } }]);
    expect(s.area_util_m2).toBe(55.1);
  });
  it("apartamento sem privativa: não sugere área útil (o corretor informa)", () => {
    const s = sugerirAreas([iptuAp], "Apartamento");
    expect(s.area_util_m2).toBeNull();
    expect(s.area_terreno_m2).toBeNull();
  });
  it("casa: construída da matrícula como sugestão; terreno = área total", () => {
    const s = sugerirAreas([
      {
        tipo: "matricula",
        raw: {
          area_total: "300,00 metros quadrados",
          area_construida: "249,58 metros quadrados",
          observacoes_imovel: "Um prédio residencial ... lote 4",
        },
      },
      { tipo: "iptu", raw: { area_total: "300,00", area_construida: "260,10" } },
    ]);
    expect(s.tipo_sugerido).toBe("Casa");
    expect(s.area_util_m2).toBe(249.58);
    expect(s.area_util_fonte).toBe("área construída da matrícula");
    expect(s.area_terreno_m2).toBe(300);
    expect(s.divergente).toBe(true);
  });
  it("casa só com IPTU: usa a construída do IPTU", () => {
    const s = sugerirAreas([{ tipo: "iptu", raw: { area_total: "250,00 m²", area_construida: "278,71 m²" } }], "Casa");
    expect(s.area_util_m2).toBe(278.71);
    expect(s.area_util_fonte).toBe("área construída do IPTU");
    expect(s.divergente).toBe(false);
  });
  it("terreno: só área do terreno", () => {
    const s = sugerirAreas([
      { tipo: "matricula", raw: { area_total: "595,00 m²", observacoes_imovel: "Um lote de terreno" } },
    ]);
    expect(s.tipo_sugerido).toBe("Terreno");
    expect(s.area_util_m2).toBeNull();
    expect(s.area_terreno_m2).toBe(595);
  });
  it("tipo desconhecido e sem privativa: não chuta área útil", () => {
    const s = sugerirAreas([{ tipo: "iptu", raw: { area_total: "200,00", area_construida: "82,68" } }]);
    expect(s.tipo_sugerido).toBeNull();
    expect(s.area_util_m2).toBeNull();
    expect(s.area_construida_m2).toBe(82.68);
  });
  it("diferença pequena (até 2%) não é divergência", () => {
    const s = sugerirAreas([
      { tipo: "matricula", raw: { area_construida: "100,00" } },
      { tipo: "iptu", raw: { area_construida: "101,50" } },
    ], "Casa");
    expect(s.divergente).toBe(false);
  });
});

describe("fichaFaltando (mesma regra da trava do banco)", () => {
  const conf = { area_confirmada_em: "2026-10-08T12:00:00Z", area_confirmada_por: "u" };
  it("sem tipo", () => {
    expect(fichaFaltando({})).toEqual(["Tipo do imóvel"]);
    expect(fichaFaltando({ tipo_imovel: "Residencial" })).toEqual(["Tipo do imóvel"]);
  });
  it("residencial pede área útil, quartos, banheiros e vagas; suítes e ano opcionais", () => {
    expect(fichaFaltando({ tipo_imovel: "Apartamento" })).toEqual([
      "Área útil",
      "Quartos",
      "Banheiros",
      "Vagas",
    ]);
    expect(
      fichaFaltando({ tipo_imovel: "Casa", area_util_m2: 120, quartos: 3, banheiros: 2, vagas: 0, ...conf }),
    ).toEqual([]);
  });
  it("área útil precisa ser confirmada", () => {
    expect(
      fichaFaltando({ tipo_imovel: "Casa", area_util_m2: 120, quartos: 3, banheiros: 2, vagas: 1 }),
    ).toEqual(["Confirmar a área útil"]);
  });
  it("terreno pede só a área do terreno (confirmada)", () => {
    expect(fichaFaltando({ tipo_imovel: "Terreno" })).toEqual(["Área do terreno"]);
    expect(fichaFaltando({ tipo_imovel: "Terreno", area_terreno_m2: 300 })).toEqual([
      "Confirmar a área do terreno",
    ]);
    expect(fichaFaltando({ tipo_imovel: "Terreno", area_terreno_m2: 300, ...conf })).toEqual([]);
  });
  it("comercial: só área útil", () => {
    expect(fichaFaltando({ tipo_imovel: "Comercial", area_util_m2: "90.77", ...conf })).toEqual([]);
  });
});

describe("tela", () => {
  it("campos por tipo, como no Estudo", () => {
    expect(campoVisivel("area_terreno_m2", "Apartamento")).toBe(false);
    expect(campoVisivel("area_terreno_m2", "Casa")).toBe(true);
    expect(campoVisivel("quartos", "Terreno")).toBe(false);
    expect(campoVisivel("area_terreno_m2", "Terreno")).toBe(true);
  });
  it("preço por m²", () => {
    expect(precoM2(500000, 54.8)).toBe(9124);
    expect(precoM2(500000, null)).toBeNull();
    expect(precoM2(0, 50)).toBeNull();
  });
});
