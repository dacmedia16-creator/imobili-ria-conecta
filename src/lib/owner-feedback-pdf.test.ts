import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupByListing, type Snapshot } from "./owner-feedback";
import { buildOwnerFeedbackPdf, pdfFileName, pdfSafe } from "./owner-feedback-pdf";
import { summarizeActions, type FeedbackAction } from "./owner-feedback-actions";

const snap = (p: Partial<Snapshot>): Snapshot => ({
  portal: "imovelweb",
  collected_on: "2026-10-06",
  listing_code: "630601001-12",
  broker_id: "b1",
  window_kind: "last30",
  window_from: "2026-09-06",
  window_to: "2026-10-05",
  impressions: 900,
  views: 120,
  contacts: 3,
  error: null,
  ...p,
});

describe("PDF do feedback", () => {
  it("gera PDF sem plano: 1 página com logo, sem quebrar com emoji", async () => {
    const listing = groupByListing([
      snap({}),
      snap({ portal: "zap", window_kind: "unknown", views: 999 }),
      snap({ portal: "cliqueimudei", error: "timeout", views: null }),
    ])[0];
    const bytes = await buildOwnerFeedbackPdf({
      listing,
      brokerName: "Ana Corretora",
      ownerName: "João 😊",
      recommendation: "Ótima exposição — seguimos acompanhando os interessados.",
      logoPng: new Uint8Array(readFileSync("public/remax-logo-transparent.png")),
      issuedAt: new Date("2026-10-06T12:00:00Z"),
    });
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(bytes.length).toBeGreaterThan(5000);
  });
  it("limpa caracteres fora da fonte e monta nome do arquivo", () => {
    expect(pdfSafe("Oi 😊 “ok” — já")).toBe('Oi  "ok" - já');
    expect(pdfFileName("630601001-12")).toBe("feedback-630601001-12.pdf");
  });
  it("com plano de marketing grande, quebra em várias páginas", async () => {
    const listing = groupByListing([snap({})])[0];
    const acts: FeedbackAction[] = Array.from({ length: 80 }, (_, i) => ({
      id: `a${i}`,
      list: i < 50 ? "marketing" : "checklist",
      category: `Categoria ${Math.floor(i / 8)}`,
      label: `Ação número ${i} com um texto um pouco mais longo para testar a quebra de linha no PDF`,
      weight: i < 50 ? (i % 3 === 0 ? "vital" : "importante") : null,
      sort: i,
    }));
    const done = Object.fromEntries(
      acts.filter((_, i) => i % 2 === 0).map((a) => [a.id, "2026-10-06"]),
    );
    const bytes = await buildOwnerFeedbackPdf({
      listing,
      brokerName: "Ana",
      ownerName: "João",
      recommendation: "Seguimos.",
      marketing: summarizeActions(acts, done, "marketing"),
      checklist: summarizeActions(acts, done, "checklist"),
      issuedAt: new Date("2026-10-06T12:00:00Z"),
    });
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});
