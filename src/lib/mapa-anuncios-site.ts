import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Capture } from "./exclusive-captures";
import { bairroLabel, brl, type Filters } from "./exclusive-captures-dashboard";

/**
 * Camada "anúncios do site RE/MAX" no mapa do painel de captações (pedido de Denis 13/10/2026).
 * Dados: RPC mapa_anuncios_site (migration 20261013200000) — anúncios ATIVOS, com coordenada, da
 * última coleta boa da imobiliária. Só o que o site público já mostra; nunca proprietário/contato.
 */
export type SiteListing = {
  code: string;
  url: string | null;
  transacao: "venda" | "locacao" | null;
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
  /** Captação confirmada como o mesmo imóvel (ligação ativa) e que o usuário pode abrir. */
  capture_id: string | null;
  coleta: string;
};

export type Transacao = "venda" | "locacao";
/** Vermelho RE/MAX: anúncio do site. Captação ligada ganha só o contorno nessa cor. */
export const SITE_COLOR = "#dc2626";
export const TRANSACAO_LABEL: Record<Transacao, string> = {
  venda: "Site RE/MAX · venda",
  locacao: "Site RE/MAX · locação",
};

const db = supabase as unknown as SupabaseClient;
export async function listSiteListings(): Promise<SiteListing[]> {
  const { data, error } = await db.rpc("mapa_anuncios_site");
  if (error) throw new Error(error.message);
  return ((data ?? []) as SiteListing[]).map((l) => ({
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
export function filterSiteListings(
  list: SiteListing[],
  f: Filters,
  shown: Transacao[],
): SiteListing[] {
  if (f.situacao || f.unidade) return [];
  return list.filter((l) => {
    if (!l.transacao || !shown.includes(l.transacao)) return false;
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
 *  - anúncio com capture_id (ligação confirmada) NUNCA vira marcador solto — a captação é o marcador.
 *    Se a captação não tem coordenada, usa a do anúncio;
 *  - semelhança de endereço não junta nada (o banco só devolve capture_id para ligação 'ativo').
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

const TIPO = (t: string | null) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "Imóvel");
export function siteListingLines(l: SiteListing): { text: string; bold?: boolean }[] {
  const det = [
    l.area ? `${l.area.toLocaleString("pt-BR")} m²` : null,
    l.quartos ? `${l.quartos} quarto${l.quartos > 1 ? "s" : ""}` : null,
    l.preco ? brl(l.preco) + (l.transacao === "locacao" ? "/mês" : "") : null,
  ].filter(Boolean);
  return [
    {
      text: `Anúncio no site RE/MAX · ${l.transacao === "locacao" ? "locação" : "venda"}`,
      bold: true,
    },
    { text: `${TIPO(l.tipo)}${l.rua ? " · " + l.rua : ""}` },
    { text: `${siteBairroLabel(l)}${l.cidade ? " · " + l.cidade : ""}` },
    ...(det.length ? [{ text: det.join(" · ") }] : []),
    {
      text: `Corretor: ${l.corretor || "—"}${l.exclusivo ? " · exclusivo" : ""} · código ${l.code}`,
    },
  ];
}
