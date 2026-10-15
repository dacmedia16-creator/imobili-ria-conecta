// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Leaflet falso: só o necessário para o PinsMap montar e para contarmos invalidateSize.
const fake = vi.hoisted(() => {
  const invalidateSize = vi.fn();
  const mapObj = {
    setView: vi.fn(),
    stop: vi.fn(),
    fitBounds: vi.fn(),
    remove: vi.fn(),
    getZoom: () => 12,
    invalidateSize,
  };
  mapObj.setView.mockReturnValue(mapObj);
  const layerObj = { addTo: vi.fn(), clearLayers: vi.fn() };
  layerObj.addTo.mockReturnValue(layerObj);
  const marker = {
    bindPopup: vi.fn(),
    addTo: vi.fn(),
    getLatLng: () => ({ lat: 0, lng: 0 }),
    openPopup: vi.fn(),
  };
  marker.bindPopup.mockReturnValue(marker);
  marker.addTo.mockReturnValue(marker);
  const lf = {
    map: vi.fn(() => mapObj),
    tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
    layerGroup: vi.fn(() => layerObj),
    circleMarker: vi.fn(() => marker),
    latLngBounds: vi.fn((pts: unknown) => pts),
  };
  return { lf, mapObj, invalidateSize };
});
vi.mock("leaflet", () => ({ default: fake.lf, ...fake.lf }));
vi.mock("leaflet/dist/leaflet.css", () => ({}));

import { PinsMap, type MapPin } from "@/components/mapa/PinsMap";

const pins: MapPin[] = [
  { id: "p1", lat: -23.5, lon: -47.45, color: "#f00", lines: [{ text: "Casa", bold: true }] },
];

async function montar() {
  render(createElement(PinsMap, { pins, city: "Sorocaba", uf: "SP" }));
  // espera o import("leaflet") dinâmico criar o mapa
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(fake.lf.map).toHaveBeenCalled();
}
const frame = () => screen.getByTestId("pins-map-frame");

describe("PinsMap — Ampliar (tela cheia)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.style.overflow = "";
  });
  afterEach(() => cleanup());

  it("começa normal, com altura fixa e botão Ampliar", async () => {
    await montar();
    expect(frame().dataset.ampliado).toBe("false");
    expect(frame().className).not.toContain("fixed");
    expect(screen.getByRole("button", { name: "Ampliar mapa" })).toBeTruthy();
    expect(frame().firstElementChild?.className).toContain("h-[420px]");
  });

  it("Ampliar abre em tela cheia, trava a rolagem e redimensiona o Leaflet", async () => {
    await montar();
    fake.invalidateSize.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Ampliar mapa" }));
    expect(frame().dataset.ampliado).toBe("true");
    expect(frame().className).toContain("fixed inset-0");
    expect(screen.getByRole("dialog", { name: "Mapa em tela cheia" })).toBeTruthy();
    expect(frame().firstElementChild?.className).not.toContain("h-[420px]");
    expect(document.body.style.overflow).toBe("hidden");
    expect(fake.invalidateSize).toHaveBeenCalled();
    // mesmo mapa (não recria o Leaflet, então pinos/filtros/popups seguem iguais)
    expect(fake.lf.map).toHaveBeenCalledTimes(1);
  });

  it("botão Sair da tela cheia volta ao normal e libera a rolagem", async () => {
    await montar();
    fireEvent.click(screen.getByRole("button", { name: "Ampliar mapa" }));
    fake.invalidateSize.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Sair da tela cheia" }));
    expect(frame().dataset.ampliado).toBe("false");
    expect(frame().className).not.toContain("fixed");
    expect(document.body.style.overflow).toBe("");
    expect(fake.invalidateSize).toHaveBeenCalled();
    expect(fake.lf.map).toHaveBeenCalledTimes(1);
  });

  it("tecla Esc sai da tela cheia; fora da tela cheia, Esc não faz nada", async () => {
    await montar();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(frame().dataset.ampliado).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Ampliar mapa" }));
    fireEvent.keyDown(window, { key: "Enter" });
    expect(frame().dataset.ampliado).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(frame().dataset.ampliado).toBe("false");
    expect(screen.getByRole("button", { name: "Ampliar mapa" })).toBeTruthy();
  });
});
