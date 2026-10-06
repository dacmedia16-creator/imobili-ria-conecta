/**
 * PDF do Feedback ao Proprietário (A4, quantas páginas precisar).
 * Seções: imóvel, desempenho nos portais, plano de marketing executado, checklist do corretor,
 * próximas ações e recomendação. Mesma regra da mensagem: número só com período confirmado.
 */
import type { ListingFeedback } from "@/lib/owner-feedback";
import { nextActions, type ActionSummary } from "@/lib/owner-feedback-actions";

export interface OwnerPdfInput {
  listing: ListingFeedback;
  brokerName: string;
  ownerName: string;
  recommendation: string;
  /** Plano de marketing e checklist (opcionais; sem eles a seção não aparece). */
  marketing?: ActionSummary | null;
  checklist?: ActionSummary | null;
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
  type Page = ReturnType<typeof pdf.addPage>;
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`Relatório do imóvel ${input.listing.code}`));
  pdf.setProducer("ADM MAX");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const blue = rgb(0, 0.27, 0.55);
  const red = rgb(0.86, 0.08, 0.16);
  const green = rgb(0.1, 0.5, 0.25);
  const gray = rgb(0.4, 0.4, 0.4);
  const light = rgb(0.9, 0.92, 0.95);
  const PW = 595.28;
  const PH = 841.89;
  const M = 50;
  const W = PW - 2 * M;
  const BOTTOM = 70;
  let page: Page = pdf.addPage([PW, PH]);
  let y = PH - M;

  const newPage = () => {
    page = pdf.addPage([PW, PH]);
    y = PH - M;
  };
  const ensure = (h: number) => {
    if (y - h < BOTTOM) newPage();
  };
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
  const section = (title: string) => {
    ensure(50);
    y -= 6;
    text(title, M, 14, bold, blue);
    y -= 8;
    page.drawRectangle({ x: M, y: y - 2, width: W, height: 1.2, color: red });
    y -= 20;
  };
  const bar = (percent: number) => {
    page.drawRectangle({ x: M, y: y - 2, width: W, height: 8, color: light });
    if (percent > 0)
      page.drawRectangle({ x: M, y: y - 2, width: (W * percent) / 100, height: 8, color: green });
    y -= 22;
  };

  // Cabeçalho
  if (input.logoPng?.length) {
    try {
      const img = await pdf.embedPng(input.logoPng);
      const h = 42;
      page.drawImage(img, { x: M, y: y - h, width: (img.width / img.height) * h, height: h });
    } catch {
      // logo inválido: segue sem logo
    }
  }
  const issued = (input.issuedAt ?? new Date()).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  const issuedTxt = pdfSafe(`Emitido em ${issued}`);
  page.drawText(issuedTxt, {
    x: M + W - font.widthOfTextAtSize(issuedTxt, 9),
    y: y - 12,
    size: 9,
    font,
    color: gray,
  });
  y -= 70;
  text("Feedback do seu imóvel", M, 20, bold, blue);
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
  y -= 6;

  // Resumo em números (plano executado / vitais / checklist)
  const mk = input.marketing && input.marketing.total ? input.marketing : null;
  const ck = input.checklist && input.checklist.total ? input.checklist : null;
  if (mk || ck) {
    ensure(60);
    const boxes: Array<[string, string]> = [];
    if (mk) {
      boxes.push(["Plano executado", `${mk.percent}%`]);
      boxes.push(["Ações concluídas", `${mk.done} / ${mk.total}`]);
      if (mk.vitalTotal) boxes.push(["Ações vitais", `${mk.vitalDone} / ${mk.vitalTotal}`]);
    }
    if (ck) boxes.push(["Checklist do corretor", `${ck.done} / ${ck.total}`]);
    const bw = (W - (boxes.length - 1) * 8) / boxes.length;
    boxes.forEach(([k, v], i) => {
      const x = M + i * (bw + 8);
      page.drawRectangle({ x, y: y - 40, width: bw, height: 48, color: light });
      page.drawText(pdfSafe(v), { x: x + 8, y: y - 14, size: 16, font: bold, color: blue });
      page.drawText(pdfSafe(k), { x: x + 8, y: y - 32, size: 8, font, color: gray });
    });
    y -= 62;
  }

  // Números por portal
  section("Desempenho nos portais");
  const cols = [M, M + 190, M + 300, M + 400];
  ["Portal", "Visualizações", "Contatos", "Aparições em buscas"].forEach((h, i) =>
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
    ensure(32);
    text(l.label, cols[0], 10, bold);
    text(`${fmt(l.views)}${fmtDelta(l.viewsDelta)}`, cols[1], 10);
    text(`${fmt(l.contacts)}${fmtDelta(l.contactsDelta)}`, cols[2], 10);
    text(fmt(l.impressions), cols[3], 10);
    y -= 13;
    text(`Período: ${l.periodText}`, cols[0], 8, font, gray);
    y -= 17;
  }
  if (others.length)
    for (const ln of wrap(`Também anunciado em: ${others.map((l) => l.label).join(", ")}.`, 10)) {
      ensure(14);
      text(ln, M, 10, font, gray);
      y -= 14;
    }
  if (failed.length) {
    ensure(14);
    text(
      `Sem atualização nesta semana: ${failed.map((l) => l.label).join(", ")}.`,
      M,
      10,
      font,
      gray,
    );
    y -= 14;
  }
  y -= 6;

  // Listas de ações: mostra só o que foi feito (como o modelo atual).
  const doneList = (title: string, s: ActionSummary, withWeight: boolean) => {
    section(title);
    ensure(30);
    text(`${s.done} de ${s.total} ações concluídas (${s.percent}%)`, M, 10, font, gray);
    y -= 14;
    bar(s.percent);
    if (!s.done) {
      text("Nenhuma ação marcada ainda.", M, 10, font, gray);
      y -= 16;
      return;
    }
    for (const g of s.groups) {
      const done = g.items.filter((i) => i.done);
      if (!done.length) continue;
      ensure(36);
      text(g.category.toUpperCase(), M, 9, bold, blue);
      y -= 15;
      for (const it of done) {
        const lines = wrap(it.label, 10, font, W - 110);
        ensure(lines.length * 13 + 4);
        page.drawText("+", { x: M + 4, y, size: 10, font: bold, color: green });
        lines.forEach((ln, i) => {
          page.drawText(ln, { x: M + 18, y: y - i * 13, size: 10, font });
        });
        if (withWeight && it.weight) {
          const w = pdfSafe(it.weight);
          page.drawText(w, {
            x: M + W - font.widthOfTextAtSize(w, 8),
            y,
            size: 8,
            font,
            color: it.weight === "vital" ? red : gray,
          });
        }
        y -= lines.length * 13 + 3;
      }
      y -= 6;
    }
  };
  if (mk) doneList("Plano de marketing", mk, true);
  if (ck) doneList("Checklist do corretor", ck, false);

  // Próximas ações
  const next = mk ? nextActions(mk, 5) : [];
  if (next.length) {
    section("Próximas ações");
    for (const a of next) {
      const lines = wrap(a, 10, font, W - 18);
      ensure(lines.length * 13 + 4);
      page.drawText("-", { x: M + 4, y, size: 10, font: bold, color: blue });
      lines.forEach((ln, i) => page.drawText(ln, { x: M + 18, y: y - i * 13, size: 10, font }));
      y -= lines.length * 13 + 3;
    }
    y -= 6;
  }

  // Recomendação
  if (input.recommendation.trim()) {
    section("Recomendação do seu corretor");
    for (const ln of wrap(input.recommendation, 11)) {
      ensure(16);
      text(ln, M, 11);
      y -= 16;
    }
  }

  // Rodapé em todas as páginas
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 64 }, end: { x: M + W, y: 64 }, thickness: 0.5, color: gray });
    p.drawText(pdfSafe("Números informados pelos próprios portais de anúncio."), {
      x: M,
      y: 50,
      size: 8,
      font,
      color: gray,
    });
    const pg = `${i + 1}/${pages.length}`;
    p.drawText(pg, { x: M + W - font.widthOfTextAtSize(pg, 8), y: 50, size: 8, font, color: gray });
  });
  return pdf.save();
}
