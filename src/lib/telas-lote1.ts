/**
 * Melhorias de tela, lote 1 (t_7bd432c2, itens 1-3 do t_d62be550). Só apresentação:
 * ordenar, paginar, agrupar e escrever textos. Nenhuma regra de quem vê ou de quem pode agir mora
 * aqui — isso continua na RLS e nas RPCs (PR #412, #413 e #414).
 */
import { encerrado, type Lead, type LeadBanco } from "@/lib/leads";
import type { ItemFila } from "@/lib/crm";

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

// ---------------------------------------------------------------- paginação (Captação e Leads)

export type Pagina<T> = {
  itens: T[];
  /** Página atual (1, 2, 3…), já corrigida para o intervalo válido. */
  pagina: number;
  paginas: number;
  total: number;
  /** Posição do primeiro e do último item mostrados (1-based); 0 e 0 quando vazio. */
  de: number;
  ate: number;
};

/** Fatia uma lista já filtrada e ordenada. Página fora do intervalo cai na última válida. */
export function paginar<T>(lista: readonly T[], pagina: number, tamanho: number): Pagina<T> {
  const total = lista.length;
  const paginas = Math.max(1, Math.ceil(total / Math.max(1, tamanho)));
  const p = Math.min(Math.max(1, Math.floor(pagina) || 1), paginas);
  const ini = (p - 1) * tamanho;
  const itens = lista.slice(ini, ini + tamanho);
  return {
    itens,
    pagina: p,
    paginas,
    total,
    de: total ? ini + 1 : 0,
    ate: total ? ini + itens.length : 0,
  };
}

export const POR_PAGINA_CAPTACAO = 24;
export const POR_PAGINA_LEADS = 25;

// ---------------------------------------------------------------- tempo sem atendimento

/** Desde quando o lead está sem atendimento: última interação; se nunca houve, a chegada. */
export function semAtendimentoDesde(l: Pick<Lead, "ultima_interacao_em" | "created_at">): string {
  return l.ultima_interacao_em ?? l.created_at;
}

/** "agora", "40 min", "5 h", "3 dias". */
export function tempoCurto(ms: number): string {
  const m = Math.max(0, Math.floor(ms / MIN));
  if (m < 1) return "agora";
  if (m < 60) return `${m} min`;
  const h = Math.floor(ms / HORA);
  if (h < 24) return `${h} h`;
  const d = Math.floor(ms / DIA);
  return d === 1 ? "1 dia" : `${d} dias`;
}

export type Espera = { ms: number; texto: string; tom: "green" | "amber" | "red" | "slate" };

/**
 * Tempo sem atendimento com cor E texto (regra de Denis): até 1 dia verde, de 1 a 3 dias âmbar,
 * mais de 3 dias vermelho. Lead encerrado não conta (cinza, "Encerrado").
 */
export function esperaDoLead(
  l: Pick<Lead, "ultima_interacao_em" | "created_at" | "etapa">,
  agora = new Date(),
): Espera {
  if (encerrado(l.etapa)) return { ms: 0, texto: "Encerrado", tom: "slate" };
  const ms = Math.max(0, agora.getTime() - new Date(semAtendimentoDesde(l)).getTime());
  const tom = ms >= 3 * DIA ? "red" : ms >= DIA ? "amber" : "green";
  const prefixo = l.ultima_interacao_em ? "Sem contato há" : "Sem 1º contato há";
  return { ms, texto: `${prefixo} ${tempoCurto(ms)}`, tom };
}

/**
 * Ordem do painel: leads em aberto primeiro, do que está há MAIS tempo sem atendimento para o
 * mais recente; os encerrados (ganho/perdido) vão para o fim, do mais novo para o mais antigo.
 */
export function ordenarPorEspera<T extends Lead>(leads: readonly T[]): T[] {
  return [...leads].sort((a, b) => {
    const fa = encerrado(a.etapa) ? 1 : 0;
    const fb = encerrado(b.etapa) ? 1 : 0;
    if (fa !== fb) return fa - fb;
    if (fa) return b.updated_at.localeCompare(a.updated_at);
    return (
      semAtendimentoDesde(a).localeCompare(semAtendimentoDesde(b)) ||
      a.created_at.localeCompare(b.created_at)
    );
  });
}

/** Banco da imobiliária: quem está esperando há mais tempo aparece primeiro. */
export function ordenarBanco<T extends Pick<LeadBanco, "no_banco_desde" | "created_at">>(
  itens: readonly T[],
): T[] {
  return [...itens].sort(
    (a, b) =>
      a.no_banco_desde.localeCompare(b.no_banco_desde) || a.created_at.localeCompare(b.created_at),
  );
}

/** Primeira linha útil da mensagem do portal (sem links), para a linha compacta. */
export function resumoMensagem(msg: string | null | undefined, max = 90): string {
  if (!msg) return "";
  const limpa = msg
    .replace(/https?:\/\/\S+/g, "")
    .split(/\r?\n/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .find((s) => s.length > 0);
  if (!limpa) return "";
  return limpa.length > max ? `${limpa.slice(0, max - 1).trimEnd()}…` : limpa;
}

// ---------------------------------------------------------------- fila do dia

const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "Hoje, terça 24/11" a partir de AAAA-MM-DD (data de São Paulo). */
export function tituloHoje(hoje: string): string {
  const [a, m, d] = hoje.split("-").map(Number);
  const semana = DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
  return `Hoje, ${semana} ${hoje.slice(8, 10)}/${hoje.slice(5, 7)}`;
}

export type MotivoFila = ItemFila["motivo"];

export const GRUPOS_FILA: {
  motivo: MotivoFila;
  titulo: string;
  explica: string;
  tom: "blue" | "red" | "amber";
}[] = [
  {
    motivo: "aceite",
    titulo: "Aguardando aceite",
    explica: "Sua vez: aceite o lead.",
    tom: "blue",
  },
  {
    motivo: "atrasado",
    titulo: "Atrasados",
    explica: "O próximo contato já passou.",
    tom: "red",
  },
  {
    motivo: "sem",
    titulo: "Sem próximo passo",
    explica: "Defina quando falar de novo.",
    tom: "red",
  },
  {
    motivo: "hoje",
    titulo: "Para hoje",
    explica: "Contato marcado para hoje.",
    tom: "amber",
  },
];

/** Separa a fila (já ordenada por filaDoDia) nos 4 grupos, mantendo a ordem e os contadores. */
export function gruposDaFila(fila: readonly ItemFila[]) {
  return GRUPOS_FILA.map((g) => {
    const itens = fila.filter((i) => i.motivo === g.motivo);
    return { ...g, itens, total: itens.length };
  });
}
