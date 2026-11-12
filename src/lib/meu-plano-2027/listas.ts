/**
 * Listas fixas das telas do Meu Plano 2027, usadas pela tela (telas.tsx) e pelo PDF (pdf-conteudo.ts).
 * Movidas de src/components/minha-carreira/meu-plano/telas.tsx sem mudar nenhum texto (t_65edd0b0).
 */

export const SEMANAS = [
  {
    t: "SEMANA 1 — Me preparar",
    itens: [
      "CRECI e cadastro na unidade em dia",
      "Foto profissional, cartão e assinatura de e-mail no padrão REMAX",
      "Acesso ao iList e ao MaxCenter funcionando",
      "Estudar a Cartilha Corretor - Introdução até Passo 1 - Posicionamento",
      "Mensagem sobre a nova carreira para 20 pessoas da agenda, por dia",
      "Reuniões da imobiliária, inscrição no FIC, aulas da Universidade REMAX",
      "Definir com o broker a minha região de posicionamento",
    ],
  },
  {
    t: "SEMANA 2 — Conhecer a minha região",
    itens: [
      "Continuar as 20 mensagens por dia",
      "Configurar o Instagram (bio) e o WhatsApp Business",
      "Posicionamento: visitar os comércios da região e me apresentar",
      "Listar os imóveis à venda na região, inclusive os vendidos pelo proprietário",
      "Mapear a região com as fichas de pesquisa de posicionamento",
      "Acompanhar um colega em uma primeira visita (V1)",
    ],
  },
  {
    t: "SEMANA 3 — Ativar a minha rede",
    itens: [
      "Montar a minha lista FROG e cadastrar no CRM",
      "Continuar as 20 mensagens por dia",
      "Entregar a carta aos vizinhos na minha região",
      "Montar o meu dossiê do corretor",
      "Ações diárias de posicionamento",
      "Direct para 10 pessoas do Instagram por dia",
      "3 contatos por dia com “à venda pelo proprietário”",
    ],
  },
  {
    t: "SEMANA 4 — Ir a mercado",
    itens: [
      "Agendar e realizar a minha primeira V1",
      "Montar a minha primeira ACM e validar com o broker",
      "Treinar a V2 em role-play com o broker",
      "Revisar as 4 semanas com o meu parceiro de cobrança",
    ],
  },
];
export const MARCOS_CAPT = [
  "Primeira visita (V1) realizada, com o dossiê do corretor",
  "Segunda visita (V2): Plano de Marketing e Venda apresentado e ACM validada com o broker",
  "CRE assinada por todos os proprietários",
  "Documentação do imóvel e dos proprietários validada",
  "Home staging, fotos profissionais e dossiê do imóvel prontos",
  "Imóvel cadastrado no iList e publicado nos portais",
  "Placa, carta aos vizinhos e parceria 50/50 ativadas",
  "Feedback semanal e régua de revisão agendados",
];
export const MARCOS_VENDA = [
  "Primeira visita de comprador realizada, com ficha de visita",
  "Primeira proposta formalizada por escrito",
  "Proposta aceita e condições registradas",
  "Contrato de compra e venda assinado",
  "Comissão recebida",
];
export const MESES = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];
export const BLOCOS_SEMANA: [string, string][] = [
  [
    "Posicionamento e prospecção",
    "Presença na região (mín. 1h/dia), lista FROG, FSBO, ligações e agendamentos",
  ],
  ["Visitas ao proprietário", "V1, V2, preparo do Plano de Marketing e Venda e da ACM"],
  ["Atendimento ao comprador", "Visitas com compradores, propostas, negociação"],
  [
    "Acompanhamento e revisão",
    "Relatório semanal ao proprietário, imóveis parados, revisão de preço",
  ],
];
/** Linhas do acompanhamento semanal (p44); campo ac.<linha>.<semana>. */
export const ATIVIDADES_SEMANA = [
  "Contatos com agendamento",
  "Primeiras visitas (V1)",
  "Segundas visitas (V2)",
  "CREs assinadas",
  "Imóveis com preço revisado",
  "Visitas com compradores",
  "Propostas formalizadas",
  "Transações fechadas",
  "Pontos da regra dos 4 pontos",
];
