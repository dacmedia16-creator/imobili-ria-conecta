import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  acoesSemSemana,
  ajustarSemanas,
  buildDossiePdf,
  intervaloSemana,
  semanaSugerida,
  semanasDaAcao,
  semanasTexto,
  totalSemanasPlano,
} from "./capture-dossie";
import { normalizeForm } from "./exclusive-captures";
import {
  ownerPlan,
  ownerPlanText,
  planItemKey,
  semanaRotulo,
  type PlanItem,
} from "./feedback-captacao";
import type { FeedbackAction } from "./owner-feedback-actions";

const a = (id: string, weight: FeedbackAction["weight"]): FeedbackAction => ({
  id,
  list: "marketing",
  category: "Divulgação",
  label: `Ação ${id}`,
  weight,
  sort: Number(id.replace(/\D/g, "")) || 0,
});
const catalog = [a("m1", "vital"), a("m2", "importante"), a("m3", "complementar")];

describe("Plano por semanas: regras", () => {
  it("semana N vai de aprovação + 7×(N−1) até aprovação + 7×N − 1", () => {
    expect(intervaloSemana("2026-10-09", 1)).toEqual({ inicio: "2026-10-09", fim: "2026-10-15" });
    expect(intervaloSemana("2026-10-09", 2)).toEqual({ inicio: "2026-10-16", fim: "2026-10-22" });
    expect(intervaloSemana("2026-12-28", 1).fim).toBe("2027-01-03");
  });
  it("total de semanas: até a última semana da exclusividade; sem prazo = 4 (padrão)", () => {
    expect(totalSemanasPlano({ aprovadaEm: "2026-10-09", fimExclusividade: "2027-04-07" })).toEqual(
      {
        total: 26,
        padrao: false,
      },
    );
    expect(totalSemanasPlano({ prazoDias: "90" })).toEqual({ total: 13, padrao: false });
    expect(totalSemanasPlano({ prazoDias: "" })).toEqual({ total: 4, padrao: true });
    expect(totalSemanasPlano({})).toEqual({ total: 4, padrao: true });
    expect(totalSemanasPlano({ prazoDias: "3650" }).total).toBe(104);
  });
  it("sugestão pela regra atual: essencial S1, importante S2, complementar S4 (limitada ao total)", () => {
    expect(semanaSugerida("vital", 26)).toBe(1);
    expect(semanaSugerida("importante", 26)).toBe(2);
    expect(semanaSugerida("complementar", 26)).toBe(4);
    expect(semanaSugerida("complementar", 3)).toBe(3);
    expect(semanaSugerida(null, 26)).toBe(4);
  });
  it("ao marcar ação, já sugere a semana; mantém as escolhidas; tira desmarcadas", () => {
    expect(ajustarSemanas(catalog, ["m1", "m2", "m3"], undefined, 8)).toEqual({
      m1: [1],
      m2: [2],
      m3: [4],
    });
    expect(ajustarSemanas(catalog, ["m2"], { m1: [1], m2: [3, 1, 3] }, 8)).toEqual({ m2: [1, 3] });
    // Semana além do fim da exclusividade sai.
    expect(ajustarSemanas(catalog, ["m1"], { m1: [1, 9] }, 8)).toEqual({ m1: [1] });
  });
  it("exige ao menos 1 semana por ação marcada (só no plano novo)", () => {
    expect(acoesSemSemana(catalog, ["m1", "m2"], { m1: [1], m2: [] }).map((x) => x.id)).toEqual([
      "m2",
    ]);
    expect(acoesSemSemana(catalog, ["m1", "m2"], undefined)).toEqual([]);
  });
  it("texto das semanas, com 'Toda semana'", () => {
    expect(semanasTexto([1])).toBe("Semana 1");
    expect(semanasTexto([1, 2, 4])).toBe("Semanas 1, 2 e 4");
    expect(semanasTexto([1, 2, 3, 4], 4)).toBe("Toda semana (1 a 4)");
    expect(semanasDaAcao({ x: [3, 0, 2, 2] }, "x")).toEqual([2, 3]);
  });
  it("normalizeForm guarda as semanas válidas e não inventa quando ausente", () => {
    expect(normalizeForm({}).plano_semanas).toBeUndefined();
    expect(
      normalizeForm({ plano_semanas: { m1: [1, 0, 2.5, 3, 200] } as Record<string, number[]> })
        .plano_semanas,
    ).toEqual({ m1: [1, 3] });
  });
});

const item = (o: Partial<PlanItem>): PlanItem => ({
  action_id: "a1",
  category: "Divulgação",
  label: "Post nas redes",
  weight: "importante",
  sort: 1,
  in_plan: true,
  prazo: null,
  done_on: null,
  done_by_nome: null,
  proof_path: null,
  proof_name: null,
  semana: 0,
  semana_inicio: null,
  ...o,
});

describe("Feedback ao proprietário com semanas", () => {
  const hoje = "2026-10-20";
  const s = (n: number, extra: Partial<PlanItem> = {}) =>
    item({
      semana: n,
      semana_inicio: intervaloSemana("2026-10-09", n).inicio,
      prazo: intervaloSemana("2026-10-09", n).fim,
      ...extra,
    });

  it("Próximos passos mostram 'Semana N (dd/mm a dd/mm)'; feito mostra a data em que foi feito", () => {
    const p = ownerPlan([s(1, { done_on: "2026-10-10" }), s(2), s(3)], hoje);
    expect(p.feitas).toEqual([{ label: "Post nas redes", data: "10/10" }]);
    expect(p.proximos.map((x) => x.quando)).toEqual([
      "Semana 2 (16/10 a 22/10)",
      "Semana 3 (23/10 a 29/10)",
    ]);
    expect(ownerPlanText(p)).toContain("post nas redes — Semana 2 (16/10 a 22/10)");
    expect(ownerPlanText(p)).not.toContain("((");
  });
  it("semana vencida aparece como 'esta semana' (o atraso só o gestor vê), sem repetir", () => {
    const p = ownerPlan(
      [s(1), item({ action_id: "a1", semana: 0, prazo: "2026-10-01", in_plan: false })],
      hoje,
    );
    expect(p.proximos).toEqual([{ label: "Post nas redes", quando: "esta semana" }]);
    const dup = ownerPlan([s(1), s(2, { prazo: "2026-10-12" })], hoje);
    expect(dup.proximos).toHaveLength(1);
  });
  it("plano antigo continua com a data do prazo", () => {
    const p = ownerPlan([item({ prazo: "2026-11-08" })], hoje);
    expect(p.proximos[0].quando).toBe("08/11");
  });
  it("cada semana é um item próprio: chave e rótulo", () => {
    expect(planItemKey(s(2))).toBe("a1:2");
    expect(planItemKey(item({}))).toBe("a1:0");
    expect(semanaRotulo(s(2))).toBe("Semana 2 (16/10 a 22/10)");
    expect(semanaRotulo(item({ prazo: "2026-10-16" }))).toBe("");
  });
});

describe("PDF do Plano para assinatura com semanas", () => {
  it("gera com a linha 'Quando' por ação (plano novo) e sem ela no plano antigo", async () => {
    const base = {
      actions: catalog,
      selected: ["m1", "m2"],
      ownerNames: ["Proprietário Fictício"],
      brokerName: "Corretor Fictício",
      property: { tipo: "Casa", bairro: "Jardim Fictício" },
    };
    const novo = await buildDossiePdf({
      ...base,
      semanas: { m1: [1], m2: [1, 2, 3, 4] },
      totalSemanas: 4,
    });
    const antigo = await buildDossiePdf(base);
    expect((await PDFDocument.load(novo)).getPageCount()).toBeGreaterThanOrEqual(1);
    expect(novo.length).toBeGreaterThan(antigo.length);
  });
});
