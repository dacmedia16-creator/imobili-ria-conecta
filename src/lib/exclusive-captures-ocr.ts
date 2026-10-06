import type { Owner, Property } from "./exclusive-captures";

type Suggestions = Partial<Owner> & Partial<Property>;
const cpfPattern = /\b\d{3}[. ]?\d{3}[. ]?\d{3}[- ]?\d{2}\b/g;

export function validCpf(value: string): boolean {
  if (!/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11 || /^(\d)\1+$/.test(digits)) return false;
  for (let size = 9; size < 11; size++) {
    const sum = [...digits.slice(0, size)].reduce(
      (n, digit, i) => n + Number(digit) * (size + 1 - i),
      0,
    );
    if (Number(digits[size]) !== ((sum * 10) % 11) % 10) return false;
  }
  return true;
}

export function validCreci(value: string): boolean {
  return (
    value.trim().length >= 4 &&
    value.trim().length <= 50 &&
    /^[A-Za-z0-9][A-Za-z0-9 ./-]*$/.test(value.trim())
  );
}

/** OCR is untrusted: return only a few labelled, reviewable hints, never the raw document. */
export function parseCaptureSuggestions(text: string, scope: "owner" | "property"): Suggestions {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  // Documentos reais (CNH, RG, IPTU, matrícula) costumam trazer o rótulo numa linha e o
  // valor na linha seguinte. Tenta o resto da mesma linha e, se não servir, a próxima.
  const labelled = (pattern: RegExp, pick: (value: string) => string | undefined) => {
    for (let i = 0; i < lines.length; i++) {
      if (!pattern.test(lines[i])) continue;
      const same = lines[i].replace(pattern, "").replace(/^[:\s-]+/, "").trim().slice(0, 120);
      const fromSame = same ? pick(same) : undefined;
      if (fromSame) return fromSame;
      const next = lines[i + 1]?.slice(0, 120);
      const fromNext = next ? pick(next) : undefined;
      if (fromNext) return fromNext;
    }
    return undefined;
  };
  const LABEL_WORDS =
    /\b(?:nome|cpf|rg|data|nascimento|filia[çc][ãa]o|identidade|emissor|registro|validade|categoria|habilita[çc][ãa]o|rep[úu]blica|naturalidade|expedi[çc][ãa]o|documento|assinatura)\b/i;
  const asName = (value: string) => {
    const clean = value.replace(/[^\p{L} .'-]/gu, " ").replace(/\s+/g, " ").trim();
    return /^[\p{L} .'-]{5,120}$/u.test(clean) && clean.includes(" ") && !LABEL_WORDS.test(clean)
      ? clean
      : undefined;
  };
  const asRg = (value: string) => {
    const match = value.match(/\b\d{1,2}\.?\d{3}\.?\d{3}(?:-?[\dxX])?\b/)?.[0];
    return match && !validCpf(match) ? match : undefined;
  };
  const asCode = (min: number) => (value: string) => {
    const match = value.match(/[\dA-Za-z][\w./-]*(?: [\w./-]+)*/)?.[0]?.trim();
    return match && /\d/.test(match) && match.length >= min && match.length <= 50
      ? match
      : undefined;
  };
  const asAddress = (value: string) =>
    value.length >= 8 && /\p{L}/u.test(value) && !LABEL_WORDS.test(value.split(/[,\d]/)[0])
      ? value
      : undefined;
  const result: Suggestions = {};
  if (scope === "owner") {
    const name = labelled(
      /^(?:\d+\s*(?:e\s*\d+\s*)?)?(?:nome(?: e sobrenome| completo)?|propriet[áa]rio|titular)\b\s*[:-]?\s*/i,
      asName,
    );
    if (name) result.nome_completo = name;
    const cpf = [...text.matchAll(cpfPattern)].map(([match]) => match).find(validCpf);
    if (cpf) result.cpf = cpf;
    const rg =
      labelled(/^(?:rg|registro geral|c[ée]dula de identidade|identidade)\b\s*[:-]?\s*/i, asRg) ??
      labelled(/^(?:\d+[a-z]?\s*)?doc\.? identidade\b.*$/i, asRg);
    if (rg) result.rg = rg;
    const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
    if (email) result.email = email;
    const phone = labelled(/^(?:telefone|celular|fone)\s*[:-]?\s*/i, (value) =>
      /^[\d() +-]{10,22}$/.test(value) ? value : undefined,
    );
    if (phone) result.telefone_1 = phone;
    const address = labelled(/^(?:endere[çc]o|logradouro)\s*[:-]?\s*/i, asAddress);
    if (address) result.endereco_completo = address;
  } else {
    const inscription = labelled(
      /^(?:inscri[çc][ãa]o(?: imobili[áa]ria| municipal| cadastral)?|classifica[çc][ãa]o(?: fiscal)?|cadastro imobili[áa]rio)\s*[:-]?\s*/i,
      asCode(4),
    );
    if (inscription) result.classificacao_fiscal_iptu = inscription;
    const register = labelled(
      /^(?:n[úu]mero da matr[íi]cula|matr[íi]cula(?: n[º°o.]*)?)\s*[:-]?\s*/i,
      asCode(3),
    );
    if (register) result.numero_matricula = register;
    const registry = labelled(/^(?:cart[óo]rio|registro de im[óo]veis)\s*[:-]?\s*/i, (value) =>
      value.length >= 4 ? value : undefined,
    );
    if (registry) result.cartorio_registro = registry;
    const address = labelled(
      /^(?:endere[çc]o(?: do im[óo]vel)?|local(?:iza[çc][ãa]o)? do im[óo]vel|logradouro)\s*[:-]?\s*/i,
      asAddress,
    );
    if (address) result.endereco = address;
  }
  return result;
}

const MAX_OCR_BYTES = 8 * 1024 * 1024;
const OCR_TIMEOUT_MS = 45_000;

/** Browser-only, same-origin assets. No CDN, server upload, external OCR, or logging of PII. */
export async function suggestFromLocalFile(
  file: File,
  scope: "owner" | "property",
): Promise<Suggestions> {
  if (typeof window === "undefined" || typeof Worker === "undefined")
    throw new Error("Leitura local indisponível neste dispositivo; preencha manualmente.");
  if (file.size > MAX_OCR_BYTES)
    throw new Error("Arquivo grande para leitura local; preencha manualmente.");
  const assets = `${window.location.origin}/exclusive-ocr`;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  let ocr: Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>> | undefined;
  let pdfLoading: { destroy(): Promise<void> } | undefined;
  try {
    const task = async () => {
      const [{ createWorker }, pdfjs] = await Promise.all([
        import("tesseract.js"),
        file.type === "application/pdf" ? import("pdfjs-dist") : Promise.resolve(null),
      ]);
      if (pdfjs) pdfjs.GlobalWorkerOptions.workerSrc = `${assets}/pdf.worker.min.mjs`;
      ocr = await createWorker("por", 1, {
        workerPath: `${assets}/worker.min.js`,
        corePath: `${assets}/core`,
        langPath: assets,
        gzip: false,
        workerBlobURL: false,
        cacheMethod: "none",
      });
      if (expired) throw new Error("Leitura local expirou");
      let text = "";
      if (pdfjs) {
        const loading = pdfjs.getDocument({
          data: new Uint8Array(await file.arrayBuffer()),
        });
        pdfLoading = loading;
        const pdfDocument = await loading.promise;
        if (expired) throw new Error("Leitura local expirou");
        // Only the first two pages; bounded canvas resolution and no raw text retained.
        for (let pageNo = 1; pageNo <= Math.min(pdfDocument.numPages, 2); pageNo++) {
          if (expired) throw new Error("Leitura local expirou");
          const page = await pdfDocument.getPage(pageNo);
          const viewport = page.getViewport({ scale: 1.6 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          if (canvas.width * canvas.height > 8_000_000)
            throw new Error("Página grande para leitura local");
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas indisponível");
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          text += `\n${(await ocr.recognize(canvas)).data.text}`;
          canvas.width = 0;
          canvas.height = 0;
          page.cleanup();
        }
      } else {
        text = (await ocr.recognize(file)).data.text;
      }
      return parseCaptureSuggestions(text, scope);
    };
    return await Promise.race([
      task(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          expired = true;
          void ocr?.terminate().catch(() => {});
          void pdfLoading?.destroy().catch(() => {});
          reject(new Error("Leitura local demorou demais; preencha manualmente."));
        }, OCR_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    await Promise.allSettled([ocr?.terminate(), pdfLoading?.destroy()]);
  }
}
