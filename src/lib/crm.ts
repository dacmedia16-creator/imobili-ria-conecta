// CRM — dois funis (Venda e Captação) sobre o módulo Leads. Card t_188fb282; maquete aprovada por Denis
// em 29/10/2026. Lógica pura (sem imports de tela/banco). O banco (migration 20261029100000_crm_dois_funis)
// é a proteção real: RLS do módulo Leads + RPCs crm_* que exigem próximo contato, aceite e papel.
import { ORIGEM_LABEL, type Lead, type Origem } from "@/lib/leads";

/**
 * Etapas do CRM: as do módulo Leads + "avaliacao" e "acompanhamento" (só no funil de captação;
 * CHECK leads_etapa_do_funil). "acompanhamento" = Acompanhamento pós-dossiê (t_ab39e04e, Denis 27/11).
 */
export type Etapa =
  | "novo"
  | "em_atendimento"
  | "visita_agendada"
  | "avaliacao"
  | "proposta"
  | "acompanhamento"
  | "ganho"
  | "perdido";
const encerrado = (e: string) => e === "ganho" || e === "perdido";

// "locacao": t_d4c8b724 (Denis 24/11) — leads de aluguel (C2S "Aluguel" / portal RENT) entram nele sozinhos.
export const FUNIS = ["venda", "captacao", "locacao"] as const;
export type Funil = (typeof FUNIS)[number];

export type FunilDef = {
  nome: string;
  publico: string;
  etapas: readonly Etapa[];
  label: Partial<Record<Etapa, string>>;
  conv: string;
};

/** Etapas na ordem do quadro. Os nomes no banco são os do módulo Leads; só o rótulo muda por funil. */
export const FUNIL: Record<Funil, FunilDef> = {
  venda: {
    nome: "Funil de Venda",
    publico: "comprador",
    etapas: ["novo", "em_atendimento", "visita_agendada", "proposta", "ganho", "perdido"],
    label: {
      novo: "Novo",
      em_atendimento: "Em contato",
      visita_agendada: "Visita",
      proposta: "Proposta",
      ganho: "Fechado",
      perdido: "Perdido",
    },
    conv: "Converter em venda",
  },
  // Método Denis (t_ab39e04e, 27/11): 1ª visita conhece o proprietário, 2ª visita leva o dossiê e o
  // acompanhamento pós-dossiê fecha a exclusividade (80% das dele saíram depois do dia do dossiê).
  // Sem migrar dados: avaliacao e proposta só trocaram o rótulo; "acompanhamento" é a única etapa nova.
  captacao: {
    nome: "Funil de Captação",
    publico: "proprietário",
    etapas: [
      "novo",
      "em_atendimento",
      "avaliacao",
      "proposta",
      "acompanhamento",
      "ganho",
      "perdido",
    ],
    label: {
      novo: "Novo contato",
      em_atendimento: "Em contato",
      avaliacao: "1ª visita (conhecer o proprietário)",
      proposta: "2ª visita (dossiê)",
      acompanhamento: "Acompanhamento pós-dossiê",
      ganho: "Captado",
      perdido: "Perdido",
    },
    conv: "Converter em captação",
  },
  // Etapas aprovadas por Denis 24/11 ("1 ok sem contrato"): as mesmas do banco que a venda usa.
  // Sem conversão: o contrato de locação fica no módulo Locação (desligado na Única).
  locacao: {
    nome: "Funil de Locação",
    publico: "locação (inquilino)",
    etapas: ["novo", "em_atendimento", "visita_agendada", "proposta", "ganho", "perdido"],
    label: {
      novo: "Novo",
      em_atendimento: "Em contato",
      visita_agendada: "Visita",
      proposta: "Ficha/Análise de crédito",
      ganho: "Fechado",
      perdido: "Perdido",
    },
    conv: "",
  },
};

export const funilDe = (l: Pick<Lead, "funil">): Funil =>
  l.funil === "captacao" || l.funil === "locacao" ? l.funil : "venda";
export const nomeEtapa = (f: Funil, e: Etapa) => FUNIL[f].label[e] ?? e;

/** Data de hoje (AAAA-MM-DD) em São Paulo — a mesma do banco (crm_hoje). */
export function hojeSP(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

/** Soma dias a uma data AAAA-MM-DD (sem fuso). */
export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const x = new Date(Date.UTC(a, m - 1, d + dias));
  return x.toISOString().slice(0, 10);
}

/** "29/10" a partir de AAAA-MM-DD. */
export const diaMes = (iso: string | null | undefined) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "";

export type EstadoProximo = "fim" | "sem" | "atrasado" | "hoje" | "ok";

/** Situação do próximo contato: sem próximo passo e atrasado = alerta vermelho. */
export function estadoProximo(
  l: Pick<Lead, "etapa" | "proximo_contato_em">,
  hoje: string,
): EstadoProximo {
  if (encerrado(l.etapa)) return "fim";
  if (!l.proximo_contato_em) return "sem";
  if (l.proximo_contato_em < hoje) return "atrasado";
  if (l.proximo_contato_em === hoje) return "hoje";
  return "ok";
}
export const emAlerta = (e: EstadoProximo) => e === "sem" || e === "atrasado";

/** Dias desde a última movimentação (interação do responsável ou atualização do lead). */
export function diasParado(l: Pick<Lead, "ultima_interacao_em" | "updated_at" | "created_at">, agora = new Date()) {
  const base = l.ultima_interacao_em ?? l.updated_at ?? l.created_at;
  return Math.max(0, Math.floor((agora.getTime() - new Date(base).getTime()) / 86_400_000));
}
/** A partir de quantos dias sem movimento o lead aparece como "parado" (maquete: 5). */
export const DIAS_PARADO = 5;

export type Pedido = "nada" | "proximo" | "perda" | "fechar" | "bloqueado";

/**
 * O que a tela pede ao soltar o cartão em outra coluna (o banco repete as regras):
 * etapa aberta = próximo contato; perdido = motivo; Fechado/Captado = converter ou só mover.
 * Lead encerrado só o gestor reabre; lead aguardando aceite do próprio corretor não anda.
 */
export function pedidoAoMover(
  l: Pick<Lead, "etapa" | "funil">,
  para: Etapa,
  opts: { gestor: boolean; aguardandoAceite: boolean },
): Pedido {
  if (para === l.etapa) return "nada";
  if (!FUNIL[funilDe(l)].etapas.includes(para)) return "bloqueado";
  if (opts.aguardandoAceite) return "bloqueado";
  if (encerrado(l.etapa) && !opts.gestor) return "bloqueado";
  if (para === "perdido") return "perda";
  if (para === "ganho") return "fechar";
  return "proximo";
}

/** Validação do próximo contato (mesmas regras de crm_validar_proximo). Devolve o erro ou null. */
export function validarProximo(data: string, motivo: string, hoje: string): string | null {
  if (!data || !motivo.trim()) return "Informe a data e o motivo do próximo contato.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return "Data inválida.";
  if (data < hoje) return "A data do próximo contato não pode ser no passado.";
  if (data > somarDias(hoje, 366)) return "Data do próximo contato longe demais (até 1 ano).";
  if (motivo.trim().length > 200) return "Motivo longo demais (até 200 caracteres).";
  return null;
}

/** Acompanhamento pós-dossiê: próximo contato sugerido de 7 em 7 dias (Denis escolheu 7). */
export const DIAS_ACOMPANHAMENTO = 7;
export const MOTIVO_ACOMPANHAMENTO = "Perguntar como está a procura pelo imóvel";
/** Retorno sugerido no funil de venda (proposta recusada / visita não realizada). O 1º é o padrão. */
export const DIAS_RETORNO_VENDA = [7, 10, 15] as const;

export type SugestaoProximo = { data: string; motivo: string; atalhos: readonly number[] };

/**
 * Próximo contato pré-preenchido no diálogo (só sugestão: o corretor altera; data + motivo seguem
 * obrigatórios). `para` = etapa de destino; null = só registrar o contato, continuando na etapa.
 * - Captação → Acompanhamento pós-dossiê (ou registrar nele): hoje + 7 e motivo sugerido.
 * - Venda: proposta recusada (sai da Proposta para trás) ou visita não realizada (sai da Visita para
 *   trás), ou registrar contato parado na Visita/Proposta: hoje + 7, com atalhos 7/10/15 e sem motivo.
 * Fora disso: null (o diálogo mantém o comportamento de antes).
 */
export function sugestaoProximo(
  l: Pick<Lead, "etapa" | "funil">,
  para: Etapa | null,
  hoje: string,
): SugestaoProximo | null {
  const f = funilDe(l);
  const atual = l.etapa as Etapa;
  const destino = para ?? atual;
  if (f === "captacao") {
    return destino === "acompanhamento"
      ? { data: somarDias(hoje, DIAS_ACOMPANHAMENTO), motivo: MOTIVO_ACOMPANHAMENTO, atalhos: [] }
      : null;
  }
  if (f !== "venda") return null;
  const ordem = FUNIL.venda.etapas;
  const recuo =
    (atual === "proposta" || atual === "visita_agendada") &&
    (para === null || (ordem.indexOf(para) >= 0 && ordem.indexOf(para) < ordem.indexOf(atual)));
  if (!recuo || encerrado(destino)) return null;
  return { data: somarDias(hoje, DIAS_RETORNO_VENDA[0]), motivo: "", atalhos: DIAS_RETORNO_VENDA };
}

/** Lead vinculado a venda/captação (é o que conta como convertido). */
export const convertido = (l: Pick<Lead, "sale_id" | "capture_convertida_id">) =>
  Boolean(l.sale_id || l.capture_convertida_id);

export type ItemFila = { lead: Lead; motivo: "aceite" | "atrasado" | "sem" | "hoje" };

/**
 * Fila do dia: aguardando aceite → atrasados → sem próximo passo → hoje.
 * `meuId`: só os leads em que a pessoa é responsável (corretor). Sem `meuId`: todos os visíveis (gestor).
 */
export function filaDoDia(leads: Lead[], hoje: string, meuId?: string): ItemFila[] {
  const ordem = { aceite: 0, atrasado: 1, sem: 2, hoje: 3 } as const;
  const itens: ItemFila[] = [];
  for (const l of leads) {
    if (encerrado(l.etapa) || l.no_banco_desde || !l.responsavel_id) continue;
    if (meuId && l.responsavel_id !== meuId) continue;
    if (!l.aceito_em) {
      itens.push({ lead: l, motivo: "aceite" });
      continue;
    }
    const e = estadoProximo(l, hoje);
    if (e === "atrasado" || e === "sem" || e === "hoje") itens.push({ lead: l, motivo: e });
  }
  return itens.sort(
    (a, b) =>
      ordem[a.motivo] - ordem[b.motivo] ||
      (a.lead.proximo_contato_em ?? "").localeCompare(b.lead.proximo_contato_em ?? "") ||
      a.lead.created_at.localeCompare(b.lead.created_at),
  );
}

export type LinhaConversao = {
  chave: string;
  rotulo: string;
  leads: number;
  venda: number;
  captacao: number;
  pct: number | null;
};

function linha(chave: string, rotulo: string, ls: Lead[]): LinhaConversao {
  const venda = ls.filter((l) => l.sale_id).length;
  const captacao = ls.filter((l) => l.capture_convertida_id).length;
  return {
    chave,
    rotulo,
    leads: ls.length,
    venda,
    captacao,
    pct: ls.length ? Math.round(((venda + captacao) * 100) / ls.length) : null,
  };
}

function agrupar(leads: Lead[], chave: (l: Lead) => string) {
  const m = new Map<string, Lead[]>();
  for (const l of leads) {
    const k = chave(l);
    m.set(k, [...(m.get(k) ?? []), l]);
  }
  return m;
}

/** Visão do gestor: totais, parados/sem próximo passo e conversão por corretor e por origem/portal. */
export function resumoGestor(
  leads: Lead[],
  hoje: string,
  nomeDe: (id: string | null) => string,
  agora = new Date(),
) {
  const abertos = leads.filter((l) => !encerrado(l.etapa));
  const parados = abertos
    .filter((l) => l.responsavel_id && !l.no_banco_desde)
    .map((l) => ({ lead: l, estado: estadoProximo(l, hoje), dias: diasParado(l, agora) }))
    .filter((p) => emAlerta(p.estado) || p.dias >= DIAS_PARADO)
    .sort((a, b) => b.dias - a.dias);
  const convertidos = leads.filter(convertido).length;
  const porCorretor = [...agrupar(leads, (l) => l.responsavel_id ?? "")]
    .map(([k, ls]) => linha(k, k ? nomeDe(k) : "Sem responsável", ls))
    .sort((a, b) => b.leads - a.leads || a.rotulo.localeCompare(b.rotulo));
  const porOrigem = [...agrupar(leads, (l) => l.origem)]
    .map(([k, ls]) => linha(k, ORIGEM_LABEL[k as Origem] ?? k, ls))
    .sort((a, b) => b.leads - a.leads || a.rotulo.localeCompare(b.rotulo));
  return {
    total: leads.length,
    convertidos,
    pct: leads.length ? Math.round((convertidos * 100) / leads.length) : null,
    parados,
    porCorretor,
    porOrigem,
  };
}

/** Mensagens das RPCs do CRM em português de tela (as do módulo Leads continuam em mensagemErroLead). */
export function mensagemErroCrm(msg: string): string | null {
  const m = msg.toLowerCase();
  if (m.includes("modulo crm desligado")) return "O CRM está desligado nesta imobiliária.";
  if (m.includes("antes de converter")) return "O lead precisa ser aceito antes de converter.";
  if (m.includes("proximo contato invalida")) return "Data do próximo contato inválida.";
  if (m.includes("motivo do proximo contato longo")) return "Motivo longo demais (até 200 caracteres).";
  if (m.includes("proximo contato")) return "Informe a data e o motivo do próximo contato.";
  if (m.includes("so troca o funil")) return "O funil só pode ser trocado em Novo ou Em contato.";
  if (m.includes("funil de venda")) return "Só lead do funil de venda vira venda.";
  if (m.includes("funil de captacao")) return "Só lead do funil de captação vira captação.";
  if (m.includes("captacao exclusiva desligada")) return "A Captação exclusiva está desligada nesta imobiliária.";
  if (m.includes("so o corretor responsavel converte"))
    return "Só o corretor responsável converte em captação (ele vira o captador).";
  if (m.includes("ja tem venda em andamento")) return "Este imóvel já tem uma venda em andamento.";
  if (m.includes("nao cria venda")) return "Seu papel não cria venda.";
  if (m.includes("unidade inválida") || m.includes("unidade invalida")) return "Escolha a unidade da captação.";
  if (m.includes("preencha seu nome")) return "Preencha seu nome no perfil antes de criar a captação.";
  return null;
}
