/**
 * PDF "Meu Plano 2027" (A4 retrato, quantas páginas precisar). Cartão t_65edd0b0.
 * Visual no padrão dos PDFs do ADM MAX (owner-feedback-pdf.ts, ficha-colaborador-pdf.ts): faixa azul com linha
 * vermelha, nome e logo da imobiliária (sem logo, sai sem logo), cabeçalho com colaborador, trilha e data de
 * emissão; depois cada tela na ordem da trilha com o rótulo da página do book; no fim, os números calculados.
 * O conteúdo vem de pdf-conteudo.ts (testado); aqui só desenha. pdf-lib já é dependência do projeto.
 */
import { conteudoPlanoPdf, type ItemPdf, type PlanoPdfDados, type SecaoPdf } from "./pdf-conteudo";
import type { TaxasFunil } from "./regras";

export interface PlanoPdfInput {
  plano: PlanoPdfDados;
  /** Nome do colaborador dono do plano. */
  colaborador: string;
  taxasPadrao?: Partial<TaxasFunil> | null;
  agencyName?: string | null;
  /** Logo da imobiliária em PNG ou JPG (opcional). */
  logoPng?: Uint8Array | null;
  issuedAt?: Date;
}

/**
 * Helvetica padrão só cobre WinAnsi. Diferente do pdfSafe do feedback, MANTÉM o travessão "—" (campo vazio
 * aprovado como "—"), as aspas, "…", "•", "×" e "÷", que a fonte tem; troca "−", "≈", "✔" e remove o resto
 * (emoji etc.).
 */
export function limpa(t: string): string {
  return t
    .replace(/\u2212/g, "-")
    .replace(/\u2248/g, "~")
    .replace(/[\u2714\u2713]/g, "OK")
    .replace(
      /[^\x20-\x7E\u00A0-\u00FF\n\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC]/g,
      "",
    )
    .trim();
}

export async function buildPlanoPdf(input: PlanoPdfInput): Promise<Uint8Array> {
  const conteudo = conteudoPlanoPdf(input.plano, input.taxasPadrao);
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  type Color = ReturnType<typeof rgb>;
  const pdf = await PDFDocument.create();
  pdf.setTitle(limpa(`Meu Plano 2027 - ${input.colaborador}`));
  pdf.setProducer("ADM MAX");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const BLUE = rgb(0, 0.24, 0.65);
  const BLUE_DARK = rgb(0, 0.16, 0.42);
  const RED = rgb(0.86, 0.11, 0.18);
  const INK = rgb(0.13, 0.15, 0.2);
  const MUTED = rgb(0.45, 0.48, 0.55);
  const LINE = rgb(0.87, 0.89, 0.93);
  const SOFT = rgb(0.96, 0.97, 0.99);
  const BLUE_SOFT = rgb(0.92, 0.95, 1);
  const WHITE = rgb(1, 1, 1);

  const PW = 595.28;
  const PH = 841.89;
  const M = 40;
  const W = PW - 2 * M;
  const BOTTOM = 50;

  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (input.logoPng?.length) {
    try {
      const isPng = input.logoPng[0] === 0x89 && input.logoPng[1] === 0x50;
      logo = isPng ? await pdf.embedPng(input.logoPng) : await pdf.embedJpg(input.logoPng);
    } catch {
      logo = null; // logo inválido: segue sem logo
    }
  }

  const emitido = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(input.issuedAt ?? new Date());

  let page = pdf.addPage([PW, PH]);
  let y = PH;

  const txt = (t: string, x: number, base: number, size = 9, f = font, color: Color = INK) =>
    page.drawText(limpa(t), { x, y: base, size, font: f, color });
  const wrap = (t: string, size: number, width: number, f = font): string[] => {
    const out: string[] = [];
    for (const para of limpa(t).split("\n")) {
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
    return (out.length ? out : [""]).map((l) => {
      if (f.widthOfTextAtSize(l, size) <= width) return l;
      let c = l;
      while (c.length > 1 && f.widthOfTextAtSize(`${c}...`, size) > width) c = c.slice(0, -1);
      return `${c}...`;
    });
  };

  const faixa = (primeira: boolean) => {
    const h = primeira ? 74 : 34;
    page.drawRectangle({ x: 0, y: PH - h, width: PW, height: h, color: BLUE });
    page.drawRectangle({ x: 0, y: PH - h - 3, width: PW, height: 3, color: RED });
    let xr = PW - M;
    if (logo) {
      const lh = primeira ? 42 : 20;
      const lw = Math.min((logo.width / logo.height) * lh, 150);
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
      txt("Meu Plano 2027", M, PH - 34, 20, bold, WHITE);
      const ag = input.agencyName?.trim();
      if (ag) txt(wrap(ag, 10, xr - M - 8, bold)[0], M, PH - 54, 10, bold, rgb(0.85, 0.9, 1));
      y = PH - h - 3 - 16;
    } else {
      txt(`Meu Plano 2027 · ${input.colaborador}`, M, PH - 22, 10, bold, WHITE);
      y = PH - h - 3 - 18;
    }
  };
  const novaPagina = () => {
    page = pdf.addPage([PW, PH]);
    faixa(false);
  };
  const garante = (h: number) => {
    if (y - h < BOTTOM) novaPagina();
  };

  faixa(true);

  // ---------- cartão do colaborador ----------
  {
    const h = 58;
    page.drawRectangle({
      x: M,
      y: y - h,
      width: W,
      height: h,
      color: SOFT,
      borderColor: LINE,
      borderWidth: 0.6,
    });
    const cols: [string, string][] = [
      ["Colaborador(a)", input.colaborador || "—"],
      ["Trilha", conteudo.trilhaNome],
      ["Telas completas", `${conteudo.telas}/${conteudo.total}`],
      ["Emitido em", emitido],
    ];
    const cw = (W - 24) / cols.length;
    cols.forEach(([l, v], i) => {
      const x = M + 12 + i * cw;
      txt(l.toUpperCase(), x, y - 20, 7, bold, MUTED);
      wrap(v, 10.5, cw - 10, bold)
        .slice(0, 2)
        .forEach((ln, j) => txt(ln, x, y - 35 - j * 12, 10.5, bold, INK));
    });
    y -= h + 18;
  }

  // ---------- desenho dos itens ----------
  const COL_ROT = W * 0.5;
  const desenhaCampo = (it: Extract<ItemPdf, { k: "campo" }>) => {
    const rot = wrap(it.rot, 8.5, COL_ROT - 10);
    const fv = it.calc ? bold : font;
    const val = wrap(it.val, 9, W - COL_ROT - 4, fv);
    const n = Math.max(rot.length, val.length);
    const h = n * 11 + 7;
    garante(h);
    rot.forEach((l, i) => txt(l, M + 4, y - 11 - i * 11, 8.5, font, MUTED));
    val.forEach((l, i) =>
      txt(
        l,
        M + COL_ROT,
        y - 11 - i * 11,
        9,
        fv,
        it.val === "—" ? MUTED : it.calc ? BLUE_DARK : INK,
      ),
    );
    y -= h;
    page.drawLine({
      start: { x: M, y },
      end: { x: M + W, y },
      thickness: 0.4,
      color: LINE,
    });
  };
  const desenhaTabela = (it: Extract<ItemPdf, { k: "tabela" }>) => {
    const pesos = it.pesos ?? it.cab.map(() => 1);
    const tot = pesos.reduce((a, b) => a + b, 0);
    const ws = pesos.map((p) => (W * p) / tot);
    const muitas = it.cab.length > 8;
    const size = muitas ? 6.5 : 8;
    const linha = (cells: string[], cab: boolean) => {
      const ls = cells.map((c, i) => wrap(c, size, ws[i] - 6, cab ? bold : font));
      const h = Math.max(...ls.map((l) => l.length)) * (size + 2.5) + 6;
      garante(h + (cab ? 14 : 0));
      if (cab) page.drawRectangle({ x: M, y: y - h, width: W, height: h, color: BLUE_SOFT });
      let x = M;
      ls.forEach((l, i) => {
        l.forEach((t, j) =>
          txt(
            t,
            x + 3,
            y - size - 2 - j * (size + 2.5),
            size,
            cab || i === 0 ? bold : font,
            t === "—" ? MUTED : INK,
          ),
        );
        x += ws[i];
      });
      y -= h;
      page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.4, color: LINE });
    };
    linha(it.cab, true);
    it.linhas.forEach((l) => linha(l, false));
  };
  const desenhaSecao = (s: SecaoPdf) => {
    garante(70);
    page.drawRectangle({ x: M, y: y - 15, width: 4, height: 15, color: RED });
    const tit = wrap(s.titulo, 12, W - 150, bold);
    txt(tit[0], M + 12, y - 12, 12, bold, BLUE_DARK);
    if (s.rotulo) {
      const r = limpa(s.rotulo);
      txt(r, M + W - bold.widthOfTextAtSize(r, 8.5), y - 11, 8.5, bold, MUTED);
    }
    y -= 18;
    txt(s.ev, M + 12, y - 8, 7.5, font, MUTED);
    y -= 16;
    for (const it of s.itens) {
      if (it.k === "campo") desenhaCampo(it);
      else if (it.k === "tabela") {
        y -= 2;
        desenhaTabela(it);
        y -= 4;
      } else if (it.k === "sub") {
        garante(30);
        y -= 6;
        txt(it.t, M + 4, y - 9, 8.5, bold, BLUE);
        y -= 14;
      } else {
        const ls = wrap(it.t, 8, W - 8);
        garante(ls.length * 10 + 6);
        ls.forEach((l, i) => txt(l, M + 4, y - 9 - i * 10, 8, font, MUTED));
        y -= ls.length * 10 + 6;
      }
    }
    y -= 16;
  };

  conteudo.secoes.forEach(desenhaSecao);

  // ---------- números calculados ----------
  garante(90);
  page.drawRectangle({ x: M, y: y - 26, width: W, height: 26, color: BLUE });
  txt("NÚMEROS DO PLANO (CALCULADOS)", M + 10, y - 17, 11, bold, WHITE);
  y -= 40;
  conteudo.numeros.forEach(desenhaSecao);

  // ---------- rodapé ----------
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const r = limpa(`Página ${i + 1} de ${pages.length}`);
    p.drawText(r, {
      x: PW - M - font.widthOfTextAtSize(r, 7.5),
      y: 24,
      size: 7.5,
      font,
      color: MUTED,
    });
    p.drawText(limpa(`Meu Plano 2027 · ${input.colaborador} · emitido em ${emitido}`), {
      x: M,
      y: 24,
      size: 7.5,
      font,
      color: MUTED,
    });
  });

  return pdf.save();
}
