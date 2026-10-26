import { describe, expect, it, vi } from "vitest";
import { conferirDestino, fetchXmlSeguro, ipPrivado, LinkXmlInvalido, resolverDoh, validarLinkXml } from "./xml-feed-seguro";
import { baixarEContar } from "./xml-feed.server";

// Card t_76243950: o "Link do XML" é digitado na tela, então o download pelo servidor bloqueia endereços
// internos (SSRF). Sem rede: DNS e fetch simulados.
const publico = async () => ["104.18.38.10"];

describe("validarLinkXml", () => {
  it("aceita https com nome público", () => {
    expect(validarLinkXml(" https://portal.exemplo.com.br/feed/zap ").hostname).toBe("portal.exemplo.com.br");
    expect(validarLinkXml("https://x.supabase.co:443/functions/v1/portal-feed/zap").pathname).toContain("portal-feed");
  });
  it.each([
    ["", /500/],
    ["http://portal.exemplo.com/feed", /https/],
    ["ftp://portal.exemplo.com/feed", /https/],
    ["https://user:senha@portal.exemplo.com/feed", /usuário/],
    ["https://portal.exemplo.com:8443/feed", /porta/],
    ["https://localhost/feed", /público/],
    ["https://metadata.google.internal/x", /público/],
    ["https://intranet/feed", /público/],
    ["https://127.0.0.1/feed", /IP/],
    ["https://169.254.169.254/latest", /IP/],
    ["https://[::1]/feed", /IP|público/],
    ["https://2130706433/feed", /IP|público/],
    ["https://" + "a".repeat(500) + ".com", /500/],
  ])("recusa %s", (url, msg) => {
    expect(() => validarLinkXml(url)).toThrow(msg);
  });
});

describe("ipPrivado", () => {
  it.each(["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.0.10", "100.64.0.1", "0.0.0.0",
    "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "ff02::1", "lixo"])(
    "%s é interno",
    (ip) => expect(ipPrivado(ip)).toBe(true),
  );
  it.each(["104.18.38.10", "172.64.149.246", "8.8.8.8", "172.32.0.1", "2606:4700::6812:260a"])("%s é público", (ip) =>
    expect(ipPrivado(ip)).toBe(false),
  );
});

describe("conferirDestino / fetchXmlSeguro", () => {
  it("bloqueia nome público que aponta para IP interno (DNS)", async () => {
    await expect(conferirDestino("https://rebind.exemplo.com/x", async () => ["104.18.38.10", "10.0.0.5"])).rejects.toThrow(/interno/);
  });
  it("DNS fora do ar ou sem resposta = bloqueia (fecha por padrão)", async () => {
    await expect(conferirDestino("https://a.exemplo.com/x", async () => { throw new Error("x"); })).rejects.toBeInstanceOf(LinkXmlInvalido);
    await expect(conferirDestino("https://a.exemplo.com/x", async () => [])).rejects.toThrow(/não existe/);
  });
  it("segue redirecionamento só se o destino também for público", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://cdn.exemplo.com/f.xml" } }))
      .mockResolvedValueOnce(new Response("ok"));
    const r = await fetchXmlSeguro("https://a.exemplo.com/x", {}, { fetchFn, resolver: publico });
    expect(await r.text()).toBe("ok");
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    const ruim = vi.fn().mockResolvedValue(new Response(null, { status: 301, headers: { location: "http://169.254.169.254/latest" } }));
    await expect(fetchXmlSeguro("https://a.exemplo.com/x", {}, { fetchFn: ruim, resolver: publico })).rejects.toBeInstanceOf(LinkXmlInvalido);
    expect(ruim).toHaveBeenCalledTimes(1);
  });
  it("redirecionamento em loop para depois de 3", async () => {
    const loop = vi.fn().mockImplementation(async () => new Response(null, { status: 302, headers: { location: "/de-novo" } }));
    await expect(fetchXmlSeguro("https://a.exemplo.com/x", {}, { fetchFn: loop, resolver: publico })).rejects.toThrow(/redireciona/);
    expect(loop).toHaveBeenCalledTimes(4);
  });
  it("resolverDoh lê A e AAAA do DNS por HTTPS", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ Status: 0, Answer: [{ type: 5, data: "x.cdn." }, { type: 1, data: "104.18.38.10" }] }))
      .mockResolvedValueOnce(Response.json({ Status: 0 }));
    expect(await resolverDoh(fetchFn)("a.exemplo.com")).toEqual(["104.18.38.10"]);
    expect(String(fetchFn.mock.calls[0][0])).toContain("cloudflare-dns.com/dns-query?name=a.exemplo.com&type=A");
  });
});

describe("Testar link (baixarEContar)", () => {
  const xml = `<ListingDataFeed><Listings><Listing><ListingID>A1</ListingID><TransactionType>For Sale</TransactionType></Listing><Listing><ListingID>A2</ListingID><TransactionType>For Rent</TransactionType></Listing></Listings></ListingDataFeed>`;
  it("mostra quantos imóveis o XML trouxe", async () => {
    const r = await baixarEContar("https://a.exemplo.com/x", { fetchFn: async () => new Response(xml), resolver: publico });
    expect(r).toEqual({ ok: true, total: 2, venda: 1, aluguel: 1 });
  });
  it("erros viram mensagem simples, sem o link", async () => {
    const url = "https://a.exemplo.com/feed?token=SEGREDO";
    const casos = await Promise.all([
      baixarEContar(url, { fetchFn: async () => new Response("x", { status: 500 }), resolver: publico }),
      baixarEContar(url, { fetchFn: async () => new Response("<html>erro</html>"), resolver: publico }),
      baixarEContar(url, { fetchFn: async () => { throw new Error(`falhou ${url}`); }, resolver: publico }),
      baixarEContar("https://a.exemplo.com/x", { fetchFn: async () => new Response(xml), resolver: async () => ["10.0.0.1"] }),
      baixarEContar("http://a.exemplo.com/x", { fetchFn: async () => new Response(xml), resolver: publico }),
    ]);
    expect(casos.map((c) => c.ok)).toEqual([false, false, false, false, false]);
    expect(JSON.stringify(casos)).not.toMatch(/SEGREDO|token|a\.exemplo/);
    expect(casos[3]).toMatchObject({ erro: expect.stringMatching(/interno/) });
  });
});
