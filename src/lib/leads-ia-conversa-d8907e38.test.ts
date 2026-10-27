// t_37cf21e3: conversa de teste de Denis (d8907e38, ZZ, VIP0027) — os 6 pontos, nas funções puras do roteiro.
import { describe, expect, it } from "vitest";
import { falasSemResposta, permitidosDe, validarRedacaoDetalhe, type SaidaModelo } from "./leads-ia-redacao";
import type { FichaIa, ImovelParecido } from "./leads-ia";
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

// --- Travas novas (resposta escrita pelo modelo) ---------------------------------------------------------
const FICHA: FichaIa = {
  tipo: "casa", bairro: "Central Parque", cidade: "Sorocaba", quartos: "3", suites: "1", vagas: "4",
  preco: "R$ 690.000", preco_valor: 690000, link: "https://vipsevenimoveis.com.br/imovel/VIP0027",
};
const CENTRO: ImovelParecido = { codigo: "VIP0015", tipo: "apartamento", bairro: "Centro", cidade: "Sorocaba", quartos: "4", suites: "3", vagas: "2", preco: "R$ 975.000", url: "https://vipsevenimoveis.com.br/imovel/VIP0015" };
const CAMPOLIM: ImovelParecido = { codigo: "VIP0036", tipo: "apartamento", bairro: "Parque Campolim", cidade: "Sorocaba", quartos: "3", suites: "3", vagas: "3", preco: "R$ 1.170.000", url: "https://vipsevenimoveis.com.br/imovel/VIP0036" };
const CASA: ImovelParecido = { codigo: "VIP0137", tipo: "casa", bairro: "Horto Florestal", cidade: "Sorocaba", quartos: "3", suites: "2", vagas: "2", preco: "R$ 685.000", url: "https://vipsevenimoveis.com.br/imovel/VIP0137" };
const s = (mensagem: string, acao: SaidaModelo["acao"] = "responder", codigo: string | null = null): SaidaModelo => ({ mensagem, acao, codigo, registro: {} });
const perm = (parecidos: ImovelParecido[], extra: Record<string, unknown> = {}) => Object.assign(permitidosDe(FICHA, parecidos, [], []), extra);

describe("trava fotos (item 6)", () => {
  it("barra \"te mando mais fotos\" (ao vivo, 18:34)", () => {
    const d = validarRedacaoDetalhe(s("Claro, te mando mais fotos da casa do Central Parque! O corretor confirma com você na visita ou no contato. Quer agendar a visita para conhecer?"), perm([], { fotos: { link: FICHA.link } }), "me manda mais fotos");
    expect(d?.motivo).toBe("fotos");
  });
  it("barra fotos sem o link (ao vivo, 18:35)", () => {
    const d = validarRedacaoDetalhe(s("As fotos da casa do Central Parque o corretor confirma com você na visita ou no contato. Quer agendar a visita para conhecê-la?"), perm([], { fotos: { link: FICHA.link } }), "me manda as fotos primeiro");
    expect(d?.motivo).toBe("fotos");
  });
  it("aceita o link do anúncio", () => {
    expect(validarRedacaoDetalhe(s(`As fotos estão todas no anúncio: ${FICHA.link} Quer agendar uma visita?`), perm([], { fotos: { link: FICHA.link } }), "me manda mais fotos")).toBeNull();
  });
});

describe("trava região (item 2)", () => {
  it("barra imóvel do Centro para quem pediu Campolim, sem aviso", () => {
    const d = validarRedacaoDetalhe(s(`Tenho um apartamento com 3 suítes por R$ 975.000: ${CENTRO.url} O que acha?`, "oferecer", "VIP0015"), perm([CENTRO], { regiao: "campolim" }), "3 suites ate 1200");
    expect(d?.motivo).toBe("regiao");
  });
  it("aceita com o aviso de que no Campolim não tem e que fica em outro bairro", () => {
    const d = validarRedacaoDetalhe(s(`No Campolim não tenho com 3 suítes agora. Um apartamento parecido fica no Centro, em outro bairro, por R$ 975.000: ${CENTRO.url} Te serve?`, "oferecer", "VIP0015"), perm([CENTRO], { regiao: "campolim", estoque: "com_candidatos" }), "3 suites ate 1200");
    expect(d).toBeNull();
  });
  it("imóvel do próprio bairro pedido passa sem aviso", () => {
    expect(validarRedacaoDetalhe(s(`Achei um apartamento no Parque Campolim por R$ 1.170.000: ${CAMPOLIM.url} O que acha?`, "oferecer", "VIP0036"), perm([CAMPOLIM], { regiao: "campolim" }), "3 suites ate 1200")).toBeNull();
  });
});

describe("trava perfil (item 3): duas buscas", () => {
  it("barra apartamento quando o cliente fala da casa DELE", () => {
    const d = validarRedacaoDetalhe(s(`Tenho sim! Um apartamento por R$ 1.170.000: ${CAMPOLIM.url} Te serve?`, "oferecer", "VIP0036"), perm([CAMPOLIM], { perfilTipo: "casa" }), "vc tem mais opções ?");
    expect(d?.motivo).toBe("perfil");
  });
  it("casa passa", () => {
    expect(validarRedacaoDetalhe(s(`Tenho sim! Uma casa no Horto Florestal por R$ 685.000: ${CASA.url} Gostou?`, "oferecer", "VIP0137"), perm([CASA], { perfilTipo: "casa" }), "vc tem mais opções ?")).toBeNull();
  });
  it("as mensagens que chegaram juntas vão para o roteiro", () => {
    expect(
      falasSemResposta(
        [
          { autor: "ia", texto: "O endereço exato o corretor confirma." },
          { autor: "cliente", texto: "vou passar seu contato para ele" },
          { autor: "cliente", texto: "sobre a casa q eu to vendo para mim" },
          { autor: "cliente", texto: "vc tem mais opções ?" },
        ],
        "vc tem mais opções ?",
      ),
    ).toEqual(["vou passar seu contato para ele", "sobre a casa q eu to vendo para mim"]);
  });
});

describe("trava sem_oferta (item 4): pediu opções e há candidato", () => {
  it("barra voltar só para a casa original", () => {
    const d = validarRedacaoDetalhe(s("Ah, desculpa! Então seguimos com a casa que você viu, no Central Parque. Quer agendar uma visita?"), perm([CASA], { pediuOpcoes: true, estoque: "com_candidatos" }), "disse q quero casa");
    expect(d?.motivo).toBe("sem_oferta");
  });
});

describe("trava gostou (item 5)", () => {
  it("barra \"Que bom que gostou!\" quando o cliente só disse \"Gostaria\"", () => {
    const d = validarRedacaoDetalhe(s("Que bom que gostou! A casa tem 3 quartos. Quer agendar uma visita?"), perm([], { clienteGostou: false }), "Gostaria");
    expect(d?.motivo).toBe("gostou");
  });
  it("passa quando ele disse que gostou", () => {
    expect(validarRedacaoDetalhe(s("Que bom que gostou! Quer agendar uma visita?"), perm([], { clienteGostou: true }), "gostei")).toBeNull();
  });
});
