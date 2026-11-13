/**
 * Painel de contadores da lista de Captações exclusivas e avisos do botão "Aprovar captação"
 * (t_f19b654f, aprovado por Denis em 15/10/2026). Só regras de tela: usa exatamente os dados que
 * a lista/tela já carregam (RLS decide o que cada pessoa vê); nada aqui fala com o banco.
 */
import type { Capture, CaptureDocument, CaptureEvent, CaptureStatus } from "./exclusive-captures";
import { hojeSaoPaulo } from "./hoje-sao-paulo";

export type PainelCardKey =
  "aguardando_gestor" | "em_assinatura" | "devolvidas" | "aprovadas_mes" | "aprovadas_total";

export type PainelCard = {
  key: PainelCardKey;
  titulo: string;
  /** De quem é a vez (padrão do Denis: cor + frase). */
  frase: string;
  /** Classes do cartão (cor) — destaque laranja para a vez do gestor. */
  classe: string;
};

export const PAINEL_CARDS: PainelCard[] = [
  {
    key: "aguardando_gestor",
    titulo: "Aguardando gestor",
    frase: "Vez do gestor: conferir e aprovar.",
    classe: "border-orange-300 bg-orange-50 text-orange-900",
  },
  {
    key: "em_assinatura",
    titulo: "Em assinatura",
    frase: "Vez do proprietário: assinar o contrato.",
    classe: "border-sky-300 bg-sky-50 text-sky-900",
  },
  {
    key: "devolvidas",
    titulo: "Devolvidas",
    frase: "Vez do corretor: ajustar e reenviar.",
    classe: "border-amber-300 bg-amber-50 text-amber-900",
  },
  {
    key: "aprovadas_mes",
    titulo: "Aprovadas no mês",
    frase: "Concluídas: exclusividade valendo.",
    classe: "border-emerald-300 bg-emerald-50 text-emerald-900",
  },
  // Denis 27/10/2026 (t_7a5f8410): total de aprovadas, sem filtro de data.
  {
    key: "aprovadas_total",
    titulo: "Aprovadas (total)",
    frase: "Exclusividades aprovadas e não arquivadas.",
    classe: "border-teal-300 bg-teal-50 text-teal-900",
  },
];

type CaptureLike = Pick<Capture, "status" | "archived_at" | "signed_on"> & {
  discarded_at?: string | null;
};

const STATUS_DO_CARD: Record<Exclude<PainelCardKey, "aprovadas_mes">, CaptureStatus> = {
  aguardando_gestor: "enviada",
  em_assinatura: "em_assinatura",
  devolvidas: "devolvida",
  aprovadas_total: "aprovada",
};

/** Ativa = não arquivada e não descartada (a lista principal já mostra só essas). */
export function captacaoAtiva(c: CaptureLike): boolean {
  return !c.archived_at && !c.discarded_at;
}

/**
 * Captação pertence ao cartão? "Aprovadas no mês" usa signed_on (data de assinatura do contrato,
 * gravada na aprovação) no mês corrente de São Paulo. Aprovada sem signed_on fica de fora: a lista
 * não carrega o histórico de cada captação, e buscar evento por evento custaria uma consulta por
 * item. `hoje` = data civil AAAA-MM-DD em São Paulo.
 */
export function noCard(c: CaptureLike, key: PainelCardKey, hoje: string): boolean {
  if (!captacaoAtiva(c)) return false;
  if (key === "aprovadas_mes")
    return c.status === "aprovada" && !!c.signed_on && c.signed_on.slice(0, 7) === hoje.slice(0, 7);
  return c.status === STATUS_DO_CARD[key];
}

export function contarPainel(list: CaptureLike[], hoje: string): Record<PainelCardKey, number> {
  const out = {
    aguardando_gestor: 0,
    em_assinatura: 0,
    devolvidas: 0,
    aprovadas_mes: 0,
    aprovadas_total: 0,
  };
  for (const c of list)
    for (const card of PAINEL_CARDS) if (noCard(c, card.key, hoje)) out[card.key]++;
  return out;
}

/** Clicar no mesmo cartão limpa o filtro; clicar em outro troca. */
export function alternarCard(
  atual: PainelCardKey | null,
  clicado: PainelCardKey,
): PainelCardKey | null {
  return atual === clicado ? null : clicado;
}

// ---------------------------------------------------------------------------------------------
// Etapas visíveis na lista (t_abf93125, maquete aprovada por Denis em 13/11/2026). Só tela: os 5
// status reais viram 4 passos; nenhuma regra, permissão ou dado muda.

export type EtapaCaptacao = "corretor" | "gestor" | "assinatura" | "aprovada";

export const ETAPAS_CAPTACAO: { key: EtapaCaptacao; label: string; chip: string }[] = [
  { key: "corretor", label: "Corretor", chip: "Com o corretor" },
  { key: "gestor", label: "Gestor", chip: "Com o gestor" },
  { key: "assinatura", label: "Assinatura", chip: "Em assinatura" },
  { key: "aprovada", label: "Aprovada", chip: "Aprovada" },
];

const ETAPA_DO_STATUS: Record<CaptureStatus, EtapaCaptacao> = {
  rascunho: "corretor",
  devolvida: "corretor",
  enviada: "gestor",
  em_assinatura: "assinatura",
  aprovada: "aprovada",
};

export function etapaCaptacao(status: CaptureStatus): EtapaCaptacao {
  return ETAPA_DO_STATUS[status];
}

/** Índice 0..3 da etapa (para a barra). */
export function indiceEtapa(status: CaptureStatus): number {
  return ETAPAS_CAPTACAO.findIndex((e) => e.key === ETAPA_DO_STATUS[status]);
}

/** Selo da etapa no canto do cartão (mesmas cores de cores-status: laranja = vez do gestor). */
export const SELO_ETAPA: Record<CaptureStatus, { texto: string; classe: string }> = {
  rascunho: { texto: "Com o corretor", classe: "bg-slate-100 text-slate-700" },
  devolvida: { texto: "Devolvida ao corretor", classe: "bg-amber-100 text-amber-900" },
  enviada: { texto: "Com o gestor", classe: "bg-orange-100 text-orange-800" },
  em_assinatura: { texto: "Em assinatura", classe: "bg-sky-100 text-sky-800" },
  aprovada: { texto: "Aprovada", classe: "bg-emerald-100 text-emerald-800" },
};

/** Quem está olhando a lista. `liderados` = fetchLedMemberIds (mesma hierarquia de is_lead_of). */
export type ContextoVez = {
  userId: string | null | undefined;
  admin: boolean;
  /** Tem papel gestor ou team_leader. */
  gestor: boolean;
  liderados: ReadonlySet<string>;
};

type CaptacaoVez = Pick<Capture, "status" | "captor_id" | "archived_at"> & {
  discarded_at?: string | null;
};

/**
 * Pode agir como gestor nesta captação? Réplica na tela de exclusive_is_manager: admin/super_admin
 * em qualquer uma; gestor/TL só quando o captador é ele mesmo ou alguém que ele lidera
 * (is_lead_of: equipe, líder auxiliar ou subequipe). Só o papel NÃO basta: um gestor que enxerga
 * outras equipes não pode ver "Sua vez" nas captações delas.
 * shortcut: os liderados vêm de team_members/teams/team_co_leaders lidos pelo navegador; se a RLS
 * esconder alguma equipe dele, o selo some (falha para o lado seguro, o banco continua decidindo).
 */
export function podeGerirCaptacao(c: Pick<Capture, "captor_id">, ctx: ContextoVez): boolean {
  if (ctx.admin) return true;
  if (!ctx.gestor || !ctx.userId) return false;
  return c.captor_id === ctx.userId || ctx.liderados.has(c.captor_id);
}

/**
 * "Sua vez": a próxima ação é de quem está olhando.
 * - Corretor (qualquer papel): as próprias captações em rascunho ou devolvidas.
 * - Gestor: as enviadas que ele pode gerir (podeGerirCaptacao).
 * Em assinatura a vez é do proprietário (maquete aprovada), e aprovada já terminou.
 */
export function captacaoMinhaVez(c: CaptacaoVez, ctx: ContextoVez): boolean {
  if (!captacaoAtiva(c) || !ctx.userId) return false;
  if (c.status === "rascunho" || c.status === "devolvida") return c.captor_id === ctx.userId;
  if (c.status === "enviada") return podeGerirCaptacao(c, ctx);
  return false;
}

export type FiltroEtapa = "minha_vez" | "todas" | EtapaCaptacao;

export function noFiltroEtapa(c: CaptacaoVez, filtro: FiltroEtapa, ctx: ContextoVez): boolean {
  if (filtro === "todas") return true;
  if (filtro === "minha_vez") return captacaoMinhaVez(c, ctx);
  return etapaCaptacao(c.status) === filtro;
}

/** Contadores dos chips, só das captações ativas (as arquivadas têm botão próprio). */
export function contarEtapas(list: CaptacaoVez[], ctx: ContextoVez): Record<FiltroEtapa, number> {
  const out: Record<FiltroEtapa, number> = {
    minha_vez: 0,
    todas: 0,
    corretor: 0,
    gestor: 0,
    assinatura: 0,
    aprovada: 0,
  };
  for (const c of list) {
    if (!captacaoAtiva(c)) continue;
    out.todas++;
    out[etapaCaptacao(c.status)]++;
    if (captacaoMinhaVez(c, ctx)) out.minha_vez++;
  }
  return out;
}

export const AVISO_SEM_ASSINADO = "Anexe o contrato assinado (PDF) para liberar a aprovação.";
/** Texto de aprovarBloqueio() para a mesma falta — a tela esconde para não repetir o aviso âmbar. */
export const BLOQUEIO_SEM_ASSINADO = "Anexe o contrato assinado antes de aprovar.";

/** Aviso âmbar sob o botão enquanto não houver documento `assinado` (o botão fica desativado). */
export function avisoSemAssinado(docs: Pick<CaptureDocument, "kind">[]): string | null {
  return docs.some((d) => d.kind === "assinado") ? null : AVISO_SEM_ASSINADO;
}

/** Menor data de assinatura aceita pelo banco (exclusive_set_signed_on, 20261015150000). */
export const DATA_ASSINATURA_MIN = "2000-01-01";

/**
 * Mostra o campo "Informe a data em que o contrato foi assinado" ao captador? Mesma regra do banco:
 * só o próprio captador, antes da aprovação (enviada ou em_assinatura), captação não arquivada e
 * com o contrato ASSINADO válido já anexado (t_77132312: sem assinatura não há data de assinatura).
 * Gestor usa o campo do cartão de aprovação (ou "Corrigir data" depois de aprovada).
 */
export function podeCaptadorInformarData(
  c: Pick<Capture, "status" | "captor_id" | "archived_at">,
  userId: string | null | undefined,
  gestor: boolean,
  temAssinado: boolean,
): boolean {
  return (
    temAssinado &&
    !gestor &&
    !!userId &&
    c.captor_id === userId &&
    !c.archived_at &&
    (c.status === "enviada" || c.status === "em_assinatura")
  );
}

/**
 * Início do detalhe gravado por clicksign_attach_signed na aprovação automática (migration 20261123120000).
 * O autor gravado é o captador (actor_id é obrigatório), mas a tela mostra "automaticamente", sem nome.
 */
export const PREFIXO_APROVACAO_AUTOMATICA = "Aprovada automaticamente:";

/**
 * Captação do próprio gestor/team leader (Denis 22/10/2026, t_83e2ee96): quem envia já é quem
 * revisaria, então "Enviar" não para em "Enviada ao gestor" esperando ele mesmo — envia e já gera o
 * PDF para assinatura no mesmo clique. Mesma regra do banco: exclusive_is_manager aceita o próprio
 * captador gestor/TL (captor_id = actor). Cadastro manual fica de fora (não tem PDF gerado).
 */
export function captacaoDoProprioGestor(
  c: Pick<Capture, "captor_id" | "manual">,
  userId: string | null | undefined,
  gestor: boolean,
): boolean {
  return gestor && !!userId && c.captor_id === userId && !c.manual;
}

const FORMATO_DATA_HORA_SP = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "15/10/2026 às 10:31" no horário de Brasília. */
export function dataHoraSaoPaulo(iso: string): string {
  const partes = Object.fromEntries(
    FORMATO_DATA_HORA_SP.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${partes.day}/${partes.month}/${partes.year} às ${partes.hour}:${partes.minute}`;
}

/**
 * "Captação aprovada por Fulano em dd/mm/aaaa às hh:mm" (último evento `aprovar` do histórico).
 * Sem evento: só "Captação aprovada". Nome, nunca UUID (sem nome: "gestor").
 */
export function textoAprovacao(
  history: (Pick<CaptureEvent, "action" | "created_at" | "actor_nome"> & {
    detail?: string | null;
  })[],
): string {
  const ultima = [...history]
    .filter((h) => h.action === "aprovar")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!ultima) return "Captação aprovada";
  // Aprovada pelo banco ao chegar o assinado da Clicksign (t_e433a198, toda captação desde t_2cbd375c).
  if (ultima.detail?.startsWith(PREFIXO_APROVACAO_AUTOMATICA))
    return `Captação aprovada automaticamente em ${dataHoraSaoPaulo(ultima.created_at)} (contrato assinado pela Clicksign)`;
  const quem = ultima.actor_nome?.trim() || "gestor";
  return `Captação aprovada por ${quem} em ${dataHoraSaoPaulo(ultima.created_at)}`;
}

export { hojeSaoPaulo };
