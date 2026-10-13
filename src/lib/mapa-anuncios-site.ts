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
};

/** Vermelho RE/MAX: anúncio do site. Captação ligada ganha só o contorno nessa cor. */
export const SITE_COLOR = "#dc2626";
export const SITE_LABEL = "Site RE/MAX · venda";

const db = supabase as unknown as SupabaseClient;
export async function listSiteListings(): Promise<SiteListing[]> {
  const { data, error } = await db.rpc("mapa_anuncios_site");
  if (error) throw new Error(error.message);
  return ((data ?? []) as SiteListing[])
    .filter((l) => l.transacao === "venda") // defesa extra: o banco já devolve só venda
    .map((l) => ({
      ...l,
      lat: Number(l.lat),
      lon: Number(l.lon),
      area: l.area == null ? null : Number(l.area),
      preco: l.preco == null ? null : Number(l.preco),
    }));
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
} {
  const soltos: SiteListing[] = [];
  const porCaptacao = new Map<string, SiteListing[]>();
  for (const l of list) {
    if (l.capture_id) porCaptacao.set(l.capture_id, [...(porCaptacao.get(l.capture_id) ?? []), l]);
    else soltos.push(l);
  }
  return { soltos, porCaptacao };
}

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
  const lat = pin.lat ?? ls[0]?.lat ?? null;
  const lon = pin.lon ?? ls[0]?.lon ?? null;
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
