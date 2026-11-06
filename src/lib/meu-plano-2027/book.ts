/**
 * Book Agent Summit 2027 (56 páginas). A REMAX autorizou exibir as páginas no sistema (Denis, 06/11/2026).
 * As imagens são arquivos estáticos em public/book-agent-summit-2027/p-NN.webp (900 px, ~3 MB no total),
 * fora do bundle JS; o navegador só baixa a página aberta (e pré-carrega a próxima).
 */
import { telaDaPagina } from "./telas";

export const TOTAL_PAGINAS = 56;
export const imagemPagina = (n: number) =>
  `/book-agent-summit-2027/p-${String(Math.min(TOTAL_PAGINAS, Math.max(1, n))).padStart(2, "0")}.webp`;

export const SECOES = [
  { n: "Capa e abertura", de: 1, ate: 13 },
  { n: "Diagnóstico", de: 14, ate: 17 },
  { n: "Passo 1 · Aspirações", de: 18, ate: 20 },
  { n: "Passo 2 · Meu número", de: 21, ate: 25 },
  { n: "Passo 3 · Onde quero chegar", de: 26, ate: 32 },
  { n: "Passo 4 · Onde eu jogo", de: 33, ate: 34 },
  { n: "Passo 5 · Como eu executo", de: 35, ate: 41 },
  { n: "Passo 6 · Como eu acompanho", de: 42, ate: 45 },
  { n: "Anotações", de: 46, ate: 47 },
  { n: "Trilha Ativação", de: 48, ate: 52 },
  { n: "Fechamento e agenda", de: 53, ate: 56 },
];

const TIT: Record<number, string> = {
  1: "Capa",
  2: "Nova Cartilha do Corretor (anúncio)",
  3: "Sumário",
  4: "Carta do Presidente",
  5: "Cultura REMAX",
  6: "O modelo REMAX: ciclo de crescimento",
  7: "O modelo REMAX: o seu resultado",
  8: "O crescimento do corretor REMAX",
  9: "Por que o Agent Summit pode mudar sua vida",
  10: "Planejamento: conceitos essenciais",
  11: "Como planejamos na REMAX",
  12: "As áreas do plano e o passo a passo",
  13: "Como usar este plano",
  14: "Diagnóstico (abertura)",
  18: "Passo 1 (abertura)",
  19: "Por que a busca pelo sucesso é importante",
  21: "Passo 2 (abertura)",
  26: "Passo 3 (abertura)",
  28: "Clubes de Corretores",
  29: "Noite 5 Estrelas (fotos)",
  33: "Passo 4 (abertura)",
  35: "Passo 5 (abertura)",
  41: "100 dias para o sucesso (anúncio)",
  42: "Passo 6 (abertura)",
  46: "Anotações",
  47: "Anotações",
  48: "Trilha Ativação (abertura)",
  53: "O corretor empreendedor REMAX",
  54: "Agenda 2027",
  55: "Loja REMAX (anúncio)",
  56: "Contracapa",
};
export const tituloPagina = (n: number) => telaDaPagina(n)?.t ?? TIT[n] ?? `Página ${n}`;
export const secaoDaPagina = (n: number) =>
  SECOES.find((s) => n >= s.de && n <= s.ate) ?? SECOES[0];

/** "Leia antes": páginas só de leitura, resumidas (pdf = página do PDF). */
export const LEIA: Record<string, { t: string; pdf: number; r: string }> = {
  carta: {
    t: "Carta do Presidente",
    pdf: 4,
    r: "“Consciência é a nova inteligência.” Saber e não fazer produz o mesmo resultado de não saber. Este book é um convite para transformar intenção em compromisso: o plano agora coloca estoque e captação no centro.",
  },
  cultura: {
    t: "Cultura REMAX",
    pdf: 5,
    r: "Missão: atingir nossos objetivos ajudando as outras pessoas a atingirem os delas. Propósito: “Inspirar vidas, construir histórias!”. Valores: honestidade, parceria, foco, aprendizado, compromisso, excelência, resiliência.",
  },
  modelo: {
    t: "Como o modelo REMAX impulsiona o seu crescimento",
    pdf: 8,
    r: "O ciclo: capta certo → revisa o preço quando preciso → gira o estoque → fatura todo mês → fica e cresce. A transação paga o mês; a repetição muda o seu percentual (de 40% a 70%).",
  },
  dados: {
    t: "O que a rede aprendeu em 2026",
    pdf: 9,
    r: "Quem vende nos 6 primeiros meses fica 13 meses (quem não vende, 5). Imóvel no posicionamento vende 45% mais e 25 dias mais rápido. Quem revisa preço após 90 dias vende 6 em 10; quem não revisa, 3. Um trimestre sem comissão = 1,5× mais chance de sair.",
  },
  conceitos: {
    t: "Planejamento: conceitos essenciais",
    pdf: 10,
    r: "“Planejar é decidir onde queremos chegar, como chegar e com quais recursos.” A essência da estratégia é definir o que não será feito.",
  },
  como: {
    t: "Como planejamos na REMAX + KRIs e KPIs",
    pdf: 11,
    r: "Diagnóstico → Objetivo → Estratégia e plano → Execução. Dois resultados-chave: KRI 1 = CREs; KRI 2 = VGC. Os KPIs (novas CREs, canceladas, vendidas, transações de captação e de venda, ticket médio) ligam o objetivo às ações do dia.",
  },
  areas: {
    t: "As áreas do plano e o passo a passo",
    pdf: 12,
    r: "Diagnóstico · Passo 1 Meu porquê · Passo 2 Meu número · Passo 3 Minha meta · Passo 4 Onde eu jogo · Passo 5 Como eu executo · Passo 6 Como eu acompanho · Trilha Ativação.",
  },
  porque: {
    t: "Por que a busca pelo sucesso é importante para você?",
    pdf: 19,
    r: "Imagine um cenário onde dinheiro não é mais uma preocupação: o que mudaria? Que sonhos realizaria? “Quem tem um porquê para viver pode suportar quase qualquer como.” Não é sobre levantar parede, é sobre construir catedral.",
  },
  clubes: {
    t: "Clubes de Corretores",
    pdf: 28,
    r: "Premiação pelo faturamento do ano civil anterior: Executive a partir de R$ 173.010 · 100% a partir de R$ 346.021 · Platinum R$ 865.052 · Chairman's R$ 1.730.104 · Titan R$ 2.595.156 · Diamond R$ 3.460.208 · Pinnacle R$ 6.920.415.",
  },
  buffini: {
    t: "100 dias para o sucesso (anúncio)",
    pdf: 41,
    r: "Mais de 70% dos top producers REMAX já fizeram o programa de Brian Buffini. (Página de propaganda.)",
  },
  empreendedor: {
    t: "O corretor empreendedor REMAX",
    pdf: 53,
    r: "O corretor REMAX é empresário, não empregado: controla o próprio destino, tem um plano escrito e faz o telefone tocar com marketing proativo.",
  },
  agenda: {
    t: "Agenda 2027 (eventos)",
    pdf: 54,
    r: "The Winners (Toronto, 15–19/2) · R4 (Las Vegas, 21–24/2) · C7 Brazil & Friends (SP, 19–21/5) · eventos online: Kick Off 28/01, Max Evolution e Agent Summit Review trimestrais · Agent Summit 2028 em 18 e 19/11/27.",
  },
  loja: {
    t: "Loja REMAX (anúncio)",
    pdf: 55,
    r: "Vista REMAX: remaxstore.com.br. (Página de propaganda.)",
  },
};
