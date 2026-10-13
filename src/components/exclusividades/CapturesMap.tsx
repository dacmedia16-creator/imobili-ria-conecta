import { useMemo } from "react";
import {
  bairroLabel,
  situation,
  SITUATION_COLOR,
  SITUATION_LABEL,
} from "@/lib/exclusive-captures-dashboard";
import { formatDateBR, MANUAL_COLOR, validityText, type Capture } from "@/lib/exclusive-captures";
import { sitePin, withLinkedListings, type SiteListing } from "@/lib/mapa-anuncios-site";
import { PinsMap, type MapPin } from "@/components/mapa/PinsMap";

/**
 * Mapa das captações (OpenStreetMap). Popup só com dados do imóvel — nunca do proprietário.
 * Camada opcional de anúncios do site RE/MAX: marcador menor, vermelho. Anúncio LIGADO à captação
 * (ligação confirmada) não ganha marcador próprio: a captação recebe contorno vermelho e o link.
 * Montagem dos pinos do site compartilhada com a tela "Mapa de captações" (mapa-anuncios-site.ts).
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
      const { s, v } = situation(c, today);
      // Captação sem coordenada, mas ligada a anúncio com coordenada: usa a do anúncio.
      const pin = withLinkedListings(
        {
          id: c.id,
          lat: c.geo_lat,
          lon: c.geo_lon,
          // Cadastro manual (contrato de papel): pino roxo, como na maquete aprovada.
          color: c.manual ? MANUAL_COLOR : SITUATION_COLOR[s],
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
          ],
          links: [],
          actionLabel: "Abrir captação →",
        },
        linkedListings?.get(c.id),
      );
      if (pin) out.push(pin);
    }
    for (const l of siteListings) out.push(sitePin(l));
    return out;
  }, [captures, today, siteListings, linkedListings]);

  return <PinsMap pins={pins} city={city} uf={uf} onOpen={onOpen} />;
}
