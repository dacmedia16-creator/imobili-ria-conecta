/**
 * Painel de contadores da lista de Captações exclusivas e avisos do botão "Aprovar captação"
 * (t_f19b654f, aprovado por Denis em 15/10/2026). Só regras de tela: usa exatamente os dados que
 * a lista/tela já carregam (RLS decide o que cada pessoa vê); nada aqui fala com o banco.
 */
import type { Capture, CaptureDocument, CaptureEvent, CaptureStatus } from "./exclusive-captures";
import { hojeSaoPaulo } from "./hoje-sao-paulo";

export type PainelCardKey = "aguardando_gestor" | "em_assinatura" | "devolvidas" | "aprovadas_mes";

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
    classe: "border-red-300 bg-red-50 text-red-900",
  },
  {
    key: "aprovadas_mes",
    titulo: "Aprovadas no mês",
    frase: "Concluídas: exclusividade valendo.",
    classe: "border-emerald-300 bg-emerald-50 text-emerald-900",
  },
];

type CaptureLike = Pick<Capture, "status" | "archived_at" | "signed_on"> & {
  discarded_at?: string | null;
};

const STATUS_DO_CARD: Record<Exclude<PainelCardKey, "aprovadas_mes">, CaptureStatus> = {
  aguardando_gestor: "enviada",
  em_assinatura: "em_assinatura",
  devolvidas: "devolvida",
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
  const out = { aguardando_gestor: 0, em_assinatura: 0, devolvidas: 0, aprovadas_mes: 0 };
  for (const c of list) for (const card of PAINEL_CARDS) if (noCard(c, card.key, hoje)) out[card.key]++;
  return out;
}

/** Clicar no mesmo cartão limpa o filtro; clicar em outro troca. */
export function alternarCard(atual: PainelCardKey | null, clicado: PainelCardKey): PainelCardKey | null {
  return atual === clicado ? null : clicado;
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
 * só o próprio captador, antes da aprovação (enviada ou em_assinatura), captação não arquivada.
 * Gestor usa o campo do cartão de aprovação (ou "Corrigir data" depois de aprovada).
 */
export function podeCaptadorInformarData(
  c: Pick<Capture, "status" | "captor_id" | "archived_at">,
  userId: string | null | undefined,
  gestor: boolean,
): boolean {
  return (
    !gestor &&
    !!userId &&
    c.captor_id === userId &&
    !c.archived_at &&
    (c.status === "enviada" || c.status === "em_assinatura")
  );
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
  history: Pick<CaptureEvent, "action" | "created_at" | "actor_nome">[],
): string {
  const ultima = [...history]
    .filter((h) => h.action === "aprovar")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!ultima) return "Captação aprovada";
  const quem = ultima.actor_nome?.trim() || "gestor";
  return `Captação aprovada por ${quem} em ${dataHoraSaoPaulo(ultima.created_at)}`;
}

export { hojeSaoPaulo };
