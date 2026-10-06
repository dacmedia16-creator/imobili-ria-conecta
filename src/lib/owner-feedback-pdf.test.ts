import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupByListing, type Snapshot } from "./owner-feedback";
import { buildOwnerFeedbackPdf, pdfFileName, pdfSafe } from "./owner-feedback-pdf";

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
  it("gera PDF de 1 página com logo, sem quebrar com emoji", async () => {
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
});
