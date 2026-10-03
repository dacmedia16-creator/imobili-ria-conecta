import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  bairroLabel,
  situation,
  SITUATION_COLOR,
  SITUATION_LABEL,
} from "@/lib/exclusive-captures-dashboard";
import { formatDateBR, validityText, type Capture } from "@/lib/exclusive-captures";

/** Mapa das captações (OpenStreetMap). Popup só com dados do imóvel — nunca do proprietário.
 * Texto montado via DOM (textContent) para não interpretar HTML digitado no formulário. */
export function CapturesMap({
  captures,
  today,
  onOpen,
}: {
  captures: Capture[];
  today: string;
  onOpen: (id: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  const draw = () => {
    const lf = L.current;
    if (!lf || !map.current || !layer.current) return;
    layer.current.clearLayers();
    const pts: [number, number][] = [];
    for (const c of captures) {
      if (c.geo_lat == null || c.geo_lon == null) continue;
      const { s, v } = situation(c, today);
      const box = document.createElement("div");
      box.style.minWidth = "180px";
      const line = (text: string, bold = false) => {
        const p = document.createElement("div");
        p.textContent = text;
        if (bold) p.style.fontWeight = "600";
        box.appendChild(p);
      };
      line(c.form_data.imovel?.endereco || c.form_data.imovel?.tipo_imovel || "Imóvel", true);
      line(`${bairroLabel(c)} · ${c.form_data.imovel?.tipo_imovel || "—"}`);
      line(`${SITUATION_LABEL[s]}${v ? " · " + validityText(v) : ""}`);
      line(`Captador: ${c.broker_name || "—"} · criada em ${formatDateBR(c.created_on_sp)}`);
      const a = document.createElement("button");
      a.type = "button";
      a.textContent = "Abrir captação →";
      a.style.marginTop = "6px";
      a.style.color = "#2563eb";
      a.onclick = () => openRef.current(c.id);
      box.appendChild(a);
      lf.circleMarker([c.geo_lat, c.geo_lon], {
        radius: 9,
        color: "#ffffff",
        weight: 2,
        fillColor: SITUATION_COLOR[s],
        fillOpacity: 0.95,
      })
        .bindPopup(box)
        .addTo(layer.current);
      pts.push([c.geo_lat, c.geo_lon]);
    }
    if (pts.length) map.current.fitBounds(lf.latLngBounds(pts), { padding: [30, 30], maxZoom: 15 });
  };

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((mod) => {
      const lf = (mod as unknown as { default?: typeof import("leaflet") }).default ?? mod;
      if (cancelled || !el.current || map.current) return;
      L.current = lf;
      map.current = lf.map(el.current).setView([-23.5015, -47.4526], 12); // Sorocaba
      lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map.current);
      layer.current = lf.layerGroup().addTo(map.current);
      draw();
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(draw, [captures, today]);

  return <div ref={el} className="h-[420px] w-full rounded-md border" style={{ zIndex: 0 }} />;
}
