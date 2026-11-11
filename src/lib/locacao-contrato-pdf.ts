import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export type OpcoesPdfContrato = {
  negrito?: ArrayBuffer | Uint8Array;
  logo?: Uint8Array | null;
};

const PW = 595.28;
const PH = 841.89;
const ML = 22.4;
const MR = 23.3;
const W = PW - ML - MR;
const TOP1 = 18;
const TOPN = 14;
const BOTTOM = 36;
const SIZE = 10;
const LINE = 12;
const PARA = 12;
const TITLE = 16;
const SUB = 8;
const PAGE_N = 8;
const INK = rgb(0, 0, 0);

const ROTULO =
  /^(LOCADOR(?:A|ES|AS)?:|LOCATÁRI[OA]S?:|ADMINISTRADORA:|GARANTIA LOCATÍCIA - FIADOR(?:A|ES|AS)?:|PARÁGRAFO\s+\d+º:|Parágrafo\s+[^:]+:|Cláusula\s+\d+º\s*[-–]|OBJETO DA LOCAÇÃO:|PRAZO DA LOCAÇÃO:|CLÁUSULAS ADICIONAIS:)/;
const CABECALHO_TITULO = /^CONTRATO DE LOCAÇÃO -/;
const CABECALHO_SUB = /^Contrato de Garantia:/;
const CABECALHO_NUM = /^N[º°]\s/;

type Fonte = { widthOfTextAtSize: (t: string, s: number) => number };

function quebrar(
  texto: string,
  fonte: Fonte,
  size: number,
  largura: number,
  primeira?: number,
): string[] {
  const linhas: string[] = [];
  let s = "";
  let max = primeira ?? largura;
  const push = (t: string) => {
    linhas.push(t);
    max = largura;
  };
  for (const word of texto.split(/ +/).filter(Boolean)) {
    let resto = word;
    while (fonte.widthOfTextAtSize(resto, size) > max) {
      let i = resto.length - 1;
      while (i > 1 && fonte.widthOfTextAtSize(resto.slice(0, i), size) > max) i--;
      if (s) push(s);
      s = "";
      push(resto.slice(0, i));
      resto = resto.slice(i);
    }
    const next = s ? `${s} ${resto}` : resto;
    if (fonte.widthOfTextAtSize(next, size) > max && s) {
      push(s);
      s = resto;
    } else s = next;
  }
  if (s) linhas.push(s);
  return linhas.length ? linhas : [""];
}

function ehTituloSecao(p: string): boolean {
  const t = p.trim();
  if (t === "QUADRO RESUMO:") return true;
  return t.length > 0 && t.length < 90 && t === t.toUpperCase() && /[A-ZÁÉÍÓÚÃÕÇ]/.test(t);
}

function ehAssinatura(p: string): boolean {
  return /^(LOCADOR(?:A|ES|AS)?|LOCATÁRI[OA]S?|FIADOR(?:A|ES|AS)?|ADMINISTRADORA):$/.test(p.trim());
}

export async function gerarPdfContrato(
  paragrafos: string[],
  fonteBytes: ArrayBuffer | Uint8Array,
  opcoes?: OpcoesPdfContrato,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonte = await pdf.embedFont(fonteBytes, { subset: true });
  const negrito = opcoes?.negrito ? await pdf.embedFont(opcoes.negrito, { subset: true }) : fonte;
  let logo = null as Awaited<ReturnType<typeof pdf.embedPng>> | null;
  if (opcoes?.logo?.length) {
    try {
      const b = opcoes.logo;
      const isPng = b[0] === 0x89 && b[1] === 0x50;
      logo = isPng ? await pdf.embedPng(b) : await pdf.embedJpg(b);
    } catch {
      logo = null;
    }
  }
  let pagina = pdf.addPage([PW, PH]);
  let y = PH - TOP1;

  const garantir = (h: number) => {
    if (y - h < BOTTOM) {
      pagina = pdf.addPage([PW, PH]);
      y = PH - TOPN;
    }
  };
  const texto = (t: string, x: number, base: number, size = SIZE, f = fonte) =>
    pagina.drawText(t, { x, y: base, size, font: f, color: INK });
  const justificar = (linha: string, ultima: boolean, size = SIZE, f = fonte) => {
    garantir(LINE);
    const words = linha.split(/ +/).filter(Boolean);
    if (!words.length) {
      y -= LINE;
      return;
    }
    const total = words.reduce((s, w) => s + f.widthOfTextAtSize(w, size), 0);
    if (ultima || words.length === 1 || total >= W) {
      texto(linha, ML, y, size, f);
    } else {
      const gap = (W - total) / (words.length - 1);
      let x = ML;
      for (const w of words) {
        texto(w, x, y, size, f);
        x += f.widthOfTextAtSize(w, size) + gap;
      }
    }
    y -= LINE;
  };
  const sublinhar = (t: string, size: number, f = negrito) => {
    const w = f.widthOfTextAtSize(t, size);
    pagina.drawLine({
      start: { x: ML, y: y - 1.2 },
      end: { x: ML + w, y: y - 1.2 },
      thickness: 0.6,
      color: INK,
    });
  };

  const titulo = paragrafos.find((p) => CABECALHO_TITULO.test(p)) ?? "";
  const subtitulo = paragrafos.find((p) => CABECALHO_SUB.test(p)) ?? "";
  const numero = paragrafos.find((p) => CABECALHO_NUM.test(p)) ?? "";

  let tituloX = 133.5;
  if (logo) {
    const h = 37.5;
    const w = Math.min((logo.width / logo.height) * h, 96);
    pagina.drawImage(logo, { x: ML, y: PH - TOP1 - h, width: w, height: h });
    tituloX = Math.max(133.5, ML + w + 12);
  }
  if (titulo) texto(titulo, tituloX, PH - 40, TITLE, negrito);
  if (subtitulo) texto(subtitulo, tituloX, PH - 62, SUB, fonte);
  if (numero) {
    const nw = fonte.widthOfTextAtSize(numero, SIZE);
    texto(numero, (PW - nw) / 2, PH - 96, SIZE, fonte);
  }
  y = PH - 114;

  const corpo = paragrafos.filter(
    (p) => !CABECALHO_TITULO.test(p) && !CABECALHO_SUB.test(p) && !CABECALHO_NUM.test(p),
  );

  for (const p of corpo) {
    for (const raw of p.split("\n")) {
      const linha = raw.trimEnd();
      if (!linha) {
        y -= PARA / 2;
        continue;
      }
      if (/^Início:/.test(linha) && linha.includes("Término:")) {
        const [ini, fim] = linha.split(/\s*Término:\s*/);
        garantir(LINE);
        texto(ini.trim(), ML, y);
        const fimTxt = `Término: ${fim.trim()}`;
        texto(fimTxt, PW - MR - fonte.widthOfTextAtSize(fimTxt, SIZE), y);
        y -= LINE + PARA;
        continue;
      }
      if (ehAssinatura(linha)) {
        garantir(LINE * 5);
        texto(linha, ML, y, SIZE, negrito);
        y -= LINE + 2;
        continue;
      }
      if (/,\s+\d{1,2} de [a-zç]+ de \d{4}\.$/i.test(linha) && linha.length < 90) {
        garantir(LINE * 20);
        const tw = fonte.widthOfTextAtSize(linha, SIZE);
        texto(linha, (PW - tw) / 2, y);
        y -= LINE + PARA * 2;
        continue;
      }
      if (ehTituloSecao(linha)) {
        y -= 2;
        garantir(LINE + 2);
        texto(linha, ML, y, SIZE, negrito);
        sublinhar(linha, SIZE);
        y -= LINE + 4;
        continue;
      }
      const m = ROTULO.exec(linha);
      if (m) {
        const rotulo = m[0];
        const resto = linha.slice(rotulo.length).trim();
        const offset = negrito.widthOfTextAtSize(rotulo, SIZE) + 3;
        const linhas = resto ? quebrar(resto, fonte, SIZE, W, Math.max(40, W - offset)) : [];
        const bloco = LINE * Math.max(1, linhas.length) + PARA;
        garantir(Math.min(bloco, PH - TOPN - BOTTOM - LINE));
        texto(rotulo, ML, y, SIZE, negrito);
        if (/^(PARÁGRAFO |Parágrafo |Cláusula )/.test(rotulo)) sublinhar(rotulo.trim(), SIZE);
        if (!resto) {
          y -= LINE + PARA;
          continue;
        }
        linhas.forEach((ln, i) => {
          if (i === 0) {
            texto(ln, ML + offset, y);
            y -= LINE;
          } else justificar(ln, i === linhas.length - 1);
        });
        y -= PARA;
        continue;
      }
      const linhas = quebrar(linha, fonte, SIZE, W);
      linhas.forEach((ln, i) => justificar(ln, i === linhas.length - 1));
      y -= PARA;
    }
  }

  const n = pdf.getPageCount();
  pdf.getPages().forEach((pg, i) => {
    const t = `${i + 1} de ${n}`;
    pg.drawText(t, {
      x: PW - MR - fonte.widthOfTextAtSize(t, PAGE_N),
      y: 31,
      size: PAGE_N,
      font: fonte,
      color: INK,
    });
  });
  return pdf.save();
}
