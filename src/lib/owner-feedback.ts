/**
 * Feedback ao Proprietário: junta os números dos portais por anúncio e monta o texto
 * que o corretor revisa e envia pelo próprio WhatsApp.
 * Regra: só vai para o proprietário número com período confirmado; erro de coleta fica sem número.
 */

export type PortalKey = "zap" | "imovelweb" | "cliqueimudei" | "chavesnamao";
export type WindowKind = "cumulative" | "last30" | "unknown";

export interface Snapshot {
  portal: PortalKey;
  collected_on: string;
  listing_code: string;
  broker_id: string | null;
  window_kind: WindowKind;
  window_from: string | null;
  window_to: string | null;
  impressions: number | null;
  views: number | null;
  contacts: number | null;
  error: string | null;
}

export const PORTAL_LABEL: Record<PortalKey, string> = {
  zap: "ZAP, OLX e VivaReal",
  imovelweb: "Imovelweb",
  cliqueimudei: "Cliquei Mudei",
  chavesnamao: "Chaves na Mão",
};

export interface PortalLine {
  portal: PortalKey;
  label: string;
  views: number | null;
  contacts: number | null;
  impressions: number | null;
  /** Variação desde a coleta anterior (só quando há duas coletas válidas). */
  viewsDelta: number | null;
  contactsDelta: number | null;
  periodText: string;
  /** Período confirmado: pode ir para o proprietário. */
  confirmed: boolean;
  error: string | null;
  collectedOn: string;
}

export interface ListingFeedback {
  code: string;
  brokerId: string | null;
  lines: PortalLine[];
  lastCollectedOn: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function periodText(s: Pick<Snapshot, "window_kind" | "window_from" | "window_to">): string {
  if (s.window_kind === "last30")
    return s.window_from && s.window_to
      ? `últimos 30 dias (${fmtDate(s.window_from)} a ${fmtDate(s.window_to)})`
      : "últimos 30 dias";
  if (s.window_kind === "cumulative") return "desde a publicação";
  return "período a confirmar";
}

const diff = (a: number | null, b: number | null | undefined) =>
  a == null || b == null ? null : a - b;

/** Agrupa snapshots por anúncio; usa a coleta mais recente de cada portal e a anterior para a variação. */
export function groupByListing(rows: Snapshot[]): ListingFeedback[] {
  const byCode = new Map<string, Snapshot[]>();
  for (const r of rows) {
    const list = byCode.get(r.listing_code) ?? [];
    list.push(r);
    byCode.set(r.listing_code, list);
  }
  const out: ListingFeedback[] = [];
  for (const [code, list] of byCode) {
    const lines: PortalLine[] = [];
    const portals = [...new Set(list.map((r) => r.portal))].sort(
      (a, b) => Object.keys(PORTAL_LABEL).indexOf(a) - Object.keys(PORTAL_LABEL).indexOf(b),
    );
    for (const p of portals) {
      const hist = list
        .filter((r) => r.portal === p)
        .sort((a, b) => b.collected_on.localeCompare(a.collected_on));
      const cur = hist[0];
      const prev = hist.slice(1).find((r) => !r.error);
      // Variação só faz sentido para número acumulado (ou período desconhecido, a confirmar).
      const deltaOk = !cur.error && prev && cur.window_kind !== "last30";
      lines.push({
        portal: p,
        label: PORTAL_LABEL[p],
        views: cur.error ? null : cur.views,
        contacts: cur.error ? null : cur.contacts,
        impressions: cur.error ? null : cur.impressions,
        viewsDelta: deltaOk ? diff(cur.views, prev?.views) : null,
        contactsDelta: deltaOk ? diff(cur.contacts, prev?.contacts) : null,
        periodText: periodText(cur),
        confirmed: !cur.error && cur.window_kind !== "unknown",
        error: cur.error,
        collectedOn: cur.collected_on,
      });
    }
    out.push({
      code,
      brokerId: list[0].broker_id,
      lines,
      lastCollectedOn:
        lines
          .map((l) => l.collectedOn)
          .sort()
          .at(-1) ?? "",
    });
  }
  return out.sort((a, b) => totalViews(b) - totalViews(a) || a.code.localeCompare(b.code));
}

export function totalViews(l: ListingFeedback): number {
  return l.lines.reduce((s, x) => s + (x.views ?? 0), 0);
}
export function totalContacts(l: ListingFeedback): number {
  return l.lines.reduce((s, x) => s + (x.contacts ?? 0), 0);
}

/** Diagnóstico simples (regra fixa; a IA entra depois). Usa só números confirmados. */
export function diagnosis(l: ListingFeedback): string {
  const ok = l.lines.filter((x) => x.confirmed);
  const v = ok.reduce((s, x) => s + (x.views ?? 0), 0);
  const c = ok.reduce((s, x) => s + (x.contacts ?? 0), 0);
  if (!ok.length) return "";
  if (v < 20)
    return "O anúncio está com pouca exposição. Vale reforçar fotos, título e destaque nos portais.";
  if (c === 0 || c / v < 0.01)
    return "Muita gente está vendo o imóvel, mas poucos estão pedindo informações. Preço e primeiras fotos costumam ser o ponto de ajuste.";
  return "O imóvel está atraindo visitas e contatos. Seguimos acompanhando os interessados.";
}

const n = (x: number) => x.toLocaleString("pt-BR");

/** Texto curto para o WhatsApp. Só inclui portais com período confirmado. */
export function ownerMessage(opts: {
  ownerName?: string;
  brokerName?: string;
  listing: ListingFeedback;
  recommendation: string;
}): string {
  const { listing } = opts;
  const ok = listing.lines.filter((x) => x.confirmed);
  const linhas = ok.map(
    (x) =>
      `• ${x.label} (${x.periodText}): ${n(x.views ?? 0)} visualizações e ${n(x.contacts ?? 0)} contatos`,
  );
  const outros = listing.lines.filter((x) => !x.confirmed && !x.error).map((x) => x.label);
  const partes = [
    `Olá${opts.ownerName ? `, ${opts.ownerName.split(" ")[0]}` : ""}! Tudo bem?`,
    `Segue o acompanhamento do seu imóvel (código ${listing.code}) nos portais:`,
    linhas.join("\n"),
    outros.length ? `Ele também está anunciado em: ${outros.join(", ")}.` : "",
    opts.recommendation.trim(),
    `Qualquer dúvida, estou à disposição.${opts.brokerName ? `\n${opts.brokerName.split(" ")[0]} — RE/MAX Única Escolha` : ""}`,
  ];
  return partes.filter(Boolean).join("\n\n");
}

export function whatsappLink(text: string, phone?: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const to = digits ? (digits.length <= 11 ? `55${digits}` : digits) : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

/** Resumo só com números confirmados, para a IA escrever a recomendação. Sem dados pessoais. */
export function aiFacts(l: ListingFeedback): string {
  const ok = l.lines.filter((x) => x.confirmed);
  const linhas = ok.map((x) => {
    const parts = [
      `${x.label} (${x.periodText}): ${x.views ?? 0} visualizações, ${x.contacts ?? 0} contatos`,
    ];
    if (x.impressions != null) parts.push(`${x.impressions} aparições em buscas`);
    if (x.viewsDelta != null)
      parts.push(
        `variação na semana: ${x.viewsDelta >= 0 ? "+" : ""}${x.viewsDelta} visualizações`,
      );
    if (x.contactsDelta != null)
      parts.push(`${x.contactsDelta >= 0 ? "+" : ""}${x.contactsDelta} contatos`);
    return `- ${parts.join("; ")}`;
  });
  const outros = l.lines.filter((x) => !x.confirmed && !x.error).map((x) => x.label);
  return [
    linhas.length ? linhas.join("\n") : "- Nenhum número com período confirmado.",
    outros.length ? `Também anunciado em: ${outros.join(", ")} (sem números confirmados).` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Limpa a resposta da IA: texto simples, curto, sem markdown. */
export function cleanAiText(t: string): string {
  return t
    .replace(/[*_#`>]/g, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 600);
}
