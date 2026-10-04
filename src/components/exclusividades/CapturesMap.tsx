import { useMemo } from "react";
import {
  bairroLabel,
  situation,
  SITUATION_COLOR,
  SITUATION_LABEL,
} from "@/lib/exclusive-captures-dashboard";
import { formatDateBR, validityText, type Capture } from "@/lib/exclusive-captures";
import { PinsMap, type MapPin } from "@/components/mapa/PinsMap";

/** Mapa das captações (OpenStreetMap). Popup só com dados do imóvel — nunca do proprietário. */
export function CapturesMap({
  captures,
  today,
  city,
  uf,
  onOpen,
}: {
  captures: Capture[];
  today: string;
  city: string | null;
  uf: string | null;
  onOpen: (id: string) => void;
}) {
  const pins = useMemo<MapPin[]>(() => {
    const out: MapPin[] = [];
    for (const c of captures) {
      if (c.geo_lat == null || c.geo_lon == null) continue;
      const { s, v } = situation(c, today);
      out.push({
        id: c.id,
        lat: c.geo_lat,
        lon: c.geo_lon,
        color: SITUATION_COLOR[s],
        lines: [
          {
            text: c.form_data.imovel?.endereco || c.form_data.imovel?.tipo_imovel || "Imóvel",
            bold: true,
          },
          { text: `${bairroLabel(c)} · ${c.form_data.imovel?.tipo_imovel || "—"}` },
          { text: `${SITUATION_LABEL[s]}${v ? " · " + validityText(v) : ""}` },
          {
            text: `Captador: ${c.broker_name || "—"} · criada em ${formatDateBR(c.created_on_sp)}`,
          },
        ],
        actionLabel: "Abrir captação →",
      });
    }
    return out;
  }, [captures, today]);

  return <PinsMap pins={pins} city={city} uf={uf} onOpen={onOpen} />;
}
