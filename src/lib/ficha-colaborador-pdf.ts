/**
 * PDF "Ficha dos colaboradores" (t_618b64bc). A4 paisagem, quantas páginas precisar.
 * Visual padrão RE/MAX (skill max-relatorios-pdf-marca): faixa azul no topo com linha vermelha,
 * nome e logo da imobiliária, cartões de resumo com números grandes, tabela com cabeçalho azul,
 * ficha "Completa" em verde e "Pendente" em vermelho, rodapé "Página X de Y".
 */
import { pdfSafe } from "@/lib/owner-feedback-pdf";
import { COLUNAS_EXPORT, type Colaborador, linhaExport } from "@/lib/ficha-colaborador";

export interface FichasPdfInput {
  colaboradores: Colaborador[];
  /** Total da imobiliária (antes do filtro), para o cartão de resumo. */
  totalImobiliaria: number;
  filtros: string;
  roleLabels: Record<string, string>;
  agencyName?: string | null;
  logoPng?: Uint8Array | null;
  issuedAt?: Date;
}

// Colunas do PDF (subconjunto da exportação, para caber em paisagem) e larguras relativas.
const COLS: { titulo: string; idx: number; peso: number }[] = [
  { titulo: "Nome", idx: 0, peso: 15 },
  { titulo: "Papel / Equipe", idx: 2, peso: 12 },
  { titulo: "Nascimento", idx: 4, peso: 7.5 },
  { titulo: "Ficha", idx: 5, peso: 6.5 },
  { titulo: "Filhos", idx: 6, peso: 4.5 },
  { titulo: "Plano de saúde", idx: 8, peso: 10 },
  { titulo: "Hospital", idx: 9, peso: 11 },
  { titulo: "Contato de emergência", idx: 10, peso: 15 },
  { titulo: "Telefone", idx: 12, peso: 9 },
  { titulo: "Religião", idx: 13, peso: 9.5 },
];

export function fichasPdfFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `ficha-colaboradores-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.pdf`;
}

export async function buildFichasPdf(input: FichasPdfInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  type Color = ReturnType<typeof rgb>;
  const pdf = await PDFDocument.create();
  pdf.setTitle("Ficha dos colaboradores");
  pdf.setProducer("ADM MAX");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

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

  const PW = 841.89;
  const PH = 595.28;
  const M = 32;
  const W = PW - 2 * M;
  const BOTTOM = 44;
  const s = (t: string) => pdfSafe(t);

  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (input.logoPng?.length) {
    try {
      const isPng = input.logoPng[0] === 0x89 && input.logoPng[1] === 0x50;
      logo = isPng ? await pdf.embedPng(input.logoPng) : await pdf.embedJpg(input.logoPng);
    } catch {
      logo = null; // logo inválido: segue sem logo
    }
  }

  const issued = input.issuedAt ?? new Date();
  const emitido = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(issued);

  let page = pdf.addPage([PW, PH]);
  let y = PH;

  const txt = (t: string, x: number, base: number, size = 8, f = font, color: Color = INK) =>
    page.drawText(s(t), { x, y: base, size, font: f, color });
  const tw = (t: string, size: number, f = font) => f.widthOfTextAtSize(s(t), size);
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
    // Palavra única maior que a coluna: corta com reticências.
    return out.map((l) => {
      if (f.widthOfTextAtSize(l, size) <= width) return l;
      let c = l;
      while (c.length > 1 && f.widthOfTextAtSize(`${c}...`, size) > width) c = c.slice(0, -1);
      return `${c}...`;
    });
  };

  const faixa = (primeira: boolean) => {
    const h = primeira ? 70 : 40;
    page.drawRectangle({ x: 0, y: PH - h, width: PW, height: h, color: BLUE });
    page.drawRectangle({ x: 0, y: PH - h - 3, width: PW, height: 3, color: RED });
    let xr = PW - M;
    if (logo) {
      const lh = primeira ? 40 : 24;
      const lw = (logo.width / logo.height) * lh;
      const pad = 4;
      page.drawRectangle({
        x: xr - lw - pad * 2,
        y: PH - h / 2 - lh / 2 - pad,
        width: lw + pad * 2,
        height: lh + pad * 2,
        color: WHITE,
      });
      page.drawImage(logo, { x: xr - lw - pad, y: PH - h / 2 - lh / 2, width: lw, height: lh });
      xr -= lw + pad * 2 + 10;
    }
    if (primeira) {
      txt("Ficha dos colaboradores", M, PH - 32, 18, bold, WHITE);
      const sub = [input.agencyName?.trim(), `Emitido em ${emitido}`].filter(Boolean).join("  ·  ");
      txt(sub, M, PH - 50, 9, font, rgb(0.85, 0.9, 1));
      txt("Uso interno · dados pessoais (LGPD)", M, PH - 62, 7.5, font, rgb(0.85, 0.9, 1));
    } else {
      txt("Ficha dos colaboradores (continuação)", M, PH - 25, 11, bold, WHITE);
    }
    y = PH - h - 3 - 14;
  };

  faixa(true);

  // Cartões de resumo
  const lista = input.colaboradores;
  const completas = lista.filter((c) => c.completa).length;
  const comPlano = lista.filter((c) => c.tem_plano_saude === true).length;
  const cards: { rot: string; val: string; cor: Color; barra?: number }[] = [
    { rot: "Colaboradores na lista", val: String(lista.length), cor: BLUE_DARK },
    {
      rot: "Fichas completas",
      val: `${completas}`,
      cor: GREEN,
      barra: lista.length ? completas / lista.length : 0,
    },
    { rot: "Fichas pendentes", val: String(lista.length - completas), cor: RED },
    { rot: "Com plano de saúde", val: String(comPlano), cor: BLUE },
  ];
  const gap = 10;
  const cw = (W - gap * (cards.length - 1)) / cards.length;
  const ch = 50;
  cards.forEach((c, i) => {
    const x = M + i * (cw + gap);
    page.drawRectangle({
      x,
      y: y - ch,
      width: cw,
      height: ch,
      color: SOFT,
      borderColor: LINE,
      borderWidth: 0.8,
    });
    txt(c.rot, x + 10, y - 14, 8, font, MUTED);
    txt(c.val, x + 10, y - 38, 20, bold, c.cor);
    if (c.barra != null) {
      const bx = x + 60;
      const bw = cw - 72;
      page.drawRectangle({ x: bx, y: y - 34, width: bw, height: 5, color: LINE });
      page.drawRectangle({
        x: bx,
        y: y - 34,
        width: Math.max(0, bw * c.barra),
        height: 5,
        color: GREEN,
      });
      txt(`${Math.round(c.barra * 100)}%`, bx, y - 45, 7, font, MUTED);
    }
  });
  y -= ch + 12;

  // Filtro aplicado
  const filtroLinhas = wrap(`Filtro: ${input.filtros}`, 8, W - 16);
  const fh = 8 + filtroLinhas.length * 10;
  page.drawRectangle({ x: M, y: y - fh, width: W, height: fh, color: BLUE_SOFT });
  page.drawRectangle({ x: M, y: y - fh, width: 3, height: fh, color: BLUE });
  filtroLinhas.forEach((l, i) => txt(l, M + 10, y - 11 - i * 10, 8, font, INK));
  y -= fh + 6;
  txt(
    `Total na imobiliária: ${input.totalImobiliaria} · mostrando ${lista.length}`,
    M,
    y - 8,
    7.5,
    font,
    MUTED,
  );
  y -= 16;

  // Tabela
  const pesoTotal = COLS.reduce((a, c) => a + c.peso, 0);
  const larg = COLS.map((c) => (c.peso / pesoTotal) * W);
  const PAD = 4;
  const FS = 7.5;
  const LH = 9.5;

  const cabecalho = () => {
    const hh = 18;
    page.drawRectangle({ x: M, y: y - hh, width: W, height: hh, color: BLUE });
    let x = M;
    COLS.forEach((c, i) => {
      txt(c.titulo, x + PAD, y - 12, 7.5, bold, WHITE);
      x += larg[i];
    });
    y -= hh;
  };
  cabecalho();

  if (!lista.length) {
    txt("Nenhum colaborador com esse filtro.", M + PAD, y - 16, 9, font, MUTED);
    y -= 24;
  }

  lista.forEach((c, n) => {
    const base = linhaExport(c, input.roleLabels);
    const valores = COLS.map((col) => {
      if (col.idx === 2) return [base[2], base[3]].filter(Boolean).join(" · ");
      if (col.idx === 8) return c.tem_plano_saude === false ? "Não tem" : base[8];
      if (col.idx === 10)
        return [base[10], base[11] ? `(${base[11]})` : ""].filter(Boolean).join(" ");
      return base[col.idx];
    });
    const linhas = valores.map((v, i) =>
      wrap(v || "-", FS, larg[i] - PAD * 2, i === 0 ? bold : font),
    );
    const h = Math.max(...linhas.map((l) => l.length)) * LH + 8;
    if (y - h < BOTTOM) {
      page = pdf.addPage([PW, PH]);
      faixa(false);
      cabecalho();
    }
    if (n % 2 === 1) page.drawRectangle({ x: M, y: y - h, width: W, height: h, color: SOFT });
    let x = M;
    linhas.forEach((ls, i) => {
      const isFicha = COLS[i].idx === 5;
      const cor = isFicha ? (c.completa ? GREEN : RED) : i === 0 ? INK : INK;
      ls.forEach((l, k) =>
        txt(l, x + PAD, y - 10 - k * LH, FS, i === 0 || isFicha ? bold : font, cor),
      );
      x += larg[i];
    });
    page.drawLine({
      start: { x: M, y: y - h },
      end: { x: M + W, y: y - h },
      thickness: 0.5,
      color: LINE,
    });
    y -= h;
  });

  // Rodapé em todas as páginas
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const t1 = s(`Página ${i + 1} de ${pages.length}`);
    p.drawLine({ start: { x: M, y: 30 }, end: { x: PW - M, y: 30 }, thickness: 0.5, color: LINE });
    p.drawText(t1, { x: PW - M - tw(t1, 7.5), y: 18, size: 7.5, font, color: MUTED });
    p.drawText(
      s("Documento confidencial: uso restrito a emergência e gestão de pessoas. Não compartilhar."),
      { x: M, y: 18, size: 7.5, font, color: MUTED },
    );
  });

  return pdf.save();
}
