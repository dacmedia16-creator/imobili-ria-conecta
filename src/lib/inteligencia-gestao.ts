// Inteligência de gestão (cartão t_1d3c07b3, briefing aprovado por Denis em 08/11/2026, tópico 6238).
// Só regras puras: nada aqui lê o banco. Regra principal: NÃO DUPLICAR. Cada sinal usa a regra que já existe:
//   1) Dias sem vender ............ nivelSemVender (painel-equipe-calc.ts): >14 amarelo, >30 ou nunca = vermelho
//   2) Atividade × meta ........... metas da calc()/ms.* + proximidade() + faixa() (meta-atividades.ts, "Sua semana")
//   3) Leads sem resposta ......... prazoDoLead() (leads.ts), a mesma do Painel de leads e da rotina de prazos
//   4) Gestões .................... captureValidity() + statusReuniao() (avisos de exclusividade, PR #285)
//   5) Captações no mês ........... captMes do plano × dias passados do mês (feito = capt_mes do Diário,
//                                   contado pela data de assinatura)
// O farol NÃO é ranking e não tem pontos (decisão de 16/10, mantida).
import { faixa, proximidade, type Faixa, type Feito, type MetasSemana } from "./meta-atividades";
import { diasEntre, nivelSemVender } from "./painel-equipe-calc";
import { prazoDoLead, type Lead, type LeadConfig } from "./leads";
import { captureValidity } from "./exclusive-captures";
import { REUNIAO_DIAS, statusReuniao } from "./avisos-exclusividade";

// --- Tipos --------------------------------------------------------------------------------------------

/** "sem_plano" e "sem_dado" não têm cor e não contam para o farol. */
export type CorSinal = Faixa | "sem_plano" | "sem_dado";
export type ChaveSinal = "sem_vender" | "atividade" | "leads" | "gestoes" | "captacoes";
export type Sinal = { chave: ChaveSinal; cor: CorSinal; texto: string };

export type Farol = "risco" | "atencao" | "tranquilo" | "novo";
export const FAROL_ROTULO: Record<Farol, string> = {
  risco: "🔴 Risco alto",
  atencao: "🟡 Atenção",
  tranquilo: "🟢 Tranquilo",
  novo: "🆕 Novo",
};
export const SINAL_ROTULO: Record<ChaveSinal, string> = {
  sem_vender: "Sem vender",
  atividade: "Atividade da semana",
  leads: "Leads",
  gestoes: "Gestões",
  captacoes: "Captações no mês",
};

/** Corretor com menos de 60 dias na equipe aparece como "novo", sem farol de produção. */
export const DIAS_NOVO = 60;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const somarDias = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// --- Sinal 1: dias sem vender (regra atual do Painel da Equipe) -------------------------------------

const COR_NIVEL = { ok: "verde", atencao: "amarelo", alerta: "vermelho" } as const;

export function sinalSemVender(dias: number | null): Sinal {
  return {
    chave: "sem_vender",
    cor: COR_NIVEL[nivelSemVender(dias)],
    texto: dias == null ? "Ainda não vendeu" : `${plural(dias, "dia", "dias")} sem vender`,
  };
}

// --- Sinal 2: atividade da semana × meta do plano -------------------------------------------------------

export function sinalAtividade(semana: Feito, metas: MetasSemana | null): Sinal {
  if (!metas) return { chave: "atividade", cor: "sem_plano", texto: "Sem plano" };
  const p = proximidade(semana, metas);
  return {
    chave: "atividade",
    // Mesmas faixas do "Sua semana": verde >= 100%, amarelo >= 70%, vermelho < 70%.
    cor: faixa(p, 1),
    texto: `Atividade da semana em ${Math.round(p * 100)}% da meta`,
  };
}

/**
 * A cópia "ms.*" que o team leader recebe só é regravada quando o corretor abre o plano ou o Diário.
 * Desatualizada = gravada antes da última mudança das taxas padrão da imobiliária (a única coisa que muda
 * a meta sem o corretor abrir nada) ou há mais de 30 dias. Aí a tela mostra "meta de DD/MM".
 * shortcut: a data da cópia é o updated_at do plano (qualquer gravação do plano conta como "cópia nova").
 */
export const META_VALIDADE_DIAS = 30;
export function metaDesatualizada(
  metasEm: string | null,
  taxasEm: string | null,
  hoje: string,
): string | null {
  if (!metasEm) return null;
  const velha =
    (taxasEm != null && metasEm < taxasEm) || diasEntre(metasEm, hoje) > META_VALIDADE_DIAS;
  return velha ? `meta de ${ddmm(metasEm)}` : null;
}

// --- Sinal 3: leads sem resposta (regra de prazo do Painel de leads) ------------------------------------

export type LeadFarol = Pick<
  Lead,
  | "etapa"
  | "no_banco_desde"
  | "responsavel_id"
  | "atribuido_em"
  | "aceito_em"
  | "ultima_interacao_em"
  | "created_at"
>;

const DIA_MS = 864e5;

/**
 * Vermelho: algum lead com o prazo vencido (aceite, 1ª interação ou próxima interação). Amarelo: algum
 * vence nas próximas 24 h. null em `leads` = módulo de leads desligado (sem cor).
 */
export function sinalLeads(
  leads: readonly LeadFarol[] | null,
  config: LeadConfig | null,
  agora: Date,
): Sinal {
  if (!leads || !config) return { chave: "leads", cor: "sem_dado", texto: "Leads desligado" };
  let vencidos = 0;
  let vencendo = 0;
  let maisAntigo = 0;
  for (const l of leads) {
    const p = prazoDoLead(l as Lead, config, agora);
    if (p.tipo !== "aceite" && p.tipo !== "primeira_interacao" && p.tipo !== "sem_interacao")
      continue;
    if (p.restante <= 0) {
      vencidos++;
      maisAntigo = Math.max(maisAntigo, -p.restante);
    } else if (p.restante <= DIA_MS) vencendo++;
  }
  if (vencidos > 0) {
    const ha =
      maisAntigo >= DIA_MS
        ? plural(Math.floor(maisAntigo / DIA_MS), "dia", "dias")
        : "menos de 1 dia";
    return {
      chave: "leads",
      cor: "vermelho",
      texto: `${plural(vencidos, "lead sem resposta", "leads sem resposta")} (prazo vencido há ${ha})`,
    };
  }
  if (vencendo > 0)
    return {
      chave: "leads",
      cor: "amarelo",
      texto: `${plural(vencendo, "lead vence", "leads vencem")} em até 24 h`,
    };
  return { chave: "leads", cor: "verde", texto: "Leads em dia" };
}

// --- Sinal 4: gestões (exclusividades e reunião de 45 dias) ---------------------------------------------

export type CaptacaoFarol = {
  id: string;
  status: string;
  signed_on: string | null;
  /** Prazo individual do contrato (form_data.condicoes.prazo_dias_numero). */
  prazo_dias: string | null;
  vendida: boolean;
  /** null = módulo de avisos/reunião desligado: a reunião de 45 dias não entra (não há onde registrar). */
  reunioes: string[] | null;
};

/** Até quantos dias antes de vencer acende o amarelo. */
export const GESTAO_AVISO_DIAS = 15;

/** Captação no formato que captureValidity()/statusReuniao() esperam. null = fora da conta (não aprovada,
 * vendida ou sem assinatura). */
export function capturaBase(c: CaptacaoFarol) {
  if (c.status !== "aprovada" || c.vendida || !c.signed_on) return null;
  return {
    status: "aprovada" as const,
    signed_on: c.signed_on,
    form_data: { condicoes: { prazo_dias_numero: c.prazo_dias ?? "" } },
  } as Parameters<typeof captureValidity>[0];
}

export function resumoGestoes(caps: readonly CaptacaoFarol[], hoje: string) {
  let vencidas = 0;
  let vencem = 0;
  let reunioesAtrasadas = 0;
  let reunioesProximas = 0;
  for (const c of caps) {
    const base = capturaBase(c);
    if (!base) continue;
    const v = captureValidity(base, hoje);
    if (!v) continue;
    if (v.daysLeft < 0) vencidas++;
    else if (v.daysLeft <= GESTAO_AVISO_DIAS) vencem++;
    if (c.reunioes) {
      const r = statusReuniao(base, c.reunioes, hoje);
      if (r?.pendente) reunioesAtrasadas++;
      else if (r && REUNIAO_DIAS - r.dias <= GESTAO_AVISO_DIAS) reunioesProximas++;
    }
  }
  return { vencidas, vencem, reunioesAtrasadas, reunioesProximas };
}

export function sinalGestoes(caps: readonly CaptacaoFarol[] | null, hoje: string): Sinal {
  if (!caps) return { chave: "gestoes", cor: "sem_dado", texto: "Captação exclusiva desligada" };
  const g = resumoGestoes(caps, hoje);
  const partes: string[] = [];
  if (g.vencidas)
    partes.push(plural(g.vencidas, "exclusividade vencida", "exclusividades vencidas"));
  if (g.reunioesAtrasadas)
    partes.push(
      plural(g.reunioesAtrasadas, "reunião de 45 dias atrasada", "reuniões de 45 dias atrasadas"),
    );
  if (partes.length) return { chave: "gestoes", cor: "vermelho", texto: partes.join(" e ") };
  if (g.vencem) partes.push(plural(g.vencem, "exclusividade vence", "exclusividades vencem"));
  if (g.reunioesProximas)
    partes.push(
      plural(g.reunioesProximas, "reunião de 45 dias vence", "reuniões de 45 dias vencem"),
    );
  if (partes.length)
    return {
      chave: "gestoes",
      cor: "amarelo",
      texto: `${partes.join(" e ")} em até ${GESTAO_AVISO_DIAS} dias`,
    };
  return { chave: "gestoes", cor: "verde", texto: "Gestões em dia" };
}

// --- Sinal 5: captações no mês × meta proporcional --------------------------------------------------------

/** Quanto da meta de captações do mês já deveria estar feito hoje (arredondado para baixo). */
export function captacoesEsperadas(captMes: number, hoje: string): number {
  const [a, m, d] = hoje.split("-").map(Number);
  const diasMes = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Math.floor((captMes * d) / diasMes);
}

export function sinalCaptacoes(feitoMes: number, metas: MetasSemana | null, hoje: string): Sinal {
  if (!metas) return { chave: "captacoes", cor: "sem_plano", texto: "Sem plano" };
  const esperado = captacoesEsperadas(metas.captMes, hoje);
  return {
    chave: "captacoes",
    cor: faixa(feitoMes, esperado),
    texto: `${feitoMes} de ${esperado} esperadas até hoje (meta do mês: ${metas.captMes})`,
  };
}

// --- Farol geral ----------------------------------------------------------------------------------------------

export function farolGeral(sinais: readonly Sinal[], diasNaEquipe: number | null): Farol {
  if (diasNaEquipe != null && diasNaEquipe < DIAS_NOVO) return "novo";
  const verm = sinais.filter((s) => s.cor === "vermelho").length;
  const amar = sinais.filter((s) => s.cor === "amarelo").length;
  if (verm >= 2) return "risco";
  if (verm === 1 || amar >= 2) return "atencao";
  return "tranquilo";
}

export type EntradaFarol = {
  user_id: string;
  nome: string;
  /** Data (aaaa-mm-dd) em que entrou na equipe atual; null = desconhecida (não vira "novo"). */
  entrou_em: string | null;
  dias_sem_vender: number | null;
  semana: Feito;
  capt_mes: number;
  metas: MetasSemana | null;
  /** Só para o TL (cópia ms.*): data da cópia e da última mudança das taxas da imobiliária. */
  metas_em?: string | null;
  taxas_em?: string | null;
  leads: LeadFarol[] | null;
  lead_config: LeadConfig | null;
  captacoes: CaptacaoFarol[] | null;
};

export type LinhaFarol = {
  user_id: string;
  nome: string;
  farol: Farol;
  sinais: Sinal[];
  /** Só os sinais vermelhos/amarelos (o que acendeu o farol), para a pauta da 1:1. */
  acesos: Sinal[];
  diasNaEquipe: number | null;
  /** "meta de DD/MM" quando a cópia das metas do TL está desatualizada. */
  metaDe: string | null;
};

export function calcularFarol(e: EntradaFarol, hoje: string, agora: Date): LinhaFarol {
  const sinais = [
    sinalSemVender(e.dias_sem_vender),
    sinalAtividade(e.semana, e.metas),
    sinalLeads(e.leads, e.lead_config, agora),
    sinalGestoes(e.captacoes, hoje),
    sinalCaptacoes(e.capt_mes, e.metas, hoje),
  ];
  const diasNaEquipe = e.entrou_em ? diasEntre(e.entrou_em, hoje) : null;
  const farol = farolGeral(sinais, diasNaEquipe);
  return {
    user_id: e.user_id,
    nome: e.nome,
    farol,
    sinais,
    acesos:
      farol === "novo" ? [] : sinais.filter((s) => s.cor === "vermelho" || s.cor === "amarelo"),
    diasNaEquipe,
    metaDe: e.metas ? metaDesatualizada(e.metas_em ?? null, e.taxas_em ?? null, hoje) : null,
  };
}

const ORDEM_FAROL: Record<Farol, number> = { risco: 0, atencao: 1, tranquilo: 2, novo: 3 };

/** Risco alto → atenção → tranquilo → novo; dentro do grupo, mais vermelhos e amarelos primeiro. Não é ranking. */
export function ordenarFarol<T extends Pick<LinhaFarol, "farol" | "sinais" | "nome">>(
  linhas: T[],
): T[] {
  const n = (l: T, c: CorSinal) => l.sinais.filter((s) => s.cor === c).length;
  return [...linhas].sort(
    (a, b) =>
      ORDEM_FAROL[a.farol] - ORDEM_FAROL[b.farol] ||
      n(b, "vermelho") - n(a, "vermelho") ||
      n(b, "amarelo") - n(a, "amarelo") ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  );
}

// --- Parte 2: onde o corretor perde mais (gargalo, 90 dias) ----------------------------------------------

/** Contagens dos últimos 90 dias. "Visita (antiga)" não entra (o banco nem a soma aqui). */
export type Funil90 = { ligacoes: number; v1: number; v2: number; captacoes: number };
export type EtapaFunil = "lig_v1" | "v1_v2" | "v2_capt";

export const GARGALO_MIN_INICIO = 5;
/** Corretor pelo menos 30% abaixo da taxa da equipe (relativo: taxa <= 70% da taxa da equipe). */
export const GARGALO_QUEDA = 0.3;

export const ETAPA_ROTULO: Record<EtapaFunil, string> = {
  lig_v1: "de ligação para V1",
  v1_v2: "de V1 para V2",
  v2_capt: "de V2 para captação",
};
/** Uma frase fixa de dica por etapa (sem IA). */
export const DICA_ETAPA: Record<EtapaFunil, string> = {
  lig_v1: "Ligue com roteiro e proponha a visita já na primeira conversa.",
  v1_v2: "Leve o dossiê do imóvel já na V1 e saia com a V2 marcada.",
  v2_capt: "Na V2, apresente o Plano de Marketing e Venda com a ACM e peça a exclusividade.",
};

const ETAPAS: { k: EtapaFunil; de: keyof Funil90; para: keyof Funil90 }[] = [
  { k: "lig_v1", de: "ligacoes", para: "v1" },
  { k: "v1_v2", de: "v1", para: "v2" },
  { k: "v2_capt", de: "v2", para: "captacoes" },
];

export type Gargalo =
  | {
      tipo: "gargalo";
      etapa: EtapaFunil;
      taxa: number;
      taxaEquipe: number;
      texto: string;
      dica: string;
    }
  | { tipo: "pouco_dado"; texto: string }
  | { tipo: "sem_gargalo"; texto: string };

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Aponta a etapa com a maior queda relativa, só se o corretor tiver >= 5 no início dela e converter pelo
 * menos 30% menos que a equipe. Sem nenhuma etapa com >= 5 no início: "pouco dado ainda". Com dados mas
 * sem queda de 30%: sem gargalo ("—").
 */
export function gargalo(eu: Funil90, equipe: Funil90): Gargalo {
  let melhor: { k: EtapaFunil; taxa: number; taxaEq: number; queda: number } | null = null;
  let algumComDado = false;
  for (const e of ETAPAS) {
    const inicio = eu[e.de];
    if (inicio < GARGALO_MIN_INICIO) continue;
    algumComDado = true;
    const taxaEq = equipe[e.de] > 0 ? equipe[e.para] / equipe[e.de] : 0;
    if (!(taxaEq > 0)) continue;
    const taxa = eu[e.para] / inicio;
    const queda = 1 - taxa / taxaEq;
    if (queda >= GARGALO_QUEDA - 1e-9 && (!melhor || queda > melhor.queda))
      melhor = { k: e.k, taxa, taxaEq, queda };
  }
  if (melhor)
    return {
      tipo: "gargalo",
      etapa: melhor.k,
      taxa: melhor.taxa,
      taxaEquipe: melhor.taxaEq,
      texto: `${ETAPA_ROTULO[melhor.k]}. Você converte ${pct(melhor.taxa)}, a equipe ${pct(melhor.taxaEq)}.`,
      dica: DICA_ETAPA[melhor.k],
    };
  return algumComDado
    ? { tipo: "sem_gargalo", texto: "—" }
    : { tipo: "pouco_dado", texto: "pouco dado ainda" };
}

// --- Parte 3: previsão do trimestre --------------------------------------------------------------------------

/** Trimestre civil de `hoje` (aaaa-mm-dd): meses "aaaa-mm" e quantos meses vêm DEPOIS do mês atual. */
export function trimestreDe(hoje: string) {
  const a = Number(hoje.slice(0, 4));
  const m = Number(hoje.slice(5, 7));
  const primeiro = Math.floor((m - 1) / 3) * 3 + 1;
  const meses = [0, 1, 2].map((i) => `${a}-${String(primeiro + i).padStart(2, "0")}`);
  const ultimoDia = new Date(Date.UTC(a, primeiro + 2, 0)).getUTCDate();
  return {
    numero: (primeiro + 2) / 3,
    meses,
    inicio: `${meses[0]}-01`,
    fim: `${meses[2]}-${String(ultimoDia).padStart(2, "0")}`,
    mesesRestantes: primeiro + 2 - m,
  };
}

export const PESO_ANDAMENTO = 0.8;
export const PESO_RITMO = 0.5;

export type Previsao = {
  valor: number;
  recebido: number;
  andamento: number;
  ritmoMensal: number;
  mesesRestantes: number;
  meta: number | null;
  /** % da meta do trimestre (null sem meta). */
  pctMeta: number | null;
  frase: string;
};

const round2 = (v: number) => Math.round(v * 100) / 100;
const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/**
 * Previsão = VGC recebido no trimestre + 80% do VGC das vendas em andamento + 50% do ritmo médio mensal ×
 * meses que faltam. Sem meta cadastrada, só o valor previsto.
 */
export function previsaoTrimestre(i: {
  recebido: number;
  andamento: number;
  ritmoMensal: number;
  mesesRestantes: number;
  meta: number | null;
}): Previsao {
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  const recebido = n(i.recebido);
  const andamento = n(i.andamento);
  const ritmoMensal = n(i.ritmoMensal);
  const meses = Math.max(0, Math.floor(i.mesesRestantes));
  const valor = round2(recebido + PESO_ANDAMENTO * andamento + PESO_RITMO * ritmoMensal * meses);
  const meta = i.meta != null && i.meta > 0 ? i.meta : null;
  const resto =
    meses > 0
      ? ` + metade do ritmo médio (${brl(ritmoMensal)}/mês) × ${plural(meses, "mês que falta", "meses que faltam")}`
      : "";
  return {
    valor,
    recebido,
    andamento,
    ritmoMensal,
    mesesRestantes: meses,
    meta,
    pctMeta: meta ? Math.round((valor / meta) * 100) : null,
    frase: `= ${brl(recebido)} já recebidos + 80% de ${brl(andamento)} em vendas em andamento${resto}.`,
  };
}

// --- Parte 4: conversa 1:1 ---------------------------------------------------------------------------------------

export const DIAS_PROXIMA_1A1 = 14;
export const MAX_COMBINADOS = 20;
export const MAX_TEXTO_COMBINADO = 300;

/** Próxima 1:1 sugerida: 14 dias depois da conversa (editável na tela; o banco aplica o mesmo padrão). */
export const proximaSugerida = (data: string) => somarDias(data, DIAS_PROXIMA_1A1);

/** 1:1 atrasada = a data combinada para a próxima já passou e não houve conversa depois dela. */
export function umAUmAtrasada(proxima: string | null, hoje: string): boolean {
  return proxima != null && proxima < hoje;
}

export type Combinado = { texto: string; feito: boolean | null };

/** Limpa a lista de combinados (vazios fora, texto cortado, no máximo 20) — o banco repete a validação. */
export function normalizarCombinados(
  lista: readonly { texto: string; feito?: boolean | null }[],
): Combinado[] {
  return lista
    .map((c) => ({ texto: c.texto.trim().slice(0, MAX_TEXTO_COMBINADO), feito: c.feito ?? null }))
    .filter((c) => c.texto.length > 0)
    .slice(0, MAX_COMBINADOS);
}

export type Pauta = {
  versao: 1;
  numeros: Record<string, number | string | null>;
  sinais: Sinal[];
  pendencias: { kind: string; imovel: string | null; detalhe: string }[];
  combinados_anteriores: Combinado[];
};

/** Pauta automática (o retrato é gravado junto com a conversa e o corretor vê tudo). */
export function montarPauta(i: {
  numeros: Pauta["numeros"];
  farol: Pick<LinhaFarol, "acesos">;
  pendencias: readonly { kind: string; imovel: string | null; detalhe: string }[];
  anteriores: readonly Combinado[];
}): Pauta {
  return {
    versao: 1,
    numeros: { ...i.numeros },
    sinais: i.farol.acesos.map((s) => ({ ...s })),
    pendencias: i.pendencias.map((p) => ({ kind: p.kind, imovel: p.imovel, detalhe: p.detalhe })),
    combinados_anteriores: normalizarCombinados(i.anteriores),
  };
}
