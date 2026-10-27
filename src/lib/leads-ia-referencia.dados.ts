// CONJUNTO DE REFERÊNCIA da Nicole (card t_a9f1b447, pedido de Denis 27/10/2026, tópico 6238).
//
// Conversas REAIS de Denis em teste ao vivo na ZZ (texto do cliente igual ao que ele digitou), com os imóveis
// reais do XML da ZZ (lidos em 27/10, só leitura). Cada fala traz a resposta que uma pessoa da equipe daria
// ("esperado") e a resposta que saiu no teste ao vivo ("antes"). Usado:
//   - no vitest (leads-ia-referencia.test.ts), com o roteiro fixo (plano B), sem modelo;
//   - no teste com o modelo real (scripts/leads-ia-test/referencia-modelo.ts, teto US$ 1);
//   - na comparação de modelos (t_48ddeac0): usar ESTE arquivo.
// REGRA: toda falha nova vista em teste real entra aqui (fala do cliente + resposta esperada + o que saiu).
import type {
  ContextoIa,
  FichaIa,
  FiltroBusca,
  FiltroCaracteristicaBusca,
  FiltroParecido,
  ImovelParecido,
  ResultadoCaracteristica,
  ResultadoParecidos,
} from "./leads-ia";

export type FalaReferencia = {
  cliente: string;
  /** Como uma pessoa da equipe responderia. */
  esperado: string;
  /** O que saiu no teste ao vivo (null = ficou sem resposta). */
  antes: string | null;
  /** O que saiu errado ao vivo (resumo). */
  falha?: string;
};
export type ConversaReferencia = {
  id: string;
  lead: string;
  ficha: FichaIa;
  anuncio: string;
  primeira: string;
  falas: FalaReferencia[];
};

const casa = (x: Partial<ImovelParecido> & { codigo: string }): ImovelParecido => ({
  cidade: "Sorocaba",
  url: `https://vipsevenimoveis.com.br/imovel/${x.codigo}`,
  ...x,
});

/** Estoque real da ZZ usado nas conversas (venda). */
export const ESTOQUE_ZZ: Array<ImovelParecido & { preco_valor: number }> = [
  { ...casa({ codigo: "3879", tipo: "casa", bairro: "Horto Florestal", quartos: "3", suites: "1", vagas: "2", area_util_m2: "93", preco: "R$ 645.000" }), preco_valor: 645000 },
  { ...casa({ codigo: "3881", tipo: "casa", bairro: "Jardim Piratininga", quartos: "3", vagas: "2", area_util_m2: "114", preco: "R$ 655.000" }), preco_valor: 655000 },
  { ...casa({ codigo: "3882", tipo: "casa", bairro: "Jardim Novo Horizonte", quartos: "3", suites: "1", vagas: "2", area_util_m2: "123", preco: "R$ 665.000" }), preco_valor: 665000 },
  { ...casa({ codigo: "VIP0015", tipo: "apartamento", bairro: "Centro", quartos: "4", suites: "3", vagas: "2", area_util_m2: "135", preco: "R$ 975.000" }), preco_valor: 975000 },
  { ...casa({ codigo: "VIP0047", tipo: "apartamento", bairro: "Vila Independência", quartos: "4", suites: "4", vagas: "2", area_util_m2: "157", preco: "R$ 1.037.000" }), preco_valor: 1037000 },
  { ...casa({ codigo: "VIP0110", tipo: "casa", bairro: "Ibiti Royal Park", quartos: "3", suites: "3", vagas: "4", area_util_m2: "184", preco: "R$ 1.050.000" }), preco_valor: 1050000 },
  { ...casa({ codigo: "VIP0050", tipo: "casa", bairro: "Cajuru do Sul", quartos: "3", suites: "3", vagas: "2", area_util_m2: "221", preco: "R$ 1.090.000" }), preco_valor: 1090000 },
  { ...casa({ codigo: "2501", tipo: "casa", bairro: "Condominio Ibiti Reserva", quartos: "3", suites: "3", vagas: "4", area_util_m2: "169", preco: "R$ 1.150.000" }), preco_valor: 1150000 },
  { ...casa({ codigo: "3920", tipo: "casa", bairro: "Condominio Ibiti Reserva", quartos: "3", suites: "2", vagas: "4", area_util_m2: "160", preco: "R$ 1.175.000" }), preco_valor: 1175000 },
  { ...casa({ codigo: "VIP0119", tipo: "casa", bairro: "Condominio Ibiti Reserva", quartos: "3", suites: "1", vagas: "4", area_util_m2: "150", preco: "R$ 1.199.000" }), preco_valor: 1199000 },
  { ...casa({ codigo: "3921", tipo: "casa", bairro: "Condominio Ibiti Reserva", quartos: "3", suites: "1", vagas: "4", area_util_m2: "167", preco: "R$ 1.220.000" }), preco_valor: 1220000 },
  { ...casa({ codigo: "3965", tipo: "apartamento", bairro: "Parque Campolim", quartos: "3", suites: "1", vagas: "2", area_util_m2: "85", preco: "R$ 598.000" }), preco_valor: 598000 },
  { ...casa({ codigo: "3817", tipo: "apartamento", bairro: "Parque Campolim", quartos: "2", suites: "1", vagas: "2", area_util_m2: "67", preco: "R$ 615.000" }), preco_valor: 615000 },
  { ...casa({ codigo: "3809", tipo: "apartamento", bairro: "Parque Campolim", quartos: "2", suites: "1", vagas: "1", area_util_m2: "57", preco: "R$ 650.000" }), preco_valor: 650000 },
  { ...casa({ codigo: "3800", tipo: "apartamento", bairro: "Parque Campolim", quartos: "3", suites: "1", vagas: "1", area_util_m2: "73", preco: "R$ 715.000" }), preco_valor: 715000 },
  { ...casa({ codigo: "2452", tipo: "casa", bairro: "Alphaville Nova Esplanada", cidade: "Votorantim", quartos: "4", suites: "4", vagas: "4", area_util_m2: "297", preco: "R$ 1.870.000" }), preco_valor: 1870000 },
  { ...casa({ codigo: "2100", tipo: "casa", bairro: "Alphaville Nova Esplanada", cidade: "Votorantim", quartos: "3", suites: "3", vagas: "4", area_util_m2: "225", preco: "R$ 1.879.000" }), preco_valor: 1879000 },
];

const ficha = (x: FichaIa): FichaIa => ({ cidade: "Sorocaba", negocio: "venda", ...x });

export const REFERENCIA: ConversaReferencia[] = [
  {
    id: "B",
    lead: "59538211",
    anuncio: "3881",
    ficha: ficha({
      tipo: "casa", bairro: "Jardim Piratininga", quartos: "3", banheiros: "2", vagas: "2", area_util_m2: "114",
      area_terreno_m2: "130", preco: "R$ 655.000", preco_valor: 655000, condominio: "R$ 550,00", iptu: "R$ 55,00 por mês",
      link: "https://vipsevenimoveis.com.br/imovel/3881",
    }),
    primeira:
      "Oi, Denis! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse na casa de 3 quartos no bairro Jardim Piratininga, em Sorocaba, anunciada por R$ 655.000. Anúncio: https://vipsevenimoveis.com.br/imovel/3881 Quer saber mais detalhes ou já prefere agendar uma visita?",
    falas: [
      {
        cliente: "Qual valor de IPTU e condomínio ?",
        esperado: "O condomínio é R$ 550 e o IPTU R$ 55 por mês. Quer agendar uma visita para conhecer?",
        antes: "O condomínio é R$ 550 e o IPTU fica em R$ 55 por mês. Quer agendar uma visita para conhecer? Tenho amanhã, quarta, 28/10, de manhã, ou quinta, 29/10, à tarde.",
        falha: "datas antes de o cliente querer visitar (item 7)",
      },
      {
        cliente: "Tem mais opções ?",
        esperado: "Tenho sim! Tem uma casa no Horto Florestal com 3 quartos e 93 m², por R$ 645.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3879 Gostou?",
        antes: "Tenho sim! Tem uma casa no Horto Florestal com 3 quartos, 1 suíte e 93 m², por R$ 645.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3879 O que achou dessa?",
      },
      {
        cliente: "Tem alguma opção de 3 suítes ?",
        esperado: "Com 3 suítes, nessa faixa não tenho. A mais em conta é um apartamento no Centro com 3 suítes, por R$ 975.000: https://vipsevenimoveis.com.br/imovel/VIP0015 Quer dar uma olhada, ou prefere que eu procure com 2 suítes?",
        antes: "Essa casa tem 3 quartos, sendo 1 suíte. Quer agendar uma visita para conhecer pessoalmente?",
        falha: "trava contagem barrou o '3 suítes' do cliente; frase pronta não respondeu",
      },
      {
        cliente: "Queria com 3 suítes",
        esperado: "Entendi! Com 3 suítes, a casa mais em conta é no Ibiti Royal Park, por R$ 1.050.000: https://vipsevenimoveis.com.br/imovel/VIP0110 Gostou, ou prefere que eu procure com 2 suítes?",
        antes: "Quer saber mais algum detalhe?",
        falha: "trava contagem; reserva genérica que não reconhece o pedido",
      },
      {
        cliente: "Não tem outra casa ?",
        esperado: "Com 3 suítes, outra casa é no Cajuru do Sul, por R$ 1.090.000: https://vipsevenimoveis.com.br/imovel/VIP0050 Gostou?",
        antes: "Tenho outra casa no Jardim Novo Horizonte, com 3 quartos, 1 suíte e 123 m², por R$ 665.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3882 Gostou dessa?",
        falha: "ofereceu de novo um imóvel com 1 suíte (não atende o pedido)",
      },
      {
        cliente: "Teria com 3 suítes ?",
        esperado: "Com 3 suítes tenho também uma casa no Condominio Ibiti Reserva por R$ 1.150.000: https://vipsevenimoveis.com.br/imovel/2501 Nessa faixa de R$ 650 mil não tenho. Quer ver alguma delas ou procuro com 2 suítes?",
        antes: null,
        falha: "SEM RESPOSTA por 4 minutos (limite de 2 respostas/min na conversa)",
      },
      {
        cliente: "?",
        esperado: "Oi, estou aqui! Com 3 suítes, nessa faixa não achei. Quer que eu procure com 2 suítes ou prefere ver as que te mandei?",
        antes: "Vou confirmar isso e já te falo. Quer saber mais algum detalhe?",
        falha: "trava contagem; reserva genérica",
      },
      {
        cliente: "Não",
        esperado: "Tranquilo! Quer que eu procure outras com 3 suítes ou prefere marcar uma visita?",
        antes: "Combinado! Já pedi para o nosso time de corretores te chamar aqui para continuar seu atendimento.",
        falha: "passou ao corretor sem motivo",
      },
    ],
  },
  {
    id: "C",
    lead: "ac62b62c",
    anuncio: "3809",
    ficha: ficha({
      tipo: "apartamento", bairro: "Parque Campolim", quartos: "2", suites: "1", banheiros: "2", vagas: "1", area_util_m2: "57",
      preco: "R$ 650.000", preco_valor: 650000, condominio: "R$ 380,00", iptu: "R$ 56,00 por mês",
      link: "https://vipsevenimoveis.com.br/imovel/3809",
    }),
    primeira:
      "Oi, Denis! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse no apartamento de 2 quartos no bairro Parque Campolim, em Sorocaba, anunciado por R$ 650.000. Anúncio: https://vipsevenimoveis.com.br/imovel/3809 Quer saber mais detalhes ou já prefere agendar uma visita?",
    falas: [
      {
        cliente: "Qual valor do condomínio e IPTU ?",
        esperado: "O condomínio é R$ 380 e o IPTU R$ 56 por mês. Quer marcar uma visita para conhecer o apartamento?",
        antes: "O condomínio é R$ 380 e o IPTU R$ 56 por mês. Quer marcar uma visita para conhecer o apartamento?",
      },
      {
        cliente: "Vc teria mais opções ?",
        esperado: "Tenho sim! Tem outro apartamento no Parque Campolim, com 2 quartos e 67 m², por R$ 615.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3817 Gostou?",
        antes: "Tenho sim! Tem outro apartamento no Parque Campolim, com 2 quartos e 67 m², por R$ 615.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3817 Gostou desse?",
      },
      {
        cliente: "tem alguma opção com 3 domortorios ?",
        esperado: "Tenho sim! Com 3 quartos tem um apartamento no Parque Campolim, com 85 m², por R$ 598.000: https://vipsevenimoveis.com.br/imovel/3965 Gostou?",
        antes: "Tenho sim! Tem outro apartamento no Parque Campolim, com 3 quartos e 85 m², por R$ 598.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3965 Gostou?",
      },
      {
        cliente: "tem mais opções ?",
        esperado: "Tenho também um apartamento no Parque Campolim com 3 quartos e 73 m², por R$ 715.000: https://vipsevenimoveis.com.br/imovel/3800 Gostou?",
        antes: "Tenho sim! Tem outro apartamento no Parque Campolim, com 3 quartos e 73 m², por R$ 715.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3800 O que achou desse?",
      },
      {
        cliente: "legal",
        esperado: "Que bom que gostou! Quer agendar uma visita para conhecer esse apartamento?",
        antes: "Que ótimo que gostou! Quer aproveitar para conhecer pessoalmente? Tenho horários amanhã, quarta, 28/10, de manhã, ou quinta, 29/10, à tarde. Qual fica melhor para você?",
        falha: "datas logo de cara (item 7) e 2 perguntas (trava 'perguntas', modo observar)",
      },
      {
        cliente: "uma outra coisa meu filho esta procurando uma cada no alphavillhe vcs tem?",
        esperado: "Trabalhamos sim! Para o seu filho, seria para comprar ou para alugar?",
        antes: null,
        falha: "SEM RESPOSTA (limite de 2 respostas/min na conversa); só respondeu quando ele repetiu, 5 min depois",
      },
    ],
  },
  {
    id: "A",
    lead: "4c2e125f",
    anuncio: "VIP0119",
    ficha: ficha({
      tipo: "casa", bairro: "Condominio Ibiti Reserva", quartos: "3", suites: "1", banheiros: "3", vagas: "4", area_util_m2: "150",
      area_terreno_m2: "250", preco: "R$ 1.199.000", preco_valor: 1199000, condominio: "R$ 420,00", iptu: "R$ 100,00 por mês",
      link: "https://vipsevenimoveis.com.br/imovel/VIP0119",
    }),
    primeira:
      "Oi, Denis! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse na casa de 3 quartos no bairro Condominio Ibiti Reserva, em Sorocaba, anunciada por R$ 1.199.000. Anúncio: https://vipsevenimoveis.com.br/imovel/VIP0119 Quer saber mais detalhes ou já prefere agendar uma visita?",
    falas: [
      {
        cliente: "qual valor do Condominio ?",
        esperado: "O condomínio é R$ 420 por mês. Quer agendar uma visita para conhecer a casa?",
        antes: "É uma casa com 3 quartos (1 suíte), 4 vagas e 150 m² de área útil... Proposta e negociação, quem conversa com você é o corretor...",
        falha: "repetiu a ficha inteira, sem responder direto",
      },
      {
        cliente: "tem mais opçõe s?",
        esperado: "Tenho sim! Tem outra casa no mesmo condomínio, com 3 quartos e 167 m², por R$ 1.220.000: https://vipsevenimoveis.com.br/imovel/3921 Gostou?",
        antes: "Para eu já separar o que combina com você: qual faixa de valor você tem em mente?",
        falha: "pediu a faixa em vez de mostrar opção",
      },
      {
        cliente: "nesta mesma faixa",
        esperado: "Tenho outra no mesmo condomínio, com 3 quartos e 160 m², por R$ 1.175.000: https://vipsevenimoveis.com.br/imovel/3920 Gostou?",
        antes: "E a forma de pagamento seria à vista ou com financiamento?",
        falha: "pergunta de pagamento no meio do pedido",
      },
      {
        cliente: "me manda mais opção primeiro",
        esperado: "Claro! Mais uma no mesmo condomínio, com 3 suítes e 169 m², por R$ 1.150.000: https://vipsevenimoveis.com.br/imovel/2501 Gostou?",
        antes: "Tenho uma opção parecida (código 3921)... Quer que eu peça ao corretor os...",
      },
      {
        cliente: "tem mais opções ?",
        esperado: "Nessa faixa, por enquanto essas são as que tenho. De qual você mais gostou?",
        antes: "Tenho uma opção parecida (código 3920)...",
      },
      {
        cliente: "eu queria ver um imovel para o meu filho tb vcs trabalha com apartamento ?",
        esperado: "Trabalhamos sim! Para o seu filho, seria para comprar ou para alugar?",
        antes: "Obrigada! Posso pré-agendar uma visita para você conhecer a casa...",
        falha: "ignorou a pergunta",
      },
      {
        cliente: "quero visitar a casa",
        esperado: "Ótimo! Tenho amanhã de manhã ou quinta à tarde. Qual fica melhor para você?",
        antes: null, // fala do teste offline do t_48ddeac0 (ao vivo, a conversa A já tinha sido passada)
      },
      {
        cliente: "sabado de manha pode ser?",
        esperado: "Sábado de manhã anotado! Te confirmo o horário certinho.",
        antes: null, // idem
      },
    ],
  },
];

// --- Buscas simuladas sobre o ESTOQUE_ZZ (mesmas regras das funções do banco, em memória) ---------------

const sem = (x: ImovelParecido & { preco_valor?: number }): ImovelParecido => {
  const { preco_valor: _p, ...r } = x;
  return r;
};
const num = (s?: string) => (s && /^\d+$/.test(s) ? Number(s) : 0);

/** lead_ia_imoveis_parecidos: mesmo tipo e cidade do anúncio, ±15% do preço, mais perto do preço primeiro. */
export function buscasReferencia(c: ConversaReferencia) {
  const ref = ESTOQUE_ZZ.find((x) => x.codigo === c.anuncio);
  const pref = c.ficha.preco_valor ?? ref?.preco_valor ?? 0;
  const fora = (cod: string, ex: string[]) => cod === c.anuncio || ex.includes(cod);
  return {
    buscarParecidos: async (f: FiltroParecido): Promise<ResultadoParecidos> => ({
      referencia: { codigo: c.anuncio, no_xml: true, tipo: c.ficha.tipo, bairro: c.ficha.bairro, cidade: c.ficha.cidade, preco: pref },
      itens: ESTOQUE_ZZ.filter(
        (x) =>
          !fora(x.codigo, f.excluir) &&
          x.tipo === c.ficha.tipo &&
          x.cidade === c.ficha.cidade &&
          x.preco_valor >= (f.preco_min ?? pref * 0.85) &&
          x.preco_valor <= (f.preco_max ?? pref * 1.15) &&
          (!f.mais_barato || x.preco_valor < pref),
      )
        .sort((a, b) => Math.abs(a.preco_valor - pref) - Math.abs(b.preco_valor - pref))
        .slice(0, f.limite ?? 1)
        .map(sem),
    }),
    buscarCaracteristica: async (f: FiltroCaracteristicaBusca): Promise<ResultadoCaracteristica> => {
      const c2 = ESTOQUE_ZZ.filter(
        (x) =>
          !fora(x.codigo, f.excluir) &&
          (f.suites === undefined || num(x.suites) >= f.suites) &&
          (f.quartos === undefined || num(x.quartos) >= f.quartos) &&
          (f.vagas === undefined || num(x.vagas) >= f.vagas) &&
          (f.area === undefined || num(x.area_util_m2) >= f.area) &&
          (!f.tipo || x.tipo === f.tipo) &&
          (!f.cidade || x.cidade === f.cidade),
      ).sort((a, b) => a.preco_valor - b.preco_valor);
      const min = f.preco_min ?? 0;
      const max = f.preco_max ?? 1e12;
      const meio = (min + (f.preco_max ?? min)) / 2;
      const dentro = c2
        .filter((x) => x.preco_valor >= min && x.preco_valor <= max)
        .sort((a, b) => Math.abs(a.preco_valor - meio) - Math.abs(b.preco_valor - meio));
      const prox = dentro.length
        ? null
        : [...c2].sort((a, b) => {
            const d = (x: number) => (x > max ? x - max : min - x);
            return d(a.preco_valor) - d(b.preco_valor);
          })[0] ?? null;
      return { itens: dentro.slice(0, f.limite ?? 3).map(sem), proximo: prox ? sem(prox) : null };
    },
    buscarImoveis: async (f: FiltroBusca): Promise<ResultadoParecidos> => ({
      referencia: {},
      itens: ESTOQUE_ZZ.filter(
        (x) =>
          !fora(x.codigo, f.excluir) &&
          (!f.tipo || x.tipo === f.tipo) &&
          (!f.regiao || `${x.bairro} ${x.cidade}`.toLowerCase().includes(f.regiao.toLowerCase().slice(0, 6))) &&
          (!f.preco_max || x.preco_valor <= f.preco_max),
      )
        .slice(0, f.limite ?? 1)
        .map(sem),
    }),
  };
}

/** Contexto inicial (estado da conversa logo depois da 1ª mensagem). */
export function ctxReferencia(c: ConversaReferencia): ContextoIa {
  return {
    conversa_id: c.lead,
    estado: "ativa",
    versao: 1,
    passo: "interesse",
    dados: {},
    ia_nome: "Nicole",
    lead_nome: "Denis (teste)",
    imovel: null,
    org_nome: "ZZ Teste Provisionamento",
    transacao: "venda",
    anuncio_codigo: c.anuncio,
    tem_captacao: false,
    imovel_frase: `${c.ficha.tipo === "apartamento" ? "o apartamento" : "a casa"} do bairro ${c.ficha.bairro}`,
    ficha: c.ficha,
    imovel_fonte: "xml",
  } as ContextoIa;
}
