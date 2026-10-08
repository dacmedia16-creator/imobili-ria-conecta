/**
 * Feedback ligado à captação exclusiva (migration 20261009010000).
 * - Ligação captação <-> anúncio: prefixo = ID RE/MAX do captador (travado); o corretor digita só o final.
 * - Plano de Marketing como checklist: prazo pela aprovação (essencial 7 dias, importante 14, complementar 30).
 * - Feedback ao proprietário: "O que já fizemos" e "Próximos passos" (atrasada aparece como "esta semana";
 *   o atraso só o gestor vê).
 * Regras puras aqui; o banco repete as mesmas regras nas RPCs.
 */

/** Mesma chave do banco (portal_code_key): 630601005-114 = 630601005x114 = 630601005XX0114. */
export function codeKey(code: string): string {
  const t = (code ?? "").trim().toUpperCase();
  const m = /^([0-9]{9})(?:-|X{1,2})([0-9]+)$/.exec(t);
  if (!m) return t;
  return `${m[1]}-${m[2].replace(/^0+/, "") || "0"}`;
}

/** Código completo válido (9 dígitos + separador + até 6 dígitos). */
export function codigoValido(code: string): boolean {
  return /^[0-9]{9}(?:-|X{1,2})[0-9]{1,6}$/.test((code ?? "").trim().toUpperCase());
}

/** Final digitado pelo corretor: só dígitos (aceita colar "-114" ou o código inteiro com o próprio prefixo). */
export function finalDigitado(raw: string, prefix: string): string {
  let t = (raw ?? "").trim().toUpperCase();
  if (prefix && t.startsWith(prefix)) t = t.slice(prefix.length);
  return t
    .replace(/^(?:-|X{1,2})/, "")
    .replace(/\D/g, "")
    .slice(0, 6);
}

/** Monta o código a partir do prefixo travado e do final; vazio se incompleto. */
export function montarCodigo(prefix: string | null | undefined, final: string): string {
  const f = finalDigitado(final, prefix ?? "");
  if (!prefix || !/^[0-9]{9}$/.test(prefix) || !f) return "";
  return `${prefix}-${f}`;
}

export type LinkStatus = "ativo" | "aguardando_gestor" | "recusado" | "encerrado";

export interface ListingSeen {
  collected_on: string;
  listing_code: string;
  portals: string[];
  views: number | null;
  contacts: number | null;
}

export interface ListingCheck {
  valid: boolean;
  code?: string;
  own_prefix?: boolean;
  id_owner_nome?: string | null;
  seen?: ListingSeen | null;
  next_monday?: string;
  conflict?: {
    capture_id: string;
    status: LinkStatus;
    label: string | null;
    aprovada_em: string | null;
  } | null;
}

export interface ListingContext {
  prefix: string | null;
  link: {
    id: string;
    listing_code: string;
    status: LinkStatus;
    outro_id: boolean;
    linked_at: string;
    decided_at: string | null;
    linked_by_nome: string | null;
    decided_by_nome: string | null;
    seen: ListingSeen | null;
  } | null;
  suggestions: { code: string; portals: string[]; views: number | null }[];
  latest_collection: string | null;
  next_monday: string;
  can_link: boolean;
  is_manager: boolean;
}

export type CheckState = "invalido" | "conflito" | "encontrado" | "nao_coletado";

/** Como a tela responde ao código conferido (maquete: encontrado / ainda não coletado / já ligado). */
export function checkState(c: ListingCheck | null | undefined): CheckState {
  if (!c || !c.valid) return "invalido";
  if (c.conflict) return "conflito";
  return c.seen ? "encontrado" : "nao_coletado";
}

export const PORTAL_CURTO: Record<string, string> = {
  zap: "ZAP",
  imovelweb: "Imovelweb",
  cliqueimudei: "Cliquei Mudei",
  chavesnamao: "Chaves na Mão",
};

export function portaisTexto(portals: string[] | null | undefined): string {
  const order = Object.keys(PORTAL_CURTO);
  const names = [...(portals ?? [])]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((p) => PORTAL_CURTO[p] ?? p);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`;
}

// ---------- Plano de Marketing ----------

export interface PlanItem {
  action_id: string;
  category: string;
  label: string;
  weight: "vital" | "importante" | "complementar" | null;
  sort: number;
  /** Ainda está no plano escolhido (false = saiu do plano depois de feita; fica só como registro). */
  in_plan: boolean;
  prazo: string | null;
  done_on: string | null;
  done_by_nome: string | null;
  proof_path: string | null;
  proof_name: string | null;
}

export type PlanItemState = "feito" | "atrasada" | "no_prazo" | "sem_prazo";

/** Datas no formato AAAA-MM-DD (comparação de texto = comparação de data). */
export function planItemState(it: PlanItem, hoje: string): PlanItemState {
  if (it.done_on) return "feito";
  if (!it.prazo) return "sem_prazo";
  return it.prazo < hoje ? "atrasada" : "no_prazo";
}

export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 864e5);
}

export interface PlanSummary {
  total: number;
  feitas: number;
  atrasadas: number;
  percent: number;
}

/** Só conta o que está no plano atual (ações que saíram do plano não entram no total). */
export function planSummary(items: PlanItem[], hoje: string): PlanSummary {
  const own = items.filter((i) => i.in_plan);
  const feitas = own.filter((i) => i.done_on).length;
  const atrasadas = own.filter((i) => planItemState(i, hoje) === "atrasada").length;
  return {
    total: own.length,
    feitas,
    atrasadas,
    percent: own.length ? Math.round((feitas / own.length) * 100) : 0,
  };
}

const br = (iso: string) => iso.slice(0, 10).split("-").reverse().slice(0, 2).join("/");

export interface OwnerPlan {
  feitas: { label: string; data: string }[];
  proximos: { label: string; quando: string }[];
  resumo: PlanSummary;
}

/**
 * O que vai para o proprietário: feitas com data (inclusive as que saíram do plano depois de feitas) e
 * pendentes do plano atual. Atrasada aparece como "esta semana"; o atraso só o gestor vê.
 */
export function ownerPlan(items: PlanItem[], hoje: string): OwnerPlan {
  const feitas = items
    .filter((i) => i.done_on)
    .sort((a, b) => (a.done_on ?? "").localeCompare(b.done_on ?? "") || a.sort - b.sort)
    .map((i) => ({ label: i.label, data: br(i.done_on as string) }));
  const rank = (i: PlanItem) =>
    planItemState(i, hoje) === "atrasada" ? "0000" : (i.prazo ?? "9999");
  const proximos = items
    .filter((i) => i.in_plan && !i.done_on)
    .sort((a, b) => rank(a).localeCompare(rank(b)) || a.sort - b.sort)
    .map((i) => ({
      label: i.label,
      quando: !i.prazo || i.prazo <= hoje ? "esta semana" : br(i.prazo),
    }));
  return { feitas, proximos, resumo: planSummary(items, hoje) };
}

/** Bloco de texto do plano para o WhatsApp (sem emoji: alguns aparelhos trocam por "?"). */
export function ownerPlanText(p: OwnerPlan, maxItens = 6): string {
  const lista = <T>(xs: T[], f: (x: T) => string) => {
    const shown = xs.slice(0, maxItens).map(f);
    if (xs.length > maxItens) shown.push(`e mais ${xs.length - maxItens}`);
    return shown.join("; ");
  };
  const partes: string[] = [];
  if (p.feitas.length)
    partes.push(
      `O que já fizemos: ${lista(p.feitas, (f) => `${lowerFirst(f.label)} (${f.data})`)}.`,
    );
  if (p.proximos.length)
    partes.push(
      `Próximos passos: ${lista(p.proximos, (x) => `${lowerFirst(x.label)} (${x.quando})`)}.`,
    );
  return partes.join("\n\n");
}

function lowerFirst(s: string): string {
  return s && /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

// ---------- Painel do gestor ----------

export type PendenciaKind = "sem_anuncio" | "nao_coletado" | "confirmar" | "atrasada";

export interface Pendencia {
  kind: PendenciaKind;
  capture_id: string;
  imovel: string | null;
  corretor: string | null;
  aprovada_em: string | null;
  dias: number | null;
  listing_code: string | null;
  link_id: string | null;
  /** atrasada: rótulo da ação; confirmar: nome do dono do outro ID. */
  acao: string | null;
  prazo: string | null;
}

/** Dias sem anúncio ligado até o aviso ao gestor (proposta: 7; o banco aceita 1 a 90). */
export const DIAS_AVISO_SEM_ANUNCIO = 7;

export function agruparPendencias(rows: Pendencia[]): Record<PendenciaKind, Pendencia[]> {
  const out: Record<PendenciaKind, Pendencia[]> = {
    sem_anuncio: [],
    nao_coletado: [],
    confirmar: [],
    atrasada: [],
  };
  for (const r of rows) out[r.kind]?.push(r);
  out.sem_anuncio.sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0));
  out.nao_coletado.sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0));
  out.atrasada.sort((a, b) => (a.prazo ?? "").localeCompare(b.prazo ?? ""));
  return out;
}
