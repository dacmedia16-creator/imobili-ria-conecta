/**
 * Meu Plano 2027: lista das telas (1 página de exercício do book = 1 tela), ordem de cada trilha,
 * campos obrigatórios e progresso. Só dados e funções puras; o desenho de cada tela fica em
 * src/components/minha-carreira/meu-plano/telas.tsx (mesmo id).
 */
import { AFIRMACOES, NEGOCIO, PESSOAL, calc, cheio, ok, type Respostas } from "./regras";

export const ANO_PLANO = 2027;
export type Trilha = "ativacao" | "planejamento";

export type Tela = {
  id: string;
  /** Página do PDF (1..56). A página impressa no book é pdf − 1. */
  pdf: number;
  ev: string;
  t: string;
  trilhas: Trilha[];
  intro: string;
  /** Campos que contam para "tela completa" e para o % do plano. */
  req: string[];
  /** Páginas "Leia antes" (ids de LEIA em book.ts), recolhidas. */
  leia?: string[];
  recorrente?: boolean;
  /** Prefixo dos campos livres (telas sem obrigatório), para o selo "preenchida". */
  livre?: string;
};

export const P15_CAMPOS: [string, string, "money" | "int" | "pct", "tem" | "parc" | "nao"][] = [
  ["d.comissao", "Comissão recebida", "money", "tem"],
  ["d.trans", "Transações fechadas*", "int", "tem"],
  ["d.cres", "Captações com representação exclusiva (CREs)", "int", "tem"],
  ["d.conv", "Conversão das CREs (vendidas ÷ total)", "pct", "parc"],
  ["d.ticket", "Ticket médio das transações vendidas", "money", "tem"],
  ["d.dias", "Dias medianos entre captar e vender", "int", "parc"],
  ["d.ativos", "Imóveis ativos na carteira hoje", "int", "tem"],
  ["d.revisados", "% da carteira que teve o preço revisado", "pct", "nao"],
];

const A: Trilha[] = ["ativacao"];
const P: Trilha[] = ["planejamento"];
const AP: Trilha[] = ["ativacao", "planejamento"];

export const TELAS: Tela[] = [
  {
    id: "p15",
    pdf: 15,
    ev: "Diagnóstico · Onde eu estou",
    t: "Meu ano em números",
    trilhas: P,
    intro:
      "Estes oito números são o seu ponto de partida (só venda, sem locação). No book eles vêm “preenchidos pelo sistema”: aqui o ADM MAX traz os que já tem.",
    req: P15_CAMPOS.map((x) => x[0]),
  },
  {
    id: "p16",
    pdf: 16,
    ev: "Diagnóstico · Onde eu estou",
    t: "De onde vieram meus negócios",
    trilhas: P,
    intro:
      "Nos últimos 12 meses, de onde vieram os negócios que você fechou? Anote a quantidade nas origens que geraram negócio.",
    req: ["or.0.c"],
  },
  {
    id: "p17",
    pdf: 17,
    ev: "Diagnóstico · Onde eu estou",
    t: "Onde eu estou hoje",
    trilhas: P,
    intro:
      "Pensando no seu último ano, dê uma nota de 1 a 5 para cada afirmação. 1 = discordo totalmente · 5 = concordo totalmente.",
    req: AFIRMACOES.map((_, i) => `av.${i}`),
  },
  {
    id: "p20",
    pdf: 20,
    ev: "Passo 1 · Aspirações",
    t: "Meu porquê",
    trilhas: AP,
    leia: ["porque"],
    intro:
      "Saber o seu “porquê” é mais importante do que saber o seu “como”. Responda o que quiser das 7 perguntas; a única obrigatória é a frase final.",
    req: ["pq.frase"],
  },
  {
    id: "p22",
    pdf: 22,
    ev: "Passo 2 · Meu número",
    t: "Meu orçamento pessoal",
    trilhas: AP,
    intro:
      "Estime o gasto mensal de cada grupo. Não busque exatidão, busque ordem de grandeza. Despesa anual entra dividida por 12 (IPVA de R$ 1.200 = R$ 100/mês).",
    req: PESSOAL.map((_, i) => `op.${i}`),
  },
  {
    id: "p23",
    pdf: 23,
    ev: "Passo 2 · Meu número",
    t: "Meu orçamento do negócio",
    trilhas: AP,
    intro:
      "O que custa manter o seu negócio rodando, por mês. Nenhum orçamento nasce perfeito: comece pela estimativa e corrija conforme acompanha.",
    req: NEGOCIO.map((_, i) => `on.${i}`),
  },
  {
    id: "p24",
    pdf: 24,
    ev: "Passo 2 · Meu número",
    t: "Meus sonhos",
    trilhas: AP,
    intro:
      "Três coisas que você quer realizar em 2027 e que custam dinheiro. Sonho sem valor escrito é desejo. Sonho com valor escrito é meta.",
    req: ["so.0.t", "so.0.v"],
  },
  {
    id: "p25",
    pdf: 25,
    ev: "Passo 2 · Meu número",
    t: "O número do meu estilo de vida",
    trilhas: AP,
    intro:
      "A soma das despesas pessoais, do negócio e dos sonhos, já com o imposto. É o número que sustenta todo o resto do plano.",
    req: ["es.aliq"],
  },
  {
    id: "p27",
    pdf: 27,
    ev: "Passo 3 · Onde eu quero chegar",
    t: "Da comissão à transação",
    trilhas: AP,
    leia: ["clubes"],
    intro:
      "Agora o número da sua vida vira quantidade de transações. A linha 1 vem da tela anterior.",
    req: ["m.faixa", "m.ticket", "m.pct"],
  },
  {
    id: "p30",
    pdf: 30,
    ev: "Passo 3 · Onde eu quero chegar",
    t: "Da transação à captação",
    trilhas: AP,
    intro: "Toda transação começa em uma captação. Esta é a conta mais importante do seu plano.",
    req: ["m.conv"],
  },
  {
    id: "p31",
    pdf: 31,
    ev: "Passo 3 · Onde eu quero chegar",
    t: "Minha carteira alvo",
    trilhas: AP,
    intro:
      "Captar é um fluxo. Carteira é um estoque. O indicador mais direto da saúde do seu negócio é o volume de CREs ativas.",
    req: ["m.alvo"],
  },
  {
    id: "p32",
    pdf: 32,
    ev: "Passo 3 · Onde eu quero chegar",
    t: "Minhas metas para 2027",
    trilhas: AP,
    intro:
      "O objetivo do ano em uma frase. Os números já vêm das telas anteriores (sugestão do sistema); ajuste se quiser. No fim, um toque transforma isso na sua meta oficial de 2027.",
    req: ["mt.creFim"],
  },
  {
    id: "p34",
    pdf: 34,
    ev: "Passo 4 · Onde eu jogo",
    t: "Meu posicionamento",
    trilhas: P,
    intro:
      "Comece pela região; dentro dela, escolha o tipo de imóvel e a faixa de preço em que você converte mais. A essência da estratégia é definir o que não será feito.",
    req: ["pos.regiao", "pos.tipo", "pos.de", "pos.ate"],
  },
  {
    id: "p36",
    pdf: 36,
    ev: "Passo 5 · Como eu executo",
    t: "Minha semana padrão",
    trilhas: P,
    intro:
      "Distribua as suas horas úteis entre os quatro blocos. A soma é o seu compromisso semanal. Plano que não vira semana não vira resultado.",
    req: ["sp.0", "sp.1", "sp.2", "sp.3", "sp.dia"],
  },
  {
    id: "p37",
    pdf: 37,
    ev: "Passo 5 · Como eu executo",
    t: "Meu funil de captação",
    trilhas: P,
    intro:
      "Toda CRE nasce de um funil: lead, atendimento, agendamento, V1, V2. Faça a conta de trás para frente; o sistema faz por você a partir das suas taxas.",
    req: [],
    livre: "fu.",
  },
  {
    id: "p38",
    pdf: 38,
    ev: "Passo 5 · Como eu executo",
    t: "Minha régua de revisão de preço",
    trilhas: P,
    intro:
      "A página mais importante do plano. Todo imóvel entra na régua no dia da assinatura da CRE: dia 30 leitura de mercado · dia 60 primeira revisão · dia 90 decisão com o proprietário.",
    req: ["rv.mes", "rv.dias", "rv.ritual"],
  },
  {
    id: "p39",
    pdf: 39,
    ev: "Passo 5 · Como eu executo",
    t: "Onde vou investir em marketing",
    trilhas: P,
    intro:
      "Suas três maiores origens do ano passado são o ponto de partida, não a lista de canais da moda. Escolha no máximo 3 canais.",
    req: ["mk.invest"],
  },
  {
    id: "p40",
    pdf: 40,
    ev: "Passo 5 · Como eu executo",
    t: "Minha agenda de desenvolvimento",
    trilhas: P,
    leia: ["buffini"],
    intro:
      "Quem aprende, evolui. Quem aplica, lucra. Escolha o que estudar a partir dos seus números mais fracos.",
    req: ["de.h.0", "de.horas"],
  },
  {
    id: "p43",
    pdf: 43,
    ev: "Passo 6 · Como eu acompanho",
    t: "Meu painel mensal",
    trilhas: P,
    recorrente: true,
    intro:
      "Cinco números, uma vez por mês. Leva dez minutos. A linha META DO ANO já vem do seu plano.",
    req: [],
  },
  {
    id: "p44",
    pdf: 44,
    ev: "Passo 6 · Como eu acompanho",
    t: "Meu acompanhamento semanal",
    trilhas: P,
    recorrente: true,
    intro:
      "No papel: “imprima ou copie esta página todo mês”. Aqui: a tabela da semana, com a meta já calculada pelo seu funil.",
    req: [],
    livre: "ac.",
  },
  {
    id: "p45",
    pdf: 45,
    ev: "Passo 6 · Como eu acompanho",
    t: "Meu pacto com o broker",
    trilhas: AP,
    intro:
      "Plano sem quem cobre é diário. Este pacto é o que transforma o seu plano em compromisso.",
    req: ["pa.nome", "pa.c.0", "pa.cad"],
  },
  {
    id: "p49",
    pdf: 49,
    ev: "Trilha Ativação · Para quem está começando",
    t: "Meus primeiros 90 dias",
    trilhas: A,
    leia: ["dados"],
    intro:
      "Não é faturamento, não é ranking, não é clube. A sua meta é uma só: A PRIMEIRA VENDA. Primeira CRE até o dia 45, três CREs até o dia 90.",
    req: ["d90.cre1", "d90.venda1", "d90.parceiro", "d90.aprender"],
  },
  {
    id: "p50",
    pdf: 50,
    ev: "Trilha Ativação · Para quem está começando",
    t: "Minhas 4 primeiras semanas",
    trilhas: A,
    intro: "Marque o que já fez. Você volta aqui durante o mês.",
    req: [],
    livre: "sem.",
  },
  {
    id: "p51",
    pdf: 51,
    ev: "Trilha Ativação · Para quem está começando",
    t: "Primeira captação e primeira venda",
    trilhas: A,
    intro:
      "Os marcos da primeira captação e da primeira venda. Quando fechar a primeira venda, faça o plano completo (trilha Planejamento).",
    req: [],
    livre: "mc.",
  },
  {
    id: "p52",
    pdf: 52,
    ev: "Fechamento",
    t: "Meu cockpit: meu plano em uma página",
    trilhas: AP,
    intro:
      "Tudo o que você decidiu, numa página só, montado automaticamente pelas suas respostas. Toque no número da página para corrigir na origem.",
    req: [],
  },
];

export const ORDEM: Record<Trilha, string[]> = {
  planejamento: [
    "p15",
    "p16",
    "p17",
    "p20",
    "p22",
    "p23",
    "p24",
    "p25",
    "p27",
    "p30",
    "p31",
    "p32",
    "p34",
    "p36",
    "p37",
    "p38",
    "p39",
    "p40",
    "p43",
    "p44",
    "p45",
    "p52",
  ],
  ativacao: [
    "p20",
    "p22",
    "p23",
    "p24",
    "p25",
    "p27",
    "p30",
    "p31",
    "p32",
    "p49",
    "p50",
    "p51",
    "p45",
    "p52",
  ],
};

export const TRILHAS: Record<Trilha, { n: string; quem: string; o: string; obj: string }> = {
  ativacao: {
    n: "Ativação",
    quem: "Quem está iniciando na REMAX",
    o: "Passos 1 a 3 e o bloco Ativação",
    obj: "A primeira venda",
  },
  planejamento: {
    n: "Planejamento",
    quem: "Quem já atua na REMAX",
    o: "O plano inteiro (Diagnóstico + Passos 1 a 6)",
    obj: "Meta financeira, território e rotina",
  },
};

const POR_ID = new Map(TELAS.map((t) => [t.id, t]));
export const tela = (id: string) => POR_ID.get(id);
export const telaDaPagina = (pdf: number) => TELAS.find((t) => t.pdf === pdf);

/** Rótulo da página com as duas numerações (Denis, 11/11): "pág. 19 · PDF 20". A capa (PDF 1) não tem número impresso. */
export const rotuloPagina = (pdf: number) =>
  pdf > 1 ? `pág. ${pdf - 1} · PDF ${pdf}` : `PDF ${pdf}`;

/** Páginas do book sem tela própria cujo exercício está em outra tela (PDF 11 "Ao final de 2027 eu terei…" → Metas). */
export const ATALHO_PAGINA: Record<number, string> = { 11: "p32" };
export const exercicioDaPagina = (pdf: number) =>
  ATALHO_PAGINA[pdf] ? tela(ATALHO_PAGINA[pdf]) : undefined;

/** Sem trilha escolhida (entrou pelo book ou por "Preencher esta página"), o resto do plano usa Planejamento. */
export const TRILHA_PADRAO: Trilha = "planejamento";

/**
 * Campo obrigatório que conta como preenchido mesmo vazio, porque a conta já usa uma sugestão válida
 * (diagnóstico ou telas anteriores). Só muda o % e o selo exibidos; nenhuma conta muda.
 */
function preenchido(k: string, S: Respostas, C: () => ReturnType<typeof calc>) {
  if (cheio(S[k])) return true;
  if (k === "m.ticket") return ok(C().ticket) && C().ticket > 0;
  if (k === "m.conv") return ok(C().conv) && C().conv > 0;
  if (k === "mt.creFim") return ok(C().creFim);
  return false;
}
const calcPreguicoso = (S: Respostas) => {
  let c: ReturnType<typeof calc> | null = null;
  return () => (c ??= calc(S));
};

export function progresso(S: Respostas, trilha: Trilha | null | undefined) {
  const ids = ORDEM[trilha ?? TRILHA_PADRAO];
  const C = calcPreguicoso(S);
  const req = ids.flatMap((id) => tela(id)!.req);
  const feitos = req.filter((k) => preenchido(k, S, C)).length;
  const telas = ids.filter((id) => {
    const st = statusTela(id, S);
    return st !== "vazio" && st !== "parc";
  }).length;
  return {
    pct: req.length ? Math.round((100 * feitos) / req.length) : 0,
    telas,
    total: ids.length,
  };
}

/** ok = preenchida; parc = em parte; vazio = nada; auto = tela automática (cockpit/painel). */
export function statusTela(id: string, S: Respostas): "ok" | "parc" | "vazio" | "auto" | null {
  const p = tela(id);
  if (!p) return null;
  if (p.req.length) {
    const C = calcPreguicoso(S);
    const f = p.req.filter((k) => preenchido(k, S, C)).length;
    return f === p.req.length ? "ok" : f > 0 ? "parc" : "vazio";
  }
  if (!p.livre) return "auto";
  return Object.keys(S).some((k) => k.startsWith(p.livre!) && cheio(S[k])) ? "ok" : "vazio";
}

/** Próxima/anterior dentro da trilha. Fora da trilha: volta para a escolha / vai ao fim. */
export function vizinhos(id: string, trilha: Trilha) {
  const ids = ORDEM[trilha];
  const i = ids.indexOf(id);
  return {
    i,
    total: ids.length,
    anterior: i > 0 ? ids[i - 1] : null,
    proxima: i >= 0 && i < ids.length - 1 ? ids[i + 1] : null,
  };
}

/** Só chaves de campo válidas para o banco (mesma regra de carreira_plano_salvar). */
export const CAMPO_VALIDO = /^[a-z0-9]{1,8}(\.[A-Za-z0-9]{1,12}){0,3}$/;
