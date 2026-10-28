// Junção caminho 2 + frases prontas novas (t_2aecef49).
// 1) Quando o validador bloqueia o modelo, a reserva (plano B) é a frase pronta NOVA do t_5b493bc9.
// 2) Dia/horário fora das opções ("sábado de manhã pode ser?"): aceita, anota e não repete as opções,
//    tanto no plano B quanto com o modelo ligado.
import { semConviteVisita } from "./leads-ia";
import { describe, expect, it } from "vitest";
import { proximaResposta, type ContextoIa, type FichaIa, type ImovelParecido, type ResultadoParecidos } from "./leads-ia";
import type { UsoModelo } from "./leads-ia-modelo";
import { redigirResposta } from "./leads-ia-redacao";

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
  vagas: "4",
  area_util_m2: "167",
  preco: "R$ 1.220.000",
  url: "https://vipsevenimoveis.com.br/imovel/3921",
  mesmo_bairro: true,
};
const AGORA = new Date("2026-10-27T13:00:00Z"); // terça, 10h em Brasília: opções = quarta de manhã / quinta à tarde
const buscar = async (): Promise<ResultadoParecidos> => ({ referencia: { codigo: "VIP0119", no_xml: true }, itens: [P3921] });
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
const ENV = { LEADS_IA_MODELO: "gemini", GEMINI_API_KEY: "teste" };
const fetchModelo = (saida: unknown): typeof fetch =>
  (async () =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(saida) }] } }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50 },
      }),
    )) as unknown as typeof fetch;

async function rodar(texto: string, saida: unknown, c = ctx()) {
  const usos: UsoModelo[] = [];
  let chamou = 0;
  const f = fetchModelo(saida);
  const fetchFn = (async (...a: Parameters<typeof fetch>) => {
    chamou++;
    return f(...a);
  }) as typeof fetch;
  const base = await proximaResposta(c, texto, undefined, { agora: AGORA, buscarParecidos: buscar });
  const r = await redigirResposta(c, texto, base, {
    escolha: { provedor: "gemini", modelo: null },
    env: ENV,
    historico: [],
    buscarParecidos: buscar,
    registrar: (u) => usos.push(u),
    fetchFn,
    agora: AGORA,
  });
  return { base, r, usos, chamou };
}

const ANTIGO = /(Proposta e negociação, quem conversa com você é o corretor|área útil|\(código|qual faixa de valor)/i;

describe("reserva do validador = frase pronta NOVA (casos bloqueados do resultado-final do t_7b59589c)", () => {
  // As 3 respostas do modelo que foram bloqueadas no teste real, com o mesmo motivo.
  const casos: Array<[string, unknown, string]> = [
    [
      "aceita financiamento?",
      { mensagem: "Sobre financiamento, vou confirmar. Quer saber a faixa? Quer visitar?", acao: "responder" },
      "perguntas",
    ],
    ["me conta mais desse imóvel?", { mensagem: "É uma casa disponível para visita.", acao: "responder" }, "disponibilidade"],
    ["e as condições?", { mensagem: "Está disponível e aceita financiamento.", acao: "responder" }, "disponibilidade"],
  ];
  for (const [fala, saida, motivo] of casos) {
    it(`"${fala}" bloqueado (${motivo}) -> sai a frase nova, sem os textos antigos`, async () => {
      const { base, r, usos } = await rodar(fala, saida);
      expect(r.redigida).toBe(false);
      expect(r.bloqueio).toBe(motivo);
      expect(usos[0]).toMatchObject({ bloqueado: true, bloqueio: motivo });
      // t_66ad4609: financiamento é sinal de interesse (o convite fica); nos outros casos o convite sai.
      expect(r.resposta).toBe(/financ/.test(fala) ? base.resposta : semConviteVisita(base.resposta));
      expect(r.resposta, r.resposta).not.toMatch(ANTIGO);
      expect(r.resposta).not.toMatch(/R\$ [\d.]+,00/);
    });
  }
});

describe('dia fora das opções ("sábado de manhã pode ser?")', () => {
  const dadosVisita = { convite_visita: true, visita_opcoes: ["amanhã (quarta, 28/10) de manhã", "quinta (29/10) à tarde"], interesse: true };
  it("plano B: aceita, anota, registra no resumo e não repete quarta/quinta", async () => {
    const c = ctx({ passo: "visita", dados: dadosVisita });
    const r = await proximaResposta(c, "sabado de manha pode ser?", undefined, { agora: AGORA, buscarParecidos: buscar });
    expect(r.resposta).toBe("Sábado de manhã anotado! Já pedi para {corretor} continuar seu atendimento por aqui para confirmar o horário certinho.");
    // t_82c89141 item 6a: a falha também avisa que um corretor continua o atendimento.
    expect(r.resposta_falha).toBe("Sábado de manhã anotado! Um corretor da nossa equipe vai continuar seu atendimento por aqui para confirmar o horário.");
    expect(r.resposta).not.toMatch(/quarta|quinta/i);
    expect(r.fim).toBe("visita");
    expect(r.resumo).toMatch(/PRÉ-AGENDAMENTO: sábado de manhã, dia pedido pelo cliente, fora das opções oferecidas \(confirmar/);
    expect(r.dados.visita).toBe("sábado de manhã");
  });
  it("plano B: também vale logo depois do convite (passo interesse) e com outro horário", async () => {
    const c = ctx({ dados: { convite_visita: true, interesse: true } });
    const a = await proximaResposta(c, "Sábado de manhã pode ser?", undefined, { agora: AGORA });
    expect(a.resposta).toBe("Sábado de manhã anotado! Já pedi para {corretor} continuar seu atendimento por aqui para confirmar o horário certinho.");
    const b = await proximaResposta(ctx({ passo: "visita", dados: dadosVisita }), "consigo sexta às 18h", undefined, { agora: AGORA });
    expect(b.resposta).toBe("Sexta às 18h anotado! Já pedi para {corretor} continuar seu atendimento por aqui para confirmar o horário certinho.");
    expect(b.resumo).toMatch(/PRÉ-AGENDAMENTO: sexta às 18h/);
  });
  it("plano B: escolher uma das opções continua igual (não vira pedido fora)", async () => {
    const r = await proximaResposta(ctx({ passo: "visita", dados: dadosVisita }), "quinta à tarde", undefined, { agora: AGORA });
    expect(r.resposta).toMatch(/^Combinado, quinta \(29\/10\) à tarde!/);
    expect(r.dados.visita_livre).toBeUndefined();
  });
  it("modelo ligado: não chama o modelo e sai a mesma frase (ele não repete as opções)", async () => {
    const c = ctx({ passo: "visita", dados: dadosVisita });
    const { r, chamou } = await rodar("sabado de manha pode ser?", {
      mensagem: "Consigo agendar amanhã, quarta, 28/10, de manhã ou quinta, 29/10, à tarde. Algum desses horários fica bom para você?",
      acao: "responder",
    }, c);
    expect(chamou).toBe(0);
    expect(r.resposta).toBe("Sábado de manhã anotado! Já pedi para {corretor} continuar seu atendimento por aqui para confirmar o horário certinho.");
    expect(r.resumo).toMatch(/sábado de manhã/);
  });
  it("modelo ligado: depois de o modelo convidar para a visita, o pedido de sábado no turno seguinte também é anotado", async () => {
    const { r } = await rodar("e FGTS da pra usar?", {
      // t_82c89141 item 3: "vou confirmar e já te falo" agora é barrado pela trava "retorno".
      mensagem: "O corretor confirma o uso do FGTS com você na visita ou no contato. Enquanto isso, quer marcar uma visita para conhecer a casa?",
      acao: "responder",
    });
    expect(r.redigida).toBe(true);
    expect(r.dados.convite_visita).toBe(true);
    const c2 = ctx({ passo: r.passo, dados: r.dados, versao: 4 });
    const s = await rodar("sabado de manha pode ser?", { mensagem: "Tenho quarta ou quinta. Qual prefere?", acao: "responder" }, c2);
    expect(s.chamou).toBe(0);
    expect(s.r.resposta).toBe("Sábado de manhã anotado! Já pedi para {corretor} continuar seu atendimento por aqui para confirmar o horário certinho.");
  });
  it("vale mesmo com um parecido recém-oferecido (\"pode ser\" não vira \"gostei do parecido\")", async () => {
    const c = ctx({ dados: { ...dadosVisita, parecidos: ["2501"], parecido_atual: { ...P3921, codigo: "2501" } } });
    const { r, chamou } = await rodar("sabado de manha pode ser?", { mensagem: "Pode ser!", acao: "responder" }, c);
    expect(chamou).toBe(0);
    expect(r.resposta).toBe("Sábado de manhã anotado! Já pedi para {corretor} continuar seu atendimento por aqui para confirmar o horário certinho.");
    expect(r.fim).toBe("visita");
  });
  it("sem contexto de visita e sem pedido de marcar, dia solto não vira agendamento", async () => {
    const r = await proximaResposta(ctx(), "trabalho de segunda a sexta", undefined, { agora: AGORA });
    expect(r.fim).not.toBe("visita");
  });
});

describe("t_82c89141 item 4 — dia sem período: pergunta manhã ou tarde antes de passar", () => {
  const dadosVisita = { convite_visita: true, visita_opcoes: ["amanhã (quarta, 28/10) de manhã", "quinta (29/10) à tarde"], interesse: true };
  it("roteiro: \"sábado pode ser?\" -> pergunta o período; a resposta passa avisando que o corretor continua", async () => {
    const a = await proximaResposta(ctx({ passo: "visita", dados: dadosVisita }), "sabado pode ser?", undefined, { agora: AGORA });
    expect(a.resposta).toBe("Anotado, sábado! Fica melhor de manhã ou à tarde?");
    expect(a.fim).toBeNull();
    expect(a.dados.visita_dia_pendente).toBe("sábado");
    const b = await proximaResposta(ctx({ passo: a.passo, dados: a.dados }), "de manhã", undefined, { agora: AGORA });
    expect(b.fim).toBe("visita");
    expect(b.dados.visita).toMatch(/^sábado de manhã/);
    expect(b.resposta).toMatch(/continuar seu atendimento por aqui/);
    expect(b.resposta_falha).toMatch(/Um corretor da nossa equipe vai continuar seu atendimento/);
  });
  it("modelo tenta passar com dia sem período: a Nicole pergunta manhã ou tarde em vez de passar", async () => {
    const c = ctx({ passo: "visita", dados: { convite_visita: true, interesse: true } });
    const { r } = await rodar("pode ser na sexta", { mensagem: "Combinado!", acao: "passar", registro: { visita: "sexta" } }, c);
    expect(r.fim).toBeNull();
    expect(r.resposta).toBe("Anotado, sexta! Fica melhor de manhã ou à tarde?");
  });
});
