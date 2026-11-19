/**
 * Tom do logo da imobiliária (t_331aa14e): mede se a imagem é clara ou escura para decidir se precisa de
 * uma "plaquinha" de fundo e não sumir sobre o fundo do menu (azul-marinho) ou de um card (branco).
 *
 * A medida é a luminosidade média (luma Rec. 601, 0–255) só dos pixels visíveis, pesada pela opacidade:
 * fundo transparente não conta. Feita no navegador com canvas; o bucket público organization-logos responde
 * com Access-Control-Allow-Origin: *, então a leitura dos pixels é permitida com crossOrigin="anonymous".
 */
export type LogoTom = "claro" | "escuro";

/** Acima disso o logo é "claro" (aparece bem em fundo escuro). */
export const LIMITE_LOGO_CLARO = 150;
/** Pixels com opacidade abaixo disso (0–255) são tratados como fundo transparente. */
const ALFA_MINIMO = 24;

/** Classifica pixels RGBA (formato do ImageData). Sem nenhum pixel visível devolve null (indefinido). */
export function tomDosPixels(rgba: ArrayLike<number>): LogoTom | null {
  let soma = 0;
  let peso = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a < ALFA_MINIMO) continue;
    const w = a / 255;
    soma += (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * w;
    peso += w;
  }
  if (peso === 0) return null;
  return soma / peso >= LIMITE_LOGO_CLARO ? "claro" : "escuro";
}

/**
 * Plaquinha atrás do logo, conforme o fundo onde ele aparece.
 * - Fundo escuro: plaquinha clara, a menos que o logo seja claro com certeza (falha/indefinido → plaquinha).
 * - Fundo claro: plaquinha escura só quando o logo é claro com certeza (falha → como hoje, sem plaquinha).
 */
export function plaquinhaDoLogo(
  fundo: "escuro" | "claro",
  tom: LogoTom | null,
): "clara" | "escura" | null {
  if (fundo === "escuro") return tom === "claro" ? null : "clara";
  return tom === "claro" ? "escura" : null;
}

const cache = new Map<string, Promise<LogoTom | null>>();

/** Mede o tom de um logo pela URL (só no navegador). Falha de carga/CORS → null. Resultado em cache por URL. */
export function medirTomDoLogo(url: string): Promise<LogoTom | null> {
  if (typeof window === "undefined" || typeof document === "undefined")
    return Promise.resolve(null);
  const salvo = cache.get(url);
  if (salvo) return salvo;
  const promessa = new Promise<LogoTom | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        // Reduz para no máximo 48 px: suficiente para a média e barato.
        const escala = Math.min(1, 48 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const w = Math.max(1, Math.round((img.naturalWidth || 1) * escala));
        const h = Math.max(1, Math.round((img.naturalHeight || 1) * escala));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(tomDosPixels(ctx.getImageData(0, 0, w, h).data));
      } catch {
        resolve(null); // canvas "contaminado" (CORS) ou outro erro: quem chama usa o padrão seguro
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  cache.set(url, promessa);
  return promessa;
}
