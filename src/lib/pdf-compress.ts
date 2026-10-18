/**
 * Compressão das imagens de um PDF (cartão t_f8dc8b99): o contrato-base da captação traz a capa em
 * 300 dpi sem compressão JPEG (~8 MB) e é isso que fazia o contrato gerado (e o assinado da Clicksign)
 * passar de 10 MB. Aqui cada imagem grande vira JPEG, reduzida até `maxSide` pixels no lado maior
 * (1754 px = folha A4 inteira a 150 dpi). Texto, campos e assinaturas são vetoriais e não mudam.
 *
 * Sem dependência do navegador: quem chama injeta o `ImageCodec` (canvas no navegador,
 * @napi-rs/canvas nos testes). Qualquer imagem que não dê para tratar com segurança fica como está.
 */
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  type PDFObject,
} from "pdf-lib";

export type ImageCodec = {
  /** Pixels crus (1 = cinza, 3 = RGB; 8 bits) → JPEG RGB em outW×outH. */
  fromRaw(
    px: Uint8Array,
    w: number,
    h: number,
    comps: 1 | 3,
    outW: number,
    outH: number,
    quality: number,
  ): Promise<Uint8Array>;
  /** JPEG → JPEG RGB em outW×outH. */
  fromJpeg(bytes: Uint8Array, outW: number, outH: number, quality: number): Promise<Uint8Array>;
};

export type CompressOptions = {
  /** Lado maior, em pixels, depois da redução (1754 ≈ A4 a 150 dpi). */
  maxSide: number;
  /** Qualidade do JPEG (0–1). */
  quality: number;
  /** Só mexe em imagens com stream maior que isto (logotipos pequenos ficam nítidos). */
  minBytes?: number;
  /** Também recomprime JPEGs que já cabem no tamanho (2ª passada do PDF completo). */
  recompressJpeg?: boolean;
  /** Teto de pixels decodificados por imagem (memória do celular). Acima disso, a imagem fica. */
  maxPixels?: number;
};

export type CompressReport = { images: number; changed: number; before: number; after: number };

const name = (o: PDFObject | undefined) => (o instanceof PDFName ? o.asString() : null);
const num = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : null);

function components(doc: PDFDocument, cs: PDFObject | undefined): 1 | 3 | null {
  const c = cs instanceof PDFRef ? doc.context.lookup(cs) : cs;
  const n = name(c);
  if (n === "/DeviceGray") return 1;
  if (n === "/DeviceRGB") return 3;
  if (c instanceof PDFArray && name(c.get(0)) === "/ICCBased") {
    const icc = doc.context.lookup(c.get(1));
    const N = icc instanceof PDFRawStream ? num(icc.dict.get(PDFName.of("N"))) : null;
    return N === 1 ? 1 : N === 3 ? 3 : null;
  }
  return null; // CMYK, Indexed, Lab etc.: não mexe
}

/** Desfaz o preditor PNG (Predictor >= 10) do FlateDecode. Devolve null se o tamanho não bate. */
export function pngUnpredict(data: Uint8Array, columns: number, comps: number, rows: number) {
  const bpp = comps;
  const stride = columns * comps;
  if (data.length < (stride + 1) * rows) return null;
  const out = new Uint8Array(stride * rows);
  for (let y = 0; y < rows; y++) {
    const type = data[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const raw = data[src + x];
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[dst - stride + x] : 0;
      const c = y > 0 && x >= bpp ? out[dst - stride + x - bpp] : 0;
      let v: number;
      if (type === 0) v = raw;
      else if (type === 1) v = raw + a;
      else if (type === 2) v = raw + b;
      else if (type === 3) v = raw + ((a + b) >> 1);
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else return null;
      out[dst + x] = v & 0xff;
    }
  }
  return out;
}

/** Comprime as imagens do PDF já carregado (altera `doc`). */
export async function compressPdfImages(
  doc: PDFDocument,
  codec: ImageCodec,
  opt: CompressOptions,
): Promise<CompressReport> {
  const minBytes = opt.minBytes ?? 150 * 1024;
  // 16 M px: limite de canvas do Safari no iPhone (acima disso a imagem fica como está).
  const maxPixels = opt.maxPixels ?? 16_000_000;
  const rep: CompressReport = { images: 0, changed: 0, before: 0, after: 0 };
  const objects = doc.context.enumerateIndirectObjects();
  // Máscaras de transparência ficam como estão (o PDF aceita máscara com outra resolução).
  const masks = new Set<string>();
  for (const [, o] of objects) {
    if (!(o instanceof PDFRawStream)) continue;
    for (const k of ["SMask", "Mask"]) {
      const m = o.dict.get(PDFName.of(k));
      if (m instanceof PDFRef) masks.add(m.toString());
    }
  }
  for (const [ref, o] of objects) {
    if (!(o instanceof PDFRawStream)) continue;
    const d = o.dict;
    if (name(d.get(PDFName.of("Subtype"))) !== "/Image" || masks.has(ref.toString())) continue;
    rep.images++;
    const size = o.contents.length;
    rep.before += size;
    rep.after += size;
    if (size < minBytes) continue;
    const w = num(d.get(PDFName.of("Width")));
    const h = num(d.get(PDFName.of("Height")));
    const filterObj = d.get(PDFName.of("Filter"));
    const filter =
      filterObj instanceof PDFArray && filterObj.size() === 1
        ? name(filterObj.get(0))
        : name(filterObj);
    const comps = components(doc, d.get(PDFName.of("ColorSpace")));
    if (!w || !h || !comps || num(d.get(PDFName.of("BitsPerComponent"))) !== 8) continue;
    if (d.get(PDFName.of("Decode")) || d.get(PDFName.of("ImageMask"))) continue;
    if (filter !== "/FlateDecode" && filter !== "/DCTDecode") continue;
    if (w * h > maxPixels) continue;
    const scale = Math.min(1, opt.maxSide / Math.max(w, h));
    if (filter === "/DCTDecode" && scale === 1 && !opt.recompressJpeg) continue;
    const outW = Math.max(1, Math.round(w * scale));
    const outH = Math.max(1, Math.round(h * scale));
    let jpeg: Uint8Array;
    try {
      if (filter === "/DCTDecode") {
        jpeg = await codec.fromJpeg(o.contents, outW, outH, opt.quality);
      } else {
        let px = decodePDFRawStream(o).decode();
        const dp = d.lookupMaybe(PDFName.of("DecodeParms"), PDFDict);
        const pred = dp ? num(dp.get(PDFName.of("Predictor"))) ?? 1 : 1;
        if (pred >= 10) {
          const cols = num(dp?.get(PDFName.of("Columns"))) ?? w;
          const un = pngUnpredict(px, cols, comps, h);
          if (!un) continue;
          px = un;
        } else if (pred !== 1) continue;
        if (px.length < w * h * comps) continue;
        jpeg = await codec.fromRaw(px, w, h, comps, outW, outH, opt.quality);
      }
    } catch {
      continue; // imagem que o navegador não decodifica fica como está
    }
    if (!jpeg.length || jpeg.length >= size) continue;
    const entries: Record<string, PDFObject | string | number> = {
      Type: PDFName.of("XObject"),
      Subtype: PDFName.of("Image"),
      Width: outW,
      Height: outH,
      BitsPerComponent: 8,
      Filter: PDFName.of("DCTDecode"),
      // O JPEG sai em RGB: mantém o perfil de cor só se ele já era de 3 canais.
      ColorSpace: comps === 3 ? d.get(PDFName.of("ColorSpace"))! : PDFName.of("DeviceRGB"),
    };
    const smask = d.get(PDFName.of("SMask"));
    if (smask) entries.SMask = smask;
    const interp = d.get(PDFName.of("Interpolate"));
    if (interp) entries.Interpolate = interp;
    doc.context.assign(ref, doc.context.stream(jpeg, entries as never));
    rep.changed++;
    rep.after += jpeg.length - size;
  }
  return rep;
}

/** Carrega, comprime e salva. Em qualquer erro devolve o PDF original (nunca piora o fluxo). */
export async function compressPdfBytes(
  bytes: Uint8Array,
  codec: ImageCodec,
  opt: CompressOptions,
): Promise<{ bytes: Uint8Array; report: CompressReport | null }> {
  try {
    const doc = await PDFDocument.load(bytes);
    const report = await compressPdfImages(doc, codec, opt);
    if (!report.changed) return { bytes, report };
    const out = await doc.save();
    return out.length < bytes.length ? { bytes: out, report } : { bytes, report };
  } catch {
    return { bytes, report: null };
  }
}

/** Contrato gerado (vai à Clicksign): imagens a ~150 dpi, JPEG 80%. */
export const GERACAO_CONTRATO: CompressOptions = { maxSide: 1754, quality: 0.8 };

/** Teto do PDF completo pedido por Denis: menos de 9 MB (9.000.000 bytes, com folga). */
export const LIMITE_PDF_COMPLETO = 9_000_000;

/** Passadas do PDF completo quando passa do teto: cada uma mais leve que a anterior. */
export const PASSADAS_PDF_COMPLETO: CompressOptions[] = [
  { maxSide: 1754, quality: 0.75, minBytes: 80 * 1024, recompressJpeg: true },
  { maxSide: 1400, quality: 0.6, minBytes: 60 * 1024, recompressJpeg: true },
  { maxSide: 1100, quality: 0.5, minBytes: 40 * 1024, recompressJpeg: true },
];

/**
 * Faz caber no teto: devolve o PDF da primeira passada que coube (ou o menor de todos) e se coube.
 * O PDF que já cabe volta sem mudança.
 */
export async function caberNoLimite(
  bytes: Uint8Array,
  codec: ImageCodec,
  limite = LIMITE_PDF_COMPLETO,
  passadas = PASSADAS_PDF_COMPLETO,
): Promise<{ bytes: Uint8Array; cabe: boolean; passadas: number }> {
  if (bytes.length < limite) return { bytes, cabe: true, passadas: 0 };
  let menor = bytes;
  let n = 0;
  for (const p of passadas) {
    n++;
    // Sempre a partir do original: recomprimir JPEG sobre JPEG acumula perda à toa.
    const r = await compressPdfBytes(bytes, codec, p);
    if (r.bytes.length < menor.length) menor = r.bytes;
    if (menor.length < limite) return { bytes: menor, cabe: true, passadas: n };
  }
  return { bytes: menor, cabe: false, passadas: n };
}

export const formatMB = (n: number) =>
  `${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
