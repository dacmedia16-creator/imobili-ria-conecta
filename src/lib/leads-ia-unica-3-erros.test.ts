// t_f32decca (Denis, 23/11/2026, tópico 6238): 3 erros da Nicole no Piloto C2S, antes de ligar na Única.
// Roda o caminho real do servidor (responderEEnviar) com o banco, a busca no XML e o modelo SIMULADOS.
// Nenhum lead real, rede ou dado pessoal: textos reescritos a partir das conversas (sem nome nem telefone).
import { describe, expect, it, vi } from "vitest";
import {
  responderEEnviar,
  type DepsRetorno,
  type MensagemZion,
  type RespostaBanco,
} from "./leads-ia-retorno.server";
import type {
  ContextoIa,
  DadosQualificacao,
  FichaIa,
  ImovelParecido,
  ResultadoParecidos,
} from "./leads-ia";

const FICHA: FichaIa = {
  tipo: "casa",
  bairro: "Jardim Guaiba",
  cidade: "Sorocaba",
  quartos: "2",
  negocio: "venda",
  preco_valor: 235000,
  preco: "R$ 235.000",
  link: "https://example.org/40",
};
const ctx = (dados: DadosQualificacao): ContextoIa =>
  ({
    conversa_id: "cv",
    estado: "ativa",
    versao: 3,
    passo: "interesse",
    dados,
    ia_nome: "Nicole",
    lead_nome: "",
    org_nome: "RE/MAX Única Escolha",
    transacao: "venda",
    anuncio_codigo: "x",
    imovel_frase: null,
    ficha: FICHA,
    imovel_fonte: "xml",
  }) as ContextoIa;
const casa = (
  codigo: string,
  quartos: string,
  extra: Partial<ImovelParecido> = {},
): ImovelParecido => ({
  codigo,
  tipo: "casa",
  cidade: "Sorocaba",
  bairro: "Lopes de Oliveira",
  quartos,
  url: `https://example.org/${codigo}`,
  ...extra,
});
const msg = (texto: string): MensagemZion =>
  ({
    id: "m1",
    telefone: "5515900000000",
    texto,
    tipo: "texto",
    grupo: false,
    status: false,
    proprio: false,
  }) as MensagemZion;

const ENV = { LEADS_IA_MODELO: "gemini", GEMINI_API_KEY: "teste" };
const gemini = (mensagem: string, corpos: string[] = []): typeof fetch =>
  (async (_u: unknown, init?: { body?: string }) => {
    corpos.push(String(init?.body ?? ""));
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({ mensagem, acao: "responder", codigo: null, registro: {} }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

async function rodar(
  dados: DadosQualificacao,
  texto: string,
  o: {
    parecidos?: ImovelParecido[];
    modelo?: string;
    corpos?: string[];
    historico?: Array<{ autor: "ia" | "cliente"; texto: string }>;
  } = {},
) {
  const aplicar = vi.fn(async (_a: Record<string, unknown>) => ({
    data: { ok: true },
    error: null,
  }));
  const buscar = vi.fn(async (): Promise<ResultadoParecidos> => ({
    referencia: {},
    itens: o.parecidos ?? [],
  }));
  const deps: DepsRetorno = {
    receber: vi.fn(),
    aplicar,
    reservar: vi.fn(async () => ({ data: [], error: null })),
    resultado: vi.fn(async () => undefined),
    registrarUso: vi.fn(async () => undefined),
    env: o.modelo ? ENV : {},
    fetchFn: o.modelo ? gemini(o.modelo, o.corpos) : undefined,
    esperar: async () => undefined,
    rand: () => 0,
    modoEquipe: async () => true, // Piloto C2S e Única: lead_config.ia_modo_equipe = true
    redacaoLigada: async () => !!o.modelo,
    modoValidador: async () => "bloquear",
    historico: async () => o.historico ?? [],
    buscarParecidos: buscar,
  };
  const banco: RespostaBanco = {
    r: "ok",
    responder: true,
    lead_id: "l1",
    organization_id: "piloto",
    tipo: "texto",
    ctx: ctx(dados),
  } as RespostaBanco;
  await responderEEnviar(banco, msg(texto), deps);
  const a = aplicar.mock.calls[0][0] as { _resposta: string };
  return { resposta: a._resposta, buscar };
}

describe("t_f32decca erro 1: não promete corretor/visita sem o cliente pedir", () => {
  it("reclamação de visita antiga (conversa do lead Grégor): sem 'o corretor confirma o horário' nem convite", async () => {
    const { resposta } = await rodar(
      { interesse: true, finalidade: "comprar" },
      "Assim mais marquei visita e ninguém me marcou p irmos",
      {
        modelo:
          "Que situação chata, sinto muito por isso! Sobre a visita, o corretor confirma o horário com você. Qual dia e período ficam melhores para vocês?",
      },
    );
    expect(resposta).not.toMatch(/corretor|confirma o hor|qual dia|per[ií]odo/i);
  });
  it("cliente só pediu opções: o modelo convida e promete corretor -> sai sem convite e sem promessa", async () => {
    const { resposta } = await rodar(
      { interesse: true, finalidade: "comprar" },
      "Pode mandar outras casas",
      {
        parecidos: [casa("dois", "2", { preco: "R$ 198.000" })],
        modelo:
          "Tenho sim! Tem outra casa no bairro Lopes de Oliveira, com 2 quartos, por R$ 198.000. Dá uma olhada: https://example.org/dois Quer agendar uma visita? O corretor confirma o horário com você.",
      },
    );
    expect(resposta).not.toMatch(/corretor|confirma o hor|agendar|marcar/i);
  });
});

describe("t_f32decca erro 2: compra de 2 quartos não recebe 3 quartos nem valor de aluguel", () => {
  const dados: DadosQualificacao = {
    interesse: true,
    finalidade: "comprar",
    filtro_pedido: { quartos: 2 },
  };
  const opcoes = [
    casa("tres", "3", { preco: "R$ 350.000" }),
    casa("mista", "2", { preco: "R$ 300.000", aluguel: "R$ 9.500" }),
  ];
  it("roteiro: 'tem outras opções?' mostra só 2 quartos e o preço de venda", async () => {
    const { resposta } = await rodar(dados, "tem outras opções?", { parecidos: opcoes });
    expect(resposta).toMatch(/2 quartos/);
    expect(resposta).toMatch(/R\$ 300\.000/);
    expect(resposta).not.toMatch(/3 quartos|aluguel|9\.500/);
  });
  it("modelo: os candidatos enviados não têm o 3 quartos nem o aluguel", async () => {
    const corpos: string[] = [];
    await rodar(dados, "tem outras opções?", { parecidos: opcoes, modelo: "Tenho sim!", corpos });
    expect(corpos.length).toBeGreaterThan(0);
    const usuario = corpos.join("\n");
    expect(usuario).not.toContain("example.org/tres");
    expect(usuario).not.toMatch(/9\.500/);
  });
});

describe("t_f32decca erro 3: 'Que bom que gostou!' só se o cliente disse que gostou", () => {
  const mostrado = casa("213", "2", { bairro: "Jardim Nova Aparecidinha", preco: "R$ 249.000" });
  it("'Pode ser' depois de uma opção mostrada não vira elogio", async () => {
    const { resposta } = await rodar(
      { interesse: true, finalidade: "comprar", parecido_atual: mostrado, parecidos: ["213"] },
      "Pode ser",
    );
    expect(resposta).not.toMatch(/gostou/i);
  });
  it("'gostei' continua com 'Que bom que gostou!'", async () => {
    const { resposta } = await rodar(
      { interesse: true, finalidade: "comprar", parecido_atual: mostrado, parecidos: ["213"] },
      "gostei dessa",
    );
    expect(resposta).toMatch(/Que bom que gostou/);
  });
});
