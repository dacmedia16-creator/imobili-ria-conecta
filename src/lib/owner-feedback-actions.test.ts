import { describe, expect, it } from "vitest";
import { nextActions, summarizeActions, type FeedbackAction } from "./owner-feedback-actions";

const acts: FeedbackAction[] = [
  { id: "a", list: "marketing", category: "Fotos", label: "Fotos pro", weight: "vital", sort: 1 },
  {
    id: "b",
    list: "marketing",
    category: "Fotos",
    label: "Tour 360",
    weight: "importante",
    sort: 2,
  },
  { id: "c", list: "marketing", category: "Redes", label: "Instagram", weight: "vital", sort: 3 },
  { id: "d", list: "checklist", category: "V1", label: "Ouvir", weight: null, sort: 1 },
];

describe("summarizeActions", () => {
  it("calcula progresso, vitais e agrupa por categoria", () => {
    const s = summarizeActions(acts, { a: "2026-10-06" }, "marketing");
    expect(s.total).toBe(3);
    expect(s.done).toBe(1);
    expect(s.percent).toBe(33);
    expect(s.vitalTotal).toBe(2);
    expect(s.vitalDone).toBe(1);
    expect(s.groups.map((g) => g.category)).toEqual(["Fotos", "Redes"]);
    expect(s.groups[0].items[0].done).toBe(true);
  });
  it("lista vazia não divide por zero", () => {
    expect(summarizeActions([], {}, "checklist").percent).toBe(0);
  });
  it("próximas ações priorizam vitais pendentes", () => {
    const s = summarizeActions(acts, { a: "x" }, "marketing");
    expect(nextActions(s)).toEqual(["Instagram", "Tour 360"]);
  });
});
