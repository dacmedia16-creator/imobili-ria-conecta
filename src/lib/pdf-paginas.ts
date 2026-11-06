/**
 * PDF legível em qualquer celular (t_41c8f65a): o Chrome do Android não mostra PDF dentro de
 * <iframe> (fica em branco) e o Safari do iPhone mostra só a 1ª página sem rolar. Aqui o pdf.js
 * desenha cada página como imagem, que rola normal em qualquer aparelho.
 */

export const PREVIA_MARCA = "PRÉVIA — NÃO ASSINAR";

/** Máximo de páginas desenhadas (o contrato + Plano tem ~10; evita estourar memória no celular). */
export const MAX_PAGINAS_VISUALIZAR = 40;

/** Carimba "PRÉVIA — NÃO ASSINAR" em todas as páginas (só na cópia de conferência). */
export async function marcarPrevia(bytes: Uint8Array): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, degrees } = await import("pdf-lib");
  const pdf = await PDFDocument.load(bytes);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.min(width, height) / 11;
    const w = font.widthOfTextAtSize(PREVIA_MARCA, size);
    // Diagonal centralizada (45°): desloca a origem para o texto cruzar o meio da folha.
    const d = w / 2 / Math.SQRT2;
    page.drawText(PREVIA_MARCA, {
      x: width / 2 - d,
      y: height / 2 - d,
      size,
      font,
      color: rgb(0.85, 0.1, 0.1),
      opacity: 0.25,
      rotate: degrees(45),
    });
    page.drawText(`${PREVIA_MARCA} · conferência do corretor`, {
      x: 24,
      y: height - 18,
      size: 9,
      font,
      color: rgb(0.85, 0.1, 0.1),
    });
  }
  return pdf.save();
}

type PdfjsPagina = {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise: Promise<void> };
  cleanup(): void;
};

/**
 * Desenha as páginas do PDF como JPEG e devolve URLs `blob:` (quem chama revoga).
 * `largura` = pixels da imagem (nitidez); a tela reduz para caber.
 */
export async function paginasPdfComoImagens(
  bytes: Uint8Array,
  { largura = 1240, maxPaginas = MAX_PAGINAS_VISUALIZAR } = {},
): Promise<{ urls: string[]; total: number }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/exclusive-ocr/pdf.worker.min.mjs`;
  const loading = pdfjs.getDocument({ data: bytes.slice() });
  const urls: string[] = [];
  try {
    const pdf = await loading.promise;
    const total = pdf.numPages;
    for (let n = 1; n <= Math.min(total, maxPaginas); n++) {
      const page = (await pdf.getPage(n)) as unknown as PdfjsPagina;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: largura / base.width });
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
          (b) => (b ? resolve(b) : reject(new Error("Falha ao desenhar a página"))),
          "image/jpeg",
          0.85,
        ),
      );
      urls.push(URL.createObjectURL(blob));
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
    return { urls, total };
  } catch (e) {
    urls.forEach((u) => URL.revokeObjectURL(u));
    throw e;
  } finally {
    await loading.destroy().catch(() => {});
  }
}
