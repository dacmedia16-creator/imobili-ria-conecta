// Nicole redige com travas (t_7b59589c): validador determinístico + plano B + chave desligada.
import { describe, expect, it } from "vitest";
import {
  proximaResposta,
  type ContextoIa,
  type FichaIa,
  type ImovelParecido,
  type ResultadoParecidos,
} from "./leads-ia";
import type { UsoModelo } from "./leads-ia-modelo";
import {
  lerSaida,
  montarMensagens,
  permitidosDe,
  redigirResposta,
  textoRobo,
  validarRedacao,
  visitaSemParenteses,
  type SaidaModelo,
} from "./leads-ia-redacao";

// Dados reais do XML da ZZ (lead 4c2e125f, VIP0119) e dos parecidos devolvidos pela RPC.
const FICHA: FichaIa = {
  tipo: "casa",
  bairro: "Condominio Ibiti Reserva",
  cidade: "Sorocaba",
  quartos: "3",
  suites: "1",
  banheiros: "3",
  vagas: "4",
  area_util_m2: "150",
  area_terreno_m2: "250",
  negocio: "venda",
  preco: "R$ 1.199.000",
  preco_valor: 1199000,
  condominio: "R$ 420,00",
  iptu: "R$ 100,00 por mês",
  link: "https://vipsevenimoveis.com.br/imovel/VIP0119",
};
const P3921: ImovelParecido = {
  codigo: "3921",
  tipo: "casa",
  bairro: "Condominio Ibiti Reserva",
  cidade: "Sorocaba",
  quartos: "3",
  suites: "1",
  vagas: "4",
  area_util_m2: "167",
  preco: "R$ 1.220.000",
  url: "https://vipsevenimoveis.com.br/imovel/3921",
  mesmo_bairro: true,
};
const P3920: ImovelParecido = {
  codigo: "3920",
  tipo: "casa",
  bairro: "Condominio Ibiti Reserva",
  cidade: "Sorocaba",
  quartos: "3",
  suites: "2",
  vagas: "4",
  area_util_m2: "160",
  preco: "R$ 1.175.000",
  url: "https://vipsevenimoveis.com.br/imovel/3920",
  mesmo_bairro: true,
};
const AGORA = new Date("2026-10-27T13:00:00Z");
const VISITA = visitaSemParenteses(AGORA);
const PERM = permitidosDe(FICHA, [P3921, P3920], VISITA);
const s = (mensagem: string, extra: Partial<SaidaModelo> = {}): SaidaModelo => ({
  mensagem,
  acao: "responder",
  codigo: null,
  registro: {},
  ...extra,
});

const ctx = (extra: Partial<ContextoIa> = {}): ContextoIa => ({
  conversa_id: "c1",
  estado: "ativa",
  versao: 3,
  passo: "interesse",
  dados: {},
  ia_nome: "Nicole",
  lead_nome: "Denis",
  imovel: null,
  org_nome: "ZZ Teste Provisionamento",
  transacao: "venda",
  anuncio_codigo: "VIP0119",
  ficha: FICHA,
  imovel_frase: "a casa do bairro Condominio Ibiti Reserva",
  imovel_fonte: "xml",
  ...extra,
});

describe("validador da redação (travas depois do modelo)", () => {
  it("aprova resposta direta com dado da ficha", () => {
    expect(
      validarRedacao(
        s("O condomínio é R$ 420 por mês. Quer marcar uma visita para conhecer?"),
        PERM,
        "qual valor do Condominio ?",
      ),
    ).toBeNull();
    expect(
      validarRedacao(
        s("O IPTU é R$ 100 por mês e são 4 vagas na garagem. Quer conhecer?"),
        PERM,
        "e o iptu?",
      ),
    ).toBeNull();
  });
  it("aprova oferta de parecido real com link exato", () => {
    const m =
      "Tenho sim! Tem outra casa no mesmo condomínio, com 3 quartos e 167 m², por R$ 1.220.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3921 Gostou?";
    expect(
      validarRedacao(s(m, { acao: "oferecer", codigo: "3921" }), PERM, "tem mais opções?"),
    ).toBeNull();
  });
  it("bloqueia preço inventado", () => {
    expect(validarRedacao(s("Está por R$ 1.100.000. Quer visitar?"), PERM, "")).toBe("valor");
    expect(validarRedacao(s("Sai por 1,1 milhão. Quer visitar?"), PERM, "")).toBe("valor");
    expect(validarRedacao(s("O condomínio é R$ 380. Quer visitar?"), PERM, "")).toBe("valor");
  });
  it("bloqueia área, quartos e vagas que não existem nos dados", () => {
    expect(validarRedacao(s("Ela tem 180 m². Gostou?"), PERM, "")).toBe("area");
    expect(validarRedacao(s("Ela tem 5 quartos. Gostou?"), PERM, "")).toBe("contagem");
    expect(validarRedacao(s("Tem duas vagas de garagem. Gostou?"), PERM, "")).toBe("contagem");
    expect(validarRedacao(s("Fica a 2 km do shopping."), PERM, "")).toBe("numero");
  });
  it("link só o url exato do XML", () => {
    expect(
      validarRedacao(s("Veja: https://vipsevenimoveis.com.br/imovel/9999 Gostou?"), PERM, ""),
    ).toBe("link");
    expect(validarRedacao(s("Veja no zapimoveis.com.br"), PERM, "")).toBe("link");
    expect(
      validarRedacao(
        s("Veja: https://vipsevenimoveis.com.br/imovel/VIP0119 Quer visitar?"),
        PERM,
        "",
      ),
    ).toBeNull();
  });
  it("oferta precisa ser de candidato fornecido e ainda não oferecido", () => {
    const m = "Tem esta: https://vipsevenimoveis.com.br/imovel/3921 Gostou?";
    expect(validarRedacao(s(m, { acao: "oferecer", codigo: "9999" }), PERM, "")).toBe("oferta");
    expect(validarRedacao(s(m, { acao: "oferecer", codigo: "3921" }), PERM, "", ["3921"])).toBe(
      "oferta",
    );
    expect(validarRedacao(s(m, { acao: "oferecer", codigo: "3920" }), PERM, "")).toBe("oferta");
  });
  it("bloqueia disponibilidade, financiamento/permuta, andar, desconto e promessa", () => {
    expect(validarRedacao(s("Está disponível sim! Quer visitar?"), PERM, "")).toBe(
      "disponibilidade",
    );
    expect(validarRedacao(s("Aceita financiamento sim! Quer visitar?"), PERM, "")).toBe("condicao");
    expect(validarRedacao(s("Dá para usar FGTS. Quer visitar?"), PERM, "")).toBe("condicao");
    expect(validarRedacao(s("Aceita permuta, pode mandar. Quer visitar?"), PERM, "")).toBe(
      "condicao",
    );
    expect(validarRedacao(s("Fica no último andar. Quer visitar?"), PERM, "")).toBe("andar");
    expect(validarRedacao(s("Consigo um desconto para você. Quer visitar?"), PERM, "")).toBe(
      "desconto",
    );
    expect(validarRedacao(s("Garanto que você vai amar. Quer visitar?"), PERM, "")).toBe(
      "promessa",
    );
  });
  it("deixa dizer que vai confirmar (sem afirmar)", () => {
    expect(
      validarRedacao(
        s("Vou confirmar o financiamento e já te falo! Quer marcar uma visita enquanto isso?"),
        PERM,
        "aceita financiamento?",
      ),
    ).toBeNull();
    expect(
      validarRedacao(
        s("Vou confirmar a disponibilidade e já te falo. Quer marcar uma visita?"),
        PERM,
        "",
      ),
    ).toBeNull();
  });
  it("identidade: nunca IA/robô/sistema/assistente virtual, nem dizer que é humana", () => {
    expect(validarRedacao(s("Sou a assistente virtual da ZZ."), PERM, "")).toBe("identidade");
    expect(validarRedacao(s("Aqui é a IA da ZZ."), PERM, "")).toBe("identidade");
    expect(validarRedacao(s("O sistema mostra que sim."), PERM, "")).toBe("identidade");
    expect(validarRedacao(s("Não sou robô, sou uma pessoa!"), PERM, "")).toBe("identidade");
  });
  it("corretor só na frase de passagem (colocada pelo código); sem parênteses; tamanho; 1 pergunta", () => {
    expect(validarRedacao(s("Quer que eu peça ao corretor?"), PERM, "")).toBe("corretor");
    expect(validarRedacao(s("Tem a casa código 3921 (código 3921). Gostou?"), PERM, "")).toBe(
      "parenteses",
    );
    expect(validarRedacao(s("a".repeat(401)), PERM, "")).toBe("tamanho");
    expect(validarRedacao(s("Gostou? Quer visitar?"), PERM, "")).toBe("perguntas");
    expect(validarRedacao(s("Obrigada! O condomínio é R$ 420."), PERM, "qual o condomínio?")).toBe(
      "obrigada",
    );
  });
  it("data de visita só as oferecidas", () => {
    expect(validarRedacao(s(`Pode ser ${VISITA[0]}?`), PERM, "")).toBeNull();
    expect(validarRedacao(s("Pode ser dia 15/11?"), PERM, "")).toBe("numero");
  });
});

describe("lerSaida", () => {
  it("aceita só chaves conhecidas", () => {
    const o = lerSaida(
      '{"mensagem":" Oi ","acao":"x","registro":{"pagamento":["financiamento","pix"],"lixo":1,"finalidade":"morar"}}',
    );
    expect(o).toEqual({
      mensagem: "Oi",
      acao: "responder",
      codigo: null,
      registro: { pagamento: ["financiamento"] },
    });
    expect(lerSaida("não é json")).toBeNull();
    expect(lerSaida('{"acao":"passar"}')).toBeNull();
  });
});

describe("montarMensagens (o que vai ao modelo)", () => {
  it("mascara telefone e e-mail e não leva código do imóvel do cliente", () => {
    const m = montarMensagens({
      ctx: ctx(),
      texto: "meu zap é 15 99999-1234 e email a@b.com",
      historico: [{ autor: "ia", texto: "Oi, Denis!" }],
      candidatos: [P3921],
      visita: VISITA,
    });
    expect(m.usuario).not.toMatch(/99999|a@b\.com/);
    expect(m.usuario).toContain("[número]");
    expect(m.usuario).toContain('"condominio":"R$ 420"');
    expect(m.sistema).toContain("Nicole");
    expect(m.sistema).toContain("ZZ Teste Provisionamento");
  });
});

// --- Orquestração com modelo simulado ------------------------------------------------------------------
const ENV = { LEADS_IA_MODELO: "gemini", GEMINI_API_KEY: "teste" };
const fetchModelo = (saida: unknown, status = 200): typeof fetch =>
  (async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: typeof saida === "string" ? saida : JSON.stringify(saida) }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 1000,
          candidatesTokenCount: 50,
          thoughtsTokenCount: 100,
        },
      }),
      { status },
    )) as unknown as typeof fetch;
const buscar = async (): Promise<ResultadoParecidos> => ({
  referencia: { codigo: "VIP0119", no_xml: true },
  itens: [P3921, P3920],
});

async function rodar(texto: string, fetchFn: typeof fetch, c = ctx()) {
  const usos: UsoModelo[] = [];
  const base = await proximaResposta(c, texto, undefined, {
    agora: AGORA,
    buscarParecidos: buscar,
  });
  const r = await redigirResposta(c, texto, base, {
    escolha: { provedor: "gemini", modelo: null },
    env: ENV,
    historico: [],
    buscarParecidos: buscar,
    registrar: (u) => usos.push(u),
    fetchFn,
    agora: AGORA,
  });
  return { base, r, usos };
}

describe("redigirResposta", () => {
  it("modelo aprovado: a mensagem dele sai e o uso é registrado sem conteúdo", async () => {
    const { r, usos } = await rodar(
      "qual valor do Condominio ?",
      fetchModelo({
        mensagem: "O condomínio é R$ 420 por mês. Quer marcar uma visita para conhecer?",
        acao: "responder",
      }),
    );
    expect(r.redigida).toBe(true);
    expect(r.resposta).toBe("O condomínio é R$ 420 por mês. Quer marcar uma visita para conhecer?");
    expect(usos).toHaveLength(1);
    expect(usos[0]).toMatchObject({
      uso: "redigir",
      bloqueado: false,
      tokens_entrada: 1000,
      tokens_saida: 150,
    });
    expect(JSON.stringify(usos)).not.toContain("condomínio");
  });
  it("valor inventado: bloqueia e sai o texto fixo (plano B); conta o bloqueio", async () => {
    const { base, r, usos } = await rodar(
      "qual valor do Condominio ?",
      fetchModelo({ mensagem: "O condomínio é R$ 350. Quer visitar?", acao: "responder" }),
    );
    expect(r.redigida).toBe(false);
    expect(r.bloqueio).toBe("valor");
    expect(r.resposta).toBe(base.resposta);
    expect(usos[0]).toMatchObject({ bloqueado: true, bloqueio: "valor" });
  });
  it("modelo fora do ar ou JSON ruim: plano B", async () => {
    const a = await rodar("qual valor do Condominio ?", fetchModelo({}, 503));
    expect(a.r.resposta).toBe(a.base.resposta);
    expect(a.usos[0]).toMatchObject({ ok: false, erro: "http_503", bloqueado: false });
    const b = await rodar("qual valor do Condominio ?", fetchModelo("isso não é json"));
    expect(b.r.resposta).toBe(b.base.resposta);
    expect(b.usos[0]).toMatchObject({ bloqueado: true, bloqueio: "formato" });
  });
  it("sem chave de modelo no servidor: plano B, sem chamada", async () => {
    let chamou = false;
    const f = (async () => {
      chamou = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    const base = await proximaResposta(ctx(), "oi", undefined, { agora: AGORA });
    const r = await redigirResposta(ctx(), "oi", base, {
      escolha: { provedor: "gemini", modelo: null },
      env: {},
      historico: [],
      registrar: () => undefined,
      fetchFn: f,
    });
    expect(chamou).toBe(false);
    expect(r.resposta).toBe(base.resposta);
  });
  it("sensível, opt-out (banco), pedido de pessoa e permuta continuam fixos ANTES do modelo", async () => {
    let chamou = false;
    const f = (async () => {
      chamou = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    for (const t of [
      "quero falar com um corretor",
      "vou no procon",
      "aceita meu carro como parte?",
      "sou corretor, tenho um cliente",
    ]) {
      const base = await proximaResposta(ctx(), t, undefined, { agora: AGORA });
      const r = await redigirResposta(ctx(), t, base, {
        escolha: { provedor: "gemini", modelo: null },
        env: ENV,
        historico: [],
        registrar: () => undefined,
        fetchFn: f,
      });
      expect(r.resposta).toBe(base.resposta);
    }
    expect(chamou).toBe(false);
  });
  it('"você é robô?": resposta curta e honesta, sem modelo, e oferece o corretor', async () => {
    const { r, usos } = await rodar("você é robô?", fetchModelo({ mensagem: "Não, sou humana!" }));
    expect(r.resposta).toBe(textoRobo(ctx()));
    expect(r.resposta).not.toMatch(/não sou uma pessoa|\(/);
    expect(r.dados.ofereceu_corretor).toBe(true);
    expect(usos).toHaveLength(0);
  });
  it("oferta aprovada grava o parecido; passar usa a frase fixa de passagem com {corretor}", async () => {
    const m =
      "Tenho sim! Tem outra casa no mesmo condomínio, com 3 quartos e 167 m², por R$ 1.220.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3921 Gostou?";
    const a = await rodar(
      "tem mais opções?",
      fetchModelo({ mensagem: m, acao: "oferecer", codigo: "3921" }),
    );
    expect(a.r.dados.parecidos).toEqual(["3921"]);
    expect(a.r.dados.parecido_atual?.codigo).toBe("3921");
    const b = await rodar(
      "pode ser amanhã de manhã",
      fetchModelo({
        mensagem: "Combinado, amanhã de manhã!",
        acao: "passar",
        registro: { visita: "amanhã de manhã" },
      }),
    );
    expect(b.r.fim).toBe("visita");
    expect(b.r.resposta).toContain("{corretor}");
    expect(b.r.resposta_falha).not.toContain("{corretor}");
    expect(b.r.dados.visita).toBe("amanhã de manhã");
  });
  it("busca nova (apartamento para o filho) vai para o resumo do corretor", async () => {
    const r = await rodar(
      "eu queria ver um imovel para o meu filho tb vcs trabalha com apartamento ?",
      fetchModelo({
        mensagem: "Trabalhamos sim! Ele procura para comprar ou alugar?",
        acao: "responder",
        registro: { nova_busca: "apartamento para o filho" },
      }),
    );
    expect(r.r.resposta).toBe("Trabalhamos sim! Ele procura para comprar ou alugar?");
    expect(r.r.dados.outras_buscas).toEqual(["apartamento para o filho"]);
    expect(r.r.dados.parecidos).toBeUndefined();
  });
});
