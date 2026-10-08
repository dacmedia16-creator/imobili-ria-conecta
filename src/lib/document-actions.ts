import { toast } from "sonner";

export type PrintableDocument = { file_name: string; url: string };
export const isImageFile = (name: string) => /\.(jpe?g|png|gif|webp|bmp)$/i.test(name);
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

async function imageToPngBytes(blob: Blob): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível");
  ctx.drawImage(bitmap, 0, 0);
  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Falha ao converter imagem"))),
      "image/png",
    );
  });
  bitmap.close();
  return new Uint8Array(await pngBlob.arrayBuffer());
}

/**
 * PDF protegido por senha de proprietário (ex.: matrícula de cartório) abre normal, mas o
 * pdf-lib não descriptografa: copiar as páginas gerava folhas em branco. Aqui o pdf.js
 * (que descriptografa) desenha cada página como imagem.
 */
async function encryptedPdfPagesAsJpeg(bytes: Uint8Array): Promise<Uint8Array[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/exclusive-ocr/pdf.worker.min.mjs`;
  const loading = pdfjs.getDocument({ data: bytes.slice() });
  const pdf = await loading.promise;
  const out: Uint8Array[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      // ~200 dpi, limitado para não estourar memória no celular.
      const scale = Math.min(200 / 72, 3000 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas indisponível");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Falha ao converter página"))),
          "image/jpeg",
          0.85,
        ),
      );
      out.push(new Uint8Array(await blob.arrayBuffer()));
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
  } finally {
    await loading.destroy();
  }
  return out;
}

/**
 * Junta tudo num PDF só: `head` (ex.: contrato + Plano de Marketing recém-gerados) primeiro e depois os
 * documentos na ordem recebida. Somente URLs assinadas do storage privado.
 */
export async function juntarDocumentosEmPdf(
  list: PrintableDocument[],
  head?: Uint8Array,
): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();
  if (head) {
    const src = await PDFDocument.load(head);
    (await merged.copyPages(src, src.getPageIndices())).forEach((p) => merged.addPage(p));
  }
  for (const doc of list) {
    const resp = await fetch(doc.url);
    if (!resp.ok) throw new Error(`Falha ao baixar ${doc.file_name}`);
    const blob = await resp.blob();
    if (isImageFile(doc.file_name)) {
      const pngBytes = await imageToPngBytes(blob);
      const img = await merged.embedPng(pngBytes);
      const page = merged.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      if (src.isEncrypted) {
        for (const jpg of await encryptedPdfPagesAsJpeg(bytes)) {
          const img = await merged.embedJpg(jpg);
          // Mantém tamanho de folha A4/carta (pontos), não o tamanho em pixels.
          const w = 595;
          const h = (img.height / img.width) * w;
          merged.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
        }
        continue;
      }
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }
  }
  return merged.save();
}

/** Reutilizado pelas vendas e captações. */
export async function baixarDocumentosComoPdf(
  list: PrintableDocument[],
  nomeArquivo: string,
  head?: Uint8Array,
) {
  const mergedBytes = await juntarDocumentosEmPdf(list, head);
  const blobUrl = URL.createObjectURL(
    new Blob([mergedBytes as BlobPart], { type: "application/pdf" }),
  );
  try {
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }
}

export function openDocumentPrintWindow(): Window | null {
  // Open while still in the click handler: signed URLs are fetched asynchronously.
  // `noopener` in window.open features returns null in browsers, so detach immediately instead.
  const w = window.open("", "_blank");
  if (!w) {
    toast.error("Permita pop-ups para imprimir");
    return null;
  }
  w.opener = null;
  w.document.title = "Preparando impressão";
  return w;
}

export function printDocumentUrls(list: PrintableDocument[], preparedWindow?: Window) {
  const w = preparedWindow ?? openDocumentPrintWindow();
  if (!w) return;
  const body = list
    .map(
      (d) => `
    <section class="page">
      <h2>${escapeHtml(d.file_name)}</h2>
      ${
        isImageFile(d.file_name)
          ? `<img src="${escapeHtml(d.url)}" alt="${escapeHtml(d.file_name)}" />`
          : `<iframe src="${escapeHtml(d.url)}" title="${escapeHtml(d.file_name)}"></iframe>`
      }
    </section>
  `,
    )
    .join("");
  w.document.write(`<!doctype html><html><head><title>Imprimir documentos</title><style>
    body { margin: 0; font-family: sans-serif; }
    .page { page-break-after: always; padding: 16px; box-sizing: border-box; min-height: 100vh; }
    .page:last-child { page-break-after: auto; }
    .page h2 { font-size: 13px; margin: 0 0 8px; color: #333; }
    .page img { max-width: 100%; max-height: 92vh; display: block; margin: 0 auto; object-fit: contain; }
    .page iframe { width: 100%; height: 92vh; border: 0; }
  </style></head><body>${body}</body></html>`);
  w.document.close();
  w.onload = () => {
    w.focus();
    setTimeout(() => w.print(), 400);
  };
}
