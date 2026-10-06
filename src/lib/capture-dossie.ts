/**
 * Dossiê da captação: ações do plano de marketing que o corretor se compromete a fazer.
 * Sai anexado ao final do PDF do contrato de exclusividade (mesma assinatura).
 * A lista vem do catálogo do Feedback (owner_feedback_actions, list = "marketing").
 */
import type { FeedbackAction } from "@/lib/owner-feedback-actions";
import { pdfSafe } from "@/lib/owner-feedback-pdf";

export interface DossieGroup {
  category: string;
  items: FeedbackAction[];
}

/** Só o plano de marketing entra no Dossiê (o checklist do corretor é roteiro interno). */
export function dossieCatalog(actions: FeedbackAction[]): FeedbackAction[] {
  return actions.filter((a) => a.list === "marketing").sort((a, b) => a.sort - b.sort);
}

export function groupDossie(actions: FeedbackAction[]): DossieGroup[] {
  const groups: DossieGroup[] = [];
  for (const a of dossieCatalog(actions)) {
    let g = groups.find((x) => x.category === a.category);
    if (!g) {
      g = { category: a.category, items: [] };
      groups.push(g);
    }
    g.items.push(a);
  }
  return groups;
}

/** Seleção inicial: ações vitais já marcadas. */
export function defaultDossieSelection(actions: FeedbackAction[]): string[] {
  return dossieCatalog(actions)
    .filter((a) => a.weight === "vital")
    .map((a) => a.id);
}

/** Mantém só ids que existem no catálogo atual, na ordem do catálogo. */
export function selectedDossie(
  actions: FeedbackAction[],
  ids: string[] | undefined,
): FeedbackAction[] {
  const set = new Set(ids ?? []);
  return dossieCatalog(actions).filter((a) => set.has(a.id));
}

export function missingVitals(
  actions: FeedbackAction[],
  ids: string[] | undefined,
): FeedbackAction[] {
  const set = new Set(ids ?? []);
  return dossieCatalog(actions).filter((a) => a.weight === "vital" && !set.has(a.id));
}

export interface DossiePdfInput {
  actions: FeedbackAction[];
  selected: string[];
  ownerNames: string[];
  brokerName: string;
  brokerCreci?: string;
  property: {
    tipo?: string;
    endereco?: string;
    bairro?: string;
    municipio?: string;
    valor?: string;
  };
  company?: string;
  issuedOn?: string; // dd/mm/aaaa
}

/** Gera as páginas do Dossiê (PDF A4 independente). */
export async function buildDossiePdf(input: DossiePdfInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle("Planejamento de Marketing");
  pdf.setProducer("ADM MAX");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const BLUE = rgb(0, 0.24, 0.65);
  const BLUE_DARK = rgb(0, 0.16, 0.42);
  const RED = rgb(0.86, 0.11, 0.18);
  const INK = rgb(0.13, 0.15, 0.2);
  const MUTED = rgb(0.45, 0.48, 0.55);
  const LINE = rgb(0.87, 0.89, 0.93);
  const WHITE = rgb(1, 1, 1);
  const PW = 595.28;
  const PH = 841.89;
  const M = 48;
  const W = PW - 2 * M;
  const BOTTOM = 70;
  type Font = typeof font;
  type Color = ReturnType<typeof rgb>;
  let page = pdf.addPage([PW, PH]);
  let y = PH;
  const txt = (t: string, x: number, base: number, size = 10, f: Font = font, color: Color = INK) =>
    page.drawText(pdfSafe(t), { x, y: base, size, font: f, color });
  const wrap = (t: string, size: number, width: number, f: Font = font): string[] => {
    const out: string[] = [];
    let line = "";
    for (const w of pdfSafe(t).split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) > width && line) {
        out.push(line);
        line = w;
      } else line = next;
    }
    if (line) out.push(line);
    return out.length ? out : ["-"];
  };
  const header = (first: boolean) => {
    if (first) {
      const H = 100;
      page.drawRectangle({ x: 0, y: PH - H, width: PW, height: H, color: BLUE });
      page.drawRectangle({ x: 0, y: PH - H - 4, width: PW, height: 4, color: RED });
      txt("ANEXO AO CONTRATO DE EXCLUSIVIDADE", M, PH - 36, 8.5, bold, rgb(0.75, 0.83, 1));
      txt("Planejamento de Marketing", M, PH - 64, 24, bold, WHITE);
      txt(
        `Plano de ações para o seu imóvel${input.issuedOn ? ` · emitido em ${input.issuedOn}` : ""}`,
        M,
        PH - 84,
        10,
        font,
        rgb(0.85, 0.9, 1),
      );
      y = PH - H - 4 - 24;
    } else {
      page.drawRectangle({ x: 0, y: PH - 30, width: PW, height: 30, color: BLUE });
      page.drawRectangle({ x: 0, y: PH - 32, width: PW, height: 2, color: RED });
      txt("Planejamento de Marketing (continuação)", M, PH - 20, 10, bold, WHITE);
      y = PH - 32 - 26;
    }
  };
  const ensure = (h: number) => {
    if (y - h < BOTTOM) {
      page = pdf.addPage([PW, PH]);
      header(false);
    }
  };
  header(true);

  // Dados do imóvel / partes
  const p = input.property;
  const rows: [string, string][] = [
    ["Imóvel", [p.tipo, p.endereco, p.bairro, p.municipio].filter((v) => v?.trim()).join(", ")],
    ["Valor anunciado", p.valor?.trim() ?? ""],
    ["Proprietário(s)", input.ownerNames.filter((n) => n.trim()).join(" e ")],
    [
      "Corretor(a) responsável",
      [input.brokerName, input.brokerCreci ? `CRECI ${input.brokerCreci}` : ""]
        .filter((v) => v?.trim())
        .join(" · "),
    ],
  ];
  for (const [label, value] of rows) {
    const lines = wrap(value || "-", 10.5, W - 150, bold);
    ensure(16 * lines.length + 4);
    txt(label.toUpperCase(), M, y - 11, 7.5, bold, MUTED);
    lines.forEach((l, i) => txt(l, M + 150, y - 11 - i * 14, 10.5, bold, INK));
    y -= 14 * lines.length + 8;
  }
  y -= 4;
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.6, color: LINE });
  y -= 18;
  for (const l of wrap(
    `${input.company?.trim() || "A imobiliária"}, por meio do(a) corretor(a) responsável, se compromete a realizar as ações abaixo para divulgar e vender o imóvel durante o período de exclusividade. O andamento será informado ao proprietário nos relatórios de feedback.`,
    10,
    W,
  )) {
    ensure(14);
    txt(l, M, y - 10, 10, font, INK);
    y -= 14;
  }
  y -= 10;

  // Ações por categoria
  const chosen = new Set(input.selected);
  const groups = groupDossie(input.actions)
    .map((g) => ({ ...g, items: g.items.filter((a) => chosen.has(a.id)) }))
    .filter((g) => g.items.length);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  ensure(30);
  page.drawRectangle({ x: M, y: y - 14, width: 4, height: 14, color: RED });
  txt(`AÇÕES COMPROMETIDAS (${total})`, M + 12, y - 12, 12, bold, BLUE_DARK);
  y -= 28;
  let n = 0;
  for (const g of groups) {
    ensure(40);
    txt(g.category, M, y - 10, 10.5, bold, BLUE);
    y -= 18;
    for (const a of g.items) {
      n += 1;
      const lines = wrap(a.label, 10, W - 40);
      ensure(14 * lines.length + 6);
      page.drawRectangle({
        x: M + 4,
        y: y - 11,
        width: 9,
        height: 9,
        borderColor: BLUE,
        borderWidth: 0.9,
      });
      page.drawSvgPath("M 1.8 4.6 L 3.8 7 L 7.6 2", {
        x: M + 4,
        y: y - 2,
        borderColor: BLUE,
        borderWidth: 1.2,
      });
      txt(`${n}.`, M + 20, y - 10, 10, bold, MUTED);
      lines.forEach((l, i) => txt(l, M + 40, y - 10 - i * 13, 10, font, INK));
      y -= 13 * lines.length + 6;
    }
    y -= 6;
  }
  if (!total) {
    txt("Nenhuma ação selecionada.", M, y - 10, 10, font, MUTED);
    y -= 20;
  }

  // Assinaturas
  ensure(110);
  y -= 50;
  const half = (W - 40) / 2;
  const sign = (x: number, label: string, name: string) => {
    page.drawLine({ start: { x, y }, end: { x: x + half, y }, thickness: 0.8, color: INK });
    txt(label, x, y - 14, 9, bold, INK);
    txt(wrap(name || "", 9, half)[0] ?? "", x, y - 27, 9, font, MUTED);
  };
  sign(M, "Proprietário(a)", input.ownerNames.filter((v) => v.trim()).join(" e "));
  sign(M + half + 40, "Corretor(a) responsável", input.brokerName);

  const pages = pdf.getPages();
  pages.forEach((pg, i) =>
    pg.drawText(pdfSafe(`Planejamento de Marketing · página ${i + 1} de ${pages.length}`), {
      x: M,
      y: 30,
      size: 8,
      font,
      color: MUTED,
    }),
  );
  return pdf.save();
}

/** Anexa as páginas do Dossiê ao final do contrato. */
export async function appendDossieToContract(
  contract: Uint8Array,
  dossie: Uint8Array,
): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(contract);
  const extra = await PDFDocument.load(dossie);
  const pages = await doc.copyPages(extra, extra.getPageIndices());
  for (const p of pages) doc.addPage(p);
  return doc.save();
}
