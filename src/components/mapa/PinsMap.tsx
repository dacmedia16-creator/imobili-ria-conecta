import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";
import { agencyCity, agencyUf } from "@/lib/agency-profile";

export type MapPin = {
  id: string;
  lat: number;
  lon: number;
  color: string;
  /** Linhas do popup; a primeira costuma ir em negrito. */
  lines: { text: string; bold?: boolean }[];
  actionLabel?: string;
};

/** Mapa OpenStreetMap genérico (Captação e Vendas por região). Centro inicial na cidade da
 * imobiliária. Popup montado via DOM (textContent) para não interpretar HTML digitado. */
export function PinsMap({
  pins,
  city,
  uf,
  onOpen,
}: {
  pins: MapPin[];
  city: string | null;
  uf: string | null;
  onOpen?: (id: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const pinsRef = useRef(pins);
  pinsRef.current = pins;

  const draw = () => {
    const lf = L.current;
    if (!lf || !map.current || !layer.current) return;
    layer.current.clearLayers();
    const pts: [number, number][] = [];
    for (const p of pins) {
      const box = document.createElement("div");
      box.style.minWidth = "180px";
      for (const l of p.lines) {
        const d = document.createElement("div");
        d.textContent = l.text;
        if (l.bold) d.style.fontWeight = "600";
        box.appendChild(d);
      }
      if (p.actionLabel && openRef.current) {
        const a = document.createElement("button");
        a.type = "button";
        a.textContent = p.actionLabel;
        a.style.marginTop = "6px";
        a.style.color = "#2563eb";
        a.onclick = () => openRef.current?.(p.id);
        box.appendChild(a);
      }
      lf.circleMarker([p.lat, p.lon], {
        radius: 9,
        color: "#ffffff",
        weight: 2,
        fillColor: p.color,
        fillOpacity: 0.95,
      })
        .bindPopup(box)
        .addTo(layer.current);
      pts.push([p.lat, p.lon]);
    }
    if (pts.length) map.current.fitBounds(lf.latLngBounds(pts), { padding: [30, 30], maxZoom: 15 });
  };

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((mod) => {
      const lf = (mod as unknown as { default?: typeof import("leaflet") }).default ?? mod;
      if (cancelled || !el.current || map.current) return;
      L.current = lf;
      const isSorocaba =
        agencyCity(city).toLocaleLowerCase("pt-BR") === "sorocaba" &&
        agencyUf(uf, city).toUpperCase() === "SP";
      map.current = lf
        .map(el.current)
        .setView(isSorocaba ? [-23.5015, -47.4526] : [-15.8, -47.9], 12);
      if (city?.trim() && !isSorocaba) {
        const q = [agencyCity(city), agencyUf(uf, city), "Brasil"].filter(Boolean).join(", ");
        void fetch(
          "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=" +
            encodeURIComponent(q),
        )
          .then((response) => (response.ok ? response.json() : []))
          .then((hits: { lat: string; lon: string }[]) => {
            if (!cancelled && map.current && hits[0] && pinsRef.current.length === 0)
              map.current.setView([Number(hits[0].lat), Number(hits[0].lon)], 12);
          })
          .catch(() => {});
      }
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
  }, [city, uf]);
  useEffect(draw, [pins]);

  return <div ref={el} className="h-[420px] w-full rounded-md border" style={{ zIndex: 0 }} />;
}
