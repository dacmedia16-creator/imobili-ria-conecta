import { useMemo } from "react";
import {
  bairroLabel,
  situation,
  SITUATION_COLOR,
  SITUATION_LABEL,
} from "@/lib/exclusive-captures-dashboard";
import { formatDateBR, MANUAL_COLOR, validityText, type Capture } from "@/lib/exclusive-captures";
import { SITE_COLOR, siteListingLines, type SiteListing } from "@/lib/mapa-anuncios-site";
import { PinsMap, type MapPin } from "@/components/mapa/PinsMap";

const safeUrl = (u: string | null) =>
  u && /^https:\/\/(www\.)?remax\.com\.br\//i.test(u) ? u : null;

/**
 * Mapa das captações (OpenStreetMap). Popup só com dados do imóvel — nunca do proprietário.
 * Camada opcional de anúncios do site RE/MAX: marcador menor, vermelho. Anúncio LIGADO à captação
 * (ligação confirmada) não ganha marcador próprio: a captação recebe contorno vermelho e o link.
 */
export function CapturesMap({
  captures,
  today,
  city,
  uf,
  onOpen,
  siteListings = [],
  linkedListings,
}: {
  captures: Capture[];
  today: string;
  city: string | null;
  uf: string | null;
  onOpen: (id: string) => void;
  /** Anúncios soltos (sem captação ligada), já filtrados. */
  siteListings?: SiteListing[];
  /** Anúncios ligados, por captação. */
  linkedListings?: Map<string, SiteListing[]>;
}) {
  const pins = useMemo<MapPin[]>(() => {
    const out: MapPin[] = [];
    for (const c of captures) {
      const linked = linkedListings?.get(c.id) ?? [];
      // Captação ainda sem coordenada, mas ligada a anúncio com coordenada: usa a do anúncio.
      const lat = c.geo_lat ?? linked[0]?.lat;
      const lon = c.geo_lon ?? linked[0]?.lon;
      if (lat == null || lon == null) continue;
      const { s, v } = situation(c, today);
      out.push({
        id: c.id,
        lat,
        lon,
        // Cadastro manual (contrato de papel): pino roxo, como na maquete aprovada.
        color: c.manual ? MANUAL_COLOR : SITUATION_COLOR[s],
        ring: linked.length ? SITE_COLOR : undefined,
        lines: [
          {
            text: c.form_data.imovel?.endereco || c.form_data.imovel?.tipo_imovel || "Imóvel",
            bold: true,
          },
          ...(c.manual ? [{ text: "Cadastro manual (contrato de papel)" }] : []),
          { text: `${bairroLabel(c)} · ${c.form_data.imovel?.tipo_imovel || "—"}` },
          { text: `${SITUATION_LABEL[s]}${v ? " · " + validityText(v) : ""}` },
          {
            text: `Captador: ${c.broker_name || "—"} · criada em ${formatDateBR(c.created_on_sp)}`,
          },
          ...linked.map((l) => ({ text: `Anunciada no site RE/MAX · código ${l.code}` })),
        ],
        links: linked
          .map((l) => safeUrl(l.url))
          .filter((u): u is string => !!u)
          .map((href) => ({ text: "Ver no site RE/MAX ↗", href })),
        actionLabel: "Abrir captação →",
      });
    }
    for (const l of siteListings) {
      const href = safeUrl(l.url);
      out.push({
        id: `site:${l.code}`,
        lat: l.lat,
        lon: l.lon,
        color: SITE_COLOR,
        radius: 6,
        lines: siteListingLines(l),
        links: href ? [{ text: "Ver no site RE/MAX ↗", href }] : [],
      });
    }
    return out;
  }, [captures, today, siteListings, linkedListings]);

  return <PinsMap pins={pins} city={city} uf={uf} onOpen={onOpen} />;
}
