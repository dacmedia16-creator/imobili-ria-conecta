/**
 * Plano de marketing + checklist do corretor (Feedback ao Proprietário).
 * Lista única por imobiliária; o corretor marca o que já fez em cada imóvel.
 */
export type ActionList = "marketing" | "checklist";
export type ActionWeight = "vital" | "importante" | "complementar" | null;

export interface FeedbackAction {
  id: string;
  list: ActionList;
  category: string;
  label: string;
  weight: ActionWeight;
  sort: number;
}

export interface ActionGroup {
  category: string;
  items: Array<FeedbackAction & { done: boolean; doneAt: string | null }>;
}

export interface ActionSummary {
  total: number;
  done: number;
  percent: number;
  vitalTotal: number;
  vitalDone: number;
  groups: ActionGroup[];
}

export const WEIGHT_LABEL: Record<string, string> = {
  vital: "essencial",
  importante: "importante",
  complementar: "complementar",
};

/** Agrupa por categoria (na ordem do catálogo) e calcula o progresso. */
export function summarizeActions(
  actions: FeedbackAction[],
  doneAt: Record<string, string>,
  list: ActionList,
): ActionSummary {
  const own = actions.filter((a) => a.list === list).sort((a, b) => a.sort - b.sort);
  const groups: ActionGroup[] = [];
  for (const a of own) {
    let g = groups.find((x) => x.category === a.category);
    if (!g) {
      g = { category: a.category, items: [] };
      groups.push(g);
    }
    g.items.push({ ...a, done: a.id in doneAt, doneAt: doneAt[a.id] ?? null });
  }
  const done = own.filter((a) => a.id in doneAt).length;
  const vital = own.filter((a) => a.weight === "vital");
  return {
    total: own.length,
    done,
    percent: own.length ? Math.round((done / own.length) * 100) : 0,
    vitalTotal: vital.length,
    vitalDone: vital.filter((a) => a.id in doneAt).length,
    groups,
  };
}

/** Próximas ações sugeridas: pendentes, vitais primeiro, na ordem do catálogo. */
export function nextActions(s: ActionSummary, max = 5): string[] {
  const pend = s.groups.flatMap((g) => g.items.filter((i) => !i.done));
  const rank = (w: ActionWeight) => (w === "vital" ? 0 : w === "importante" ? 1 : 2);
  return pend
    .sort((a, b) => rank(a.weight) - rank(b.weight) || a.sort - b.sort)
    .slice(0, max)
    .map((i) => i.label);
}
