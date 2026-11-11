/**
 * Meu Plano 2027 (cartão t_1ac2e95d; maquete v3 aprovada por Denis em 06/11/2026). Fórmulas do book
 * Agent Summit 2027, puras (nada aqui lê o banco). As contas foram conferidas na maquete com os números
 * de exemplo impressos no próprio book; meu-plano-2027.test.ts repete essas 12 contas.
 * Os números citados como "p.N" são a página impressa do book (a página do PDF é N + 1).
 */

export type Valor = string | boolean | number | null | undefined;
export type Respostas = Record<string, Valor>;

/** Número digitado no padrão brasileiro: "3.450", "3450,50", "R$ 59,99", "15%". Vazio/inválido = NaN. */
export function num(v: Valor): number {
  if (v === undefined || v === null || typeof v === "boolean") return NaN;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let s = String(v)
    .trim()
    .replace(/R\$|\s|%/g, "");
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
export const ok = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
export const soma = (a: number[]) => a.reduce((t, x) => t + (ok(x) ? x : 0), 0);
const ou = (a: number, b: number) => (ok(a) ? a : b);
export const cheio = (v: Valor) =>
  v !== undefined && v !== null && v !== false && String(v).trim() !== "";

export const PESSOAL: [string, string][] = [
  ["Casa", "Aluguel ou prestação, condomínio, IPTU, contas, mercado"],
  ["Transporte", "Prestação, seguro, IPVA, combustível, estacionamento, app"],
  ["Saúde", "Plano, farmácia, dentista"],
  ["Educação", "Escola, faculdade, cursos, material"],
  ["Pessoal", "Cuidados, academia, roupas, contribuições"],
  ["Lazer", "Restaurantes, viagens, assinaturas"],
  ["Financeiro", "Tarifas, anuidades, empréstimos, pensão"],
  ["Imprevistos", "Manutenção, presentes, auxílio à família"],
];
export const NEGOCIO: [string, string][] = [
  ["Locomoção", "Carro a trabalho, combustível, estacionamento, app"],
  ["Marketing de captação", "Prospecção do proprietário, impressos, brindes, patrocínios"],
  ["Marketing de venda", "Portais, fotos, tour virtual, anúncios, placas"],
  ["Portal Boost", "Mais visibilidade para seus imóveis"],
  ["Administrativo", "Fee da franquia, CRECI, REMARKT, telefonia, assistente"],
  ["Formação e eventos", "Cursos, inscrições, viagens de treinamento"],
];
export const ORIGENS = [
  "Indicação de cliente",
  "Indicação de amigo, vizinho ou ex-colega",
  "Portaria, zelador ou síndico",
  "Parceria com colega REMAX",
  "Portal REMAX",
  "Portais imobiliários",
  "Anúncios Meta e Google",
  "Redes sociais",
  "Material impresso, placa, carro adesivado",
  "Open house e eventos",
];
export const AFIRMACOES: [string, string][] = [
  [
    "Minhas metas do ano passado eram irreais para o meu momento",
    "Meta irreal: ambição sem base no seu histórico vira frustração em março.",
  ],
  [
    "Não tive disciplina para manter a rotina que eu mesmo defini",
    "Plano sem rotina: meta anual que não vira tarefa da semana não acontece.",
  ],
  [
    "Deixei imóveis parados na carteira sem revisar o preço",
    "Estoque parado: carteira que não gira é trabalho já feito sendo jogado fora.",
  ],
  [
    "Trabalhei espalhado, sem território ou especialidade definida",
    "Esforço espalhado: quem atende a cidade inteira não é referência em lugar nenhum.",
  ],
  [
    "Não acompanhei meus números durante o ano",
    "Ausência de medição: sem número, você só descobre em dezembro.",
  ],
  [
    "Fiquei sobrecarregado e abandonei o plano no meio do caminho",
    "Isolamento: quem não presta contas a ninguém desiste mais cedo.",
  ],
];
export const PORQUE: [string, string][] = [
  [
    "O que te inspira a acordar e trabalhar todos os dias?",
    "Compreender sua motivação diária ajuda a manter o foco e a paixão.",
  ],
  [
    "Quais são suas metas de longo prazo na carreira de corretor imobiliário?",
    "Metas de longo prazo dão direção ao seu desenvolvimento.",
  ],
  [
    "O que significa ‘sucesso’ para você?",
    "Uma definição pessoal de sucesso, alinhada aos seus valores.",
  ],
  [
    "Que aspecto do seu trabalho te traz mais satisfação?",
    "Guia suas ações para mais dessas experiências.",
  ],
  [
    "Como você gostaria de ser lembrado pelos seus clientes e colegas?",
    "O legado e a reputação que deseja construir.",
  ],
  [
    "O que te motivou a escolher a carreira de corretor imobiliário?",
    "Revisitar as razões iniciais reacende a paixão.",
  ],
  [
    "Quem ficará orgulhoso de você quando conseguir?",
    "Quem ganha se você ganhar? Para quem essa vitória importa além de você.",
  ],
];
export const CANAIS = [
  "Indicações e rede de relacionamento",
  "Portaria, zelador e síndico",
  "Parceria 50/50 com colegas REMAX",
  "Portais imobiliários",
  "Anúncios Meta e Google",
  "Portal Boost",
  "Redes sociais e conteúdo próprio",
  "Carta aos vizinhos e material impresso",
  "Placas e carro adesivado",
  "Open house e safári de corretores",
  "Patrocínio local (comércio, associação, time)",
];
export const AGENDA = [
  "Conexão Corretor",
  "Formação inicial de corretores",
  "100 dias para o sucesso (Brian Buffini)",
  "Academia REMAX (regional)",
  "Escola REMAX (minha imobiliária)",
  "Convenção Nacional REMAX – C7 (19 a 21/5/27)",
  "Agent Summit (18 e 19/11/27)",
  "Leitura ou mentoria",
];
export const FAIXAS: [number, string][] = [
  [40, "40% início de carreira"],
  [45, "45% crescimento"],
  [60, "60% performance sólida"],
  [70, "70% máxima comissão"],
];
/** p.27 do book: faturamento do ano civil anterior. */
export const CLUBES = [
  { n: "Executive Club", min: 173010 },
  { n: "100% Club", min: 346021 },
  { n: "Platinum Club", min: 865052 },
  { n: "Chairman's Club", min: 1730104 },
  { n: "Titan Club", min: 2595156 },
  { n: "Diamond Club", min: 3460208 },
  { n: "Pinnacle Club", min: 6920415 },
];
export function clubePorValor(v: number) {
  let c: (typeof CLUBES)[number] | null = null;
  for (const x of CLUBES) if (ok(v) && v >= x.min) c = x;
  return c;
}
/** p.30 do book: régua das CREs ativas. */
export const REGUA: [number, number, string][] = [
  [0, 4, "Não tem negócio"],
  [5, 10, "Negócio lento — volume insuficiente para constância"],
  [11, 15, "Negócio — ciclo saudável"],
  [16, 18, "Negócio feliz — fluxo contínuo de visitas, propostas e fechamentos"],
  [19, 23, "Alta performance — exige suporte para manter a qualidade"],
  [24, 1e9, "Perda de eficácia — excesso de contratos sem apoio"],
];
export const regua = (n: number) =>
  ok(n) ? (REGUA.find((r) => n >= r[0] && n <= r[1]) ?? REGUA[0])[2] : "";

/** Taxas do funil (p.36). Ordem: resposta do corretor → padrão da imobiliária → exemplo do book. */
export type TaxasFunil = { v2cre: number | null; v1v2: number | null; folga: number | null };
export const FUNIL_BOOK = { v2cre: 50, v1v2: 60, folga: 25 } as const;

export function calc(S: Respostas, padrao?: Partial<TaxasFunil> | null) {
  const g = (k: string) => num(S[k]);
  const d = {
    comissao: g("d.comissao"),
    trans: g("d.trans"),
    cres: g("d.cres"),
    conv: g("d.conv"),
    ticket: g("d.ticket"),
    dias: g("d.dias"),
    ativos: g("d.ativos"),
    revisados: g("d.revisados"),
  };
  // Diagnóstico (p.15 e p.16)
  const orig = ORIGENS.map((o, i) => ({ o, t: soma([g(`or.${i}.c`), g(`or.${i}.v`)]) }))
    .filter((x) => x.t > 0)
    .sort((a, b) => b.t - a.t);
  const top3 = orig.slice(0, 3).map((x) => x.o);
  const notas = AFIRMACOES.map((_, i) => g(`av.${i}`));
  const notasPreenchidas = notas.filter(ok).length;
  const notaTotal = soma(notas);
  const notaFaixa =
    notasPreenchidas < 6
      ? ""
      : notaTotal <= 12
        ? "Você executa. Seu desafio é ambição, não disciplina. Suba a meta."
        : notaTotal <= 20
          ? "Você executa em partes. Escolha as duas afirmações de maior nota e ataque só elas em 2027."
          : "A execução é o seu gargalo. Não adianta planejar maior. Planeje menor e cumpra. Use o pacto com o broker e cobre a cadência.";
  const armadilhas = notas
    .map((n, i) => [n, i] as const)
    .filter((x) => ok(x[0]))
    .sort((a, b) => b[0] - a[0])
    .slice(0, 2)
    .map((x) => AFIRMACOES[x[1]][1]);
  // Passo 2 (p.21 a p.24)
  const pessoalMes = soma(PESSOAL.map((_, i) => g(`op.${i}`)));
  const pessoalAno = pessoalMes * 12;
  const negocioMes = soma(NEGOCIO.map((_, i) => g(`on.${i}`)));
  const negocioAno = negocioMes * 12;
  const mktNegocioMes = soma([g("on.1"), g("on.2"), g("on.3")]);
  const sonhos = soma([0, 1, 2].map((i) => g(`so.${i}.v`)));
  const subtotal = pessoalAno + negocioAno + sonhos;
  const aliq = g("es.aliq");
  // O NÚMERO DO MEU ESTILO DE VIDA = linha 4 ÷ (1 − linha 5)
  const estiloAno = ok(aliq) && aliq < 100 && subtotal > 0 ? subtotal / (1 - aliq / 100) : NaN;
  const estiloMes = estiloAno / 12;
  // Passo 3 (p.26) DA COMISSÃO À TRANSAÇÃO
  const faixa = g("m.faixa");
  const bruta = ok(estiloAno) && faixa > 0 ? estiloAno / (faixa / 100) : NaN; // linha 3 = 1 ÷ 2
  const ticket = ou(g("m.ticket"), d.ticket); // linha 4 (p.14)
  const pctTrans = g("m.pct");
  const comTrans = ticket > 0 && pctTrans > 0 ? (ticket * pctTrans) / 100 : NaN; // linha 6 = 4 × 5
  const trans = ok(bruta) && comTrans > 0 ? Math.ceil(bruta / comTrans) : NaN; // linha 7 = 3 ÷ 6, para cima
  const transAcima = ok(trans) && ok(d.trans) && trans > d.trans * 1.5;
  // Passo 3 (p.29) DA TRANSAÇÃO À CAPTAÇÃO
  const conv = ou(g("m.conv"), d.conv);
  const captAno = ok(trans) && conv > 0 ? Math.round(trans / (conv / 100)) : NaN; // book: 28 ÷ 22% = 127
  const captMes = ok(captAno) ? Math.ceil(captAno / 12) : NaN; // book: 11
  // p.30 MINHA CARTEIRA ALVO
  const mesesCarteira = ou(g("m.meses"), ok(d.dias) ? Math.round((d.dias / 30) * 10) / 10 : NaN);
  const creEstimada = ok(captMes) && mesesCarteira > 0 ? Math.round(captMes * mesesCarteira) : NaN;
  // p.31 MINHAS METAS PARA 2027
  const creIni = ou(g("mt.creIni"), d.ativos);
  const novas = ou(g("mt.novas"), captAno);
  const vendidas = ou(
    g("mt.vendidas"),
    ok(novas) && conv > 0 ? Math.round((novas * conv) / 100) : NaN,
  );
  const canc = ou(g("mt.canc"), ok(novas) && ok(vendidas) ? Math.max(0, novas - vendidas) : NaN);
  // estoque = ativos no início + novos − cancelados − vendidos
  const estoqueFim = [creIni, novas, canc, vendidas].every(ok)
    ? creIni + novas - canc - vendidas
    : NaN;
  const tCapt = ou(g("mt.tCapt"), trans);
  const tVenda = ou(g("mt.tVenda"), 0);
  const transMeta = ok(tCapt) ? tCapt + (ok(tVenda) ? tVenda : 0) : NaN; // captação + venda
  const comMedia = ou(g("mt.comMedia"), comTrans);
  const vgc = ok(transMeta) && ok(comMedia) ? transMeta * comMedia : NaN; // transações × comissão média
  const creFim = ou(g("mt.creFim"), estoqueFim);
  const clubeSug = clubePorValor(vgc);
  const clube =
    (typeof S["mt.clube"] === "string" && S["mt.clube"]) || (clubeSug ? clubeSug.n : "");
  // Passo 5 (p.36) MEU FUNIL DE CAPTAÇÃO
  const txV2Cre = ou(g("fu.v2cre"), padrao?.v2cre ?? FUNIL_BOOK.v2cre);
  const txV1V2 = ou(g("fu.v1v2"), padrao?.v1v2 ?? FUNIL_BOOK.v1v2);
  const folga = ou(g("fu.folga"), padrao?.folga ?? FUNIL_BOOK.folga);
  const v2Mes = ok(captMes) && txV2Cre > 0 ? Math.ceil(captMes / (txV2Cre / 100)) : NaN;
  const v1Mes = ok(v2Mes) && txV1V2 > 0 ? Math.ceil(v2Mes / (txV1V2 / 100)) : NaN;
  const contSem = ok(v1Mes) ? Math.ceil((v1Mes / 4) * (1 + folga / 100)) : NaN;
  const contMes = ok(contSem) ? contSem * 4 : NaN;
  // p.35 semana padrão
  const horas = [0, 1, 2, 3].map((i) => g(`sp.${i}`));
  const horasTot = soma(horas);
  const horasCapt = soma([horas[0], horas[1]]);
  const horasAtend = soma([horas[2]]);
  // p.37 a p.39
  const revisarMes = g("rv.mes");
  const canais = CANAIS.filter((_, i) => S[`mk.${i}`] === true);
  const invest = g("mk.invest");
  const horasEstudo = g("de.horas");
  return {
    d,
    top3,
    notasPreenchidas,
    notaTotal,
    notaFaixa,
    armadilhas,
    pessoalMes,
    pessoalAno,
    negocioMes,
    negocioAno,
    mktNegocioMes,
    sonhos,
    subtotal,
    aliq,
    estiloAno,
    estiloMes,
    faixa,
    bruta,
    ticket,
    pctTrans,
    comTrans,
    trans,
    transAcima,
    conv,
    captAno,
    captMes,
    mesesCarteira,
    creEstimada,
    creEstimadaRegua: regua(creEstimada),
    creIni,
    novas,
    vendidas,
    canc,
    estoqueFim,
    tCapt,
    tVenda,
    transMeta,
    comMedia,
    vgc,
    creFim,
    clubeSug,
    clube,
    txV2Cre,
    txV1V2,
    folga,
    v2Mes,
    v1Mes,
    contSem,
    contMes,
    horasTot,
    horasCapt,
    horasAtend,
    revisarMes,
    canais,
    invest,
    horasEstudo,
  };
}
export type Calc = ReturnType<typeof calc>;

/** Meta oficial (minhas_metas, período 'ano') a partir do Objetivo 2027. null = faltam dados. */
export function metaOficialDoPlano(C: Calc) {
  if (!ok(C.vgc) || !ok(C.transMeta)) return null;
  return {
    comissao: Math.round(C.vgc * 100) / 100,
    vgv: ok(C.ticket) && C.ticket > 0 ? Math.round(C.transMeta * C.ticket * 100) / 100 : null,
    vendas: Math.round(C.transMeta),
    captacoes: ok(C.novas) ? Math.round(C.novas) : null,
  };
}

/** Meta do mês em 2027: anual ÷ 12; captações usam captMes da calc() (já é mensal). */
export function metaMensalDoPlano(C: Calc) {
  const anual = metaOficialDoPlano(C);
  if (!anual) return null;
  return {
    comissao: Math.round((anual.comissao / 12) * 100) / 100,
    vgv: anual.vgv == null ? null : Math.round((anual.vgv / 12) * 100) / 100,
    vendas: Math.round(anual.vendas / 12),
    captacoes: ok(C.captMes) ? Math.round(C.captMes) : anual.captacoes,
  };
}

// Formatação ----------------------------------------------------------------------------------------
export const fmt = {
  brl: (v: number) =>
    ok(v)
      ? v.toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
          minimumFractionDigits: Number.isInteger(Math.round(v * 100) / 100) ? 0 : 2,
          maximumFractionDigits: 2,
        })
      : "—",
  brl0: (v: number) =>
    ok(v)
      ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
      : "—",
  int: (v: number) => (ok(v) ? Math.round(v).toLocaleString("pt-BR") : "—"),
  dec: (v: number) => (ok(v) ? (Math.round(v * 10) / 10).toLocaleString("pt-BR") : "—"),
  pc: (v: number) => (ok(v) ? v.toLocaleString("pt-BR") + "%" : "—"),
};
export type Fmt = keyof typeof fmt;

export const dataBR = (iso: string | null | undefined) =>
  iso ? new Date(iso + "T12:00:00").toLocaleDateString("pt-BR") : "—";
export function addDias(iso: string, d: number) {
  const x = new Date(iso + "T12:00:00Z");
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
}
export const DIAS: [string, string][] = [
  ["seg", "Segunda"],
  ["ter", "Terça"],
  ["qua", "Quarta"],
  ["qui", "Quinta"],
  ["sex", "Sexta"],
];
export const nomeDia = (k: Valor) => DIAS.find((d) => d[0] === k)?.[1] ?? "";
