/**
 * Data de assinatura lida do PDF assinado da Clicksign (t_834c16c9, "sim" de Denis 29/10/2026).
 *
 * A Clicksign anexa ao PDF uma página de "Log" com uma linha por evento, no horário de Brasília
 * ("Datas e horários em GMT -03:00 Brasilia"):
 *   08 out 2026, 21:26:14 FULANO assinou como contratante. Pontos de autenticação: ...
 *   09 out 2026, 12:07:00 Processo de assinatura finalizado automaticamente. ...
 * e, nas páginas de assinatura, "Assinou como testemunha em 08 out 2026 às 15:24:37".
 *
 * Regra: o contrato só vale com todas as assinaturas, então a data é a da ÚLTIMA assinatura.
 * Sem marca da Clicksign, sem nenhuma assinatura ou sem "processo finalizado" => sem data
 * (o campo fica vazio e o corretor informa). A leitura é local (pdfjs, mesmo do OCR atual);
 * nada é enviado a serviço externo e nenhum texto do PDF é guardado.
 */

const MESES: Record<string, number> = {
  jan: 1,
  fev: 2,
  mar: 3,
  abr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  set: 9,
  out: 10,
  nov: 11,
  dez: 12,
};

const MES = "(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)";
const HORA = "(\\d{2}):(\\d{2})(?::(\\d{2}))?";
// "08 out 2026, 21:26:14 <nome> assinou" — o nome não pode atravessar outro carimbo de data.
const EVENTO = new RegExp(
  `(\\d{1,2})\\s+${MES}\\s+(\\d{4}),\\s*${HORA}\\s+((?:(?!\\d{1,2}\\s+${MES}\\s+\\d{4},\\s*\\d{2}:\\d{2}).){1,300}?)\\bassinou\\b`,
  "gis",
);
// "Assinou como contratante em 08 out 2026 às 21:26:14" (página de assinaturas).
const ASSINOU_EM = new RegExp(
  `\\bassinou\\b[^\\n]{0,80}?\\bem\\s+(\\d{1,2})\\s+${MES}\\s+(\\d{4})\\s+[àa]s\\s+${HORA}`,
  "gi",
);
// "Processo de assinatura finalizado automaticamente. Motivo: finalização automática após a última
// assinatura habilitada." (ou finalizado manualmente). "Motivo: data limite para assinatura foi atingida"
// = envelope expirado sem todas as assinaturas: não conta como contrato concluído.
const FINALIZADO =
  /processo\s+de\s+assinatura\s+finalizado\b[^.]{0,40}\.(?:\s*motivo:\s*([^.]{0,80}))?/gi;

function finalizadoValido(t: string): boolean {
  for (const m of t.matchAll(FINALIZADO)) if (!/data\s+limite/i.test(m[1] ?? "")) return true;
  return false;
}

export type LeituraDataAssinatura =
  | { ok: true; data: string; assinaturas: number }
  | {
      ok: false;
      motivo:
        "sem_texto" | "sem_clicksign" | "sem_assinaturas" | "nao_finalizado" | "data_invalida";
      assinaturas: number;
      /** Última assinatura vista, só para conferência humana (nunca preenche o campo sozinha). */
      ultimaVista?: string;
    };

const pad = (n: number) => String(n).padStart(2, "0");

function isoValida(d: number, m: number, y: number): string | null {
  if (!m || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Data (AAAA-MM-DD) da última assinatura no texto do PDF da Clicksign.
 * `hoje` (AAAA-MM-DD, São Paulo) descarta data futura.
 */
export function dataAssinaturaClicksign(texto: string, hoje?: string): LeituraDataAssinatura {
  const t = (texto ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 20) return { ok: false, motivo: "sem_texto", assinaturas: 0 };
  if (!/clicksign/i.test(t)) return { ok: false, motivo: "sem_clicksign", assinaturas: 0 };

  // Chave "AAAA-MM-DDTHH:MM:SS" ordena cronologicamente como texto.
  const carimbos: string[] = [];
  const add = (d: string, mes: string, y: string, hh: string, mm: string, ss?: string) => {
    const iso = isoValida(Number(d), MESES[mes.toLowerCase()] ?? 0, Number(y));
    if (iso) carimbos.push(`${iso}T${hh}:${mm}:${ss ?? "00"}`);
  };
  for (const m of t.matchAll(EVENTO)) {
    // "Operador ... adicionou à Lista de Assinatura" não termina em "assinou"; recusa/cancelamento não contam.
    if (/\b(recusou|cancelou)\b/i.test(m[7])) continue;
    add(m[1], m[2], m[3], m[4], m[5], m[6]);
  }
  const doLog = carimbos.length;
  for (const m of t.matchAll(ASSINOU_EM)) add(m[1], m[2], m[3], m[4], m[5], m[6]);

  if (!carimbos.length) return { ok: false, motivo: "sem_assinaturas", assinaturas: 0 };
  const ultima = carimbos.sort().at(-1)!.slice(0, 10);
  // Sem "processo finalizado" (ou finalizado por data limite) o envelope pode não ter todas as assinaturas.
  if (!finalizadoValido(t))
    return { ok: false, motivo: "nao_finalizado", assinaturas: doLog, ultimaVista: ultima };
  if (hoje && ultima > hoje) return { ok: false, motivo: "data_invalida", assinaturas: doLog };
  return { ok: true, data: ultima, assinaturas: doLog || carimbos.length };
}

/** Texto curto para a tela quando não há data confiável. */
export function motivoSemData(l: LeituraDataAssinatura): string | null {
  if (l.ok) return null;
  return {
    sem_texto: "O PDF não tem texto legível (pode ser digitalizado). Informe a data.",
    sem_clicksign: "Este PDF não tem o registro de assinaturas da Clicksign. Informe a data.",
    sem_assinaturas: "Não foi encontrada nenhuma assinatura no registro do PDF. Informe a data.",
    nao_finalizado:
      "O registro do PDF não mostra todas as assinaturas concluídas (envelope em andamento ou expirado). Informe a data.",
    data_invalida: "A data lida do PDF é inválida. Informe a data.",
  }[l.motivo];
}

type PdfTextItem = { str?: string; hasEOL?: boolean };
type PdfjsLike = {
  getDocument(src: { data: Uint8Array }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        getTextContent(): Promise<{ items: PdfTextItem[] }>;
        cleanup(): void;
      }>;
    }>;
    destroy(): Promise<void>;
  };
};

/** Máximo de páginas lidas (do fim para o começo: o log da Clicksign fica nas últimas). */
export const MAX_PAGINAS_LEITURA = 80;

/** Junta o texto das páginas (últimas primeiro) usando um módulo pdfjs já carregado. */
export async function textoDoPdf(pdfjs: PdfjsLike, bytes: Uint8Array): Promise<string> {
  const loading = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const pdf = await loading.promise;
    const ini = Math.max(1, pdf.numPages - MAX_PAGINAS_LEITURA + 1);
    const partes: string[] = [];
    for (let n = ini; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const { items } = await page.getTextContent();
      partes.push(items.map((i) => (i.str ?? "") + (i.hasEOL ? "\n" : " ")).join(""));
      page.cleanup();
    }
    return partes.join("\n");
  } finally {
    await loading.destroy().catch(() => {});
  }
}

/** Navegador: lê a data da última assinatura do PDF (null = sem data confiável). */
export async function lerDataAssinaturaPdf(
  bytes: Uint8Array,
  hoje: string,
): Promise<LeituraDataAssinatura> {
  if (typeof window === "undefined") return { ok: false, motivo: "sem_texto", assinaturas: 0 };
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/exclusive-ocr/pdf.worker.min.mjs`;
  const texto = await textoDoPdf(pdfjs as unknown as PdfjsLike, bytes);
  return dataAssinaturaClicksign(texto, hoje);
}
