// E-mail de boas-vindas do MAX HUB — TEXTO (único lugar para editar o conteúdo).
//
// PARA TROCAR O TEXTO: edite só este arquivo. O layout (render.ts) não precisa mudar.
// Variáveis disponíveis (trocadas na hora, sempre com escape de HTML):
//   {{primeiroNome}}  {{imobiliaria}}  {{email}}
// Linhas do texto puro (versão sem HTML) são geradas a partir destes mesmos campos.

export const LINKS = {
  app: "https://app.somosmaxhub.com.br/",
  capa: "https://somosmaxhub.com.br/og-maxhub.png",
};

export const CONTEUDO = {
  assunto: "Bem-vindo ao UniHub, {{primeiroNome}}",
  preheader: "Seu acesso na {{imobiliaria}} já está liberado.",
  saudacao: "Olá, {{primeiroNome}}!",
  abertura:
    "A {{imobiliaria}} liberou seu acesso ao UniHub. Com um único login, você entra em todos os sistemas MAX.",
  botao: "Entrar no UniHub",
  loginGoogle: "Entre com a sua conta Google:",
  tituloRecursos: "O que você encontra lá:",
  recursos: [
    {
      nome: "ADM MAX",
      descricao: "vendas, contratos e comissões, do cadastro do imóvel até a comissão recebida.",
    },
    {
      nome: "Estudo de Mercado MAX",
      descricao: "análise de mercado do imóvel para apoiar a captação.",
    },
    {
      nome: "Visita MAX",
      descricao: "registra e protege a visita, e o proprietário recebe o retorno do comprador.",
    },
    { nome: "Ache um Especialista", descricao: "encontre corretores por região." },
    {
      nome: "Reserva de Sala",
      descricao: "reserve a sala da unidade e receba o lembrete no WhatsApp.",
    },
  ],
  emBreve: "Em breve: Academia MAX, 60 Dias MAX, Recruta MAX e Locação MAX.",
  duvidas: "Dúvidas? Fale com o gestor da sua imobiliária.",
  assinatura: "Equipe UniHub",
  slogan: "Sistemas feitos por quem faz imobiliária no dia a dia.",
  rodape: "Este é um e-mail automático. Por favor, não responda.",
  /** Texto alternativo da capa (aparece se a imagem não carregar). */
  altCapa: "UniHub — todos os sistemas MAX em um só lugar",
  /** Valores usados quando a variável vier vazia. */
  padroes: { primeiroNome: "corretor(a)", imobiliaria: "sua imobiliária" },
};

export type ConteudoBoasVindas = typeof CONTEUDO;
