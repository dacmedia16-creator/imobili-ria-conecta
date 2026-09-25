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

/** Reutilizado pelas vendas e captações; somente URLs assinadas recebidas do storage privado. */
export async function baixarDocumentosComoPdf(list: PrintableDocument[], nomeArquivo: string) {
  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();
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
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }
  }
  const mergedBytes = await merged.save();
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
