/**
 * PDF do Feedback ao Proprietário (A4, quantas páginas precisar).
 * Visual: faixa azul RE/MAX no topo, cartão do imóvel, cartões de resumo, tabela de portais,
 * ações concluídas com selo de peso, próximas ações numeradas e recomendação em destaque.
 * Regra de dados: número só com período confirmado; erro de coleta = "sem atualização".
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
  /** PNG do logo (opcional). */
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
const delta = (n: number | null) => (n == null || n === 0 ? "" : `${n > 0 ? "+" : ""}${n}`);

export function pdfFileName(code: string): string {
  return `feedback-${code.replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
}

export async function buildOwnerFeedbackPdf(input: OwnerPdfInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  type Color = ReturnType<typeof rgb>;
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`Feedback do imóvel ${input.listing.code}`));
  pdf.setProducer("ADM MAX");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Paleta RE/MAX
  const BLUE = rgb(0, 0.24, 0.65);
  const BLUE_DARK = rgb(0, 0.16, 0.42);
  const RED = rgb(0.86, 0.11, 0.18);
  const GREEN = rgb(0.13, 0.6, 0.33);
  const INK = rgb(0.13, 0.15, 0.2);
  const MUTED = rgb(0.45, 0.48, 0.55);
  const LINE = rgb(0.87, 0.89, 0.93);
  const SOFT = rgb(0.96, 0.97, 0.99);
  const BLUE_SOFT = rgb(0.92, 0.95, 1);
  const WHITE = rgb(1, 1, 1);

  const PW = 595.28;
  const PH = 841.89;
  const M = 44;
  const W = PW - 2 * M;
  const BOTTOM = 64;
  let page = pdf.addPage([PW, PH]);
  let y = PH; // topo do próximo bloco (coordenada PDF)

  // ---------- primitivas ----------
  const s = (t: string) => pdfSafe(t);
  const tw = (t: string, size: number, f = font) => f.widthOfTextAtSize(s(t), size);
  const txt = (t: string, x: number, base: number, size = 10, f = font, color: Color = INK) =>
    page.drawText(s(t), { x, y: base, size, font: f, color });
  const txtRight = (t: string, xr: number, base: number, size = 10, f = font, color: Color = INK) =>
    txt(t, xr - tw(t, size, f), base, size, f, color);
  /** Retângulo arredondado; (x, top) = canto superior esquerdo. */
  const box = (
    x: number,
    top: number,
    w: number,
    h: number,
    r: number,
    fill?: Color,
    border?: Color,
  ) => {
    r = Math.min(r, h / 2, w / 2);
    const p = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
    page.drawSvgPath(p, {
      x,
      y: top,
      color: fill,
      borderColor: border,
      borderWidth: border ? 0.8 : 0,
    });
  };
  const wrap = (t: string, size: number, width: number, f = font): string[] => {
    const out: string[] = [];
    for (const para of s(t).split("\n")) {
      let line = "";
      for (const w of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(next, size) > width && line) {
          out.push(line);
          line = w;
        } else line = next;
      }
      if (line) out.push(line);
    }
    return out;
  };
  const check = (cx: number, cy: number, r = 6) => {
    page.drawCircle({ x: cx, y: cy, size: r, color: GREEN });
    page.drawSvgPath(`M ${-r * 0.45} 0 L ${-r * 0.1} ${r * 0.38} L ${r * 0.5} ${-r * 0.35}`, {
      x: cx,
      y: cy,
      borderColor: WHITE,
      borderWidth: 1.4,
    });
  };
  // ---------- cabeçalhos e paginação ----------
  const header = (first: boolean) => {
    if (first) {
      const H = 118;
      page.drawRectangle({ x: 0, y: PH - H, width: PW, height: H, color: BLUE });
      page.drawRectangle({ x: 0, y: PH - H - 4, width: PW, height: 4, color: RED });
      txt("GESTÃO DO SEU IMÓVEL  ·  RE/MAX", M, PH - 40, 8.5, bold, rgb(0.75, 0.83, 1));
      txt("Feedback do imóvel", M, PH - 70, 26, bold, WHITE);
      const issued = (input.issuedAt ?? new Date()).toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
      });
      txt(`Relatório emitido em ${issued}`, M, PH - 92, 10, font, rgb(0.85, 0.9, 1));
      y = PH - H - 4 - 22;
    } else {
      page.drawRectangle({ x: 0, y: PH - 30, width: PW, height: 30, color: BLUE });
      page.drawRectangle({ x: 0, y: PH - 32, width: PW, height: 2, color: RED });
      txt("Feedback do imóvel", M, PH - 20, 10, bold, WHITE);
      txtRight(input.listing.code, M + W, PH - 20, 10, bold, WHITE);
      y = PH - 32 - 24;
    }
  };
  const newPage = () => {
    page = pdf.addPage([PW, PH]);
    header(false);
  };
  const ensure = (h: number) => {
    if (y - h < BOTTOM) newPage();
  };
  const section = (title: string, right?: string) => {
    ensure(70);
    page.drawRectangle({ x: M, y: y - 14, width: 4, height: 14, color: RED });
    txt(title.toUpperCase(), M + 12, y - 12, 12, bold, BLUE_DARK);
    if (right) txtRight(right, M + W, y - 12, 9, font, MUTED);
    y -= 26;
  };

  header(true);

  // Logo num cartão branco sobre a faixa azul
  if (input.logoPng?.length) {
    try {
      const img = await pdf.embedPng(input.logoPng);
      const lh = 46;
      const lw = (img.width / img.height) * lh;
      const bw = lw + 24;
      box(M + W - bw, PH - 26, bw, lh + 20, 8, WHITE);
      page.drawImage(img, { x: M + W - bw + 12, y: PH - 26 - 10 - lh, width: lw, height: lh });
    } catch {
      // logo inválido: segue sem logo
    }
  }

  // ---------- cartão do imóvel ----------
  {
    const h = 92;
    box(M, y, W, h, 10, SOFT, LINE);
    const half = (W - 56) / 2;
    const col = (label: string, value: string, x: number, top: number) => {
      txt(label.toUpperCase(), x, top - 18, 7.5, bold, MUTED);
      txt(wrap(value || "-", 12, half, bold)[0] ?? "-", x, top - 34, 12, bold, INK);
    };
    const x1 = M + 18;
    const x2 = M + 18 + half + 20;
    col("Código do anúncio", input.listing.code, x1, y);
    col("Proprietário(a)", input.ownerName.trim(), x2, y);
    page.drawLine({
      start: { x: x1, y: y - 46 },
      end: { x: M + W - 18, y: y - 46 },
      thickness: 0.6,
      color: LINE,
    });
    col("Corretor(a) responsável", input.brokerName.trim(), x1, y - 44);
    col("Anunciado em", input.listing.lines.map((l) => l.label).join(", "), x2, y - 44);
    y -= h + 20;
  }

  // ---------- cartões de resumo ----------
  const mk = input.marketing && input.marketing.total ? input.marketing : null;
  const ck = input.checklist && input.checklist.total ? input.checklist : null;
  const confirmed = input.listing.lines.filter((l) => l.confirmed && !l.error);
  const sum = (k: "views" | "contacts") => confirmed.reduce((a, l) => a + (l[k] ?? 0), 0);
  {
    const kpis: Array<{ v: string; k: string; accent: Color; pct?: number }> = [];
    if (confirmed.length) {
      kpis.push({ v: fmt(sum("views")), k: "Visualizações", accent: BLUE });
      kpis.push({ v: fmt(sum("contacts")), k: "Contatos recebidos", accent: BLUE });
    }
    if (mk) {
      kpis.push({ v: `${mk.percent}%`, k: "Plano executado", accent: GREEN, pct: mk.percent });
    }
    if (ck && kpis.length < 4)
      kpis.push({ v: `${ck.done}/${ck.total}`, k: "Checklist", accent: GREEN });
    if (kpis.length) {
      const gap = 10;
      const bw = (W - gap * (kpis.length - 1)) / kpis.length;
      const h = 74;
      kpis.forEach((c, i) => {
        const x = M + i * (bw + gap);
        box(x, y, bw, h, 10, WHITE, LINE);
        page.drawRectangle({ x: x + 14, y: y - 14, width: 22, height: 3, color: c.accent });
        txt(c.v, x + 14, y - 42, 22, bold, INK);
        txt(c.k.toUpperCase(), x + 14, y - 57, 7.5, bold, MUTED);
        if (c.pct != null) {
          box(x + 14, y - 63, bw - 28, 4, 2, LINE);
          if (c.pct > 0)
            box(x + 14, y - 63, Math.max(4, ((bw - 28) * c.pct) / 100), 4, 2, c.accent);
        }
      });
      y -= h + 26;
    }
  }

  // ---------- portais ----------
  section("Desempenho nos portais");
  {
    const c0 = M + 14;
    const c1 = M + 230;
    const c2 = M + 340;
    const cR = M + W - 14;
    const headH = 24;
    box(M, y, W, headH, 6, BLUE);
    txt("PORTAL", c0, y - 15.5, 8, bold, WHITE);
    txt("VISUALIZAÇÕES", c1, y - 15.5, 8, bold, WHITE);
    txt("CONTATOS", c2, y - 15.5, 8, bold, WHITE);
    txtRight("APARIÇÕES EM BUSCAS", cR, y - 15.5, 8, bold, WHITE);
    y -= headH;
    if (!confirmed.length) {
      txt("Ainda sem números com período confirmado nesta semana.", c0, y - 20, 10, font, MUTED);
      y -= 30;
    }
    confirmed.forEach((l, i) => {
      const rh = 40;
      ensure(rh);
      if (i % 2 === 1) page.drawRectangle({ x: M, y: y - rh, width: W, height: rh, color: SOFT });
      txt(l.label, c0, y - 17, 11, bold, INK);
      txt(`Período: ${l.periodText}`, c0, y - 30, 7.5, font, MUTED);
      const num = (v: number | null, d: number | null, x: number) => {
        txt(fmt(v), x, y - 22, 13, bold, BLUE_DARK);
        const dt = delta(d);
        if (dt) txt(`${dt} na semana`, x, y - 33, 7, bold, (d ?? 0) >= 0 ? GREEN : RED);
      };
      num(l.views, l.viewsDelta, c1);
      num(l.contacts, l.contactsDelta, c2);
      txtRight(fmt(l.impressions), cR, y - 22, 13, bold, BLUE_DARK);
      y -= rh;
      page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.5, color: LINE });
    });
    const others = input.listing.lines.filter((l) => !l.confirmed && !l.error);
    const failed = input.listing.lines.filter((l) => l.error);
    y -= 16;
    const note = (t: string) => {
      for (const ln of wrap(t, 8.5, W - 4)) {
        ensure(12);
        txt(ln, M + 2, y, 8.5, font, MUTED);
        y -= 12;
      }
    };
    if (others.length)
      note(
        `Também anunciado em ${others.map((l) => l.label).join(", ")}. Os números desses portais entram no relatório assim que o período for confirmado.`,
      );
    if (failed.length)
      note(`Sem atualização nesta semana: ${failed.map((l) => l.label).join(", ")}.`);
    y -= 16;
  }

  // ---------- listas de ações (só o que foi feito) ----------
  const doneList = (title: string, sm: ActionSummary) => {
    section(title, `${sm.done} de ${sm.total} ações concluídas · ${sm.percent}%`);
    box(M, y, W, 8, 4, LINE);
    if (sm.percent > 0) box(M, y, Math.max(8, (W * sm.percent) / 100), 8, 4, GREEN);
    y -= 22;
    if (!sm.done) {
      txt("Nenhuma ação marcada ainda.", M, y - 4, 10, font, MUTED);
      y -= 24;
      return;
    }
    for (const g of sm.groups) {
      const done = g.items.filter((i) => i.done);
      if (!done.length) continue;
      ensure(50);
      box(M, y, W, 22, 6, BLUE_SOFT);
      txt(g.category.toUpperCase(), M + 12, y - 14.5, 8, bold, BLUE_DARK);
      txtRight(`${done.length} de ${g.items.length}`, M + W - 12, y - 14.5, 8, bold, BLUE_DARK);
      y -= 28;
      for (const it of done) {
        const lines = wrap(it.label, 10, W - 120);
        const h = lines.length * 13 + 9;
        ensure(h);
        check(M + 16, y - 7);
        lines.forEach((ln, i) => txt(ln, M + 30, y - 10.5 - i * 13, 10, font, INK));
        y -= h;
      }
      y -= 10;
    }
    y -= 8;
  };
  if (mk) doneList("Plano de marketing", mk);
  if (ck) doneList("Checklist do corretor", ck);

  // ---------- próximas ações ----------
  const next = mk ? nextActions(mk, 5) : [];
  if (next.length) {
    section("Próximas ações");
    next.forEach((a, i) => {
      const lines = wrap(a, 10, W - 40);
      const h = lines.length * 13 + 12;
      ensure(h);
      page.drawCircle({ x: M + 10, y: y - 7, size: 9, color: BLUE });
      const n = String(i + 1);
      txt(n, M + 10 - tw(n, 9, bold) / 2, y - 10.2, 9, bold, WHITE);
      lines.forEach((ln, j) => txt(ln, M + 28, y - 10.5 - j * 13, 10, font, INK));
      y -= h;
    });
    y -= 12;
  }

  // ---------- recomendação ----------
  if (input.recommendation.trim()) {
    const lines = wrap(input.recommendation, 11, W - 44);
    const h = lines.length * 16 + 50;
    section("Palavra do seu corretor");
    ensure(h);
    box(M, y, W, h, 10, BLUE_SOFT);
    page.drawRectangle({ x: M, y: y - h + 12, width: 4, height: h - 24, color: BLUE });
    lines.forEach((ln, i) => txt(ln, M + 22, y - 24 - i * 16, 11, font, INK));
    txt(input.brokerName.trim() || "Seu corretor", M + 22, y - h + 16, 9.5, bold, BLUE_DARK);
    y -= h + 10;
  }

  // ---------- rodapé ----------
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 44 }, end: { x: M + W, y: 44 }, thickness: 0.6, color: LINE });
    p.drawText(s("Números informados pelos próprios portais de anúncio."), {
      x: M,
      y: 30,
      size: 7.5,
      font,
      color: MUTED,
    });
    const pg = `Página ${i + 1} de ${pages.length}`;
    p.drawText(pg, {
      x: M + W - font.widthOfTextAtSize(pg, 7.5),
      y: 30,
      size: 7.5,
      font,
      color: MUTED,
    });
  });
  return pdf.save();
}
