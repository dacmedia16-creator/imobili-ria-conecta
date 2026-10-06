/**
 * PDF opcional do Feedback ao Proprietário (1 página A4).
 * Mesma regra da mensagem: número só com período confirmado; erro de coleta = "sem atualização".
 */
import type { ListingFeedback } from "@/lib/owner-feedback";

export interface OwnerPdfInput {
  listing: ListingFeedback;
  brokerName: string;
  ownerName: string;
  recommendation: string;
  /** PNG do logo (opcional; sem logo o PDF sai só com o título). */
  logoPng?: Uint8Array | null;
  /** Data de emissão (padrão: hoje). */
  issuedAt?: Date;
}

/** Helvetica padrão só cobre WinAnsi: troca o que não couber (emoji, aspas especiais). */
export function pdfSafe(t: string): string {
  return t
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E\u00A0-\u00FF\n]/g, "")
    .trim();
}

const fmt = (n: number | null) => (n == null ? "-" : n.toLocaleString("pt-BR"));
const fmtDelta = (n: number | null) => (n == null ? "" : ` (${n >= 0 ? "+" : ""}${n} na semana)`);

export function pdfFileName(code: string): string {
  return `feedback-${code.replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
}

export async function buildOwnerFeedbackPdf(input: OwnerPdfInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`Relatório do imóvel ${input.listing.code}`));
  pdf.setProducer("ADM MAX");
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const blue = rgb(0, 0.27, 0.55);
  const red = rgb(0.86, 0.08, 0.16);
  const gray = rgb(0.4, 0.4, 0.4);
  const M = 50;
  const W = 595.28 - 2 * M;
  let y = 841.89 - M;

  const text = (t: string, x: number, size = 11, f = font, color = rgb(0.1, 0.1, 0.1)) =>
    page.drawText(pdfSafe(t), { x, y, size, font: f, color });

  const wrap = (t: string, size: number, f = font, width = W): string[] => {
    const out: string[] = [];
    for (const para of pdfSafe(t).split("\n")) {
      let line = "";
      for (const w of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(next, size) > width && line) {
          out.push(line);
          line = w;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  };

  // Cabeçalho
  if (input.logoPng?.length) {
    try {
      const img = await pdf.embedPng(input.logoPng);
      const h = 42;
      const w = (img.width / img.height) * h;
      page.drawImage(img, { x: M, y: y - h, width: w, height: h });
    } catch {
      // logo inválido: segue sem logo
    }
  }
  const issued = (input.issuedAt ?? new Date()).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  page.drawText(pdfSafe(`Emitido em ${issued}`), {
    x: M + W - font.widthOfTextAtSize(pdfSafe(`Emitido em ${issued}`), 9),
    y: y - 12,
    size: 9,
    font,
    color: gray,
  });
  y -= 70;
  text("Relatório do seu imóvel", M, 20, bold, blue);
  y -= 8;
  page.drawRectangle({ x: M, y: y - 4, width: W, height: 2, color: red });
  y -= 26;

  const info: Array<[string, string]> = [
    ["Código do anúncio", input.listing.code],
    ["Proprietário(a)", input.ownerName.trim() || "-"],
    ["Corretor(a)", input.brokerName.trim() || "-"],
  ];
  for (const [k, v] of info) {
    text(`${k}:`, M, 11, bold);
    text(v, M + 130, 11);
    y -= 18;
  }
  y -= 12;

  // Números por portal
  text("Desempenho nos portais", M, 14, bold, blue);
  y -= 22;
  const cols = [M, M + 190, M + 300, M + 400];
  const head = ["Portal", "Visualizações", "Contatos", "Aparições em buscas"];
  head.forEach((h, i) =>
    page.drawText(pdfSafe(h), { x: cols[i], y, size: 10, font: bold, color: gray }),
  );
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.5, color: gray });
  y -= 16;

  const confirmed = input.listing.lines.filter((l) => l.confirmed && !l.error);
  const failed = input.listing.lines.filter((l) => l.error);
  const others = input.listing.lines.filter((l) => !l.confirmed && !l.error);
  if (!confirmed.length) {
    text("Ainda sem números com período confirmado nesta semana.", M, 10, font, gray);
    y -= 18;
  }
  for (const l of confirmed) {
    text(l.label, cols[0], 10, bold);
    text(`${fmt(l.views)}${fmtDelta(l.viewsDelta)}`, cols[1], 10);
    text(`${fmt(l.contacts)}${fmtDelta(l.contactsDelta)}`, cols[2], 10);
    text(fmt(l.impressions), cols[3], 10);
    y -= 13;
    text(`Período: ${l.periodText}`, cols[0], 8, font, gray);
    y -= 17;
  }
  if (others.length) {
    for (const ln of wrap(`Também anunciado em: ${others.map((l) => l.label).join(", ")}.`, 10)) {
      text(ln, M, 10, font, gray);
      y -= 14;
    }
  }
  if (failed.length) {
    text(
      `Sem atualização nesta semana: ${failed.map((l) => l.label).join(", ")}.`,
      M,
      10,
      font,
      gray,
    );
    y -= 14;
  }
  y -= 14;

  // Recomendação
  if (input.recommendation.trim()) {
    text("Recomendação do seu corretor", M, 14, bold, blue);
    y -= 20;
    for (const ln of wrap(input.recommendation, 11)) {
      if (y < 90) break;
      text(ln, M, 11);
      y -= 16;
    }
  }

  // Rodapé
  y = 50;
  page.drawLine({
    start: { x: M, y: y + 14 },
    end: { x: M + W, y: y + 14 },
    thickness: 0.5,
    color: gray,
  });
  text("Números informados pelos próprios portais de anúncio.", M, 8, font, gray);
  return pdf.save();
}
