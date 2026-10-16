import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Capture } from "./exclusive-captures";
import { bairroLabel, brl, type Filters } from "./exclusive-captures-dashboard";
import { precoNumero, tipoLabel, type FiltrosMapa } from "./mapa-captacoes-filtros";
import type { MapPin } from "@/components/mapa/PinsMap";

/**
 * Camada "anúncios do site RE/MAX" no mapa do painel de captações (pedido de Denis 13/10/2026).
 * Dados: RPC mapa_anuncios_site (migration 20261013200000) — só anúncios de VENDA, ATIVOS, com
 * coordenada, da última coleta boa da imobiliária. Locação nunca vem do banco (decisão de Denis).
 * Só o que o site público já mostra; nunca proprietário/contato.
 */
export type SiteListing = {
  code: string;
  url: string | null;
  transacao: "venda" | null;
  tipo: string | null;
  rua: string | null;
  bairro: string | null;
  cidade: string | null;
  lat: number;
  lon: number;
  area: number | null;
  quartos: number | null;
  preco: number | null;
  exclusivo: boolean;
  corretor: string | null;
  /** Captação sinalizada como o mesmo imóvel (ligação ativa ou aguardando gestor) que o usuário abre. */
  capture_id: string | null;
  coleta: string;
  /**
   * Coordenada recebida do site é inválida (0/0, fora do Brasil ou longe demais da cidade informada):
   * o anúncio fica FORA do mapa e é contado à parte. Nunca inventamos coordenada (t_9f374e4d).
   */
  localInvalida?: boolean;
  /** De onde veio o anúncio: XML RE/MAX -> OLX (principal) ou coleta do site (reserva). */
  fonte?: Fonte;
};

export type Fonte = "xml" | "site";

/** Caixa do Brasil (com folga pequena): fora disso a coordenada do site é tratada como inválida. */
const BRASIL = { latMin: -34, latMax: 5.5, lonMin: -74, lonMax: -34.5 };
/** Raio em torno da mediana dos anúncios da MESMA cidade (cidade com pelo menos MIN_CIDADE anúncios). */
export const RAIO_CIDADE_KM = 30;
/** Cidade com poucos anúncios: compara com a mediana de todos os anúncios da imobiliária. */
export const RAIO_REGIAO_KM = 75;
const MIN_CIDADE = 3;

/** Coordenada utilizável: número finito, diferente de 0/0 e dentro do Brasil. */
export function coordenadaNoBrasil(lat: unknown, lon: unknown): boolean {
  const a = Number(lat);
  const o = Number(lon);
  if (lat == null || lon == null || !Number.isFinite(a) || !Number.isFinite(o)) return false;
  if (a === 0 && o === 0) return false;
  return a >= BRASIL.latMin && a <= BRASIL.latMax && o >= BRASIL.lonMin && o <= BRASIL.lonMax;
}

const mediana = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const kmEntre = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  111.2 * Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180));

/**
 * Marca os anúncios com localização inválida. Referência da cidade = mediana dos anúncios válidos da
 * mesma cidade (robusta a poucos pontos errados); cidade com poucos anúncios usa a mediana geral.
 */
export function marcarLocalInvalida(list: SiteListing[]): SiteListing[] {
  const validos = list.filter((l) => coordenadaNoBrasil(l.lat, l.lon));
  const centro = (ls: SiteListing[]) => ({
    lat: mediana(ls.map((l) => l.lat)),
    lon: mediana(ls.map((l) => l.lon)),
  });
  const regiao = validos.length ? centro(validos) : null;
  const grupos = new Map<string, SiteListing[]>();
  for (const l of validos) {
    const k = fold(l.cidade ?? "");
    if (k) grupos.set(k, [...(grupos.get(k) ?? []), l]);
  }
  const cidades = new Map<string, { lat: number; lon: number }>();
  for (const [k, ls] of grupos) if (ls.length >= MIN_CIDADE) cidades.set(k, centro(ls));
  return list.map((l) => {
    let invalida = !coordenadaNoBrasil(l.lat, l.lon);
    if (!invalida) {
      const c = cidades.get(fold(l.cidade ?? ""));
      const ref = c ?? regiao;
      invalida = !!ref && kmEntre(l, ref) > (c ? RAIO_CIDADE_KM : RAIO_REGIAO_KM);
    }
    return { ...l, localInvalida: invalida };
  });
}

/** Primeiro anúncio da lista com localização válida (para a captação ligada usar a coordenada dele). */
export const anuncioComLocal = (ls: SiteListing[] | undefined) => ls?.find((l) => !l.localInvalida);

/** Vermelho RE/MAX: anúncio do site. Captação ligada ganha só o contorno nessa cor. */
export const SITE_COLOR = "#dc2626";
export const SITE_LABEL = "Site RE/MAX · venda";

const db = supabase as unknown as SupabaseClient;
type RawListing = Omit<SiteListing, "lat" | "lon"> & { lat: number | null; lon: number | null };

/** Normaliza a resposta do banco. Sem coordenada vira NaN: marcarLocalInvalida tira do mapa e conta à parte. */
export function normalizarAnuncios(rows: RawListing[], fonte: Fonte = "site"): SiteListing[] {
  return rows
    .filter((l) => l.transacao === "venda") // defesa extra: o banco já devolve só venda
    .map((l) => ({
      ...l,
      lat: l.lat == null ? Number.NaN : Number(l.lat),
      lon: l.lon == null ? Number.NaN : Number(l.lon),
      area: l.area == null ? null : Number(l.area),
      preco: l.preco == null ? null : Number(l.preco),
      fonte,
    }));
}

/**
 * Fonte principal: XML RE/MAX -> OLX (mapa_anuncios_xml, t_698be0d2). Sem XML bom (RPC ausente, erro ou
 * nenhuma coleta boa) cai na coleta do site RE/MAX, como antes. Nunca fica sem mapa por causa do XML.
 */
export async function listSiteListings(): Promise<SiteListing[]> {
  const xml = await db.rpc("mapa_anuncios_xml");
  if (!xml.error && Array.isArray(xml.data) && xml.data.length) {
    return normalizarAnuncios(xml.data as RawListing[], "xml");
  }
  const { data, error } = await db.rpc("mapa_anuncios_site");
  if (error) throw new Error(error.message);
  return normalizarAnuncios((data ?? []) as RawListing[], "site");
}

const fold = (x: string) =>
  x
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
/** Mesma grafia unificada de bairro das captações (o filtro de bairro casa os dois). */
export const siteBairroLabel = (l: SiteListing) =>
  bairroLabel({ form_data: { imovel: { bairro: l.bairro ?? "" } } } as unknown as Capture);

/**
 * Anúncios soltos que passam nos filtros do painel. Situação e unidade são conceitos da captação:
 * com um desses filtros ligado, a camada some (evita misturar o que não dá para comparar).
 * Período não se aplica (o anúncio é o retrato da última coleta).
 */
export function filterSiteListings(list: SiteListing[], f: Filters, shown: boolean): SiteListing[] {
  if (!shown || f.situacao || f.unidade) return [];
  return list.filter((l) => {
    if (l.transacao !== "venda") return false;
    if (f.corretor && (l.corretor || "—") !== f.corretor) return false;
    if (f.bairro && siteBairroLabel(l) !== f.bairro) return false;
    if (f.busca) {
      const hay = fold([l.rua, l.bairro, l.tipo, l.corretor, l.code].join(" "));
      if (
        !fold(f.busca)
          .split(/\s+/)
          .every((w) => hay.includes(w))
      )
        return false;
    }
    return true;
  });
}

/**
 * Separa o que vira marcador próprio do que se junta à captação (sem duplicar):
 *  - anúncio com capture_id (ligação ativa ou aguardando gestor) NUNCA vira marcador solto — a
 *    captação é o marcador. Se a captação não tem coordenada, usa a do anúncio;
 *  - semelhança de endereço não junta nada (o banco só devolve capture_id para ligação sinalizada).
 */
export function splitSiteListings(list: SiteListing[]): {
  soltos: SiteListing[];
  porCaptacao: Map<string, SiteListing[]>;
  /** Anúncios soltos com localização inválida: não viram pino, só entram nesta contagem. */
  foraDoMapa: number;
  /** Códigos dos anúncios do XML que vieram SEM coordenada: listados à parte, nunca no mapa. */
  semLocalXml: string[];
} {
  const soltos: SiteListing[] = [];
  const porCaptacao = new Map<string, SiteListing[]>();
  const semLocalXml: string[] = [];
  let foraDoMapa = 0;
  for (const l of list) {
    if (l.capture_id) porCaptacao.set(l.capture_id, [...(porCaptacao.get(l.capture_id) ?? []), l]);
    else if (semCoordenadaXml(l)) semLocalXml.push(l.code);
    else if (l.localInvalida) foraDoMapa++;
    else soltos.push(l);
  }
  return { soltos, porCaptacao, foraDoMapa, semLocalXml: semLocalXml.sort() };
}

/** Anúncio do XML que chegou sem latitude/longitude. */
export const semCoordenadaXml = (l: SiteListing) =>
  l.fonte === "xml" && (!Number.isFinite(l.lat) || !Number.isFinite(l.lon));

/** Nome da fonte para os textos das telas. */
export const fonteNome = (ls: SiteListing[]) =>
  ls[0]?.fonte === "xml" ? "XML RE/MAX" : "site RE/MAX";

/** Texto curto para a legenda das duas telas. */
export const textoForaDoMapa = (n: number, fonte: Fonte = "site") =>
  n > 0
    ? `${n} ${n === 1 ? "imóvel ficou" : "imóveis ficaram"} fora do mapa (localização inválida no ${fonte === "xml" ? "XML" : "site"} RE/MAX).`
    : "";

/** Lista à parte dos anúncios do XML sem localização (com os códigos). */
export const textoSemLocalXml = (codes: string[]) =>
  codes.length
    ? `Sem localização no XML (${codes.length}, fora do mapa): ${codes.join(", ")}.`
    : "";

/**
 * Mesmos anúncios, com os filtros da tela "Mapa de captações" (t_17cb27a7):
 *  - bairro/cidade (busca): rua, bairro, cidade e código do anúncio;
 *  - tipo: mesma normalização das captações;
 *  - preço: preço do anúncio (sem preço não entra quando há faixa);
 *  - captador: corretor do anúncio com o mesmo nome;
 *  - equipe: o anúncio não tem equipe — com esse filtro a camada some (ver siteFiltroInaplicavel).
 */
export function filterSiteListingsMapa(
  list: SiteListing[],
  f: FiltrosMapa,
  shown: boolean,
): SiteListing[] {
  if (!shown || f.equipe.trim()) return [];
  const palavras = fold(f.busca).split(/\s+/).filter(Boolean);
  const min = precoNumero(f.precoMin);
  const max = precoNumero(f.precoMax);
  return list.filter((l) => {
    if (l.transacao !== "venda") return false;
    if (palavras.length) {
      const hay = fold([l.rua, l.bairro, l.cidade, l.code].filter(Boolean).join(" "));
      if (!palavras.every((w) => hay.includes(w))) return false;
    }
    if (f.tipo && tipoLabel(l.tipo) !== f.tipo) return false;
    if (f.captador && (l.corretor ?? "") !== f.captador) return false;
    if (min != null || max != null) {
      if (l.preco == null || !(l.preco > 0)) return false;
      if (min != null && l.preco < min) return false;
      if (max != null && l.preco > max) return false;
    }
    return true;
  });
}

/** Explicação quando algum filtro da tela não se aplica ao anúncio do site. */
export function siteFiltroInaplicavel(f: FiltrosMapa): string | null {
  return f.equipe.trim()
    ? "Imóveis do site ocultos: o filtro de equipe vale só para captações (o anúncio do site não tem equipe)."
    : null;
}

/** Só links do próprio site RE/MAX (https). */
export const safeSiteUrl = (u: string | null) =>
  u && /^https:\/\/(www\.)?remax\.com\.br\//i.test(u) ? u : null;

/** Marcador próprio do anúncio solto: menor e vermelho, popup só com dados públicos. */
export function sitePin(l: SiteListing): MapPin {
  const href = safeSiteUrl(l.url);
  return {
    id: `site:${l.code}`,
    lat: l.lat,
    lon: l.lon,
    color: SITE_COLOR,
    radius: 6,
    lines: siteListingLines(l),
    links: href ? [{ text: "Ver no site RE/MAX ↗", href }] : [],
  };
}

/**
 * Junta os anúncios LIGADOS (ativo/aguardando_gestor) ao pino da captação: contorno vermelho,
 * linha com o código e link do site. Captação sem coordenada usa a do anúncio. Um marcador só.
 */
export function withLinkedListings(
  pin: Omit<MapPin, "lat" | "lon"> & { lat?: number | null; lon?: number | null },
  linked: SiteListing[] | undefined,
): MapPin | null {
  const ls = linked ?? [];
  const local = anuncioComLocal(ls); // nunca usa coordenada inválida do site
  const lat = pin.lat ?? local?.lat ?? null;
  const lon = pin.lon ?? local?.lon ?? null;
  if (lat == null || lon == null) return null;
  if (!ls.length) return { ...pin, lat, lon };
  return {
    ...pin,
    lat,
    lon,
    ring: SITE_COLOR,
    lines: [
      ...pin.lines,
      ...ls.map((l) => ({ text: `Anunciada no site RE/MAX · código ${l.code}` })),
    ],
    links: [
      ...(pin.links ?? []),
      ...ls
        .map((l) => safeSiteUrl(l.url))
        .filter((u): u is string => !!u)
        .map((href) => ({ text: "Ver no site RE/MAX ↗", href })),
    ],
  };
}

const TIPO = (t: string | null) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "Imóvel");
export function siteListingLines(l: SiteListing): { text: string; bold?: boolean }[] {
  const det = [
    l.area ? `${l.area.toLocaleString("pt-BR")} m²` : null,
    l.quartos ? `${l.quartos} quarto${l.quartos > 1 ? "s" : ""}` : null,
    l.preco ? brl(l.preco) : null,
  ].filter(Boolean);
  return [
    { text: "Anúncio no site RE/MAX · venda", bold: true },
    { text: `${TIPO(l.tipo)}${l.rua ? " · " + l.rua : ""}` },
    { text: `${siteBairroLabel(l)}${l.cidade ? " · " + l.cidade : ""}` },
    ...(det.length ? [{ text: det.join(" · ") }] : []),
    {
      text: `Corretor: ${l.corretor || "—"}${l.exclusivo ? " · exclusivo" : ""} · código ${l.code}`,
    },
  ];
}
