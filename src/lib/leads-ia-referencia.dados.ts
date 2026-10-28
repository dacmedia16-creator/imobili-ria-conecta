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
  FiltroNome,
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
  /** t_37cf21e3: chegou junto com a próxima (ao vivo não teve resposta própria); vai em falasAntes. */
  junto?: boolean;
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
export const ESTOQUE_ZZ: Array<ImovelParecido & { preco_valor: number; tipo_xml?: string; busca_texto?: string; so_anuncio?: string }> = [
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
  // t_37cf21e3: conversa F (d8907e38, VIP0027). XML real da ZZ lido em 27/10 (só leitura).
  { ...casa({ codigo: "VIP0027", tipo: "casa", bairro: "Central Parque", quartos: "3", suites: "1", vagas: "4", area_util_m2: "247", preco: "R$ 690.000" }), preco_valor: 690000, tipo_xml: "casa" },
  { ...casa({ codigo: "VIP0141", tipo: "casa", bairro: "Jardim Residencial Nikkey", quartos: "1", vagas: "4", area_util_m2: "138", preco: "R$ 638.900" }), preco_valor: 638900, tipo_xml: "casa" },
  { ...casa({ codigo: "3885", tipo: "casa", bairro: "Horto Florestal", quartos: "3", suites: "1", vagas: "3", area_util_m2: "142", preco: "R$ 695.000" }), preco_valor: 695000, tipo_xml: "casa-de-condominio" },
  { ...casa({ codigo: "VIP0137", tipo: "casa", bairro: "Horto Florestal", quartos: "3", suites: "2", vagas: "2", area_util_m2: "164", preco: "R$ 685.000" }), preco_valor: 685000, tipo_xml: "casa-de-condominio" },
  { ...casa({ codigo: "VIP0048", tipo: "casa", bairro: "Horto Florestal", quartos: "3", suites: "1", vagas: "2", area_util_m2: "156", preco: "R$ 635.000" }), preco_valor: 635000, tipo_xml: "casa-de-condominio" },
  { ...casa({ codigo: "3898", tipo: "casa", bairro: "Parque Campolim", quartos: "3", suites: "1", vagas: "2", area_util_m2: "140", preco: "R$ 770.000" }), preco_valor: 770000, tipo_xml: "casa-de-condominio" },
  { ...casa({ codigo: "VIP0036", tipo: "apartamento", bairro: "Parque Campolim", quartos: "3", suites: "3", vagas: "3", area_util_m2: "125", preco: "R$ 1.170.000" }), preco_valor: 1170000 },
  { ...casa({ codigo: "VIP0034", tipo: "apartamento", bairro: "Parque Campolim", quartos: "3", suites: "3", vagas: "2", area_util_m2: "120", preco: "R$ 1.197.000" }), preco_valor: 1197000 },
  { ...casa({ codigo: "VIP0162", tipo: "apartamento", bairro: "Parque Campolim", quartos: "3", suites: "2", vagas: "2", area_util_m2: "118", preco: "R$ 1.100.000" }), preco_valor: 1100000 },
  // t_228659f0: conversa H (7ebaa6bb). Residencial Cannes: o nome só aparece na descrição do XML (lido em 28/10).
  { ...casa({ codigo: "VIP0136", tipo: "apartamento", bairro: "Parque Campolim", quartos: "3", suites: "1", vagas: "2", area_util_m2: "97", preco: "R$ 999.000" }), preco_valor: 999000, busca_texto: "residencial cannes" },
  { ...casa({ codigo: "822", tipo: "apartamento", bairro: "Parque Campolim", quartos: "3", suites: "1", vagas: "2", area_util_m2: "97", preco: "R$ 1.100.000" }), preco_valor: 1100000, busca_texto: "condominio cannes" },
  // t_6667db44: conversa I (f3837c14, casa 2542, Ibiti Royal Park). XML real da ZZ lido em 28/10 (só leitura).
  ...(
    [
      ["2542", "casa", "Ibiti Royal Park", "3", "1", "4", "268", 1490000],
      ["2538", "casa", "Ibiti Royal Park", "3", "3", "4", "236", 1450000],
      ["2545", "casa", "Ibiti Royal Park", "3", "3", "4", "265", 1440000],
      ["2544", "casa", "Ibiti Royal Park", "3", "3", "4", "226", 1420000],
      ["2549", "casa", "Ibiti Royal Park", "3", "1", "4", "200", 1399000],
      ["3968", "apartamento", "Parque Campolim", "3", "1", "1", "68", 468000],
      ["3830", "apartamento", "Parque Campolim", "3", "1", "2", "84", 569000],
      ["VIP0054", "apartamento", "Parque Campolim", "3", "1", "2", "83", 724000],
      ["3677", "apartamento", "Parque Campolim", "3", "1", "2", "85", 760000],
    ] as const
  ).map(([codigo, tipo, bairro, quartos, suites, vagas, area, v]) => ({
    ...casa({ codigo, tipo, bairro, quartos, suites, vagas, area_util_m2: area, preco: `R$ ${v.toLocaleString("pt-BR")}` }),
    preco_valor: v,
    tipo_xml: tipo === "casa" ? "casa-de-condominio" : undefined,
  })),
  // t_33fb109d: conversa J (75957c60, apto 3691 no Parque Campolim). XML real da ZZ lido em 28/10 (só leitura).
  { ...casa({ codigo: "3691", tipo: "apartamento", bairro: "Parque Campolim", quartos: "3", suites: "1", vagas: "2", area_util_m2: "85", preco: "R$ 850.000" }), preco_valor: 850000 },
  { ...casa({ codigo: "3693", tipo: "apartamento", bairro: "Parque Campolim", quartos: "3", suites: "1", vagas: "2", area_util_m2: "85", preco: "R$ 860.000" }), preco_valor: 860000 },
  // t_66ad4609: conversa K (e3db2183, apto 3806 no Jardim Vera Cruz). XML real da ZZ lido em 28/10 (só leitura).
  ...(
    [
      ["3806", "80", 665000],
      ["3805", "80", 685000],
      ["3810", "81", 645000],
      ["VIP0130", "84", 710000],
      ["3822", "80", 595000],
      ["3816", "80", 585000],
    ] as const
  ).map(([codigo, area, v]) => ({
    ...casa({ codigo, tipo: "apartamento", bairro: "Jardim Vera Cruz", quartos: "3", suites: "1", vagas: "2", area_util_m2: area, preco: `R$ ${v.toLocaleString("pt-BR")}` }),
    preco_valor: v,
    // Só nas conversas do 3806 (K e L): não muda o resultado das conversas antigas.
    so_anuncio: "3806",
  })),
  // t_82c89141: casas de condomínio de Sorocaba (no XML o tipo é "casa-de-condominio"; para a Nicole é "casa").
  ...(
    [
      ["3975", "casa", "Jardim Residencial Villa Amato", "3", "1", "4", "261", 899000],
      ["VIP0022", "casa-de-condominio", "Cajuru do Sul", "3", "1", "2", "127", 870000],
      ["VIP0167", "casa-de-condominio", "Vila Lucy", "3", "1", "3", "160", 939000],
      ["VIP0150", "casa-de-condominio", "Jardim Novo Horizonte", "3", "1", "4", "129", 850000],
      ["3914", "casa-de-condominio", "Golden Park Residencial", "3", "1", "4", "188", 845000],
      ["3915", "casa-de-condominio", "Jardim São Carlos", "3", "1", "2", "116", 845000],
      ["VIP0112", "casa-de-condominio", "Jardim Ibiti do Paço", "3", "1", "4", "235", 990000],
      ["3980", "casa-de-condominio", "Jardim Pagliato", "3", "1", "2", "128", 799000],
      ["VIP0131", "casa-de-condominio", "Jardim Sao Carlos", "3", "1", "2", "94", 749970],
      ["3974", "casa-de-condominio", "Jardim São Carlos", "3", "1", "2", "94", 750000],
      ["3883", "casa-de-condominio", "Cajuru do Sul", "3", "1", "2", "180", 750000],
    ] as const
  ).map(([codigo, tipo_xml, bairro, quartos, suites, vagas, area, v]) => ({
    ...casa({ codigo, tipo: "casa", bairro, quartos, suites, vagas, area_util_m2: area, preco: `R$ ${v.toLocaleString("pt-BR")}` }),
    preco_valor: v,
    tipo_xml,
  })),
];

const ESTOQUE_TODO = ESTOQUE_ZZ;
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
  // t_82c89141: lead 12f005b4 (DeepSeek ao vivo, 27/10) — itens 1, 2, 3, 4, 5 e 6a.
  {
    id: "D",
    lead: "12f005b4",
    anuncio: "3975",
    ficha: ficha({
      tipo: "casa", bairro: "Jardim Residencial Villa Amato", quartos: "3", suites: "1", banheiros: "3", vagas: "4",
      area_construida_m2: "261", preco: "R$ 899.000", preco_valor: 899000, iptu: "R$ 167,00 por ano",
      link: "https://vipsevenimoveis.com.br/imovel/3975",
    }),
    primeira:
      "Oi, Denis! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse na casa de 3 quartos no bairro Jardim Residencial Villa Amato, em Sorocaba, anunciada por R$ 899.000. Anúncio: https://vipsevenimoveis.com.br/imovel/3975 Quer saber mais detalhes ou já prefere agendar uma visita?",
    falas: [
      {
        cliente: "quero mais detalhes",
        esperado: "A casa tem 3 quartos, 1 suíte, 3 banheiros, 4 vagas e 261 m² construídos. O IPTU é de R$ 167 por ano. Quer agendar uma visita?",
        antes: "Claro! A casa tem 3 banheiros, 4 vagas de garagem e 261 m² de área construida. O IPTU é de R$ 167 por ano. Quer agendar uma visita para conhecer?",
      },
      {
        cliente: "tem mais opções?",
        esperado: "Tenho sim! Uma casa de condomínio no Cajuru do Sul, 3 quartos, por R$ 870.000: https://vipsevenimoveis.com.br/imovel/VIP0022 Gostou?",
        antes: "Nessa faixa, essa casa é a opção que tenho agora. Quer agendar uma visita para conhecer?",
        falha: "disse que não tinha outra (havia 14 casas de condomínio na faixa)",
      },
      {
        cliente: "tem alguma coisa 3 suítes?",
        esperado: "Casa com 3 suítes nessa faixa não tenho. Tenho um APARTAMENTO com 3 suítes por R$ 975.000 — apartamento serve para você?",
        antes: "Tenho um apartamento com 3 suítes, 4 quartos e 135 m², por R$ 975.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/VIP0015 Gostou?",
        falha: "ofereceu apartamento a quem viu casa sem perguntar se aceita",
      },
      {
        cliente: "aceita financiamento?",
        esperado: "O corretor confirma isso com você na visita ou no contato. Quer agendar uma visita?",
        antes: "Vou confirmar isso e já te falo! Enquanto isso, quer agendar uma visita para conhecer o apartamento?",
        falha: "prometeu retorno",
      },
      {
        cliente: "pode ser sábado?",
        esperado: "Anotado, sábado! Fica melhor de manhã ou à tarde?",
        antes: "Sábado anotado! Te confirmo o horário certinho.",
        falha: "não perguntou o período e não avisou que o corretor continua",
      },
      {
        cliente: "de manhã",
        esperado: "Sábado de manhã anotado! Já pedi para o corretor, que vai continuar seu atendimento por aqui.",
        antes: null,
      },
    ],
  },
  // t_82c89141: lead 6db2a3f4 (Gemini ao vivo, 27/10) — a conversa boa, para comparar.
  {
    id: "E",
    lead: "6db2a3f4",
    anuncio: "VIP0131",
    ficha: ficha({
      tipo: "casa", bairro: "Jardim Sao Carlos", quartos: "3", suites: "1", banheiros: "4", vagas: "2",
      area_construida_m2: "94", area_terreno_m2: "140", preco: "R$ 749.970", preco_valor: 749970,
      condominio: "R$ 550,00", iptu: "R$ 95,00 por mês", link: "https://vipsevenimoveis.com.br/imovel/VIP0131",
    }),
    primeira:
      "Oi, Denis! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse na casa de 3 quartos no bairro Jardim Sao Carlos, em Sorocaba, anunciada por R$ 749.970. Anúncio: https://vipsevenimoveis.com.br/imovel/VIP0131 Quer saber mais detalhes ou já prefere agendar uma visita?",
    falas: [
      {
        cliente: "quero mais detalhes",
        esperado: "Ela tem 94 m², 1 suíte, 4 banheiros e 2 vagas. O condomínio é R$ 550 e o IPTU R$ 95 por mês. Quer agendar uma visita?",
        antes: "Ela tem 94 m² de área construída, terreno de 140 m², 1 suíte, 4 banheiros e 2 vagas. O condomínio fica R$ 550 e o IPTU R$ 95 por mês. Quer agendar uma visita para conhecer de perto?",
      },
      {
        cliente: "tem mais opções ?",
        esperado: "Tenho sim! Outra casa no Jardim São Carlos, 3 quartos, por R$ 750.000: https://vipsevenimoveis.com.br/imovel/3974 Gostou?",
        antes: "Tenho sim! Tem outra casa no Jardim São Carlos com 3 quartos, 1 suíte e 116 m² por R$ 845.000. Veja aqui: https://vipsevenimoveis.com.br/imovel/3915 O que achou dessa?",
      },
      {
        cliente: "legal gostaria de uma visita",
        esperado: "Combinado! Tenho amanhã de manhã ou quinta à tarde. Qual fica melhor?",
        antes: "Combinado! Para essa casa, temos opções para amanhã, quarta, 28/10, de manhã, ou quinta, 29/10, à tarde. Qual fica melhor para você?",
      },
      {
        cliente: "quarta de manha",
        esperado: "Quarta de manhã anotado! Já pedi para o corretor, que vai continuar seu atendimento por aqui.",
        antes: "Perfeito, já anotei aqui para quarta-feira de manhã! Já pedi para o nosso time de corretores, que vai te chamar aqui para confirmar o horário certinho.",
      },
    ],
  },
  // t_37cf21e3: conversa d8907e38 (lead cc19ea1c, DeepSeek ao vivo, 27/10 17:13-18:35) — os 6 pontos de Denis.
  {
    id: "F",
    lead: "cc19ea1c",
    anuncio: "VIP0027",
    ficha: ficha({
      tipo: "casa", bairro: "Central Parque", quartos: "3", suites: "1", banheiros: "3", vagas: "4",
      area_construida_m2: "247", area_terreno_m2: "266", preco: "R$ 690.000", preco_valor: 690000,
      iptu: "R$ 153,00 por mês", link: "https://vipsevenimoveis.com.br/imovel/VIP0027",
    }),
    primeira:
      "Oi, Denis! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse na casa de 3 quartos no bairro Central Parque, em Sorocaba, anunciada por R$ 690.000. Anúncio: https://vipsevenimoveis.com.br/imovel/VIP0027 Quer saber mais detalhes ou já prefere agendar uma visita?",
    falas: [
      { cliente: "Gostaria", esperado: "Claro! O que você gostaria de saber sobre a casa, ou já prefere agendar uma visita?", antes: "Que bom que gostou! A casa tem 3 quartos, 1 suíte, 3 banheiros e 4 vagas, em 247 m² de área construída. O IPTU é R$ 153 por mês. Quer agendar uma visita para conhecer pessoalmente?", falha: "item 5: 'Que bom que gostou!' para 'Gostaria'" },
      { cliente: "Teria  mais opções ?", esperado: "Tenho sim! Uma casa no Horto Florestal, 3 quartos, por R$ 685.000: https://vipsevenimoveis.com.br/imovel/VIP0137 Gostou?", antes: "Tenho sim! Tem outra casa no Jardim Residencial Nikkey, com 1 quarto e 4 vagas, por R$ 638.900. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/VIP0141 Gostou?", falha: "item 1: casa de 1 quarto para quem viu casa de 3" },
      { cliente: "oq mais vc tem nesta região ?", esperado: "No Central Parque não tenho outra casa nessa faixa agora. A mais perto do que você procura fica no Horto Florestal: ... Te serve, mesmo sendo em outro bairro?", antes: "Nessa região, tenho uma casa no Horto Florestal, com 3 quartos, 1 suíte e 3 vagas, por R$ 695.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3885 Gostou?", falha: "item 2: outro bairro como se fosse 'nessa região'" },
      { cliente: "meu filho esta procurando apartamento vcs tb trabalha com apartamento ?", esperado: "Trabalhamos sim! Para o seu filho, seria para comprar ou para alugar?", antes: "Trabalhamos sim com apartamentos! Ele busca comprar ou alugar?" },
      { cliente: "comprar", esperado: "E em qual bairro ou região de Sorocaba ele prefere?", antes: "Entendi! Ele busca comprar um apartamento. Qual região ele prefere?" },
      { cliente: "campolim", esperado: "E até quanto ele pensa em investir?", antes: "Sim, trabalhamos com apartamentos no Campolim! Ele busca quantos quartos?" },
      { cliente: "3 suites ate 1200", esperado: "Achei um apartamento no Parque Campolim, 3 suítes, por R$ 1.170.000: https://vipsevenimoveis.com.br/imovel/VIP0036 O que acha?", antes: "Entendi, ele busca apartamento com 3 suítes no Campolim até R$ 1.200.000. Nessa faixa, o mais em conta que tenho é um apartamento no Centro, com 4 quartos, 3 suítes e 2 vagas, por R$ 975.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/VIP0015 Quer ver esse ou prefere que eu procure com um pouco menos?", falha: "item 2/3: Centro em vez de Campolim, e a faixa do filho virou a do pai" },
      { cliente: "Quartos, metragem, vagas e andar ?", esperado: "Ele tem 3 quartos (3 suítes), 125 m² e 3 vagas. O andar o corretor confirma. O que acha?", antes: "Esse apartamento tem 4 quartos, 3 suítes, 2 vagas e 135 m². Sobre o andar, o corretor confirma com você na visita ou no contato. Quer agendar uma visita?" },
      { cliente: "sabe  se aceita permuta ?", esperado: "Permuta o corretor confirma com o proprietário. Quer agendar uma visita?", antes: "O corretor confirma se o proprietário aceita permuta com você na visita ou no contato. Quer agendar uma visita para conhecer pessoalmente?" },
      { cliente: "quem vai visitar e meu filho o ap é para ele", esperado: "Combinado, anotei que a visita ao apartamento é do seu filho.", antes: "Perfeito, então a visita é para o seu filho! Anotei que o apartamento é para ele. Quer agendar a visita para amanhã de manhã ou quinta à tarde?" },
      { cliente: "qual endereço desse ao ?", esperado: "O endereço exato o corretor passa na hora de combinar a visita.", antes: "O endereço exato o corretor confirma com você na visita ou no contato. Quer agendar a visita para amanhã de manhã ou quinta à tarde?" },
      { cliente: "vou passar seu contato para ele", junto: true, esperado: "(chegou junto com as 2 próximas)", antes: null },
      { cliente: "sobre a casa q eu to vendo para mim", junto: true, esperado: "(chegou junto com a próxima)", antes: null },
      { cliente: "vc tem mais opções ?", esperado: "Tenho sim! Outra casa, no Horto Florestal, 3 quartos, por R$ ...: <link> Gostou?", antes: "Sobre a casa que você está vendo, tenho sim! Tem um apartamento na Vila Independência, com 4 quartos, 4 suítes e 157 m², por R$ 1.037.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/VIP0047. Como é apartamento, te serve ou prefere continuar com casas?", falha: "item 3: apartamento (perfil do filho) para a casa do pai" },
      { cliente: "não quero casa mesmo", esperado: "Só para eu entender certo: você quer ver casas, certo?", antes: "Entendi! Então seguimos com o apartamento. Quer agendar uma visita para conhecer?", falha: "item 4: frase ambígua entendida ao contrário" },
      { cliente: "disse q quero casa", esperado: "Combinado, casas então! Outra casa ...: <link> Gostou?", antes: "Ah, desculpa! Então seguimos com a casa que você viu, no Central Parque. Quer agendar uma visita para conhecê-la?", falha: "item 4: não mostrou as outras casas pedidas" },
      { cliente: "quero sim", esperado: "Combinado! Quer agendar uma visita?", antes: "Que ótimo! Então vamos agendar sua visita à casa do Central Parque. Fica melhor de manhã ou à tarde?" },
      { cliente: "mas qual casa vamos visita ?", esperado: "A casa do ... (a última que você gostou): <link>", antes: "A casa que vamos visitar é a do Central Parque, com 3 quartos, 1 suíte e 247 m², por R$ 690.000. Fica melhor de manhã ou à tarde?" },
      { cliente: "me manda mais fotos", esperado: "As fotos estão todas no anúncio: <link do imóvel em questão>", antes: "Claro, te mando mais fotos da casa do Central Parque! O corretor confirma com você na visita ou no contato. Quer agendar a visita para conhecer?", falha: "item 6: promessa de fotos, sem link" },
      { cliente: "me manda as fotos primeiro", esperado: "As fotos estão todas no anúncio: <link>", antes: "As fotos da casa do Central Parque o corretor confirma com você na visita ou no contato. Quer agendar a visita para conhecê-la?", falha: "item 6: sem link" },
    ],
  },
  // t_0c590c55: conversa b00303f0 (lead 13f9b512, VIP0144, DeepSeek ao vivo, 28/10 21:40-21:43) — permuta e "corretora?".
  {
    id: "G",
    lead: "13f9b512",
    anuncio: "VIP0144",
    ficha: ficha({
      tipo: "casa", bairro: "Residencial Horto Florestal Villagio", quartos: "3", suites: "2", banheiros: "2", vagas: "2",
      area_util_m2: "113", preco: "R$ 699.000", preco_valor: 699000, condominio: "R$ 280,00", iptu: "R$ 100,00 por mês",
      link: "https://vipsevenimoveis.com.br/imovel/VIP0144",
    }),
    primeira:
      "Oi, Denis! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse na casa de 3 quartos no bairro Residencial Horto Florestal Villagio, em Sorocaba, anunciada por R$ 699.000. Anúncio: https://vipsevenimoveis.com.br/imovel/VIP0144 Quer saber mais detalhes ou já prefere agendar uma visita?",
    falas: [
      { cliente: "esta disponível ?", esperado: "Sobre a disponibilidade, o corretor confirma com você na visita ou no contato. Quer agendar uma visita para conhecer?", antes: "Sobre a disponibilidade, o corretor confirma com você na visita ou no contato. Quer agendar uma visita para conhecer?" },
      { cliente: "me manda mais detalhes", esperado: "A casa tem 3 quartos, 2 suítes, 2 vagas e 113 m². Quer agendar uma visita?", antes: "Claro! A casa tem 3 quartos, 2 suítes, 2 banheiros, 2 vagas de garagem e 113 m². O condomínio é R$ 280 e o IPTU R$ 100 por mês. Quer agendar uma visita para ver tudo de perto?" },
      { cliente: "aceita permuta ?", esperado: "Anotei! Se o proprietário aceita permuta, o corretor confirma com você na visita ou no contato. Quer agendar uma visita para conhecer?", antes: "Anotei! Se o proprietário aceita permuta, o corretor confirma com você. Já pedi para o nosso time de corretores continuar seu atendimento por aqui para conversar sobre isso.", falha: "item 4: permuta passou a conversa ao corretor (cedo demais)" },
      { cliente: "vc não é corretora ?", esperado: "Sou a Nicole, assistente virtual da ZZ, e um corretor da equipe continua seu atendimento e acompanha a visita. Quer agendar uma visita para conhecer?", antes: null, falha: "item 5: ficou sem resposta (conversa já passada)" },
    ],
  },
  // t_228659f0: conversa 7ebaa6bb (lead 4b41f454, VIP0137, DeepSeek ao vivo, 28/10 05:53-06:14) — preço inventado,
  // Cannes não achado, presa no assunto, horário inventado e corte por limite sem aviso.
  {
    id: "H",
    lead: "4b41f454",
    anuncio: "VIP0137",
    ficha: ficha({
      tipo: "casa", bairro: "Horto Florestal", quartos: "3", suites: "2", banheiros: "4", vagas: "2",
      area_util_m2: "164", area_terreno_m2: "157", preco: "R$ 685.000", preco_valor: 685000, condominio: "R$ 290,00",
      iptu: "R$ 120,00 por mês", link: "https://vipsevenimoveis.com.br/imovel/VIP0137",
    }),
    primeira:
      "Oi, Denis! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse na casa de 3 quartos no bairro Horto Florestal, em Sorocaba, anunciada por R$ 685.000. Anúncio: https://vipsevenimoveis.com.br/imovel/VIP0137 Quer saber mais detalhes ou já prefere agendar uma visita?",
    falas: [
      { cliente: "Mais detalhes", esperado: "A casa tem 3 quartos, 2 suítes, 2 vagas e 164 m². Quer agendar uma visita?", antes: "Claro! A casa tem 3 quartos, 2 suítes, 4 banheiros, 2 vagas, 164 m² de área construida e 157 m² de terreno. O condominio é R$ 290 e o IPTU R$ 120 por mês. Quer agendar uma visita?" },
      { cliente: "Tem mais opções ?", esperado: "Outra casa no mesmo bairro, com link.", antes: "Claro! Tem outra casa no mesmo bairro, com 3 quartos, 1 suíte e 3 vagas, por R$ 695.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3885 Gostou?" },
      { cliente: "Aceita permuta ?", esperado: "O corretor confirma a permuta com você. Quer agendar uma visita?", antes: "O corretor confirma se o proprietário aceita permuta com você na visita ou no contato. Quer agendar uma visita para conhecer pessoalmente?" },
      { cliente: "Então vc não sabe se está disponível ?", esperado: "A disponibilidade o corretor confirma com você. Quer agendar uma visita?", antes: "Sobre disponibilidade, o corretor confirma com você na visita ou no contato. Quer agendar uma visita para conhecer?" },
      { cliente: "Oq mas vcs tem nessa região ?", esperado: "Outra casa no Horto Florestal, com link.", antes: "Nessa região, tenho outra casa no Horto Florestal, com 3 quartos, 1 suíte e 2 vagas, por R$ 645.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3879 Gostou?" },
      { cliente: "Vc tb tem apartamento ?", esperado: "Temos sim! Para comprar ou alugar?", antes: "Sim, também trabalhamos com apartamentos! Você busca para comprar ou alugar?" },
      { cliente: "Comprar", esperado: "Em que bairro?", antes: "Entendido, comprar! E em que região ou bairro está procurando o apartamento?" },
      { cliente: "Campolim", esperado: "Quantos quartos?", antes: "Anotado, Campolim! E quantos quartos está buscando no apartamento?" },
      { cliente: "3 suítes", esperado: "Apartamento no Campolim com 3 suítes: VIP0036 por R$ 1.170.000, com link.", antes: "Nessa faixa, no Campolim, não temos apartamento com 3 suítes. O mais em conta que temos é um apartamento com 3 suítes por R$ 1.170.000, em Parque Campolim. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/VIP0036 Quer ver esse ou prefere que eu procure com menos suítes?" },
      { cliente: "Não tem nada perto de 900 mil ?", esperado: "Com 3 suítes perto de R$ 900 mil não tenho; quer que eu procure com menos suítes?", antes: "Entendi, você busca perto de R$ 900.000. Nessa faixa, no Campolim, o que temos é o apartamento com 3 suítes que te mostrei. Quer ver esse ou prefere que eu procure com menos suítes?" },
      { cliente: "Menos suítes", esperado: "2 ou 1 suíte?", antes: "Entendi! Vou procurar com menos suítes. E para essa busca, você prefere 2 suítes ou 1 suíte?" },
      { cliente: "O tiver perto de 900 mil", esperado: "Um apartamento real do XML perto de R$ 900 mil, com os dados certos e o link dele.", antes: "Entendi, perto de R$ 900.000. Nessa faixa, no Campolim, temos um apartamento com 2 suítes por R$ 850.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/VIP0036 Quer ver esse ou prefere que eu procure com 1 suíte?", falha: "item 1: VIP0036 com 2 suítes e R$ 850.000 (o anúncio tem 3 suítes e R$ 1.170.000)" },
      { cliente: "Tem cannes ??", esperado: "No Residencial Cannes tenho um apartamento de 3 quartos por R$ 999.000: <link VIP0136>. Fica um pouco acima dos R$ 900 mil.", antes: "Entendi! No Campolim, perto de R$ 900.000, temos o apartamento com 2 suítes que te mostrei. Quer ver esse ou prefere que eu procure com 1 suíte?", falha: "itens 2 e 3: ignorou o Cannes e repetiu" },
      { cliente: "Tem no condomínio cannes", esperado: "Tenho sim: <VIP0136 com preço e link>.", antes: "No Campolim, perto de R$ 900.000, não temos apartamento no condomínio Cannes. O que temos é o apartamento com 2 suítes que te mostrei. Quer ver esse ou prefere que eu procure com 1 suíte?", falha: "item 2: disse que não tinha Cannes" },
      { cliente: "Qual valor do cannes q vc tem ?", esperado: "R$ 999.000 (VIP0136) e R$ 1.100.000 (822).", antes: "Sobre o condomínio Cannes, não temos apartamento disponível nessa faixa. O que temos é o apartamento com 2 suítes que te mostrei. Quer ver esse ou prefere que eu procure com 1 suíte?", falha: "itens 2 e 3" },
      { cliente: "Qual valor do cannes ?", esperado: "O do Cannes sai por R$ 999.000: <link>.", antes: "Sobre o condomínio Cannes, não temos apartamento nessa faixa. O que temos é o apartamento com 2 suítes que te mostrei. Quer ver esse ou prefere que eu procure com 1 suíte?", falha: "itens 2 e 3" },
      { cliente: "Já entendi q não tem desse valor no cannes mas qual o preço do cannes q vc tem ??", esperado: "O do Cannes sai por R$ 999.000: <link>.", antes: "Entendido! No Campolim, perto de R$ 900.000, temos um apartamento com 2 suítes por R$ 850.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/VIP0036 Quer ver esse ou prefere que eu procure com 1 suíte?", falha: "itens 1, 3 e 6: preço inventado de novo" },
      { cliente: "Me manda o cannes q vc tem", esperado: "<link VIP0136>", antes: "Sobre o condomínio Cannes, não temos apartamento nessa faixa. O que temos é o apartamento com 2 suítes que te mostrei. Quer ver esse ou prefere que eu procure com 1 suíte?", falha: "itens 2 e 3" },
      { cliente: "Dá para visitar ?", esperado: "Claro! Qual dia e período ficam melhores para você? O corretor confirma o horário.", antes: "Claro! Temos visita amanhã de manhã ou sexta à tarde. Qual prefere?", falha: "item 5: horário inventado" },
      { cliente: "Amanhã a tarde não tem como ?", esperado: "Amanhã à tarde anotado! O corretor confirma o horário com você.", antes: null, falha: "item 4: cortada pelo limite, sem aviso" },
    ],
  },
  // t_6667db44: conversa f3837c14 (casa 2542, DeepSeek ao vivo, 28/10 06:15-09:29 BRT) — pergunta duplicada na
  // mesma mensagem, \"por quê?\" sem resposta e a CASA 2544 mandada a quem pediu \"mais opções de ap\".
  {
    id: "I",
    lead: "f3837c14",
    anuncio: "2542",
    ficha: ficha({
      tipo: "casa", bairro: "Ibiti Royal Park", quartos: "3", suites: "1", vagas: "4", area_util_m2: "268",
      preco: "R$ 1.490.000", preco_valor: 1490000, condominio: "R$ 400,00", iptu: "R$ 167,00 por mês",
      link: "https://vipsevenimoveis.com.br/imovel/2542",
    }),
    primeira:
      "Oi, Denis! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse na casa de 3 quartos no bairro Ibiti Royal Park, em Sorocaba, anunciada por R$ 1.490.000. Anúncio: https://vipsevenimoveis.com.br/imovel/2542 Quer saber mais detalhes ou já prefere agendar uma visita?",
    falas: [
      { cliente: "Tem outras ?", esperado: "Outra casa no Ibiti Royal Park, com link.", antes: "Tenho sim! Tem outra casa no Ibiti Royal Park, com 3 suítes e 236 m², por R$ 1.450.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/2538 Gostou?" },
      { cliente: "Quero ver essa", esperado: "Quer agendar a visita? Qual dia e período?", antes: "Claro! Essa casa tem 3 suítes, 4 vagas e 236 m², por R$ 1.450.000. Quer agendar uma visita para conhecer?" },
      { cliente: "Sim", esperado: "Qual dia e período ficam melhores?", antes: "Que bom! Quer agendar a visita para essa casa de 3 suítes?" },
      { cliente: "Sin", esperado: "Qual dia e período ficam melhores?", antes: "Perfeito! Me diz que dia te fica melhor para visitar e se prefere de manhã ou à tarde." },
      { cliente: "Tem mais opções ?", esperado: "Outra casa no Ibiti Royal Park, com link, 1 pergunta só.", antes: "Entendi! Tem outra casa no Ibiti Royal Park, com 3 suítes e 265 m², por R$ 1.440.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/2545 Gostou? Quer ver essa ou prefere agendar a visita na outra? Quer ver essa ou prefere agendar a visita na outra?", falha: "ponto 1: pergunta duplicada na mesma mensagem" },
      { cliente: "É apartamento vc tem ?", esperado: "Temos sim! Para comprar ou alugar?", antes: "Trabalhamos com apartamentos sim! Você procura comprar ou alugar?" },
      { cliente: "Comprar mesmo", esperado: "Em qual bairro?", antes: "Entendi, comprar! E para apartamento, tem alguma região ou bairro que você prefere?" },
      { cliente: "Campolim", esperado: "Quantos quartos?", antes: "Anotado, Campolim! E para apartamento, quantos quartos você busca?" },
      { cliente: "3 dormitórios", esperado: "Apartamento de 3 quartos no Campolim, com link.", antes: "Achei um apartamento com 3 quartos no Parque Campolim, por R$ 468.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3968. Gostou?" },
      { cliente: "pq enviou varios opçoes ?", esperado: "Te mandei outras opções porque você pediu mais. Prefere seguir só com apartamentos no Campolim?", antes: "Você pediu apartamento e eu te mostrei um! A casa que você viu antes continua de pé, se quiser retomar. Quer ver esse apartamento ou prefere voltar para a casa?", falha: "ponto 2: não entendeu a reclamação" },
      { cliente: "manda mais opções de ap", esperado: "Outro apartamento de 3 quartos no Campolim, com link.", antes: "Tenho mais uma no mesmo bairro, com 3 quartos e 226 m², por R$ 1.420.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/2544 Gostou? Se quiser, marco uma visita.", falha: "ponto 3 (GRAVE): mandou a CASA 2544 a quem pediu apartamento" },
      { cliente: "isso casa q vc mandou", esperado: "Desculpe, era uma casa. Quer que eu mostre outro apartamento no Campolim?", antes: "Você tem razão, essa é uma casa! Peço desculpas. Quer que eu procure mais apartamentos ou prefere ver essa casa?" },
      { cliente: "ap", esperado: "Outro apartamento de 3 quartos no Campolim, com link.", antes: "Entendi, você quer apartamento! Essas são as opções que tenho nessa faixa agora. Quer visitar o apartamento do Campolim ou prefere ver a casa também?" },
    ],
  },
  // t_33fb109d: conversa 75957c60 (lead d0d9b70b, teste t_0a635ef5). Denis pediu casas 3 vezes e não recebeu nenhuma.
  {
    id: "J",
    lead: "d0d9b70b",
    anuncio: "3691",
    ficha: ficha({
      tipo: "apartamento", bairro: "Parque Campolim", quartos: "3", suites: "1", banheiros: "2", vagas: "2", area_util_m2: "85",
      preco: "R$ 850.000", preco_valor: 850000, condominio: "R$ 550,00", iptu: "R$ 80,00 por mês",
      link: "https://vipsevenimoveis.com.br/imovel/3691",
    }),
    primeira:
      "Oi, Denis! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse no apartamento de 3 quartos no bairro Parque Campolim, em Sorocaba, anunciado por R$ 850.000. Anúncio: https://vipsevenimoveis.com.br/imovel/3691 Quer saber mais detalhes ou já prefere agendar uma visita?",
    falas: [
      { cliente: "queria ter detaljes", esperado: "Ficha do 3691 e convite.", antes: "Claro! O apartamento tem 3 quartos, 1 suíte, 2 banheiros, 2 vagas e 85 m². O condomínio é R$ 550 e o IPTU R$ 80 por mês. Quer agendar uma visita para conhecer?" },
      { cliente: "tem mais opções ?", esperado: "Outro apartamento parecido, com link.", antes: "Tenho sim! Tem outro apartamento no mesmo bairro, com 3 quartos, 1 suíte e 85 m², por R$ 860.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3693 Gostou?" },
      { cliente: "tem alguma opção de casa neste valor ?", esperado: "Uma casa perto de R$ 850.000, com link.", antes: "Entendido, você quer uma casa nessa faixa. Nesse momento, as opções que tenho são apartamentos. Quer ver este apartamento de 3 quartos por R$ 860.000 ou prefere que eu procure uma casa com características parecidas?", falha: "disse que só tinha apartamentos (a busca de casa nem rodou; o XML tem ~25 casas na faixa)" },
      { cliente: "veja se tem casas", esperado: "Outra casa na faixa, com link.", antes: "Entendi, você quer uma casa. Vou anotar isso para a equipe. Quer seguir vendo o apartamento de 3 quartos por R$ 860.000 ou prefere esperar novidades? Já pedi para o nosso time de corretores, que vai continuar seu atendimento por aqui.", falha: "passou ao corretor sem mostrar casa (1ª tentativa barrada por repeticao; 2ª com acao passar)" },
      { cliente: "me manda casas", esperado: "Mais uma casa na faixa, com link.", antes: null, falha: "ficou sem resposta (conversa já passada)" },
    ],
  },
  // t_66ad4609: conversa e3db2183 (lead b96ee207, teste t_616ba97d, 28/10 15:01-15:09 BRT). Denis: a Nicole oferece
  // visita em quase toda resposta (ao vivo: 3 de 7 respostas, fora a 1ª mensagem).
  {
    id: "K",
    lead: "b96ee207",
    anuncio: "3806",
    ficha: ficha({
      tipo: "apartamento", bairro: "Jardim Vera Cruz", quartos: "3", suites: "1", banheiros: "2", vagas: "2", area_util_m2: "80",
      preco: "R$ 665.000", preco_valor: 665000, condominio: "R$ 550,00", iptu: "R$ 54,00 por mês",
      link: "https://vipsevenimoveis.com.br/imovel/3806",
    }),
    primeira:
      "Oi, Denis! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse no apartamento de 3 quartos no bairro Jardim Vera Cruz, em Sorocaba, anunciado por R$ 665.000. Anúncio: https://vipsevenimoveis.com.br/imovel/3806 Quer saber mais detalhes ou já prefere agendar uma visita?",
    falas: [
      { cliente: "me passa mais Detalhes", esperado: "Ficha do 3806, sem convite de visita.", antes: "Claro! O apartamento tem 3 quartos, 1 suíte, 2 banheiros e 2 vagas, com 80 m². O condominio é R$ 550 e o IPTU R$ 54 por mês. Quer agendar uma visita para conhecer?", falha: "convite de visita sem sinal de interesse" },
      { cliente: "esta disponivel ?", esperado: "O corretor confirma a disponibilidade, sem convite de visita.", antes: "Sobre a disponibilidade, o corretor confirma com você na visita ou no contato. Quer agendar uma visita para conhecer?", falha: "convite de visita de novo, logo na resposta seguinte" },
      { cliente: "vc tem mais opções ?", esperado: "Outro apartamento parecido, com link.", antes: "Tenho outra opção no mesmo bairro, também apartamento com 3 quartos e 1 suíte, por R$ 685.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3805 Gostou?" },
      { cliente: "vc tem casas neste valor ?", esperado: "Uma casa perto de R$ 665.000, com link.", antes: "Tenho uma casa com 3 quartos, 1 suíte e 123 m², por R$ 665.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3882 Gostou?" },
      { cliente: "e no mesmo bairro do ap ?", esperado: "No Jardim Vera Cruz só há apartamentos nessa faixa.", antes: "Nessa faixa, no mesmo bairro, só tenho apartamentos. A casa que te mostrei fica no Jardim Novo Horizonte. Quer ver essa casa ou prefere seguir com os apartamentos?" },
      { cliente: "me manda mais ap", esperado: "Outro apartamento no Jardim Vera Cruz, com link.", antes: "Claro! Aqui vai outro apartamento no Jardim Vera Cruz, com 3 quartos e 1 suíte, por R$ 645.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3810 Gostou?" },
      { cliente: "quando podemos visitar ?", esperado: "Qual dia e período ficam melhores? O corretor confirma o horário.", antes: "Claro! Qual dia e período ficam melhores para você? O corretor confirma o horário com você." },
    ],
  },
  // t_66ad4609: roteiro de teste (não é conversa ao vivo) para as regras 2 a 5 de Denis: sinal de interesse, \"agora
  // não\", não voltar a oferecer sem o cliente puxar o assunto e marcar na hora quando ele pede.
  {
    id: "L",
    lead: "teste-recusa",
    anuncio: "3806",
    ficha: ficha({
      tipo: "apartamento", bairro: "Jardim Vera Cruz", quartos: "3", suites: "1", banheiros: "2", vagas: "2", area_util_m2: "80",
      preco: "R$ 665.000", preco_valor: 665000, condominio: "R$ 550,00", iptu: "R$ 54,00 por mês",
      link: "https://vipsevenimoveis.com.br/imovel/3806",
    }),
    primeira:
      "Oi, Denis! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse no apartamento de 3 quartos no bairro Jardim Vera Cruz, em Sorocaba, anunciado por R$ 665.000. Anúncio: https://vipsevenimoveis.com.br/imovel/3806 Quer saber mais detalhes ou já prefere agendar uma visita?",
    falas: [
      { cliente: "qual o valor do condominio?", esperado: "R$ 550, sem convite de visita.", antes: null },
      { cliente: "gostei, tem quantas vagas?", esperado: "2 vagas; pode convidar para a visita (gostou + vaga).", antes: null },
      { cliente: "agora nao, e o iptu?", esperado: "IPTU R$ 54, sem convite.", antes: null },
      { cliente: "aceita financiamento?", esperado: "O corretor confirma; sem convite (o cliente recusou).", antes: null },
      { cliente: "gostei bastante do ap", esperado: "Sem convite (o cliente recusou e não puxou o assunto).", antes: null },
      { cliente: "quero visitar sabado de manha", esperado: "Anota sábado de manhã e passa ao corretor.", antes: null },
    ],
  },
];

// --- Buscas simuladas sobre o ESTOQUE_ZZ (mesmas regras das funções do banco, em memória) ---------------

const sem = (x: ImovelParecido & { preco_valor?: number; tipo_xml?: string; busca_texto?: string; so_anuncio?: string }): ImovelParecido => {
  const { preco_valor: _p, tipo_xml: _t, busca_texto: _b, so_anuncio: _s, ...r } = x;
  return r;
};
const num = (s?: string) => (s && /^\d+$/.test(s) ? Number(s) : 0);
const sN = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** lead_ia_imoveis_parecidos: mesmo tipo e cidade do anúncio, ±15% do preço, mais perto do preço primeiro. */
export function buscasReferencia(c: ConversaReferencia) {
  const ESTOQUE_ZZ = ESTOQUE_TODO.filter((x) => !x.so_anuncio || x.so_anuncio === c.anuncio);
  const ref = ESTOQUE_ZZ.find((x) => x.codigo === c.anuncio);
  const pref = c.ficha.preco_valor ?? ref?.preco_valor ?? 0;
  const fora = (cod: string, ex: string[]) => cod === c.anuncio || ex.includes(cod);
  const qref = num(c.ficha.quartos);
  const tref = ref?.tipo_xml ?? ref?.tipo;
  const mesmoB = (a?: string, b?: string | null) => !!a && !!b && sN(a) === sN(b);
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
          (!f.mais_barato || x.preco_valor < pref) &&
          // t_37cf21e3 (migration 20261028000000): quartos ±1 e filtro de bairro.
          (!qref || (num(x.quartos) > 0 && Math.abs(num(x.quartos) - qref) <= 1)) &&
          (!f.bairro || mesmoB(x.bairro, f.bairro)),
      )
        .sort(
          (a, b) =>
            Number(mesmoB(b.bairro, c.ficha.bairro)) - Number(mesmoB(a.bairro, c.ficha.bairro)) ||
            Math.abs(num(a.quartos) - qref) - Math.abs(num(b.quartos) - qref) ||
            Number((b.tipo_xml ?? b.tipo) === tref) - Number((a.tipo_xml ?? a.tipo) === tref) ||
            Math.abs(a.preco_valor - pref) - Math.abs(b.preco_valor - pref),
        )
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
          (!f.bairro || sN(x.bairro ?? "").includes(sN(f.bairro))) &&
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
    // t_228659f0: lead_ia_imoveis_nome (migration 20261028100000): nome inteiro no título/descrição/bairro, sem
    // distinguir maiúsculas nem acentos, mais barato primeiro, até 3.
    buscarNome: async (f: FiltroNome): Promise<ResultadoParecidos> => {
      const n = ` ${sN(f.nome).replace(/[^a-z0-9]+/g, " ").trim()} `;
      return {
        referencia: {},
        itens: ESTOQUE_ZZ.filter(
          (x) => !(f.excluir ?? []).includes(x.codigo) && ` ${sN(`${x.busca_texto ?? ""} ${x.bairro ?? ""}`).replace(/[^a-z0-9]+/g, " ")} `.includes(n),
        )
          .sort((a, b) => a.preco_valor - b.preco_valor)
          .slice(0, f.limite ?? 3)
          .map(sem),
      };
    },
    // lead_ia_imoveis_busca: faixa min/max, tipo, região; mais perto do meio da faixa primeiro (t_33fb109d: antes
    // ignorava o preço mínimo e a ordem, e a simulação mostrava casa de R$ 645 mil para "casa perto de R$ 850 mil").
    buscarImoveis: async (f: FiltroBusca): Promise<ResultadoParecidos> => {
      const alvo = f.preco_min != null && f.preco_max != null ? (f.preco_min + f.preco_max) / 2 : (f.preco_max ?? f.preco_min ?? null);
      return {
        referencia: {},
        itens: ESTOQUE_ZZ.filter(
          (x) =>
            !fora(x.codigo, f.excluir) &&
            (!f.tipo || x.tipo === f.tipo) &&
            (!f.regiao || `${x.bairro} ${x.cidade}`.toLowerCase().includes(f.regiao.toLowerCase().slice(0, 6))) &&
            (!f.preco_min || x.preco_valor >= f.preco_min) &&
            (!f.preco_max || x.preco_valor <= f.preco_max),
        )
          .sort((a, b) => (alvo == null ? 0 : Math.abs(a.preco_valor - alvo) - Math.abs(b.preco_valor - alvo)))
          .slice(0, f.limite ?? 1)
          .map(sem),
      };
    },
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
