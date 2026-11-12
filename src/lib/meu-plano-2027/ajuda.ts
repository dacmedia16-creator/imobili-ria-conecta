/**
 * Meu Plano 2027: textos da bolinha "i" (como preencher) de cada parte dos exercícios.
 * Arquivo único para revisar e trocar texto sem mexer no desenho (Denis, 12/11).
 *
 * `fonte` = de onde veio o texto: página impressa do Book (e PDF), ou "texto nosso" quando o material
 * não explica como preencher e escrevemos só o óbvio do campo. Não vai para a tela; serve para revisão.
 * Regras: nada de regra, número ou orientação que não esteja no material; não repetir a introdução da
 * tela nem uma explicação que já esteja visível.
 */
export type Ajuda = { nome: string; t: string; fonte: string };

export const AJUDA = {
  // ── Diagnóstico ──────────────────────────────────────────────────────────────
  "p15.indicadores": {
    nome: "Meu ano em números",
    t: "Lance os números dos seus últimos 12 meses. Se você usa o iList, eles já vêm preenchidos: os que têm “✔ o ADM MAX traz” vêm do sistema; os outros você confere ou digita.",
    fonte: "Book pág. 14 (PDF 15); a parte dos selos é texto nosso",
  },
  "p16.origens": {
    nome: "Tabela de origens",
    t: "Em “Captações vendidas”, quantos imóveis captados por você e vendidos vieram de cada origem; em “Clientes compradores”, quantos compradores. O iList mostra de onde veio cada captação vendida e cada comprador.",
    fonte: "Book pág. 15 (PDF 16); a 1ª frase é texto nosso",
  },
  "p16.top3": {
    nome: "Minhas 3 maiores origens",
    t: "Saem sozinhas da tabela acima. As demais frentes de prospecção continuam ativas, com algum avanço toda semana.",
    fonte: "Book pág. 15 (PDF 16); a 1ª frase é texto nosso",
  },
  "p17.notas": {
    nome: "Notas das 6 afirmações",
    t: "Toque na nota de cada afirmação; o total (6 a 30) e o resultado aparecem sozinhos. Cada armadilha do resultado corresponde à afirmação de mesmo número.",
    fonte: "Book pág. 16 (PDF 17); a 1ª frase é texto nosso",
  },
  // ── Passo 1 ──────────────────────────────────────────────────────────────────
  "p20.perguntas": {
    nome: "As 7 perguntas",
    t: "Responda com as suas palavras. Embaixo de cada pergunta está a justificativa do book, que explica por que ela importa.",
    fonte: "Book pág. 19 (PDF 20)",
  },
  "p20.frase": {
    nome: "A frase que sustenta o plano",
    t: "Com base nas respostas anteriores, resuma o seu principal porquê em uma frase. Essa síntese consolida as suas reflexões e a essência das suas motivações e aspirações.",
    fonte: "Book pág. 19 (PDF 20)",
  },
  // ── Passo 2 ──────────────────────────────────────────────────────────────────
  "p22.orcamento": {
    nome: "Meu orçamento pessoal",
    t: "Em cada grupo, lance o valor do mês; a descrição embaixo do nome diz o que entra. Exemplo do book: Casa R$ 3.450 · Transporte R$ 760 · Saúde R$ 1.080, total mensal de R$ 8.570.",
    fonte: "Book pág. 21 (PDF 22)",
  },
  "p23.orcamento": {
    nome: "Meu orçamento do negócio",
    t: "Em cada grupo, lance o valor do mês; a descrição embaixo do nome diz o que entra. Exemplo do book: Locomoção R$ 980 · Marketing de venda R$ 1.350 · Portal Boost R$ 59,99, total mensal de R$ 3.359,99.",
    fonte: "Book pág. 22 (PDF 23)",
  },
  "p24.sonhos": {
    nome: "Meus sonhos",
    t: "Escreva o sonho e quanto ele custa no ano. Exemplo do book: trocar de carro (R$ 40.000), viagem em família (R$ 30.000), curso de especialização (R$ 5.000) = R$ 75.000.",
    fonte: "Book pág. 23 (PDF 24)",
  },
  "p25.aliq": {
    nome: "Minha alíquota de imposto",
    t: "Use a alíquota efetiva que você já paga hoje; se não souber, pergunte ao seu contador antes de fechar esta página. Exemplo do book: com 15%, um subtotal de R$ 218.159,88 vira R$ 256.658,68 no ano.",
    fonte: "Book pág. 24 (PDF 25)",
  },
  // ── Passo 3 ──────────────────────────────────────────────────────────────────
  "p27.conta": {
    nome: "Da comissão à transação",
    t: "As linhas 3, 6 e 7 são calculadas. Exemplo do book: R$ 256.658,68 ÷ 45% = R$ 570.352,62; R$ 700.000 × 3% = R$ 21.000; R$ 570.352,62 ÷ R$ 21.000 = 28 transações.",
    fonte: "Book pág. 26 (PDF 27); a 1ª frase é texto nosso",
  },
  "p27.faixa": {
    nome: "Minha faixa de comissionamento",
    t: "A faixa vai de 40% a 70%, conforme maturidade profissional e volume de vendas: 40% início de carreira · 45% crescimento · 60% performance sólida · 70% máxima comissão.",
    fonte: "Book pág. 26 (PDF 27)",
  },
  "p27.ticket": {
    nome: "Meu ticket médio",
    t: "O valor médio das suas transações vendidas, o mesmo do diagnóstico (Meu ano em números). Exemplo do book: R$ 700.000.",
    fonte: "Book págs. 14 e 26 (PDF 15 e 27)",
  },
  "p27.pct": {
    nome: "Percentual de comissão por transação",
    t: "O percentual de comissão que você recebe em cada transação. Exemplo do book: 3%.",
    fonte: "Book pág. 26 (PDF 27); a 1ª frase é texto nosso",
  },
  "p27.proxima": {
    nome: "Minha próxima faixa e meu clube",
    t: "Escolha a faixa que você quer alcançar e o Clube de Corretores que quer conquistar em 2027. Os clubes são a premiação internacional da REMAX, pelo faturamento do ano civil anterior (tabela na pág. 27).",
    fonte: "Book págs. 26 e 27 (PDF 27 e 28)",
  },
  "p30.conta": {
    nome: "Da transação à captação",
    t: "A linha 1 vem da tela anterior; você só lança a conversão. Exemplo do book: 28 transações ÷ 22% = 127 captações no ano, 11 por mês.",
    fonte: "Book pág. 29 (PDF 30); a 1ª frase é texto nosso",
  },
  "p30.conv": {
    nome: "Minha conversão da captação",
    t: "Quantas das suas CREs viram venda, em % (CREs vendidas ÷ total de CREs): o mesmo número do diagnóstico. Exemplo do book: 22%.",
    fonte: "Book págs. 14 e 29 (PDF 15 e 30)",
  },
  "p31.carteira": {
    nome: "Quantas CREs ativas quero manter",
    t: "Escreva quantas CREs ativas você quer manter ao longo de 2027. A régua das CREs ativas, no fim desta tela, mostra a situação do negócio em cada faixa (ex.: 16 a 18 = negócio feliz).",
    fonte: "Book pág. 30 (PDF 31)",
  },
  "p31.alvo": {
    nome: "Onde eu quero estar",
    t: "Marque uma das três faixas. Cada uma corresponde a uma linha da régua das CREs ativas, no fim desta tela.",
    fonte: "Book pág. 30 (PDF 31); a ligação com a régua é texto nosso",
  },
  "p31.conta": {
    nome: "Confira a sua conta",
    t: "Captações por mês × meses que cada imóvel fica na sua carteira ≈ CREs ativas. Lance quantos meses, em média, um imóvel fica na sua carteira.",
    fonte: "Book pág. 30 (PDF 31); a 2ª frase é texto nosso",
  },
  "p32.cres": {
    nome: "Metas de CREs",
    t: "Como calcular: estoque = imóveis ativos no início + novos − cancelados/expirados − vendidos.",
    fonte: "Book pág. 31 (PDF 32)",
  },
  "p32.vgc": {
    nome: "Metas de VGC",
    t: "Como calcular: transações = captação + venda; VGC = transações × comissão média por transação.",
    fonte: "Book pág. 31 (PDF 32)",
  },
  "p11.acoes": {
    nome: "Ações principais",
    t: "KRI é o resultado-chave; KPI é o indicador de desempenho. Em cada KPI, escreva as ações do dia a dia que movem esse número. Exemplo do book para Novas CREs: contatos com agendamento, primeira visita (V1) e segunda visita (V2).",
    fonte: "Book pág. 10 (PDF 11)",
  },
  // ── Passo 4 ──────────────────────────────────────────────────────────────────
  "p34.regiao": {
    nome: "Região",
    t: "Comece pela região escolhida para construir relacionamento ou pelo posicionamento da sua imobiliária. Lance também quanto da sua carteira está hoje na região e a meta para o fim de 2027 (%).",
    fonte: "Book pág. 33 (PDF 34)",
  },
  "p34.tipo": {
    nome: "Tipo de imóvel",
    t: "O tipo de imóvel em que você quer ser referência. O padrão do bairro já delimita boa parte dessa escolha; quem se posiciona bem, inevitavelmente se especializa.",
    fonte: "Book pág. 33 (PDF 34)",
  },
  "p34.ticket": {
    nome: "Ticket médio",
    t: "A faixa de preço em que você quer atuar (de R$ … a R$ …) e quanto da sua carteira você quer nesse tipo e nessa faixa no fim de 2027 (%).",
    fonte: "Book pág. 33 (PDF 34)",
  },
  // ── Passo 5 ──────────────────────────────────────────────────────────────────
  "p36.horas": {
    nome: "Horas por bloco",
    t: "Em cada bloco, lance as horas por semana; a descrição embaixo do nome diz o que entra. Posicionamento e prospecção pede presença na região de no mínimo 1 hora por dia.",
    fonte: "Book pág. 35 (PDF 36)",
  },
  "p36.dia": {
    nome: "Meu dia de revisão de estoque",
    t: "Marque o dia e trate como reunião com cliente: não se desmarca. É o único bloco que ninguém vai cobrar de você e é o que mais muda o seu ano.",
    fonte: "Book pág. 35 (PDF 36) (a 1ª frase estava visível na tela e foi movida para a bolinha)",
  },
  "p37.v2cre": {
    nome: "Quantas V2 viram CRE",
    t: "Lance, em %, quantas das suas segundas visitas (V2) viram CRE. A conta do book: V2 por mês = CREs por mês ÷ essa taxa.",
    fonte: "Book pág. 36 (PDF 37)",
  },
  "p37.v1v2": {
    nome: "Quantas V1 viram V2",
    t: "Lance, em %, quantas das suas primeiras visitas (V1) viram V2. A conta do book: V1 por mês = V2 por mês ÷ essa taxa.",
    fonte: "Book pág. 36 (PDF 37)",
  },
  "p37.folga": {
    nome: "Taxa de folga",
    t: "É uma taxa, não o resultado: acrescenta contatos extras para cobrir quem desmarca. A conta do book: contatos por semana = V1 por mês ÷ 4 semanas, com folga para quem desmarca.",
    fonte:
      "Book pág. 36 (PDF 37); a 1ª frase é texto nosso, que estava visível na tela e foi movido para a bolinha",
  },
  "p37.frog": {
    nome: "Minha lista FROG",
    t: "FROG+C: Família, Relacionamentos, Organizações e Geografia, com os clientes que você já atendeu. Cadastre todos no CRM com a origem do contato e avise a todos que você é corretor REMAX.",
    fonte: "Book pág. 36 (PDF 37) (substitui a legenda que estava visível na tela)",
  },
  "p38.compromissos": {
    nome: "Meus compromissos de revisão",
    t: "Complete as três frases. O ritual de revisão acontece no mesmo dia escolhido na sua semana padrão. Você não espera o proprietário pedir: você conduz.",
    fonte: "Book pág. 37 (PDF 38); “Complete as três frases” é texto nosso",
  },
  "p39.canais": {
    nome: "Canais de marketing",
    t: "Marque os canais em que vai concentrar o investimento e mantenha a prospecção viva em todas as outras frentes, com algum avanço toda semana. Converse com os corretores que têm mais sucesso e veja as iniciativas que eles utilizam.",
    fonte: "Book pág. 38 (PDF 39)",
  },
  "p39.invest": {
    nome: "Quanto vou investir por mês",
    t: "O valor por mês, em R$, que você vai investir nos canais escolhidos. Confira com o seu orçamento do negócio (pág. 22).",
    fonte: "Book pág. 38 (PDF 39); a 1ª frase é texto nosso",
  },
  "p40.aprender": {
    nome: "O que eu preciso aprender",
    t: "Para cada habilidade, escreva o número que ela melhora e onde vai aprender. Exemplo do book: apresentar a ACM com segurança · conversão da captação · Escola REMAX (role play).",
    fonte: "Book pág. 39 (PDF 40)",
  },
  "p40.agenda": {
    nome: "Minha agenda",
    t: "Em cada compromisso, escreva quando (ex.: terça, 9h às 10h) e reserve as horas por semana para aprender (ex.: 3 horas). Aprendeu, aplica na mesma semana.",
    fonte: "Book pág. 39 (PDF 40)",
  },
  // ── Passo 6 ──────────────────────────────────────────────────────────────────
  "p43.painel": {
    nome: "Meu painel mensal",
    t: "Cada coluna vem de uma página do plano: novas CREs (pág. 29), CREs ativas (pág. 30), CREs revisadas (pág. 37), transações e comissão (pág. 26).",
    fonte: "Book pág. 42 (PDF 43)",
  },
  "p44.semana": {
    nome: "Meu acompanhamento semanal",
    t: "Anote, a cada semana, quanto fez de cada atividade; o total sai sozinho. Se há muitos atendimentos e poucos agendamentos, o problema está na abordagem; se agendam mas não comparecem, há desalinhamento de expectativas.",
    fonte: "Book pág. 43 (PDF 44); a 1ª frase é texto nosso",
  },
  "p45.corretor": {
    nome: "Compromissos do corretor",
    t: "Escreva o seu nome e até 3 compromissos que você assume neste plano.",
    fonte: "texto nosso (o book só traz “Eu, ___, me comprometo a: 01 02 03”)",
  },
  "p45.broker": {
    nome: "Compromissos do broker",
    t: "Escreva o nome do seu broker e até 3 compromissos que ele assume com você.",
    fonte: "texto nosso (o book só traz “Eu, ___, me comprometo a: 01 02 03”)",
  },
  "p45.cadencia": {
    nome: "Nossa cadência de acompanhamento",
    t: "Marque a frequência, o dia da semana e a hora em que você e o seu broker vão se encontrar.",
    fonte: "texto nosso (o book só traz “semanal quinzenal mensal sempre às ___, às ___ h”)",
  },
  // ── Trilha Ativação ──────────────────────────────────────────────────────────
  "p49.datas": {
    nome: "Minhas datas-alvo",
    t: "Escolha as datas no calendário. A primeira venda pode chegar antes da sua captação vender: parceria 50/50 com colegas e atendimento a compradores também contam.",
    fonte: "Book pág. 46 (PDF 49); a 1ª frase é texto nosso",
  },
  "p49.apoio": {
    nome: "Parceiro e aprendizado",
    t: "Escreva quem vai cobrar você nesse período (um colega ou o broker) e o que você precisa aprender nos próximos 30 dias.",
    fonte: "texto nosso (o book só traz os dois campos)",
  },
  "p50.semana": {
    nome: "Itens da semana",
    t: "Marque cada item quando fizer. O contador ao lado do título mostra quantos itens desta semana você já marcou.",
    fonte: "texto nosso (o book só traz a lista)",
  },
  "p51.captacao": {
    nome: "Marcos da primeira captação",
    t: "Marque cada marco quando acontecer e anote a data da sua primeira captação.",
    fonte: "texto nosso (o book só traz a lista e a data)",
  },
  "p51.venda": {
    nome: "Marcos da primeira venda",
    t: "Marque cada marco quando acontecer e anote a data da sua primeira venda.",
    fonte: "texto nosso (o book só traz a lista e a data)",
  },
} satisfies Record<string, Ajuda>;

export type IdAjuda = keyof typeof AJUDA;
