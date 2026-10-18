import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  caberNoLimite,
  compressPdfBytes,
  GERACAO_CONTRATO,
  pngUnpredict,
  type ImageCodec,
} from "./pdf-compress";

// Codificador de teste com @napi-rs/canvas (mesma API de canvas do navegador). Sem ele, os testes que
// precisam de imagem real são pulados.
const require = createRequire(import.meta.url);
let napi: typeof import("@napi-rs/canvas") | null = null;
try {
  napi = require("@napi-rs/canvas");
} catch {
  napi = null;
}

const nodeCodec: ImageCodec | null = napi && {
  async fromRaw(px, w, h, comps, outW, outH, quality) {
    const full = napi!.createCanvas(w, h);
    const img = full.getContext("2d").createImageData(w, h);
    for (let i = 0, j = 0; i < w * h; i++, j += comps) {
      img.data[i * 4] = px[j];
      img.data[i * 4 + 1] = comps === 3 ? px[j + 1] : px[j];
      img.data[i * 4 + 2] = comps === 3 ? px[j + 2] : px[j];
      img.data[i * 4 + 3] = 255;
    }
    full.getContext("2d").putImageData(img, 0, 0);
    const out = napi!.createCanvas(outW, outH);
    out.getContext("2d").drawImage(full, 0, 0, outW, outH);
    return new Uint8Array(await out.encode("jpeg", Math.round(quality * 100)));
  },
  async fromJpeg(bytes, outW, outH, quality) {
    const img = await napi!.loadImage(Buffer.from(bytes));
    const out = napi!.createCanvas(outW, outH);
    out.getContext("2d").drawImage(img, 0, 0, outW, outH);
    return new Uint8Array(await out.encode("jpeg", Math.round(quality * 100)));
  },
};

/** PDF fictício com texto e uma imagem "pesada" sem compressão JPEG (ruído = não comprime no Flate). */
async function pdfComImagem(w: number, h: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  const c = napi!.createCanvas(w, h);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 2654435761) >>> 24;
  ctx.putImageData(img, 0, 0);
  const png = await pdf.embedPng(new Uint8Array(await c.encode("png")));
  page.drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
  page.drawText("CONTRATO FICTICIO - TEXTO VETORIAL", { x: 60, y: 760, size: 18, font });
  return pdf.save();
}

describe("pngUnpredict", () => {
  it("desfaz os filtros PNG (None, Sub, Up) de uma imagem 2x2 cinza", () => {
    // linha 0: filtro Sub (1) [10, +5] → [10, 15]; linha 1: filtro Up (2) [+1, +1] → [11, 16]
    const data = new Uint8Array([1, 10, 5, 2, 1, 1]);
    expect(Array.from(pngUnpredict(data, 2, 1, 2)!)).toEqual([10, 15, 11, 16]);
  });
  it("tamanho errado devolve null (a imagem fica como está)", () => {
    expect(pngUnpredict(new Uint8Array([0, 1]), 2, 1, 2)).toBeNull();
  });
});

describe.skipIf(!nodeCodec)("compressão de PDF (imagens)", () => {
  it("imagem grande vira JPEG reduzido, texto continua vetorial e o PDF abre", async () => {
    const orig = await pdfComImagem(2480, 3507);
    const r = await compressPdfBytes(orig, nodeCodec!, GERACAO_CONTRATO);
    expect(r.report?.changed).toBe(1);
    // Ruído é o pior caso do JPEG; mesmo assim reduz (imagem real do contrato reduz bem mais).
    expect(r.bytes.length).toBeLessThan(orig.length);
    const doc = await PDFDocument.load(r.bytes);
    expect(doc.getPageCount()).toBe(1);
  });
  it("erro no codificador: devolve o PDF original sem quebrar", async () => {
    const orig = await pdfComImagem(800, 800);
    const quebrado: ImageCodec = {
      fromRaw: async () => {
        throw new Error("x");
      },
      fromJpeg: async () => {
        throw new Error("x");
      },
    };
    const r = await compressPdfBytes(orig, quebrado, { ...GERACAO_CONTRATO, minBytes: 1 });
    expect(r.bytes).toBe(orig);
  });
  it("caberNoLimite: já cabe = sem mudança; passa do teto = reduz até caber ou avisa", async () => {
    const orig = await pdfComImagem(2480, 3507);
    const ja = await caberNoLimite(orig, nodeCodec!, orig.length + 1);
    expect(ja).toMatchObject({ cabe: true, passadas: 0 });
    expect(ja.bytes).toBe(orig);
    const cabe = await caberNoLimite(orig, nodeCodec!, Math.round(orig.length / 3));
    expect(cabe.cabe).toBe(true);
    expect(cabe.bytes.length).toBeLessThan(orig.length / 3);
    const nao = await caberNoLimite(orig, nodeCodec!, 1000);
    expect(nao.cabe).toBe(false);
    expect(nao.passadas).toBe(3);
  });
});

// Ensaio com os arquivos reais (homologação/ensaio local, fora do repositório): CAPTURE_PDF_REAL aponta
// para uma pasta com os PDFs. Grava os resultados em CAPTURE_PDF_REAL/out para conferência.
const REAL = process.env.CAPTURE_PDF_REAL;
describe.skipIf(!nodeCodec || !REAL)("ensaio com PDFs reais", () => {
  it("modelo do contrato: gerado bem abaixo de 10 MB", async () => {
    const f = `${REAL}/tpl-remax-padrao.pdf`;
    if (!existsSync(f)) return;
    const orig = new Uint8Array(readFileSync(f));
    const r = await compressPdfBytes(orig, nodeCodec!, GERACAO_CONTRATO);
    writeFileSync(`${REAL}/out-tpl-remax-padrao.pdf`, r.bytes);
    console.log("modelo", orig.length, "->", r.bytes.length, JSON.stringify(r.report));
    expect(r.bytes.length).toBeLessThan(5_000_000);
  });

  // Captações reais (c1 ≈ 9,6 MiB em assinatura, c2 ≈ 20 MiB aprovada): arquivos <cap>-<kind>.pdf.
  // Junta igual ao "Baixar PDF completo" (assinado primeiro, depois os documentos) e aplica as passadas.
  const ORDEM = ["assinado", "rg1", "cpf1", "cnh1", "rg2", "cpf2", "cnh2", "residencia", "iptu", "matricula"];
  async function juntar(files: string[]) {
    const out = await PDFDocument.create();
    for (const f of files) {
      const src = await PDFDocument.load(readFileSync(f), { ignoreEncryption: true });
      (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
    }
    return out.save();
  }
  it.each(["c1", "c2"])("%s: gerado < 10 MB e PDF completo < 9 MB", async (cap) => {
    const ger = `${REAL}/${cap}-gerado.pdf`;
    if (!existsSync(ger)) return;
    const g = new Uint8Array(readFileSync(ger));
    const rg = await compressPdfBytes(g, nodeCodec!, GERACAO_CONTRATO);
    writeFileSync(`${REAL}/out-${cap}-gerado.pdf`, rg.bytes);
    const files = ORDEM.map((k) => `${REAL}/${cap}-${k}.pdf`).filter((f) => existsSync(f));
    const antes = await juntar(files);
    const fit = await caberNoLimite(antes, nodeCodec!);
    writeFileSync(`${REAL}/out-${cap}-completo.pdf`, fit.bytes);
    console.log(
      cap,
      JSON.stringify({
        gerado: [g.length, rg.bytes.length],
        completo: [antes.length, fit.bytes.length],
        passadas: fit.passadas,
        cabe: fit.cabe,
        arquivos: files.length,
      }),
    );
    expect(rg.bytes.length).toBeLessThan(10_000_000);
    expect(fit.cabe).toBe(true);
    expect(fit.bytes.length).toBeLessThan(9_000_000);
  }, 300_000);
});
