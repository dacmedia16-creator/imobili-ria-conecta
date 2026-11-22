/**
 * Tráfego pago lançado à mão no Feedback ao Proprietário (t_f3f64be0, Denis 22/11/2026).
 * Regra de dados:
 *  - Cada lançamento tem canal (Meta Ads, Google Ads, Outro), período (início/fim), visualizações, contatos e,
 *    opcionalmente, o valor investido.
 *  - No relatório do proprietário entram só os lançamentos com o período INTEIRO dentro do período do relatório
 *    (não rateamos dias: isso inventaria número). Os que passam do período ficam listados só na tela interna.
 *  - O valor investido é interno: o resumo que vai para PDF/WhatsApp/IA (PaidTrafficSummary) nem tem esse campo.
 */
import { codeKey } from "@/lib/feedback-captacao";

export type PaidChannel = "meta" | "google" | "outro";

export const PAID_CHANNEL_LABEL: Record<PaidChannel, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  outro: "Outro",
};

/** Título da linha na tela interna (pedido de Denis). */
export const PAID_SCREEN_LABEL = "Tráfego pago (Meta/Google)";

export interface PaidTrafficEntry {
  id: string;
  listing_code: string;
  code_key: string;
  canal: PaidChannel;
  inicio: string; // YYYY-MM-DD
  fim: string; // YYYY-MM-DD
  visualizacoes: number;
  contatos: number;
  investimento: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export const PAID_SELECT =
  "id,listing_code,code_key,canal,inicio,fim,visualizacoes,contatos,investimento,created_by,updated_by,created_at,updated_at";

/** Período do relatório (datas civis YYYY-MM-DD, inclusivas). */
export interface ReportPeriod {
  de: string;
  ate: string;
}

/** O que vai para o proprietário: sem valor investido (por construção). */
export interface PaidTrafficSummary {
  views: number;
  contacts: number;
  /** Canais efetivamente lançados no período, na ordem Meta, Google, Outro. */
  canais: PaidChannel[];
  /** Menor início e maior fim dos lançamentos que entraram. */
  de: string;
  ate: string;
  lancamentos: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function fmtDataBr(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Período padrão do relatório: a janela "últimos 30 dias" confirmada dos portais (menor início, maior fim);
 * sem ela, os 30 dias até hoje (horário de SP, vindo de quem chama).
 */
export function defaultReportPeriod(
  windows: Array<{ from: string | null; to: string | null }>,
  hoje: string,
): ReportPeriod {
  const ok = windows.filter((w) => w.from && w.to && ISO.test(w.from) && ISO.test(w.to)) as Array<{
    from: string;
    to: string;
  }>;
  if (ok.length) {
    return {
      de: ok.map((w) => w.from).sort()[0],
      ate: ok
        .map((w) => w.to)
        .sort()
        .at(-1) as string,
    };
  }
  return { de: addDays(hoje, -29), ate: hoje };
}

export function periodValid(p: ReportPeriod | null | undefined): p is ReportPeriod {
  return !!p && ISO.test(p.de) && ISO.test(p.ate) && p.ate >= p.de;
}

/** Lançamento inteiro dentro do período do relatório. */
export function insidePeriod(
  e: Pick<PaidTrafficEntry, "inicio" | "fim">,
  p: ReportPeriod,
): boolean {
  return e.inicio >= p.de && e.fim <= p.ate;
}

/** Lançamentos do imóvel (mesma chave de código: x/hífen/zeros). */
export function entriesForListing(entries: PaidTrafficEntry[], code: string): PaidTrafficEntry[] {
  const k = codeKey(code);
  return entries
    .filter((e) => (e.code_key || codeKey(e.listing_code)) === k)
    .sort((a, b) => b.inicio.localeCompare(a.inicio) || b.created_at.localeCompare(a.created_at));
}

/** Soma o que vai para o proprietário no período. Nenhum lançamento dentro = null (linha não aparece). */
export function summarizePaid(
  entries: PaidTrafficEntry[],
  p: ReportPeriod | null | undefined,
): PaidTrafficSummary | null {
  if (!periodValid(p)) return null;
  const dentro = entries.filter((e) => insidePeriod(e, p));
  if (!dentro.length) return null;
  const ordem: PaidChannel[] = ["meta", "google", "outro"];
  return {
    views: dentro.reduce((s, e) => s + Math.max(0, e.visualizacoes ?? 0), 0),
    contacts: dentro.reduce((s, e) => s + Math.max(0, e.contatos ?? 0), 0),
    canais: ordem.filter((c) => dentro.some((e) => e.canal === c)),
    de: dentro.map((e) => e.inicio).sort()[0],
    ate: dentro
      .map((e) => e.fim)
      .sort()
      .at(-1) as string,
    lancamentos: dentro.length,
  };
}

/** Investido no período (só tela interna). */
export function investedInPeriod(
  entries: PaidTrafficEntry[],
  p: ReportPeriod | null | undefined,
): number {
  if (!periodValid(p)) return 0;
  return entries
    .filter((e) => insidePeriod(e, p))
    .reduce(
      (s, e) => s + (e.investimento != null && e.investimento > 0 ? Number(e.investimento) : 0),
      0,
    );
}

/** Rótulo para o proprietário: só os canais lançados (não inventa origem). Ex.: "Tráfego pago (Meta Ads)". */
export function paidOwnerLabel(s: Pick<PaidTrafficSummary, "canais">): string {
  const lista = paidChannelsText(s);
  return lista ? `Tráfego pago (${lista})` : "Tráfego pago";
}

/** "Meta Ads", "Meta Ads e Google Ads", "Google Ads e outros canais". */
export function paidChannelsText(s: Pick<PaidTrafficSummary, "canais">): string {
  const nomes = s.canais.map((c) => (c === "outro" ? "outros canais" : PAID_CHANNEL_LABEL[c]));
  return nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}` : (nomes[0] ?? "");
}

export function paidPeriodText(s: Pick<PaidTrafficSummary, "de" | "ate">): string {
  return s.de === s.ate ? `em ${fmtDataBr(s.de)}` : `${fmtDataBr(s.de)} a ${fmtDataBr(s.ate)}`;
}

export interface PaidDraft {
  canal: string;
  inicio: string;
  fim: string;
  visualizacoes: string;
  contatos: string;
  investimento: string;
}

export interface PaidValues {
  canal: PaidChannel;
  inicio: string;
  fim: string;
  visualizacoes: number;
  contatos: number;
  investimento: number | null;
}

/** Inteiro >= 0 a partir do texto digitado ("1.200" = 1200). Vazio = 0. */
function inteiro(t: string): number | null {
  const s = t.trim().replace(/\./g, "");
  if (!s) return 0;
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

/** Valor em reais ("1.234,56", "350,5", "350.50") >= 0. Vazio = null (não informado). */
export function parseReais(t: string): number | null | "erro" {
  let s = t.trim().replace(/^R\$\s*/i, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return "erro";
  return Number(s);
}

/** Mesmas regras do banco: canal da lista, fim >= início (até 366 dias), números >= 0. */
export function validatePaid(
  d: PaidDraft,
): { ok: true; value: PaidValues } | { ok: false; error: string } {
  if (!(["meta", "google", "outro"] as string[]).includes(d.canal))
    return { ok: false, error: "Escolha o canal." };
  if (!ISO.test(d.inicio) || !ISO.test(d.fim))
    return { ok: false, error: "Informe a data de início e a de fim." };
  if (d.fim < d.inicio) return { ok: false, error: "A data de fim não pode ser antes do início." };
  const dias = (Date.parse(d.fim) - Date.parse(d.inicio)) / 86_400_000;
  if (dias > 366) return { ok: false, error: "O período pode ter no máximo 1 ano." };
  const v = inteiro(d.visualizacoes);
  const c = inteiro(d.contatos);
  if (v == null || c == null)
    return { ok: false, error: "Visualizações e contatos devem ser números inteiros (0 ou mais)." };
  if (v > 100_000_000 || c > 10_000_000) return { ok: false, error: "Número muito alto. Confira." };
  const inv = parseReais(d.investimento);
  if (inv === "erro") return { ok: false, error: "Valor investido inválido. Ex.: 350,00" };
  if (inv != null && inv > 10_000_000)
    return { ok: false, error: "Valor investido muito alto. Confira." };
  return {
    ok: true,
    value: {
      canal: d.canal as PaidChannel,
      inicio: d.inicio,
      fim: d.fim,
      visualizacoes: v,
      contatos: c,
      investimento: inv,
    },
  };
}

export function draftFrom(e?: PaidTrafficEntry | null, p?: ReportPeriod | null): PaidDraft {
  if (!e)
    return {
      canal: "meta",
      inicio: p?.de ?? "",
      fim: p?.ate ?? "",
      visualizacoes: "",
      contatos: "",
      investimento: "",
    };
  return {
    canal: e.canal,
    inicio: e.inicio,
    fim: e.fim,
    visualizacoes: String(e.visualizacoes),
    contatos: String(e.contatos),
    investimento: e.investimento == null ? "" : String(e.investimento).replace(".", ","),
  };
}

/**
 * O que a tela mostra. O banco (RLS, owner_feedback_can_edit) é a autoridade: quem pode lançar é o corretor
 * responsável pelo imóvel, o gestor/TL dele e o admin da imobiliária. Quem não pode lançar não lê os lançamentos,
 * então o valor investido só aparece para quem lança e para os gestores.
 */
export function paidTrafficAccess(podeEditar: boolean): {
  lancar: boolean;
  verInvestimento: boolean;
} {
  return { lancar: podeEditar, verInvestimento: podeEditar };
}

export const fmtReais = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
