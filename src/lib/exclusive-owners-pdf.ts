// Páginas "Proprietários adicionais (CONTRATANTES)" do contrato de exclusividade (t_58effd65).
// O modelo PDF só tem campos para 2 proprietários: do 3º em diante, cada um vira um bloco com os
// mesmos dados do quadro do contrato e uma linha de assinatura. O bloco é INDIVISÍVEL: se não couber
// no resto da página, vai inteiro para a próxima (nada de dado ou assinatura cortado ao meio).
// O layout é calculado sem pdf-lib (`layoutExtraOwners`) para ser testado com 35+ proprietários.
import type { Owner } from "@/lib/exclusive-captures";
import { pdfSafe } from "@/lib/owner-feedback-pdf";

/** A4 em pontos, igual às páginas do contrato. */
export const OWNERS_PAGE = { width: 595.276, height: 841.89, margin: 50, footer: 40 };
const W = OWNERS_PAGE.width - 2 * OWNERS_PAGE.margin;
const TOP = OWNERS_PAGE.height - OWNERS_PAGE.margin;
/** Nada é desenhado abaixo daqui (rodapé com o número da página fica entre 0 e esta linha). */
export const OWNERS_BOTTOM = OWNERS_PAGE.margin + OWNERS_PAGE.footer;
const SIZE = 9.5;
const LINE = 13;
const TITLE_H = 74;
const CONT_H = 34;
const SIGN_SPACE = 42;
const BLOCK_GAP = 16;

export type Measure = (text: string, size: number, bold?: boolean) => number;
export type OwnerBlock = {
  /** Número do proprietário no contrato (3, 4, …). */
  number: number;
  /** Linhas de dados já quebradas na largura da página: [rótulo, texto]. */
  lines: [string, string][];
  height: number;
  name: string;
};
export type PlacedBlock = OwnerBlock & { page: number; top: number; bottom: number };

const v = (s: string | undefined) => pdfSafe((s ?? "").trim()) || "-";

/** Quebra o texto em linhas que cabem em `max` (palavras longas, como e-mail, são cortadas). */
export function wrapText(text: string, size: number, max: number, measure: Measure): string[] {
  const out: string[] = [];
  let cur = "";
  const pushWord = (word: string) => {
    let w = word;
    while (measure(w, size) > max) {
      let i = w.length - 1;
      while (i > 1 && measure(w.slice(0, i), size) > max) i--;
      if (cur) {
        out.push(cur);
        cur = "";
      }
      out.push(w.slice(0, i));
      w = w.slice(i);
    }
    return w;
  };
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (measure(next, size) <= max) {
      cur = next;
      continue;
    }
    if (cur) out.push(cur);
    cur = "";
    cur = pushWord(word);
  }
  if (cur) out.push(cur);
  return out.length ? out : ["-"];
}

const LABEL_W = 118;
function blockFor(owner: Owner, number: number, measure: Measure): OwnerBlock {
  const rows: [string, string][] = [
    ["Nome completo", v(owner.nome_completo)],
    ["RG / CPF", `${v(owner.rg)}  /  ${v(owner.cpf)}`],
    ["Nacionalidade / Estado civil", `${v(owner.nacionalidade)}  /  ${v(owner.estado_civil)}`],
    ["Endereço completo", v(owner.endereco_completo)],
    ["E-mail", v(owner.email)],
    [
      "Telefone(s)",
      [v(owner.telefone_1), owner.telefone_2?.trim() ? v(owner.telefone_2) : ""]
        .filter(Boolean)
        .join("  /  "),
    ],
  ];
  const lines: [string, string][] = [];
  for (const [label, text] of rows) {
    wrapText(text, SIZE, W - LABEL_W, measure).forEach((l, i) =>
      lines.push([i === 0 ? label : "", l]),
    );
  }
  // título + linhas + espaço para assinar + linha + nome/rótulo embaixo
  const height = 18 + lines.length * LINE + SIGN_SPACE + 28;
  return { number, lines, height, name: v(owner.nome_completo) };
}

/**
 * Distribui os blocos nas páginas. A 1ª página tem o título e o texto de ligação ao contrato; as
 * seguintes, um cabeçalho curto "(continuação)". Bloco que não cabe vai inteiro para a próxima.
 */
export function layoutExtraOwners(
  owners: Owner[],
  firstNumber: number,
  measure: Measure,
): { pages: number; blocks: PlacedBlock[] } {
  const blocks: PlacedBlock[] = [];
  let page = 0;
  let y = TOP - TITLE_H;
  owners.forEach((o, i) => {
    const b = blockFor(o, firstNumber + i, measure);
    if (y - b.height < OWNERS_BOTTOM && y < TOP - (page === 0 ? TITLE_H : CONT_H)) {
      page += 1;
      y = TOP - CONT_H;
    }
    blocks.push({ ...b, page, top: y, bottom: y - b.height });
    y -= b.height + BLOCK_GAP;
  });
  return { pages: owners.length ? page + 1 : 0, blocks };
}

type PdfLib = typeof import("pdf-lib");
type Doc = Awaited<ReturnType<PdfLib["PDFDocument"]["load"]>>;

/**
 * Acrescenta ao final do contrato as páginas dos proprietários adicionais (3º em diante).
 * `firstNumber` = número do primeiro da lista (3). Sem proprietários extras, não faz nada.
 */
export async function appendExtraOwnersPages(
  pdf: Doc,
  owners: Owner[],
  firstNumber: number,
  ctx: { imovel: string; totalOwners: number },
): Promise<number> {
  if (!owners.length) return 0;
  const { StandardFonts, rgb } = await import("pdf-lib");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const measure: Measure = (t, s, b) => (b ? bold : font).widthOfTextAtSize(t, s);
  const { pages, blocks } = layoutExtraOwners(owners, firstNumber, measure);
  const INK = rgb(0.1, 0.1, 0.12);
  const MUTED = rgb(0.38, 0.38, 0.42);
  const LINE_C = rgb(0.75, 0.75, 0.78);
  const M = OWNERS_PAGE.margin;
  const list = Array.from({ length: pages }, () =>
    pdf.addPage([OWNERS_PAGE.width, OWNERS_PAGE.height]),
  );
  const txt = (p: number, t: string, x: number, y: number, size: number, b = false, c = INK) =>
    list[p].drawText(t, { x, y, size, font: b ? bold : font, color: c });
  list.forEach((_, p) => {
    if (p === 0) {
      txt(p, "PROPRIETÁRIOS ADICIONAIS (CONTRATANTES)", M, TOP - 14, 13, true);
      const intro = pdfSafe(
        `Os proprietários abaixo (${firstNumber}º ao ${ctx.totalOwners}º) também são CONTRATANTES deste Termo de Compromisso de exclusividade` +
          (ctx.imovel.trim() ? ` do imóvel ${ctx.imovel.trim()}` : "") +
          ", com os mesmos direitos e obrigações dos proprietários indicados no quadro do contrato, e o assinam juntamente com eles.",
      );
      wrapText(intro, 9, W, measure)
        .slice(0, 4)
        .forEach((l, i) => txt(p, l, M, TOP - 32 - i * 11.5, 9, false, MUTED));
    } else {
      txt(p, "PROPRIETÁRIOS ADICIONAIS (CONTRATANTES) - continuação", M, TOP - 14, 11, true);
    }
    txt(
      p,
      `Proprietários adicionais - página ${p + 1} de ${pages}`,
      M,
      OWNERS_PAGE.margin - 18,
      8,
      false,
      MUTED,
    );
  });
  for (const b of blocks) {
    let y = b.top - 12;
    list[b.page].drawLine({
      start: { x: M, y: b.top + 4 },
      end: { x: M + W, y: b.top + 4 },
      thickness: 0.5,
      color: LINE_C,
    });
    txt(b.page, `Proprietário ${b.number}`, M, y, 10.5, true);
    y -= 18;
    for (const [label, line] of b.lines) {
      if (label) txt(b.page, pdfSafe(label), M, y, 8, true, MUTED);
      txt(b.page, line, M + LABEL_W, y, SIZE);
      y -= LINE;
    }
    y -= SIGN_SPACE - LINE;
    const sw = Math.min(300, W);
    list[b.page].drawLine({
      start: { x: M, y },
      end: { x: M + sw, y },
      thickness: 0.8,
      color: INK,
    });
    txt(b.page, `Assinatura do Proprietário ${b.number}`, M, y - 11, 8, true);
    const nome = wrapText(b.name, 8, sw, measure)[0] ?? "";
    txt(b.page, nome, M, y - 22, 8, false, MUTED);
  }
  return pages;
}
