import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { mapXmlListing, parseVrsync, runRemaxXmlCollect, soVenda, urlAnuncioSegura } from "./remax-xml";

// Card t_76243950: modo "VRSync genérico" (XML de portal de qualquer imobiliária). Dados 100% fictícios.
// O modo RE/MAX continua coberto, sem mudança, em remax-xml.test.ts.
const item = (o: { code?: string; tx?: string; titulo?: string; iptu?: string; contato?: boolean } = {}) => `
<Listing>
  <ListingID>${o.code ?? "AP0042"}</ListingID>
  <Title><![CDATA[${o.titulo ?? "Apartamento à venda, 3 quartos, Campolim, Sorocaba/SP"}]]></Title>
  <TransactionType>${o.tx ?? "For Sale"}</TransactionType>
  <DetailViewUrl>https://imobiliaria-exemplo.test/imovel/42</DetailViewUrl>
  <Media><Item medium="image" primary="true">https://cdn.test/1.jpg</Item><Item medium="image">https://cdn.test/2.jpg</Item><Item medium="video">https://cdn.test/v.mp4</Item><Item medium="image">https://cdn.test/3.jpg</Item></Media>
  <Details>
    <PropertyType>Residential / Apartment</PropertyType>
    <Description><![CDATA[Aceita permuta e financiamento. 5º andar. Ligue 15 99999-0000.]]></Description>
    <ListPrice currency="BRL">650000</ListPrice>
    <PropertyAdministrationFee currency="BRL">720</PropertyAdministrationFee>
    ${o.iptu ?? '<Iptu currency="BRL" period="Monthly">140</Iptu>'}
    <LivingArea unit="square metres">92</LivingArea>
    <LotArea unit="square metres">0</LotArea>
    <Bedrooms>3</Bedrooms>
    <Bathrooms>2</Bathrooms>
    <Suites>1</Suites>
    <Garage type="Parking Space">2</Garage>
  </Details>
  <Location displayAddress="Street">
    <City>Sorocaba</City>
    <Neighborhood>Campolim</Neighborhood>
    <Address>Rua Exemplo</Address>
    <Latitude>-23.52</Latitude><Longitude>-47.46</Longitude>
  </Location>
  ${o.contato === false ? "" : `<ContactInfo><Name>Escritório Exemplo</Name><Email>contato@exemplo.test</Email><Telephone>1533330000</Telephone><OfficeName>Exemplo Imóveis</OfficeName></ContactInfo>`}
</Listing>`;
const feed = (...items: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><ListingDataFeed xmlns="http://www.vivareal.com/schemas/1.0/VRSync"><Listings>${items.join("")}</Listings></ListingDataFeed>`;

describe("modo genérico — mapXmlListing", () => {
  it("lê código livre, condomínio, IPTU, suítes, fotos e título", () => {
    const a = mapXmlListing(item(), "generico");
    expect(a).toMatchObject({
      code: "AP0042",
      tipo: "apartamento",
      bairro: "Campolim",
      cidade: "Sorocaba",
      quartos: 3,
      banheiros: 2,
      vagas: 2,
      suites: 1,
      area: 92,
      area_util: 92,
      area_terreno: null,
      preco: 650000,
      condominio: 720,
      iptu: 140,
      iptu_periodo: "mensal",
      fotos_qtd: 3,
      titulo: "Apartamento à venda, 3 quartos, Campolim, Sorocaba/SP",
      // t_25fe1197: o link do anúncio no site da própria imobiliária agora é guardado (se for seguro).
      url: "https://imobiliaria-exemplo.test/imovel/42",
      negocio: "venda",
      preco_aluguel: null,
    });
  });
  it("NÃO guarda nenhum contato (nem do escritório)", () => {
    const a = mapXmlListing(item(), "generico")!;
    expect(a.corretor_nome).toBeNull();
    expect(a.corretor_email).toBeNull();
    expect(a.corretor_telefone).toBeNull();
    expect(a.escritorio).toBeNull();
    expect(JSON.stringify({ ...a, url: null })).not.toMatch(/exemplo\.test|1533330000|Escritório Exemplo|99999/);
  });
  it("não lê permuta, financiamento nem andar da descrição", () => {
    const a = mapXmlListing(item(), "generico")!;
    expect(JSON.stringify(a)).not.toMatch(/permuta|financ|andar/i);
  });
  it("título com telefone, e-mail ou link é descartado", () => {
    for (const t of ["Casa - ligue 15 99999-0000", "Casa contato@x.test", "Casa www.x.test"])
      expect(mapXmlListing(item({ titulo: t }), "generico")!.titulo).toBeNull();
  });
  it("IPTU anual e IPTU ausente", () => {
    expect(mapXmlListing(item({ iptu: '<Iptu currency="BRL" period="Yearly">1680</Iptu>' }), "generico")).toMatchObject({ iptu: 1680, iptu_periodo: "anual" });
    expect(mapXmlListing(item({ iptu: "" }), "generico")).toMatchObject({ iptu: null, iptu_periodo: null });
  });
  it("locação entra com o negócio e o aluguel (t_25fe1197); negócio desconhecido e código inválido ficam de fora", () => {
    const rent = item({ tx: "For Rent" }).replace("<ListPrice", '<RentalPrice currency="BRL" period="Monthly">2500</RentalPrice><ListPrice');
    expect(mapXmlListing(rent, "generico")).toMatchObject({ negocio: "locacao", preco_aluguel: 2500 });
    expect(mapXmlListing(item({ tx: "Sale/Rent" }).replace("<ListPrice", "<RentalPrice>3000</RentalPrice><ListPrice"), "generico")).toMatchObject({ negocio: "venda_locacao", preco: 650000, preco_aluguel: 3000 });
    expect(mapXmlListing(item({ tx: "Leilão" }), "generico")).toBeNull();
    // RE/MAX (Única Escolha) não muda: aluguel continua descartado.
    expect(mapXmlListing(item({ tx: "For Rent", code: "123456789-12" }))).toBeNull();
    expect(mapXmlListing(item({ code: "" }), "generico")).toBeNull();
    expect(mapXmlListing(item({ code: "AP 42" }), "generico")).toBeNull();
    expect(mapXmlListing(item({ code: "x".repeat(61) }), "generico")).toBeNull();
    expect(mapXmlListing(item({ code: "3610" }), "generico")?.code).toBe("3610");
    expect(mapXmlListing(item({ code: "VIP0028" }), "generico")?.code).toBe("VIP0028");
  });
  it("o modo RE/MAX (padrão) continua descartando códigos que não são RE/MAX", () => {
    expect(mapXmlListing(item({ code: "VIP0028" }))).toBeNull();
    expect(mapXmlListing(item({ code: "3610" }), "remax")).toBeNull();
  });
  it("'Allotment Land' vira terreno", () => {
    const x = item().replace("Residential / Apartment", "Residential / Allotment Land");
    expect(mapXmlListing(x, "generico")?.tipo).toBe("terreno");
  });
});

describe("modo genérico — parseVrsync e coleta", () => {
  it("guarda venda e locação; soVenda() devolve só a venda (o que mapa, Feedback e contagens usam)", () => {
    const p = parseVrsync(feed(item(), item({ code: "AL1", tx: "For Rent" }), item({ code: "3610" })), "generico");
    expect(p.total).toBe(3);
    expect(p.venda.map((v) => v.code)).toEqual(["AP0042", "AL1", "3610"]);
    expect(soVenda(p.venda).map((v) => v.code)).toEqual(["AP0042", "3610"]);
  });
  it("link do anúncio: só o domínio que o próprio feed mais usa (o site da imobiliária)", () => {
    const outro = (code: string, url: string) => item({ code }).replace("https://imobiliaria-exemplo.test/imovel/42", url);
    const p = parseVrsync(
      feed(item(), outro("B2", "https://www.imobiliaria-exemplo.test/imovel/B2"), outro("C3", "https://encurta.dor/abc"), outro("D4", "http://imobiliaria-exemplo.test/x")),
      "generico",
    );
    expect(Object.fromEntries(p.venda.map((v) => [v.code, v.url]))).toEqual({
      AP0042: "https://imobiliaria-exemplo.test/imovel/42",
      B2: "https://www.imobiliaria-exemplo.test/imovel/B2",
      C3: null,
      D4: null,
    });
  });
  it("urlAnuncioSegura: só https com nome, sem usuário/senha, sem porta estranha, até 300 caracteres", () => {
    expect(urlAnuncioSegura("https://vipsevenimoveis.com.br/imovel/VIP0040")).toBe("https://vipsevenimoveis.com.br/imovel/VIP0040");
    for (const u of [
      "http://imob.com.br/1",
      "https://user:pass@imob.com.br/1",
      "https://imob.com.br:8443/1",
      "https://10.0.0.1/1",
      "https://localhost/1",
      "javascript:alert(1)",
      "https://imob.com.br/a b",
      `https://imob.com.br/${"a".repeat(300)}`,
      "",
      null,
    ])
      expect(urlAnuncioSegura(u), String(u)).toBeNull();
  });
  it("RE/MAX (Única Escolha) continua guardando só link remax.com.br", () => {
    const r = item({ code: "123456789-12" });
    expect(mapXmlListing(r)?.url).toBeNull();
    expect(mapXmlListing(r.replace("https://imobiliaria-exemplo.test/imovel/42", "https://www.remax.com.br/imoveis/x"))?.url).toBe("https://www.remax.com.br/imoveis/x");
  });
  it("a coleta genérica avisa o modo ao banco; a RE/MAX continua com 4 argumentos", async () => {
    const ingest = vi.fn().mockResolvedValue({ status: "ok" });
    const failed = vi.fn();
    const fetchFn = vi.fn().mockImplementation(async () => new Response(feed(item())));
    const org = "11111111-2222-3333-4444-555555555555";
    await runRemaxXmlCollect([{ org, url: "https://x.test/g.xml", modo: "generico" }], { ingest, failed }, fetchFn);
    expect(ingest).toHaveBeenLastCalledWith(org, [expect.objectContaining({ code: "AP0042", corretor_email: null })], 1, expect.any(String), "generico");
    await runRemaxXmlCollect([{ org, url: "https://x.test/r.xml" }], { ingest, failed }, fetchFn);
    expect(ingest.mock.calls[1]).toHaveLength(4);
  });

  // Conferência opcional com o XML real em arquivo LOCAL (fora do git): XML_GENERICO_SAMPLE=/caminho/feed.xml
  it.runIf(!!process.env.XML_GENERICO_SAMPLE)("lê o XML real inteiro", () => {
    const p = parseVrsync(readFileSync(process.env.XML_GENERICO_SAMPLE!, "utf8"), "generico");
    const conta = (f: (v: (typeof p.venda)[number]) => unknown) => p.venda.filter(f).length;
    console.log(
      `total=${p.total} venda=${p.venda.length} condominio=${conta((v) => v.condominio)} iptu=${conta((v) => v.iptu)} ` +
        `suites=${conta((v) => v.suites != null)} fotos=${conta((v) => v.fotos_qtd)} titulo=${conta((v) => v.titulo)} ` +
        `outros=${conta((v) => v.tipo === "outros")} contato=${conta((v) => v.corretor_email || v.corretor_telefone || v.corretor_nome || v.escritorio)}`,
    );
    expect(soVenda(p.venda).length + p.venda.filter((v) => v.negocio !== "venda").length).toBe(p.total);
    expect(conta((v) => v.corretor_email || v.corretor_telefone || v.corretor_nome || v.escritorio)).toBe(0);
    if (process.env.XML_GENERICO_OUT) writeFileSync(process.env.XML_GENERICO_OUT, JSON.stringify(p.venda));
  });
});
