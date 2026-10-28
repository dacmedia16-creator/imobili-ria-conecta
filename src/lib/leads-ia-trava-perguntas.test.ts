// t_91c8cf89 — trava da Nicole com menos falso positivo: "2 perguntas" e "corretor".
// Casos ruins continuam barrados; casos legítimos (confirmação + pergunta, alternativa com "ou", pergunta retórica,
// "o corretor confirma/continua") passam. Idioma, promessa, preço (valor) e IPTU seguem iguais.
import { describe, expect, it } from "vitest";
import type { FichaIa, ImovelParecido } from "./leads-ia";
import { contarPerguntas, permitidosDe, validarRedacao, visitaSemParenteses, type SaidaModelo } from "./leads-ia-redacao";

const FICHA: FichaIa = {
  tipo: "casa",
  bairro: "Jardim Piratininga",
  cidade: "Sorocaba",
  quartos: "3",
  suites: "1",
  negocio: "venda",
  preco: "R$ 650.000",
  preco_valor: 650000,
  condominio: "R$ 550",
  iptu: "R$ 55",
};
const APTO: ImovelParecido = {
  codigo: "VIP0015",
  tipo: "apartamento",
  bairro: "Centro",
  cidade: "Sorocaba",
  quartos: "4",
  suites: "3",
  preco: "R$ 975.000",
  url: "https://vipsevenimoveis.com.br/imovel/VIP0015",
};
const VISITA = visitaSemParenteses(new Date("2026-10-27T13:00:00Z"));
const perm = permitidosDe(FICHA, [APTO], VISITA, ["queria com 3 suítes"]);
const s = (mensagem: string, extra: Partial<SaidaModelo> = {}): SaidaModelo => ({
  mensagem,
  acao: "responder",
  codigo: null,
  registro: {},
  ...extra,
});
const v = (m: string, extra: Partial<SaidaModelo> = {}, cliente = "x") => validarRedacao(s(m, extra), perm, cliente);

describe("regra de 1 pergunta: contarPerguntas", () => {
  it.each([
    ["Gostou? Quer visitar?", 2],
    ["Te serve? Quer agendar uma visita?", 2],
    ["Serve? Quer ver mais alguma coisa?", 2],
    ["Para seu filho, é compra ou aluguel? E em que região está procurando?", 2],
    ["Quer? Pode?", 2],
    ["O condomínio é R$ 550. Quer agendar uma visita?", 1],
    ["Anotado, sábado de manhã, certo? Quer que eu já deixe reservado?", 1],
    ["Tudo bem? Quer ver essa casa?", 1],
    ["Te serve? Ou prefere ver algo com um pouco menos?", 1],
    ["Podemos agendar. Que tal amanhã de manhã ou quinta à tarde? Qual prefere?", 1],
    ["Que tal essa casa com 3 suítes? Dá uma olhada: https://vipsevenimoveis.com.br/imovel/VIP0015?x=1 Gostou?", 1],
    ["Gostou?? ", 1],
    ["Sem pergunta nenhuma.", 0],
  ])("%s -> %i", (m, n) => expect(contarPerguntas(m)).toBe(n));
});

describe("trava perguntas: barra 2 perguntas de verdade, deixa as legítimas", () => {
  it.each([
    "Gostou? Quer visitar?",
    "Essa casa tem 3 quartos, por R$ 650.000. Te serve? Quer agendar uma visita?",
    "Claro! Para seu filho, seria compra ou aluguel? E que região ele prefere?",
  ])("barra: %s", (m) => expect(v(m)).toBe("perguntas"));
  it.each([
    "Entendo, você quer 3 suítes. Nessa faixa não temos, mas o apartamento no Centro com 3 suítes é o mais em conta, por R$ 975.000. Te serve? Ou prefere ver algo com um pouco menos?",
    "Claro! Qual dia e período ficam melhores para você? O corretor confirma o horário.",
    "Anotado, quarta de manhã, certo? Quer que eu anote mais alguma coisa?",
  ])("deixa: %s", (m) => expect(v(m)).toBeNull());
});

describe("trava corretor: usos do roteiro passam, promessas continuam barradas", () => {
  it.each([
    ["O corretor confirma o financiamento com você na visita ou no contato. Quer marcar uma visita?", {}],
    ["Anotado! O corretor combina o horário certinho com você.", {}],
    ["Anotado, quarta de manhã! O corretor confirma os detalhes com você.", { acao: "passar" as const }],
    ["Perfeito! O corretor continua seu atendimento por aqui.", { acao: "passar" as const }],
    ["Combinado! Um corretor da nossa equipe vai continuar seu atendimento.", { acao: "passar" as const }],
  ])("deixa: %s", (m, extra) => expect(v(m, extra)).toBeNull());
  it.each([
    ["Quer que eu peça ao corretor?", {}],
    ["O corretor te liga ainda hoje.", {}],
    ["O corretor te liga.", {}],
    ["O corretor te manda as fotos.", {}],
    ["O corretor confirma em até 10 minutos.", {}],
    ["O corretor vai conseguir um desconto para você.", {}],
    ["O corretor confirma ainda hoje com você.", {}],
    ["Fala com a corretora Ana.", {}],
    // "continua o atendimento" só quando passa mesmo (senão a cliente fica esperando alguém que não foi chamado).
    ["O corretor continua seu atendimento por aqui. Quer ver mais alguma?", {}],
  ])("barra: %s", (m, extra) => expect(v(m, extra)).toBe("corretor"));
  it("o resto da frase segue nas outras travas (condição, desconto, promessa)", () => {
    expect(v("O corretor continua seu atendimento e aceita financiamento sim.", { acao: "passar" })).toBe("condicao");
    expect(v("O corretor continua seu atendimento e faz um desconto.", { acao: "passar" })).toBe("desconto");
    expect(v("O corretor continua seu atendimento, garanto que vai amar.", { acao: "passar" })).toBe("promessa");
  });
});

describe("travas firmes e de preço/IPTU continuam iguais", () => {
  it("idioma, retorno, valor e IPTU", () => {
    expect(v("La casa tiene 3 habitaciones. ¿Te gusta?")).toBe("idioma");
    expect(v("O precio é R$ 650.000. Quer visitar?")).toBe("idioma");
    expect(v("Vou separar mais opções e te mando por aqui. Quer visitar?")).toBe("retorno");
    expect(v("O condomínio é R$ 350. Quer visitar?")).toBe("valor");
    expect(v("O IPTU é R$ 55 por ano. Quer visitar?")).toBe("iptu");
    expect(v("Garanto que você vai amar. Quer visitar?")).toBe("promessa");
  });
});
