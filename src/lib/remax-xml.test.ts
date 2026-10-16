import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  codeKey,
  contagemVrsync,
  feedTargets,
  listarAnunciosVrsync,
  mapXmlListing,
  parseVrsync,
  runRemaxXmlCollect,
  tipoXml,
} from "./remax-xml";

const item = (
  o: { code?: string; tx?: string; lat?: string; lon?: string; tipo?: string } = {},
) => `
<Listing>
  <ListingID>${o.code ?? "123456789-42"}</ListingID>
  <Title><![CDATA[Apartamento &amp; lazer]]></Title>
  <TransactionType>${o.tx ?? "For Sale"}</TransactionType>
  <DetailViewUrl>https://www.remax.com.br/pt-br/imoveis/apartamento/venda/sorocaba/123456789-42</DetailViewUrl>
  <Details>
    <PropertyType>${o.tipo ?? "Residential / Apartment"}</PropertyType>
    <ListPrice currency="BRL">480000</ListPrice>
    <LivingArea unit="square metres">72</LivingArea>
    <Bedrooms>2</Bedrooms>
    <Bathrooms>1</Bathrooms>
    <Garage type="Parking Space">1</Garage>
  </Details>
  <Location displayAddress="Street">
    <Country abbreviation="BR">Brasil</Country>
    <State abbreviation="SP">São Paulo</State>
    <City>Sorocaba</City>
    <Neighborhood>Campolim</Neighborhood>
    <Address>Rua Teste</Address>
    <StreetNumber>100</StreetNumber>
    <PostalCode>18000000</PostalCode>
    <Latitude>${o.lat ?? "-23.5"}</Latitude>
    <Longitude>${o.lon ?? "-47.4"}</Longitude>
  </Location>
  <ContactInfo>
    <Name>Corretor Exemplo</Name>
    <Email>Exemplo@REMAX.com.br</Email>
    <Telephone>1500000000</Telephone>
    <OfficeName>REMAX TESTE</OfficeName>
    <Location><City>Escritorio</City><Latitude>1</Latitude><Longitude>1</Longitude></Location>
  </ContactInfo>
</Listing>`;
const feed = (...items: string[]) =>
  `\uFEFF<?xml version="1.0" encoding="UTF-8"?><ListingDataFeed xmlns="http://www.vivareal.com/schemas/1.0/VRSync"><Listings>${items.join("")}</Listings></ListingDataFeed>`;

describe("mapXmlListing", () => {
  it("lê venda com endereço do imóvel (não do escritório) e corretor", () => {
    expect(mapXmlListing(item())).toEqual({
      code: "123456789-42",
      tipo: "apartamento",
      rua: "Rua Teste",
      numero: "100",
      bairro: "Campolim",
      cidade: "Sorocaba",
      cep: "18000000",
      lat: -23.5,
      lon: -47.4,
      area: 72,
      quartos: 2,
      banheiros: 1,
      vagas: 1,
      preco: 480000,
      url: "https://www.remax.com.br/pt-br/imoveis/apartamento/venda/sorocaba/123456789-42",
      escritorio: "REMAX TESTE",
      corretor_nome: "Corretor Exemplo",
      corretor_email: "exemplo@remax.com.br",
      corretor_telefone: "1500000000",
    });
  });
  it("descarta aluguel e código fora do padrão", () => {
    expect(mapXmlListing(item({ tx: "For Rent" }))).toBeNull();
    expect(mapXmlListing(item({ code: "ABC-1" }))).toBeNull();
  });
  it("coordenada 0,0 ou inválida vira sem coordenada (imóvel continua)", () => {
    const a = mapXmlListing(item({ lat: "0", lon: "0" }));
    expect(a?.lat).toBeNull();
    expect(a?.lon).toBeNull();
    expect(mapXmlListing(item({ lat: "", lon: "x" }))?.lat).toBeNull();
  });
});

describe("tipoXml", () => {
  it("usa os mesmos nomes do site RE/MAX", () => {
    expect(tipoXml("Residential / Home")).toBe("casa");
    expect(tipoXml("Residential / Condo")).toBe("casa-de-condominio");
    expect(tipoXml("Commercial / Land Lot")).toBe("terreno");
    expect(tipoXml("Algo / Novo")).toBe("outros");
    expect(tipoXml(null)).toBeNull();
  });
});

describe("parseVrsync", () => {
  it("conta tudo e devolve só venda", () => {
    const p = parseVrsync(feed(item(), item({ tx: "For Rent", code: "123456789-43" })));
    expect(p.total).toBe(2);
    expect(p.venda.map((v) => v.code)).toEqual(["123456789-42"]);
  });
  it("recusa arquivo que não é VRSync", () => {
    expect(() => parseVrsync("<html>erro</html>")).toThrow(/VRSync/);
  });
  // Conferência opcional com um XML real local: REMAX_XML_SAMPLE=/caminho/feed.xml
  it.runIf(!!process.env.REMAX_XML_SAMPLE)("lê o XML real", () => {
    const p = parseVrsync(readFileSync(process.env.REMAX_XML_SAMPLE!, "utf8"));
    const comCoord = p.venda.filter((v) => v.lat != null).length;
    const outros = p.venda.filter((v) => v.tipo === "outros").length;
    console.log(`total=${p.total} venda=${p.venda.length} comCoord=${comCoord} outros=${outros}`);
    expect(p.venda.length).toBeGreaterThan(0);
    expect(outros).toBe(0);
  });
});

// Fixture reduzida e ANONIMIZADA (estrutura do XML de 15/10/2026; códigos, contatos e endereços fictícios).
const FIXTURE = readFileSync(
  new URL("./__fixtures__/vrsync-remax-amostra.xml", import.meta.url),
  "utf8",
);

describe("fixture VRSync anonimizada", () => {
  it("extrai código, transação, escritório, ID RE/MAX e contato de todos os anúncios", () => {
    const a = listarAnunciosVrsync(FIXTURE);
    expect(contagemVrsync(a)).toEqual({
      total: 7,
      venda: 4,
      aluguel: 3,
      corretores: 5,
      com_email: 7,
      com_telefone: 5,
    });
    expect(a[0]).toEqual({
      code: "900000001-101",
      transacao: "venda",
      escritorio: "REMAX ÚNICA ESCOLHA II",
      remax_id: "900000001",
      corretor_nome: "Corretor Teste 1",
      corretor_email: "corretor1@exemplo.test",
      corretor_telefone: "1500000001",
    });
    expect(a[1].corretor_telefone).toBeNull();
    expect(a.every((x) => /^[0-9]{9}-[0-9]+$/.test(x.code))).toBe(true);
  });
  it("parseVrsync guarda só venda e mantém o anúncio sem coordenada", () => {
    const p = parseVrsync(FIXTURE);
    expect(p.total).toBe(7);
    expect(p.venda.map((v) => v.code)).toEqual([
      "900000001-101",
      "900000002-102",
      "900000003-103",
      "900000004-104",
    ]);
    expect(p.venda[0].lat).toBeNull();
    expect(p.venda.slice(1).every((v) => v.lat != null && v.lon != null)).toBe(true);
    expect(p.venda.every((v) => v.tipo && v.tipo !== "outros")).toBe(true);
  });
  it("não tem e-mail nem telefone reais", () => {
    expect(FIXTURE).not.toMatch(/@remax\.com\.br/i);
    for (const e of FIXTURE.match(/[\w.+-]+@[\w.-]+/g) ?? []) expect(e).toMatch(/@exemplo\.test$/);
  });
});

describe("codeKey (mesma regra de portal_listing_snapshots)", () => {
  it("une os pares -93 / x93 / XX093", () => {
    expect(codeKey("630601201-93")).toBe("630601201-93");
    expect(codeKey("630601201x93")).toBe("630601201-93");
    expect(codeKey("630601201XX093")).toBe("630601201-93");
    expect(codeKey(" 630601201-0093 ")).toBe("630601201-93");
    expect(codeKey("ABC")).toBe("ABC");
  });
});

// Conferência opcional com o XML real de 15/10 (não versionado):
// REMAX_XML_SAMPLE=/caminho/feed781.xml npx vitest run src/lib/remax-xml.test.ts
describe.runIf(!!process.env.REMAX_XML_SAMPLE)("XML real de 15/10", () => {
  it("bate 1.449 anúncios (699 venda, 750 aluguel), 125 corretores e e-mail em todos", () => {
    const c = contagemVrsync(
      listarAnunciosVrsync(readFileSync(process.env.REMAX_XML_SAMPLE!, "utf8")),
    );
    expect(c).toMatchObject({
      total: 1449,
      venda: 699,
      aluguel: 750,
      corretores: 125,
      com_email: 1449,
    });
  });
});

describe("feedTargets", () => {
  it("aceita só org uuid -> https", () => {
    const org = "11111111-2222-3333-4444-555555555555";
    expect(
      feedTargets(JSON.stringify({ [org]: "https://x.test/a.xml", bad: "https://y" })),
    ).toEqual([{ org, url: "https://x.test/a.xml" }]);
    expect(feedTargets(JSON.stringify({ [org]: "http://x.test" }))).toEqual([]);
    expect(feedTargets("{quebrado")).toEqual([]);
    expect(feedTargets(undefined)).toEqual([]);
  });
});

describe("runRemaxXmlCollect", () => {
  const org = "11111111-2222-3333-4444-555555555555";
  it("grava a venda lida", async () => {
    const ingest = vi.fn().mockResolvedValue({ status: "ok" });
    const failed = vi.fn();
    const fetchFn = vi.fn().mockResolvedValue(new Response(feed(item())));
    const log = await runRemaxXmlCollect(
      [{ org, url: "https://x.test/f.xml" }],
      { ingest, failed },
      fetchFn,
    );
    expect(ingest).toHaveBeenCalledWith(
      org,
      [expect.objectContaining({ code: "123456789-42" })],
      1,
      expect.any(String),
    );
    expect(failed).not.toHaveBeenCalled();
    expect(log[0]).toContain("ok");
  });
  it("falha sem expor a URL secreta e sem gravar", async () => {
    const ingest = vi.fn();
    const failed = vi.fn().mockResolvedValue(undefined);
    const url = "https://x.test/segredo.xml?token=abc";
    const fetchFn = vi.fn().mockRejectedValue(new Error(`fetch failed ${url}`));
    const log = await runRemaxXmlCollect([{ org, url }], { ingest, failed }, fetchFn);
    expect(ingest).not.toHaveBeenCalled();
    expect(failed.mock.calls[0][1]).not.toContain("segredo");
    expect(log.join()).not.toContain("token");
  });
  it("HTTP de erro vira falha (última versão boa fica no banco)", async () => {
    const ingest = vi.fn();
    const failed = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi.fn().mockResolvedValue(new Response("x", { status: 503 }));
    await runRemaxXmlCollect([{ org, url: "https://x.test/f.xml" }], { ingest, failed }, fetchFn);
    expect(failed).toHaveBeenCalledWith(org, "XML respondeu 503", expect.any(String));
  });
  it("resposta que não é VRSync (ex.: página de erro) vira falha e não grava nada", async () => {
    const ingest = vi.fn();
    const failed = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi.fn().mockResolvedValue(new Response("<html>manutenção</html>"));
    await runRemaxXmlCollect([{ org, url: "https://x.test/f.xml" }], { ingest, failed }, fetchFn);
    expect(ingest).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith(org, "Arquivo não é um XML VRSync", expect.any(String));
  });
  it("XML vazio segue para o banco, que rejeita e mantém a última versão boa", async () => {
    const ingest = vi.fn().mockResolvedValue({ status: "rejeitado", venda: 0, antes: 699 });
    const failed = vi.fn();
    const fetchFn = vi.fn().mockResolvedValue(new Response(feed()));
    const log = await runRemaxXmlCollect(
      [{ org, url: "https://x.test/f.xml" }],
      { ingest, failed },
      fetchFn,
    );
    expect(ingest).toHaveBeenCalledWith(org, [], 0, expect.any(String));
    expect(log[0]).toContain("rejeitado");
  });
  it("erro do banco não vaza a URL e uma imobiliária não derruba a outra", async () => {
    const org2 = "66666666-7777-8888-9999-000000000000";
    const url = "https://x.test/feed.xml?codigo=SEGREDO";
    const ingest = vi
      .fn()
      .mockRejectedValueOnce(new Error(`falhou ao gravar ${url}`))
      .mockResolvedValueOnce({ status: "ok" });
    const failed = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi.fn().mockImplementation(async () => new Response(feed(item())));
    const log = await runRemaxXmlCollect(
      [
        { org, url },
        { org: org2, url: "https://x.test/b.xml" },
      ],
      { ingest, failed },
      fetchFn,
    );
    expect(JSON.stringify(failed.mock.calls) + log.join()).not.toContain("SEGREDO");
    expect(log[1]).toContain("ok");
  });
});
