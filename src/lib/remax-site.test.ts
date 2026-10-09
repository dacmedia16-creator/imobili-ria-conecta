import { describe, expect, it, vi } from "vitest";
import {
  linkPtBr,
  mapAgent,
  mapListing,
  resumoSugestao,
  runRemaxSiteCollect,
  searchBody,
  type CollectDb,
  type SiteSuggestion,
} from "./remax-site";

// Item no formato real do site (campos conferidos em 09/10 na coleta somente leitura), dados fictícios.
const raw = {
  MLSID: "630699001-107",
  AgentId: 630699001,
  OfficeId: 63059,
  ListingStatusUID: 160,
  ShowContractTypeExclusive: true,
  TransactionTypeUID: 261,
  StreetName: "Rua Fictícia",
  StreetNumber: "581",
  LocalZone: "Jardim Teste",
  City: "Sorocaba",
  PostalCode: "18000-000",
  Location: { type: "Point", coordinates: [-47.48, -23.51] },
  BuiltArea: 69,
  TotalArea: 69,
  LivingArea: null,
  NumberOfBedrooms: 2,
  NumberOfBathrooms: 2,
  ParkingSpaces: 1,
  ListingPrice: 300000,
  FirstUpdatedToWeb: 1772552280,
  ShortLinks: [
    {
      ShortLink: "en/listings/condo/apartment/for-sale/sorocaba/581-rua/630699001-107",
      LanguageCode: "en-US",
    },
    {
      ShortLink: "pt-br/imoveis/apartamento/venda/sorocaba/581-rua-ficticia/630699001-107",
      LanguageCode: "pt-BR",
    },
  ],
  AgentPhone: "15999999999",
};

describe("coleta do site RE/MAX", () => {
  it("pede só os campos necessários e filtra o escritório", () => {
    const b = searchBody("listing", 63059, 500);
    expect(b.filter).toContain("OfficeId eq 63059");
    expect(b.filter).toContain("IsViewable eq true");
    expect(b.skip).toBe(500);
    expect(b.select).toContain("content/MLSID");
    expect(b.select).not.toMatch(/Phone|Email/i);
    expect(searchBody("agent", 63060, 0).select).toBe(
      "content/AgentId,content/AgentName,content/OfficeId",
    );
  });

  it("mapeia o anúncio: código, endereço, geo, área, venda/locação e URL pt-BR", () => {
    const m = mapListing(raw)!;
    expect(m).toMatchObject({
      code: "630699001-107",
      agent_id: "630699001",
      office_id: 63059,
      status_uid: 160,
      exclusivo: true,
      transacao: "venda",
      tipo: "apartamento",
      rua: "Rua Fictícia",
      numero: "581",
      bairro: "Jardim Teste",
      lat: -23.51,
      lon: -47.48,
      area: 69,
      quartos: 2,
      vagas: 1,
      preco: 300000,
    });
    expect(m.url).toBe(
      "https://www.remax.com.br/pt-br/imoveis/apartamento/venda/sorocaba/581-rua-ficticia/630699001-107",
    );
    expect(m.publicado_em).toMatch(/^2026-/);
    expect(JSON.stringify(m)).not.toContain("15999999999");
    expect(mapListing({ ...raw, TransactionTypeUID: 260 })!.transacao).toBe("locacao");
  });

  it("ignora item inválido (código sem hífen, sem agente)", () => {
    expect(mapListing({ ...raw, MLSID: "630699001107" })).toBeNull();
    expect(mapListing({ ...raw, AgentId: null })).toBeNull();
  });

  it("corretor: guarda só ID, nome e escritório", () => {
    const a = mapAgent({
      AgentId: 630699077,
      AgentName: " Fulano Fictício ",
      OfficeId: 63059,
      AgentPhone: "15999999999",
      AgentEmail: "x@y.z",
    });
    expect(a).toEqual({ agent_id: "630699077", nome: "Fulano Fictício", office_id: 63059 });
  });

  it("URL só do próprio site e em pt-BR", () => {
    expect(linkPtBr([{ ShortLink: "en/x", LanguageCode: "en-US" }]).url).toBeNull();
    expect(linkPtBr(null).url).toBeNull();
  });

  const fakeResp = (body: unknown, status = 200) =>
    ({ ok: status < 400, status, json: async () => body }) as Response;

  it("lê página por página, com pausa, e grava por imobiliária", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      calls.push(`${url.includes("listing") ? "L" : "A"}${b.skip}`);
      expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^ADM-MAX/);
      if (url.includes("agent"))
        return fakeResp({
          "@odata.count": 1,
          value: [{ content: { AgentId: 630699001, AgentName: "X", OfficeId: 63059 } }],
        });
      const total = 501;
      const n = b.skip === 0 ? 500 : 1;
      return fakeResp({
        "@odata.count": total,
        value: Array.from({ length: n }, () => ({ content: raw })),
      });
    });
    const ingest = vi.fn(async () => ({ status: "ok" }));
    const db: CollectDb = {
      targets: async () => [{ organization_id: "org-a", offices: [63059] }],
      ingest,
      failed: vi.fn(),
    };
    const sleep = vi.fn(async () => undefined);
    const log = await runRemaxSiteCollect(db, fetchFn, sleep);
    expect(calls).toEqual(["L0", "L500", "A0"]);
    expect(sleep).toHaveBeenCalled();
    expect(ingest).toHaveBeenCalledTimes(1);
    expect((ingest.mock.calls[0] as unknown[])[1]).toHaveLength(501);
    expect(log[0]).toContain("ok");
  });

  it("site fora do ar ou formato mudou: registra a falha e NÃO grava (dados anteriores ficam)", async () => {
    const ingest = vi.fn();
    const failed = vi.fn(async () => undefined);
    const db: CollectDb = {
      targets: async () => [
        { organization_id: "org-a", offices: [1] },
        { organization_id: "org-b", offices: [2] },
      ],
      ingest,
      failed,
    };
    let n = 0;
    const fetchFn = vi.fn(async () => (n++ === 0 ? fakeResp({}, 500) : fakeResp({ results: [] })));
    const log = await runRemaxSiteCollect(db, fetchFn, async () => undefined);
    expect(ingest).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledTimes(2);
    expect(log[0]).toContain("HTTP 500");
    expect(log[1]).toContain("formato do site mudou");
  });
});

describe("resumo da sugestão", () => {
  it("linha curta", () => {
    const s = {
      tipo: "casa-de-condominio",
      area: 150,
      quartos: 3,
      preco: 650000,
      transacao: "venda",
    } as SiteSuggestion;
    expect(resumoSugestao(s)).toMatch(/^Casa de condominio · 150 m² · 3 quartos · R\$\s?650\.000$/);
    expect(resumoSugestao({ ...s, preco: 2500, transacao: "locacao", quartos: 1 })).toMatch(
      /1 quarto · R\$\s?2\.500\/mês$/,
    );
  });
});
