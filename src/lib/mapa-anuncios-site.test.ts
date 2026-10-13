import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

import {
  filterSiteListings,
  listSiteListings,
  siteBairroLabel,
  siteListingLines,
  splitSiteListings,
  filterSiteListingsMapa,
  siteFiltroInaplicavel,
  sitePin,
  withLinkedListings,
  SITE_COLOR,
  type SiteListing,
} from "./mapa-anuncios-site";
import { EMPTY_FILTERS } from "./exclusive-captures-dashboard";
import { FILTROS_VAZIOS } from "./mapa-captacoes-filtros";

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

describe("listSiteListings (só venda)", () => {
  it("descarta qualquer locação que chegue (defesa extra; o banco já filtra)", async () => {
    rpc.mockResolvedValueOnce({
      data: [mk(), { ...mk({ code: "2" }), transacao: "locacao" }],
      error: null,
    });
    const out = await listSiteListings();
    expect(out.map((l) => l.code)).toEqual(["630699001-11"]);
  });
});

describe("filterSiteListings", () => {
  const list = [mk(), mk({ code: "2", corretor: "Bruno", bairro: "Centro", rua: "Av. Brasil" })];
  it("sem filtro: mostra os anúncios de venda", () => {
    expect(filterSiteListings(list, EMPTY_FILTERS, true)).toHaveLength(2);
  });
  it("chip do site desligado esconde a camada", () => {
    expect(filterSiteListings(list, EMPTY_FILTERS, false)).toEqual([]);
  });
  it("locação nunca passa", () => {
    const loc = { ...mk({ code: "3" }), transacao: "locacao" } as unknown as SiteListing;
    expect(filterSiteListings([loc], EMPTY_FILTERS, true)).toEqual([]);
  });
  it("filtro de corretor e de bairro (mesma grafia das captações)", () => {
    expect(filterSiteListings(list, { ...EMPTY_FILTERS, corretor: "Bruno" }, true)).toHaveLength(1);
    expect(siteBairroLabel(list[0])).toBe("Jardim Teste");
    expect(
      filterSiteListings(list, { ...EMPTY_FILTERS, bairro: "Jardim Teste" }, true),
    ).toHaveLength(1);
  });
  it("busca sem acento por rua/código", () => {
    expect(filterSiteListings(list, { ...EMPTY_FILTERS, busca: "acacias" }, true)).toHaveLength(1);
    expect(filterSiteListings(list, { ...EMPTY_FILTERS, busca: "630699001" }, true)).toHaveLength(
      1,
    );
  });
  it("situação ou unidade (conceitos da captação) escondem a camada", () => {
    expect(filterSiteListings(list, { ...EMPTY_FILTERS, situacao: "em_vigor" }, true)).toEqual([]);
    expect(filterSiteListings(list, { ...EMPTY_FILTERS, unidade: "u1" }, true)).toEqual([]);
  });
  it("período não esconde o anúncio (retrato da última coleta)", () => {
    expect(filterSiteListings(list, { ...EMPTY_FILTERS, periodo: "30" }, true)).toHaveLength(2);
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
    expect(text).not.toContain("/mês");
    expect(text).toContain("código 630699001-11");
  });
});

describe("fluidez com ~822 anúncios", () => {
  it("split + filtro de 822 anúncios em menos de 50 ms", () => {
    const many = Array.from({ length: 822 }, (_, i) =>
      mk({ code: `x-${i}`, capture_id: i % 50 === 0 ? `c${i}` : null, rua: `Rua ${i}` }),
    );
    const t0 = performance.now();
    const { soltos } = splitSiteListings(many);
    const out = filterSiteListings(soltos, { ...EMPTY_FILTERS, busca: "rua" }, true);
    const ms = performance.now() - t0;
    expect(out.length).toBe(822 - 17);
    expect(ms).toBeLessThan(50);
  });
});

describe("Mapa de captações: filtros da tela nos anúncios do site (t_17cb27a7)", () => {
  const lista = [
    mk({ code: "a", tipo: "casa", preco: 650000, corretor: "Ana Teste", bairro: "Campolim" }),
    mk({ code: "b", tipo: "apartamento", preco: 300000, corretor: "Bruno", bairro: "Centro" }),
    mk({ code: "c", tipo: "casa", preco: null, corretor: "Ana Teste", bairro: "Centro" }),
    mk({ code: "d", transacao: null }),
  ];
  const codes = (l: SiteListing[]) => l.map((x) => x.code);

  it("sem filtro: todos de venda; desligado: nenhum", () => {
    expect(codes(filterSiteListingsMapa(lista, FILTROS_VAZIOS, true))).toEqual(["a", "b", "c"]);
    expect(filterSiteListingsMapa(lista, FILTROS_VAZIOS, false)).toEqual([]);
  });
  it("busca por bairro/código, tipo, captador e faixa de preço", () => {
    const f = (o: Partial<typeof FILTROS_VAZIOS>) =>
      codes(filterSiteListingsMapa(lista, { ...FILTROS_VAZIOS, ...o }, true));
    expect(f({ busca: "centro" })).toEqual(["b", "c"]);
    expect(f({ busca: "b" })).toContain("b");
    expect(f({ tipo: "Casa" })).toEqual(["a", "c"]);
    expect(f({ captador: "Ana Teste" })).toEqual(["a", "c"]);
    expect(f({ precoMin: "400.000" })).toEqual(["a"]);
    expect(f({ precoMax: "400000" })).toEqual(["b"]);
  });
  it("filtro de equipe esconde a camada e explica o motivo", () => {
    const f = { ...FILTROS_VAZIOS, equipe: "x" };
    expect(filterSiteListingsMapa(lista, f, true)).toEqual([]);
    expect(siteFiltroInaplicavel(f)).toMatch(/equipe/);
    expect(siteFiltroInaplicavel(FILTROS_VAZIOS)).toBeNull();
  });
});

describe("pinos compartilhados pelas duas telas", () => {
  it("sitePin: vermelho, menor, link só do site RE/MAX", () => {
    const p = sitePin(mk());
    expect(p).toMatchObject({ id: "site:630699001-11", color: SITE_COLOR, radius: 6 });
    expect(p.links?.[0]?.href).toMatch(/^https:\/\/www\.remax\.com\.br\//);
    expect(sitePin(mk({ url: "javascript:alert(1)" })).links).toEqual([]);
  });
  it("withLinkedListings: um marcador só, com contorno, código e link", () => {
    const base = { id: "c1", lat: -23, lon: -47, color: "#000", lines: [{ text: "Cap" }] };
    expect(withLinkedListings(base, undefined)).toMatchObject({ id: "c1", lat: -23 });
    const p = withLinkedListings(base, [mk({ capture_id: "c1" })])!;
    expect(p.ring).toBe(SITE_COLOR);
    expect(p.lines.map((l) => l.text).join(" ")).toContain("código 630699001-11");
    expect(p.links).toHaveLength(1);
  });
  it("captação sem coordenada usa a do anúncio ligado; sem nenhuma, fica fora", () => {
    const base = { id: "c1", lat: null, lon: null, color: "#000", lines: [] };
    expect(withLinkedListings(base, [mk({ capture_id: "c1" })])).toMatchObject({ lat: -23.5 });
    expect(withLinkedListings(base, [])).toBeNull();
  });
});
