/**
 * Conteúdo do PDF "Meu Plano 2027" (cartão t_65edd0b0; aprovado por Denis em 12/11/2026). Só dados e funções
 * puras: o desenho (pdf-lib) fica em pdf.ts. Regras aprovadas:
 *  - só existe para plano FINALIZADO = todas as telas do plano completas (o mesmo "X/Y telas completas");
 *  - todas as respostas, tela por tela, na ordem única do plano (t_296fc69e), com o rótulo da página do book;
 *  - no fim, os números calculados: meta oficial, carteira alvo, metas mês a mês com o total e KRIs;
 *  - campo vazio = "—" (nenhum valor inventado; números calculados sem base também saem "—").
 */
import {
  AFIRMACOES,
  AGENDA,
  FAIXAS,
  NEGOCIO,
  ORIGENS,
  PESSOAL,
  PORQUE,
  calc,
  cheio,
  dataBR,
  fmt,
  metaOficialDoPlano,
  nomeDia,
  num,
  ok,
  soma,
  type Calc,
  type Respostas,
  type TaxasFunil,
  type Valor,
} from "./regras";
import { KRIS, ORDEM, P15_CAMPOS, inicioNoventaDias, progresso, rotuloPagina, tela } from "./telas";
import {
  ATIVIDADES_SEMANA,
  BLOCOS_SEMANA,
  MARCOS_CAPT,
  MARCOS_VENDA,
  MESES,
  SEMANAS,
} from "./listas";
import { tabelasMes, temMesDigitado, type LinhaMes } from "./meses";

export const VAZIO = "—";

/** Linha de pergunta/resposta, subtítulo ou tabela dentro de uma seção. */
export type ItemPdf =
  | { k: "campo"; rot: string; val: string; calc?: boolean }
  | { k: "sub"; t: string }
  | { k: "texto"; t: string }
  | { k: "tabela"; cab: string[]; linhas: string[][]; pesos?: number[] };

export type SecaoPdf = { id: string; rotulo: string; ev: string; titulo: string; itens: ItemPdf[] };

export type PlanoPdfDados = {
  respostas: Respostas;
  /** Legado (quem escolheu a trilha Ativação antes do caminho único): dia 1 dos 90 dias. */
  ativacao_inicio?: string | null;
  assinado_corretor_em?: string | null;
  assinado_broker_em?: string | null;
  meta_oficial?: {
    meta_comissao: number | null;
    meta_vendas: number | null;
    meta_captacoes: number | null;
    meta_vgv?: number | null;
  } | null;
  meta_oficial_em?: string | null;
};

export type ConteudoPdf = {
  telas: number;
  total: number;
  secoes: SecaoPdf[];
  numeros: SecaoPdf[];
};

/** Regra 1 aprovada: o plano está finalizado quando TODAS as telas do plano (ordem única) estão completas. */
export function planoFinalizado(S: Respostas): boolean {
  const p = progresso(S);
  return p.total > 0 && p.telas === p.total;
}

// Formatação de respostas -------------------------------------------------------------------------------------
const txt = (v: Valor) => (cheio(v) ? String(v).trim() : VAZIO);
const dinheiro = (v: Valor) => {
  if (!cheio(v)) return VAZIO;
  const n = num(v);
  return ok(n) ? fmt.brl(n) : String(v).trim();
};
const pct = (v: Valor) => {
  if (!cheio(v)) return VAZIO;
  const n = num(v);
  return ok(n) ? fmt.pc(n) : String(v).trim();
};
const inteiro = (v: Valor) => {
  if (!cheio(v)) return VAZIO;
  const n = num(v);
  return ok(n) ? n.toLocaleString("pt-BR") : String(v).trim();
};
const data = (v: Valor) => (typeof v === "string" && cheio(v) ? dataBR(v) : VAZIO);
const marcado = (v: Valor) => (v === true ? "Feito" : VAZIO);
const opcao = (v: Valor, opcoes: [string, string][]) =>
  cheio(v) ? (opcoes.find((o) => o[0] === String(v))?.[1] ?? String(v)) : VAZIO;
const dia = (v: Valor) => (cheio(v) ? nomeDia(v) || String(v) : VAZIO);
const FAIXAS_OP: [string, string][] = FAIXAS.map((f) => [String(f[0]), f[1]]);

// Números calculados: NaN/infinito = "—".
const cBrl = (v: number) => fmt.brl(v);
const cBrl0 = (v: number) => fmt.brl0(v);
const cInt = (v: number) => fmt.int(v);
const cDec = (v: number) => fmt.dec(v);

const campo = (rot: string, val: string): ItemPdf => ({ k: "campo", rot, val });
const conta = (rot: string, val: string): ItemPdf => ({ k: "campo", rot, val, calc: true });

/** Itens de cada tela (mesmos campos e rótulos das telas em telas.tsx). */
function itensDaTela(id: string, S: Respostas, C: Calc, d: PlanoPdfDados): ItemPdf[] {
  const s = (k: string) => S[k];
  switch (id) {
    case "p15":
      return P15_CAMPOS.map(([k, l, t]) =>
        campo(l, t === "money" ? dinheiro(s(k)) : t === "pct" ? pct(s(k)) : inteiro(s(k))),
      );
    case "p16":
      return [
        {
          k: "tabela",
          cab: ["Origem", "Captações vendidas", "Clientes compradores"],
          pesos: [3, 1, 1],
          linhas: ORIGENS.map((o, i) => [o, inteiro(s(`or.${i}.c`)), inteiro(s(`or.${i}.v`))]),
        },
        conta("Minhas 3 maiores origens do ano", C.top3.length ? C.top3.join(" · ") : VAZIO),
      ];
    case "p17":
      return [
        ...AFIRMACOES.map((a, i) => campo(`${i + 1}. ${a[0]} (nota 1 a 5)`, txt(s(`av.${i}`)))),
        conta("Total (6 a 30)", C.notasPreenchidas ? cInt(C.notaTotal) : VAZIO),
        conta("Resultado", C.notaFaixa || VAZIO),
      ];
    case "p20":
      return [
        ...PORQUE.map((q, i) => campo(`${i + 1}. ${q[0]}`, txt(s(`pq.${i}`)))),
        campo("A frase que sustenta o plano", txt(s("pq.frase"))),
      ];
    case "p22":
      return [
        ...PESSOAL.map((g, i) => campo(`${g[0]} (${g[1]})`, dinheiro(s(`op.${i}`)))),
        conta("Total mensal", cBrl(C.pessoalMes)),
        conta("Total anual (× 12)", cBrl(C.pessoalAno)),
      ];
    case "p23":
      return [
        ...NEGOCIO.map((g, i) => campo(`${g[0]} (${g[1]})`, dinheiro(s(`on.${i}`)))),
        conta("Total mensal", cBrl(C.negocioMes)),
        conta("Total anual (× 12)", cBrl(C.negocioAno)),
      ];
    case "p24":
      return [
        ...[0, 1, 2].flatMap((i) => [
          campo(`Sonho ${i + 1}`, txt(s(`so.${i}.t`))),
          campo(`Sonho ${i + 1}: valor no ano`, dinheiro(s(`so.${i}.v`))),
        ]),
        conta("O custo dos meus sonhos", cBrl(C.sonhos)),
      ];
    case "p25":
      return [
        conta("1 · Orçamento pessoal no ano", cBrl(C.pessoalAno)),
        conta("2 · Orçamento do negócio no ano", cBrl(C.negocioAno)),
        conta("3 · Meus sonhos no ano", cBrl(C.sonhos)),
        conta("4 · Subtotal (1 + 2 + 3)", cBrl(C.subtotal)),
        campo("5 · Minha alíquota estimada de imposto", pct(s("es.aliq"))),
        conta("6 · O número do meu estilo de vida (por ano)", cBrl(C.estiloAno)),
        conta("Por mês", cBrl(C.estiloMes)),
      ];
    case "p27":
      return [
        conta("1 · O número do meu estilo de vida", cBrl(C.estiloAno)),
        campo("2 · Minha faixa de comissionamento hoje", opcao(s("m.faixa"), FAIXAS_OP)),
        conta("3 · Comissão bruta que preciso gerar (1 ÷ 2)", cBrl(C.bruta)),
        campo("4 · Meu ticket médio", dinheiro(s("m.ticket"))),
        campo("5 · Percentual de comissão por transação", pct(s("m.pct"))),
        conta("6 · Comissão média por transação (4 × 5)", cBrl(C.comTrans)),
        conta("7 · Transações que preciso fechar em 2027 (3 ÷ 6)", cInt(C.trans)),
        campo("Faixa que quero alcançar", opcao(s("m.faixaAlvo"), FAIXAS_OP)),
        campo("Clube de Corretores que quero conquistar em 2027", txt(s("mt.clube"))),
      ];
    case "p30":
      return [
        conta("1 · Transações que preciso fechar", cInt(C.trans)),
        campo("2 · Minha conversão da captação", pct(s("m.conv"))),
        conta("3 · Captações que preciso fazer em 2027 (1 ÷ 2)", cInt(C.captAno)),
        conta("4 · Captações por mês (3 ÷ 12)", cInt(C.captMes)),
      ];
    case "p31":
      return [
        campo("Quantas CREs ativas quero manter ao longo de 2027", inteiro(s("m.carteira"))),
        campo("Onde eu quero estar", txt(s("m.alvo"))),
        conta("Captações por mês", cInt(C.captMes)),
        campo("Meses que cada imóvel fica na sua carteira", inteiro(s("m.meses"))),
        conta(
          "≈ CREs ativas (captações/mês × meses)",
          ok(C.creEstimada) ? `${cInt(C.creEstimada)} · ${C.creEstimadaRegua}` : VAZIO,
        ),
      ];
    case "p32":
      return [
        conta(
          "Objetivo 2027",
          `Ao final de 2027 eu terei ${cInt(C.creFim)} CREs ativas na minha carteira e o valor geral de comissão de ${cBrl0(C.vgc)}, atingindo o ${C.clube || VAZIO}.`,
        ),
        { k: "sub", t: "CREs (captações com representação exclusiva)" },
        campo("Quantidade inicial de CREs ativas", inteiro(s("mt.creIni"))),
        campo("Meta de novas CREs", inteiro(s("mt.novas"))),
        campo("Meta de CREs canceladas/expiradas", inteiro(s("mt.canc"))),
        campo("Meta de CREs vendidas", inteiro(s("mt.vendidas"))),
        conta("Estoque no fim do ano (início + novas − canceladas − vendidas)", cInt(C.estoqueFim)),
        campo("Meta de CREs ativas no fim de 2027", inteiro(s("mt.creFim"))),
        { k: "sub", t: "Valor geral de comissão (VGC)" },
        campo("Meta de transações de captação", inteiro(s("mt.tCapt"))),
        campo("Meta de transações de venda", inteiro(s("mt.tVenda"))),
        campo("Comissão média por transação", dinheiro(s("mt.comMedia"))),
        conta("Meta de transações (captação + venda)", cInt(C.transMeta)),
        conta("Meta de VGC (transações × comissão média)", cBrl0(C.vgc)),
        campo("Clube que quero conquistar em 2027", txt(s("mt.clube"))),
      ];
    case "p34":
      return [
        campo("01 · Minha área de atuação", txt(s("pos.regiao"))),
        campo("Carteira hoje na região", pct(s("pos.pctHoje"))),
        campo("Meta no fim de 2027", pct(s("pos.pctMeta"))),
        campo("02 · Tipo em que quero ser referência", txt(s("pos.tipo"))),
        campo("03 · Ticket médio: de", dinheiro(s("pos.de"))),
        campo("03 · Ticket médio: até", dinheiro(s("pos.ate"))),
        campo("Quanto da carteira quero nesse tipo e faixa no fim de 2027", pct(s("pos.pctTipo"))),
      ];
    case "p36":
      return [
        ...BLOCOS_SEMANA.map((b, i) => campo(`${b[0]} (horas/semana)`, inteiro(s(`sp.${i}`)))),
        conta("Total de horas por semana", C.horasTot > 0 ? cInt(C.horasTot) : VAZIO),
        campo("Meu dia de revisão de estoque é", dia(s("sp.dia"))),
      ];
    case "p37":
      return [
        conta("CREs por mês (da tela de captação)", cInt(C.captMes)),
        campo("De cada 100 V2, quantas viram CRE? (%)", pct(s("fu.v2cre"))),
        conta("Segundas visitas (V2) por mês", cInt(C.v2Mes)),
        campo("De cada 100 V1, quantas viram V2? (%)", pct(s("fu.v1v2"))),
        conta("Primeiras visitas (V1) por mês", cInt(C.v1Mes)),
        campo("Taxa de folga para quem desmarca (%)", pct(s("fu.folga"))),
        conta("Resultado · contatos com agendamento por semana", cInt(C.contSem)),
        campo("Pessoas no CRM hoje", inteiro(s("fu.crmHoje"))),
        campo("Quero ter no fim de 2027", inteiro(s("fu.crmFim"))),
      ];
    case "p38":
      return [
        campo("Todo mês eu reviso o preço de pelo menos … imóveis", inteiro(s("rv.mes"))),
        campo("Nenhum imóvel meu passa de … dias sem revisão", inteiro(s("rv.dias"))),
        campo("Meu ritual de revisão acontece…", txt(s("rv.ritual"))),
      ];
    case "p39":
      return [
        campo("Canais escolhidos", C.canais.length ? C.canais.join(" · ") : VAZIO),
        campo("Quanto vou investir por mês", dinheiro(s("mk.invest"))),
        conta(
          "Previsto no orçamento do negócio (captação + venda + Portal Boost)",
          cBrl(C.mktNegocioMes),
        ),
      ];
    case "p40":
      return [
        ...[0, 1, 2].flatMap((i) => [
          { k: "sub" as const, t: `Habilidade ${i + 1}` },
          campo("Habilidade que quero desenvolver", txt(s(`de.h.${i}`))),
          campo("Número que ela melhora", txt(s(`de.n.${i}`))),
          campo("Onde vou aprender", txt(s(`de.o.${i}`))),
        ]),
        { k: "sub", t: "Minha agenda" },
        ...AGENDA.map((a, i) => campo(a, txt(s(`de.a.${i}`)))),
        campo("Horas por semana reservadas para aprender", inteiro(s("de.horas"))),
      ];
    case "p43": {
      const meta = [
        C.novas,
        C.creFim,
        ok(C.revisarMes) ? C.revisarMes * 12 : NaN,
        C.transMeta,
        C.vgc,
      ];
      return [
        {
          k: "tabela",
          cab: [
            "Meta do ano",
            "Novas CREs",
            "CREs ativas",
            "CREs revisadas",
            "Transações",
            "Comissão",
          ],
          pesos: [1.4, 1, 1, 1, 1, 1.4],
          linhas: [["Do plano", ...meta.map((v, i) => (i === 4 ? cBrl0(v) : cInt(v)))]],
        },
        { k: "texto", t: "Tela recorrente: os meses são preenchidos ao longo de 2027." },
      ];
    }
    case "p44":
      return [
        campo("Mês de referência", txt(s("ac.mes"))),
        {
          k: "tabela",
          cab: ["Atividade", "Sem 1", "Sem 2", "Sem 3", "Sem 4", "Total"],
          pesos: [3, 1, 1, 1, 1, 1],
          linhas: ATIVIDADES_SEMANA.map((n, i) => {
            const v = [0, 1, 2, 3].map((w) => s(`ac.${i}.${w}`));
            const tem = v.some(cheio);
            return [n, ...v.map(inteiro), tem ? cInt(soma(v.map(num))) : VAZIO];
          }),
        },
      ];
    case "p45":
      return [
        { k: "sub", t: "Corretor" },
        campo("Eu,", txt(s("pa.nome"))),
        ...[0, 1, 2].map((i) => campo(`Me comprometo a (0${i + 1})`, txt(s(`pa.c.${i}`)))),
        { k: "sub", t: "Broker" },
        campo("Eu,", txt(s("pa.bnome"))),
        ...[0, 1, 2].map((i) => campo(`Me comprometo a (0${i + 1})`, txt(s(`pa.b.${i}`)))),
        { k: "sub", t: "Nossa cadência de acompanhamento" },
        campo(
          "Frequência",
          opcao(s("pa.cad"), [
            ["semanal", "Semanal"],
            ["quinzenal", "Quinzenal"],
            ["mensal", "Mensal"],
          ]),
        ),
        campo("Sempre às", dia(s("pa.dia"))),
        campo("Horário", txt(s("pa.hora"))),
        { k: "sub", t: "Assinaturas" },
        conta(
          "Corretor",
          d.assinado_corretor_em ? `assinado em ${dataHora(d.assinado_corretor_em)}` : "pendente",
        ),
        conta(
          "Broker",
          d.assinado_broker_em ? `assinado em ${dataHora(d.assinado_broker_em)}` : "pendente",
        ),
      ];
    case "p49":
      return [
        conta("Início dos 90 dias (dia 1)", dataBR(inicioNoventaDias(d.ativacao_inicio, S))),
        campo("Primeira CRE assinada (até o dia 45)", data(s("d90.cre1"))),
        campo("Três CREs (até o dia 90)", data(s("d90.cre3"))),
        campo("Primeira venda", data(s("d90.venda1"))),
        campo("Quem é o meu parceiro de cobrança", txt(s("d90.parceiro"))),
        campo("O que eu preciso aprender nos próximos 30 dias", txt(s("d90.aprender"))),
      ];
    case "p50":
      return SEMANAS.flatMap((sem, i) => [
        { k: "sub" as const, t: sem.t },
        ...sem.itens.map((t, j) => campo(t, marcado(s(`sem.${i}.${j}`)))),
      ]);
    case "p51":
      return [
        { k: "sub", t: "Marcos da primeira captação" },
        ...MARCOS_CAPT.map((m, j) => campo(m, marcado(s(`mc.c.${j}`)))),
        campo("Data da minha primeira captação", data(s("mc.dataCapt"))),
        { k: "sub", t: "Marcos da primeira venda" },
        ...MARCOS_VENDA.map((m, j) => campo(m, marcado(s(`mc.v.${j}`)))),
        campo("Data da minha primeira venda", data(s("mc.dataVenda"))),
      ];
    case "p52":
      return cockpit(S, C);
    case "p11":
      return [
        conta(
          "Objetivo 2027",
          `Ao final de 2027 eu terei ${cInt(C.creFim)} CREs ativas e VGC de ${cBrl0(C.vgc)}, atingindo o ${C.clube || VAZIO}.`,
        ),
        ...KRIS.flatMap((g) => [
          { k: "sub" as const, t: g.kri },
          ...g.kpis.map((p) => campo(`KPI · ${p.n}: ações principais`, txt(s(p.k)))),
        ]),
      ];
    default:
      return [];
  }
}

/** O cockpit (p52) é montado pelas outras telas: mesmas linhas da tela. */
function cockpit(S: Respostas, C: Calc): ItemPdf[] {
  const s = (k: string) => (typeof S[k] === "string" ? (S[k] as string).trim() : "");
  const v = (x: string) => x || VAZIO;
  const horas = [C.horasCapt, C.horasAtend, C.horasEstudo]
    .map((x) => (ok(x) && x > 0 ? `${x}h` : VAZIO))
    .join(" · ");
  const itens: ItemPdf[] = [
    { k: "sub", t: "Meu porquê e meu número" },
    conta("Meu porquê, em uma frase", v(s("pq.frase"))),
    conta("Número do meu estilo de vida: por ano", cBrl(C.estiloAno)),
    conta("Número do meu estilo de vida: por mês", cBrl(C.estiloMes)),
    { k: "sub", t: "Minha rotina" },
    conta("Horas/semana: captação · atendimento · desenvolvimento", horas),
    conta("Dia fixo da revisão de preço", v(nomeDia(S["sp.dia"]))),
    conta(
      "Funil do mês: prospecções · V1 · V2 · captações",
      [C.contMes, C.v1Mes, C.v2Mes, C.captMes].map(cInt).join(" · "),
    ),
    conta(
      "Canais de marketing · investimento/mês",
      C.canais.length ? `${C.canais.join(", ")} · ${cBrl0(C.invest)}` : VAZIO,
    ),
    conta(
      "Habilidade nº 1 · horas de estudo/semana",
      s("de.h.0") ? `${s("de.h.0")} · ${s("de.horas") || VAZIO}h` : VAZIO,
    ),
    { k: "sub", t: "Onde eu jogo / posicionamento" },
    conta("Minha região", v(s("pos.regiao"))),
    conta(
      "Tipo de imóvel e faixa de preço",
      s("pos.tipo")
        ? `${s("pos.tipo")} · ${cBrl0(num(S["pos.de"]))} a ${cBrl0(num(S["pos.ate"]))}`
        : VAZIO,
    ),
    { k: "sub", t: "Minha meta 2027" },
    conta("Transações que preciso fechar no ano", cInt(C.trans)),
    conta(
      "Captações no ano · por mês",
      ok(C.captAno) ? `${cInt(C.captAno)} · ${cInt(C.captMes)}` : VAZIO,
    ),
    conta("CREs ativas no fim de 2027", cInt(C.creFim)),
    conta("VGC de 2027 · clube", ok(C.vgc) ? `${cBrl0(C.vgc)} · ${C.clube || VAZIO}` : VAZIO),
    { k: "sub", t: "Meus primeiros 90 dias" },
    conta(
      "1ª CRE · 3 CREs · 1ª venda",
      [s("d90.cre1"), s("d90.cre3"), s("d90.venda1")]
        .map((x) => (x ? dataBR(x) : VAZIO))
        .join(" · "),
    ),
  ];
  itens.push(
    { k: "sub", t: "Como eu executo" },
    conta(
      "Dia e hora do acompanhamento",
      s("pa.cad") ? `${s("pa.cad")} · ${nomeDia(S["pa.dia"])} ${s("pa.hora")}`.trim() : VAZIO,
    ),
    conta("Compromisso nº 1 do meu pacto com o broker", v(s("pa.c.0"))),
    conta("Meu broker", v(s("pa.bnome"))),
  );
  return itens;
}

function dataHora(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Seções finais: números calculados pelo plano (nada digitado aqui). */
function numerosCalculados(C: Calc, d: PlanoPdfDados): SecaoPdf[] {
  const m = metaOficialDoPlano(C);
  const mo = d.meta_oficial;
  const meta: ItemPdf[] = [
    conta("VGC (comissão) do ano", m ? cBrl(m.comissao) : VAZIO),
    conta("VGV do ano (transações × ticket médio)", m && m.vgv != null ? cBrl0(m.vgv) : VAZIO),
    conta("Transações (captação + venda)", m ? cInt(m.vendas) : VAZIO),
    conta("Captações (novas CREs)", m && m.captacoes != null ? cInt(m.captacoes) : VAZIO),
    conta(
      "Gravada em Minha carreira",
      mo && d.meta_oficial_em
        ? `em ${dataHora(d.meta_oficial_em)}: ${mo.meta_comissao == null ? VAZIO : cBrl0(Number(mo.meta_comissao))} · ${mo.meta_vendas ?? VAZIO} transações · ${mo.meta_captacoes ?? VAZIO} captações`
        : "ainda não gravada",
    ),
  ];
  const carteira: ItemPdf[] = [
    conta("Onde eu quero estar", txt(d.respostas["m.alvo"])),
    conta("CREs ativas que quero manter ao longo de 2027", inteiro(d.respostas["m.carteira"])),
    conta("CREs ativas no início", cInt(C.creIni)),
    conta("Captações por mês", cInt(C.captMes)),
    conta(
      "≈ CREs ativas (captações/mês × meses na carteira)",
      ok(C.creEstimada) ? `${cInt(C.creEstimada)} · ${C.creEstimadaRegua}` : VAZIO,
    ),
    conta("Meta de CREs ativas no fim de 2027", cInt(C.creFim)),
  ];
  // Duas tabelas mês a mês (cartilha): meses digitados, sugestão nos vazios e linhas calculadas (=).
  // Só planejamento: não entra em calc().
  const tabs = tabelasMes(d.respostas ?? {}, C);
  const celula = (l: LinhaMes, v: number) => (l.dinheiro ? cInt(v) : cDec(v));
  const itensMes: ItemPdf[] = tabs.flatMap((t): ItemPdf[] => [
    { k: "sub", t: t.titulo },
    {
      k: "tabela",
      cab: ["Meta", "Anual", ...MESES],
      pesos: [2.6, 1.3, ...MESES.map(() => 1)],
      linhas: t.linhas.map((l) => [
        (l.calc ? "= " : "") + l.rot + (l.dinheiro ? " (R$)" : ""),
        celula(l, l.anual) + (l.notaAnual === "= dezembro" ? " (dez)" : ""),
        ...l.meses.map((x) => celula(l, x.usado)),
      ]),
    },
    ...t.linhas
      .filter((l) => l.diverge)
      .map((l): ItemPdf => ({
        k: "texto",
        t: `${l.rot}: os meses somam ${l.dinheiro ? cBrl0(l.anual) : cDec(l.anual)}; a meta do ano é ${l.dinheiro ? cBrl0(l.meta) : cDec(l.meta)}.`,
      })),
  ]);
  itensMes.push({
    k: "texto",
    t: "Estoque: imóveis ativos no início + novas − canceladas/expiradas − vendidas (acumulado; anual = dezembro). Transações: captação + venda. VGC: transações × comissão média do mês.",
  });
  const kris: ItemPdf[] = [
    { k: "sub", t: KRIS[0].kri },
    conta("Novas CREs", cInt(C.novas)),
    conta("CREs canceladas/expiradas", cInt(C.canc)),
    conta("CREs vendidas", cInt(C.vendidas)),
    { k: "sub", t: KRIS[1].kri },
    conta("Transações de captação", cInt(C.tCapt)),
    conta("Transações de venda", cInt(C.tVenda)),
    conta("Ticket médio por transação", cBrl0(C.ticket)),
    conta("VGC (transações × comissão média)", cBrl0(C.vgc)),
  ];
  return [
    { id: "n-meta", rotulo: "", ev: "Números do plano", titulo: "Meta oficial 2027", itens: meta },
    {
      id: "n-carteira",
      rotulo: "",
      ev: "Números do plano",
      titulo: "Carteira alvo",
      itens: carteira,
    },
    {
      id: "n-mes",
      rotulo: "",
      ev: "Números do plano",
      titulo: temMesDigitado(tabs)
        ? "Metas mês a mês e total do ano"
        : "Metas mês a mês (÷ 12) e total do ano",
      itens: itensMes,
    },
    {
      id: "n-kri",
      rotulo: "",
      ev: "Números do plano",
      titulo: "KRIs e KPIs: os números",
      itens: kris,
    },
  ];
}

/** Monta o conteúdo do PDF. Lança erro se o plano não estiver finalizado (regra 1). */
export function conteudoPlanoPdf(
  d: PlanoPdfDados,
  taxasPadrao?: Partial<TaxasFunil> | null,
): ConteudoPdf {
  const S = d.respostas ?? {};
  if (!planoFinalizado(S)) throw new Error("O plano ainda não está completo.");
  const C = calc(S, taxasPadrao);
  const p = progresso(S);
  const secoes = ORDEM.map((id) => {
    const t = tela(id)!;
    return {
      id,
      rotulo: rotuloPagina(t.pdf),
      ev: t.ev,
      titulo: t.t,
      itens: itensDaTela(id, S, C, d),
    };
  });
  return {
    telas: p.telas,
    total: p.total,
    secoes,
    numeros: numerosCalculados(C, d),
  };
}

/** Nome do arquivo: meu-plano-2027-<nome>.pdf (sem acento/símbolo). */
export function nomeArquivoPlano(nome: string | null | undefined): string {
  const base = (nome ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `meu-plano-2027${base ? `-${base}` : ""}.pdf`;
}
