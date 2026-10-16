// Minha carreira, PR 1 (card t_07d196a7): regras puras dos blocos "O que fazer hoje",
// "Minhas captações" e "Oportunidades para mim". Os dados vêm das RPCs minhas_pendencias e
// minhas_captacoes (migração 20261016100000), sempre do corretor logado na imobiliária ativa.
import { captureMatches, type CaptureCandidate, type OpportunityPost } from "@/lib/oportunidades";

export type PendenciaKind = "devolvida" | "documentos" | "atrasada" | "vencendo" | "sem_anuncio";

export type Pendencia = {
  kind: PendenciaKind;
  capture_id: string;
  imovel: string | null;
  detalhe: string;
  prazo: string | null;
  dias: number | null;
};

export type MinhaCaptacao = {
  capture_id: string;
  imovel: string | null;
  status: string;
  listing_code: string | null;
  coletado_em: string | null;
  views: number | null;
  contacts: number | null;
  /** null = sem base confiável para decidir (nunca inventamos número). */
  parado: boolean | null;
  vence_em: string | null;
  dias_restantes: number | null;
};

/** Regra de "imóvel parado" (sugestão aprovada na maquete; número ajustável depois). */
export const PARADO_DIAS = 30;
export const PARADO_MIN_VIEWS = 50;

const PESO: Record<PendenciaKind, number> = {
  devolvida: 0,
  vencendo: 1,
  atrasada: 2,
  documentos: 3,
  sem_anuncio: 4,
};

export const ROTULO_PENDENCIA: Record<PendenciaKind, string> = {
  devolvida: "Devolvida",
  documentos: "Documentos",
  atrasada: "Plano atrasado",
  vencendo: "Exclusividade",
  sem_anuncio: "Sem anúncio",
};

/**
 * Da mais urgente para a menos urgente: tipo (devolvida > vencendo > atrasada > documentos >
 * sem anúncio) e, dentro do tipo, quem está mais perto/além do prazo primeiro.
 */
export function ordenarPendencias(lista: Pendencia[]): Pendencia[] {
  const urg = (p: Pendencia) => {
    if (p.dias == null) return 0;
    // "vencendo" traz dias que faltam (negativo = já venceu); os outros, dias de atraso.
    return p.kind === "vencendo" ? p.dias : -p.dias;
  };
  return [...lista].sort((a, b) => PESO[a.kind] - PESO[b.kind] || urg(a) - urg(b));
}

export function textoDias(p: Pendencia): string | null {
  if (p.dias == null) return null;
  if (p.kind === "vencendo") {
    if (p.dias < 0) return `venceu há ${-p.dias} dia${p.dias === -1 ? "" : "s"}`;
    if (p.dias === 0) return "vence hoje";
    return `faltam ${p.dias} dia${p.dias === 1 ? "" : "s"}`;
  }
  if (p.kind === "sem_anuncio") return `aprovada há ${p.dias} dias`;
  return `${p.dias} dia${p.dias === 1 ? "" : "s"} de atraso`;
}

export function textoNumerosPortal(
  c: Pick<MinhaCaptacao, "views" | "contacts" | "listing_code">,
): string {
  if (!c.listing_code) return "Sem anúncio ligado";
  if (c.views == null || c.contacts == null) return "Sem dado dos portais nos últimos 30 dias";
  return `${c.views} visualizaç${c.views === 1 ? "ão" : "ões"} · ${c.contacts} contato${c.contacts === 1 ? "" : "s"}`;
}

export function filtrarCaptacoes(lista: MinhaCaptacao[], soParadas: boolean): MinhaCaptacao[] {
  return soParadas ? lista.filter((c) => c.parado === true) : lista;
}

/** Pedidos do grupo que encaixam nas captações do próprio corretor (reaproveita o encaixe do mural). */
export function oportunidadesParaMim(
  posts: OpportunityPost[],
  captures: CaptureCandidate[],
  hidden: Set<string>,
  userId: string,
  now = new Date(),
): { post: OpportunityPost; capture: CaptureCandidate }[] {
  const minhas = captures.filter((c) => c.captor_id === userId);
  return captureMatches(posts, minhas, hidden, now).sort((a, b) =>
    b.post.posted_at.localeCompare(a.post.posted_at),
  );
}
