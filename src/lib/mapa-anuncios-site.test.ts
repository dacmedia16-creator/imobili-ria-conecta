import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  filterSiteListings,
  siteBairroLabel,
  siteListingLines,
  splitSiteListings,
  type SiteListing,
} from "./mapa-anuncios-site";
import { EMPTY_FILTERS } from "./exclusive-captures-dashboard";

const mk = (over: Partial<SiteListing> = {}): SiteListing => ({
  code: "630699001-11",
  url: "https://www.remax.com.br/pt-br/imoveis/x/630699001-11",
  transacao: "venda",
  tipo: "casa",
  rua: "Rua das Acácias",
  bairro: "jardim   TESTE",
  cidade: "Sorocaba",
  lat: -23.5,
  lon: -47.45,
  area: 150,
  quartos: 3,
  preco: 650000,
  exclusivo: true,
  corretor: "Ana Teste",
  capture_id: null,
  coleta: "2026-10-13T06:20:00Z",
  ...over,
});
const both = ["venda", "locacao"] as const;

describe("filterSiteListings", () => {
  const list = [
    mk(),
    mk({ code: "2", transacao: "locacao", corretor: "Bruno", bairro: "Centro", rua: "Av. Brasil" }),
  ];
  it("sem filtro: mostra venda e locação", () => {
    expect(filterSiteListings(list, EMPTY_FILTERS, [...both])).toHaveLength(2);
  });
  it("chip de transação desligado esconde só aquela transação", () => {
    expect(filterSiteListings(list, EMPTY_FILTERS, ["venda"]).map((l) => l.code)).toEqual([
      "630699001-11",
    ]);
  });
  it("filtro de corretor e de bairro (mesma grafia das captações)", () => {
    expect(
      filterSiteListings(list, { ...EMPTY_FILTERS, corretor: "Bruno" }, [...both]),
    ).toHaveLength(1);
    expect(siteBairroLabel(list[0])).toBe("Jardim Teste");
    expect(
      filterSiteListings(list, { ...EMPTY_FILTERS, bairro: "Jardim Teste" }, [...both]),
    ).toHaveLength(1);
  });
  it("busca sem acento por rua/código", () => {
    expect(
      filterSiteListings(list, { ...EMPTY_FILTERS, busca: "acacias" }, [...both]),
    ).toHaveLength(1);
    expect(
      filterSiteListings(list, { ...EMPTY_FILTERS, busca: "630699001" }, [...both]),
    ).toHaveLength(1);
  });
  it("situação ou unidade (conceitos da captação) escondem a camada", () => {
    expect(filterSiteListings(list, { ...EMPTY_FILTERS, situacao: "em_vigor" }, [...both])).toEqual(
      [],
    );
    expect(filterSiteListings(list, { ...EMPTY_FILTERS, unidade: "u1" }, [...both])).toEqual([]);
  });
  it("período não esconde o anúncio (retrato da última coleta)", () => {
    expect(filterSiteListings(list, { ...EMPTY_FILTERS, periodo: "30" }, [...both])).toHaveLength(
      2,
    );
  });
});

describe("splitSiteListings (sem duplicar)", () => {
  it("ligado à captação não vira marcador solto; os demais seguem soltos", () => {
    const { soltos, porCaptacao } = splitSiteListings([
      mk({ code: "a", capture_id: "c1" }),
      mk({ code: "b" }),
      mk({ code: "c", lat: -23.5, lon: -47.45 }), // mesmo ponto de "b": continua separado
    ]);
    expect(soltos.map((l) => l.code)).toEqual(["b", "c"]);
    expect(porCaptacao.get("c1")?.map((l) => l.code)).toEqual(["a"]);
  });
});

describe("siteListingLines (privacidade)", () => {
  it("só dados públicos do anúncio; sem número da casa", () => {
    const text = siteListingLines(mk())
      .map((l) => l.text)
      .join(" | ");
    expect(text).toContain("Anúncio no site RE/MAX · venda");
    expect(text).toContain("Rua das Acácias");
    expect(text).toContain("R$");
    expect(text).toContain("código 630699001-11");
  });
  it("locação mostra o preço por mês", () => {
    expect(
      siteListingLines(mk({ transacao: "locacao", preco: 2500 }))
        .map((l) => l.text)
        .join(" "),
    ).toContain("/mês");
  });
});
