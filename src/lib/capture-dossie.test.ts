import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  appendDossieToContract,
  buildDossiePdf,
  defaultDossieSelection,
  dossieCatalog,
  dossieMissingFor,
  groupDossie,
  initialDossieSelection,
  missingVitals,
  selectedDossie,
} from "./capture-dossie";
import { normalizeForm } from "./exclusive-captures";
import type { FeedbackAction } from "./owner-feedback-actions";

const a = (id: string, p: Partial<FeedbackAction> = {}): FeedbackAction => ({
  id,
  list: "marketing",
  category: "Fotos",
  label: `Ação ${id}`,
  weight: null,
  sort: Number(id.replace(/\D/g, "")) || 0,
  ...p,
});
const catalog: FeedbackAction[] = [
  a("m1", { weight: "vital" }),
  a("m2", { weight: "importante" }),
  a("m3", { category: "Portais", weight: "vital" }),
  a("c1", { list: "checklist", category: "V1", weight: "vital" }),
];

describe("Dossiê da captação", () => {
  it("usa só o plano de marketing, agrupado por categoria", () => {
    expect(dossieCatalog(catalog).map((x) => x.id)).toEqual(["m1", "m2", "m3"]);
    expect(groupDossie(catalog).map((g) => g.category)).toEqual(["Fotos", "Portais"]);
  });
  it("começa com as vitais marcadas e avisa vitais desmarcadas", () => {
    expect(defaultDossieSelection(catalog)).toEqual(["m1", "m3"]);
    expect(missingVitals(catalog, ["m1"]).map((x) => x.id)).toEqual(["m3"]);
    expect(missingVitals(catalog, ["m1", "m3"])).toEqual([]);
  });
  it("cadastro manual começa com as vitais; normal começa vazio; seleção salva prevalece", () => {
    expect(initialDossieSelection(catalog, undefined, true)).toEqual(["m1", "m3"]);
    expect(initialDossieSelection(catalog, undefined, false)).toEqual([]);
    expect(initialDossieSelection(catalog, ["m2"], true)).toEqual(["m2"]);
    expect(initialDossieSelection(catalog, [], true)).toEqual([]);
  });
  it("Plano de Marketing obrigatório: falta sem ação marcada; sem catálogo não trava", () => {
    expect(dossieMissingFor(catalog, [])).toBe(true);
    expect(dossieMissingFor(catalog, undefined)).toBe(true);
    expect(dossieMissingFor(catalog, ["c1"])).toBe(true); // checklist não conta
    expect(dossieMissingFor(catalog, ["m2"])).toBe(false);
    expect(dossieMissingFor([], [])).toBe(false);
  });
  it("ignora ids que saíram do catálogo ou são do checklist", () => {
    expect(selectedDossie(catalog, ["m2", "c1", "sumiu"]).map((x) => x.id)).toEqual(["m2"]);
  });
  it("normalizeForm preserva o Dossiê salvo e não inventa quando ausente", () => {
    expect(normalizeForm({}).dossie).toBeUndefined();
    expect(normalizeForm({ dossie: ["m1", 2 as unknown as string] }).dossie).toEqual(["m1"]);
    expect(normalizeForm({ dossie: [] }).dossie).toEqual([]);
  });
  it("gera PDF (com acento e emoji) e anexa ao fim do contrato", async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      a(`m${i + 10}`, { label: `Divulgação ação número ${i} com texto longo 😊 `.repeat(3) }),
    );
    const dossie = await buildDossiePdf({
      actions: many,
      selected: many.map((x) => x.id),
      ownerNames: ["José da Silva", ""],
      brokerName: "Corretora Teste",
      brokerCreci: "123456-F",
      property: { tipo: "Casa", endereco: "Rua A, 1", bairro: "Centro", municipio: "Sorocaba" },
      issuedOn: "06/10/2026",
    });
    const d = await PDFDocument.load(dossie);
    expect(d.getPageCount()).toBeGreaterThan(1);
    const contract = await PDFDocument.create();
    contract.addPage();
    contract.addPage();
    const merged = await PDFDocument.load(
      await appendDossieToContract(await contract.save(), dossie),
    );
    expect(merged.getPageCount()).toBe(2 + d.getPageCount());
  });
});
