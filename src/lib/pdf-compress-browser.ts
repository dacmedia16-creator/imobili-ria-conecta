/** Codificador JPEG do navegador (canvas) para src/lib/pdf-compress.ts. Só roda no cliente. */
import type { ImageCodec } from "./pdf-compress";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível");
  return { c, ctx };
}

async function toJpeg(c: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao converter imagem"))), "image/jpeg", quality),
  );
  const out = new Uint8Array(await blob.arrayBuffer());
  c.width = 0;
  c.height = 0;
  return out;
}

function draw(src: CanvasImageSource, outW: number, outH: number) {
  const { c, ctx } = canvas(outW, outH);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, outW, outH);
  return c;
}

export const browserImageCodec: ImageCodec = {
  async fromRaw(px, w, h, comps, outW, outH, quality) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0, j = 0; i < w * h; i++, j += comps) {
      const r = px[j];
      rgba[i * 4] = r;
      rgba[i * 4 + 1] = comps === 3 ? px[j + 1] : r;
      rgba[i * 4 + 2] = comps === 3 ? px[j + 2] : r;
      rgba[i * 4 + 3] = 255;
    }
    const full = canvas(w, h);
    full.ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
    const out = draw(full.c, outW, outH);
    full.c.width = 0;
    full.c.height = 0;
    return toJpeg(out, quality);
  },
  async fromJpeg(bytes, outW, outH, quality) {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
    try {
      return await toJpeg(draw(bmp, outW, outH), quality);
    } finally {
      bmp.close();
    }
  },
};
