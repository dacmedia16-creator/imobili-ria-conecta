/**
 * Mural de Conquistas — regras puras do aviso com confete (venda assinada em tempo real).
 *
 * O evento chega pelo Realtime (INSERT em `achievement_posts`, ver docs/mural-conquistas-backend.md).
 * Aqui só ficam as decisões de tela, sem React e sem Supabase, para serem testadas isoladamente:
 *  - o que mostrar (nomes e papéis; NUNCA valor, comissão ou cliente);
 *  - quando NÃO mostrar (módulo desligado, silenciado, revogado, outra imobiliária, já visto);
 *  - quais conquistas a pessoa já viu (localStorage por usuário).
 */

export const CELEBRATION_DURATION_MS = 4000;
export const SEEN_LIMIT = 200;
export const MUTE_EVENT = "adm-max:mural-mute";

const seenKey = (userId: string) => `adm-max:mural-vistos:v1:${userId}`;
const muteKey = (userId: string) => `adm-max:mural-silenciado:v1:${userId}`;

/** Só os campos que o aviso pode usar. Qualquer outro campo do payload é descartado. */
export type CelebrationPost = {
  id: string;
  organizationId: string;
  pessoas: { papel: "Captador" | "Vendedor" | "Coordenador/Broker"; nome: string }[];
  imovel: string | null;
};

type Row = Record<string, unknown>;
const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Converte `payload.new` em dados de tela. Formato inesperado = null (não comemora). */
export function parseCelebrationPost(raw: unknown): CelebrationPost | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Row;
  const id = texto(r.id);
  const organizationId = texto(r.organization_id);
  if (!id || !organizationId) return null;
  if (r.ativo !== true) return null; // revogada (ou sem a flag): nunca comemora
  const pessoas: CelebrationPost["pessoas"] = [];
  const captador = texto(r.captador_nome);
  const vendedor = texto(r.vendedor_nome);
  const coordenador = texto(r.coordenador_nome);
  if (captador) pessoas.push({ papel: "Captador", nome: captador });
  if (vendedor) pessoas.push({ papel: "Vendedor", nome: vendedor });
  if (coordenador) pessoas.push({ papel: "Coordenador/Broker", nome: coordenador });
  if (pessoas.length === 0) return null;
  const tipo = texto(r.tipo_imovel);
  const bairro = texto(r.bairro);
  const imovel = [tipo, bairro].filter(Boolean).join(" no ") || null;
  return { id, organizationId, pessoas, imovel };
}

export type CelebrationGate = {
  /** Módulo `mural_conquistas` ligado na imobiliária atual. */
  enabled: boolean;
  /** O próprio usuário silenciou as comemorações. */
  muted: boolean;
  /** Imobiliária atual do usuário (current_org_id). */
  organizationId: string | null;
  /** IDs de conquistas que este usuário já viu. */
  seen: ReadonlySet<string>;
};

/** Decide se o evento vira aviso. A RLS já filtra no servidor; aqui é a 2ª trava (falha fechada). */
export function shouldCelebrate(
  event: { eventType?: string; new?: unknown },
  gate: CelebrationGate,
): CelebrationPost | null {
  if (!gate.enabled || gate.muted || !gate.organizationId) return null;
  if (event.eventType && event.eventType !== "INSERT") return null; // reativação/revogação = UPDATE
  const post = parseCelebrationPost(event.new);
  if (!post) return null;
  if (post.organizationId !== gate.organizationId) return null;
  if (gate.seen.has(post.id)) return null;
  return post;
}

/** Frase do aviso, ex.: "Captador: Ana · Vendedor: Caio". */
export function celebrationPeopleText(post: CelebrationPost): string {
  return post.pessoas.map((p) => `${p.papel}: ${p.nome}`).join(" · ");
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readSeen(userId: string): Set<string> {
  try {
    const raw = storage()?.getItem(seenKey(userId));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** Marca como vista (mantém só as últimas SEEN_LIMIT para não crescer sem fim). */
export function markSeen(userId: string, postId: string): Set<string> {
  const atual = [...readSeen(userId)].filter((id) => id !== postId);
  atual.push(postId);
  const final = atual.slice(-SEEN_LIMIT);
  try {
    storage()?.setItem(seenKey(userId), JSON.stringify(final));
  } catch {
    /* navegador sem localStorage: vale só nesta aba */
  }
  return new Set(final);
}

/** Cópia local da preferência (o banco, `achievement_mutes`, é a fonte; isto evita piscar). */
export function readMutedLocal(userId: string): boolean {
  try {
    return storage()?.getItem(muteKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function writeMutedLocal(userId: string, muted: boolean) {
  try {
    storage()?.setItem(muteKey(userId), muted ? "1" : "0");
  } catch {
    /* ignora */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MUTE_EVENT, { detail: { userId, muted } }));
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}
