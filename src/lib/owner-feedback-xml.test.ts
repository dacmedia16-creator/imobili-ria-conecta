import { describe, expect, it } from "vitest";
import {
  dedupeByCodeKey,
  groupByListing,
  mergeXmlBase,
  totalContacts,
  totalViews,
  type ListingFeedback,
  type Snapshot,
  type XmlBaseRow,
} from "./owner-feedback";
import { parseVrsync } from "./remax-xml";

const portal = (code: string, views: number, brokerId: string | null = null): ListingFeedback => ({
  code,
  brokerId,
  lastCollectedOn: "2026-10-15",
  lines: [{ portal: "zap", views, contacts: 1 } as unknown as ListingFeedback["lines"][number]],
});
const base = (
  code: string,
  code_key: string,
  broker_id: string | null,
  corretor_xml: string | null = null,
): XmlBaseRow => ({
  code,
  code_key,
  broker_id,
  corretor_xml,
});
const snap = (
  listing_code: string,
  portal: Snapshot["portal"],
  views: number | null,
  contacts: number | null,
  extra: Partial<Snapshot> = {},
): Snapshot => ({
  portal,
  collected_on: "2026-10-15",
  listing_code,
  broker_id: "u1",
  window_kind: "cumulative",
  window_from: null,
  window_to: null,
  impressions: null,
  views,
  contacts,
  error: null,
  ...extra,
});

describe("mergeXmlBase", () => {
  it("sem XML bom (nenhuma coleta boa ainda) mantém os portais e nunca zera a tela", () => {
    const p = [portal("123456789-1", 5)];
    expect(mergeXmlBase([], p)).toEqual({ listings: p, foraDaRemax: [] });
  });
  it("XML é a base; portal entra pela chave (x/zeros) e o resto vai para fora da RE/MAX", () => {
    const r = mergeXmlBase(
      [
        base("123456789-0042", "123456789-42", "u1"),
        base("123456789-7", "123456789-7", null, "Fulano"),
      ],
      [portal("123456789X42", 10), portal("999999999-1", 3)],
    );
    expect(r.listings.map((l) => [l.code, l.brokerId, l.lines.length, l.corretorXml])).toEqual([
      ["123456789-0042", "u1", 1, null],
      ["123456789-7", null, 0, "Fulano"],
    ]);
    expect(r.listings.every((l) => l.noXml)).toBe(true);
    expect(r.foraDaRemax.map((l) => l.code)).toEqual(["999999999-1"]);
  });
  it("sem corretor no XML usa o corretor do portal", () => {
    const r = mergeXmlBase(
      [base("123456789-1", "123456789-1", null)],
      [portal("123456789-1", 1, "u9")],
    );
    expect(r.listings[0].brokerId).toBe("u9");
  });
  it("par -93/x93 no mesmo portal vira UM imóvel com UMA linha do Zap, sem contar em dobro", () => {
    const rows = [
      snap("630601201-93", "zap", 60, 2),
      snap("630601201x93", "zap", 40, 1),
      snap("630601201-93", "imovelweb", 10, 0),
      snap("630601201x11", "zap", 7, 0),
    ];
    const r = mergeXmlBase([base("630601201-93", "630601201-93", "u1")], groupByListing(rows));
    expect(r.listings).toHaveLength(1);
    const l = r.listings[0];
    expect(l.lines.map((x) => x.portal)).toEqual(["zap", "imovelweb"]);
    expect(l.lines[0].views).toBe(100);
    expect(totalViews(l)).toBe(110);
    expect(totalContacts(l)).toBe(3);
    // anúncio do portal sem par no XML: bloco "Anunciado no portal, fora da RE/MAX"
    expect(r.foraDaRemax.map((x) => x.code)).toEqual(["630601201x11"]);
  });
  it("par só no portal (fora do XML) conta uma vez no alerta, com o código no formato hífen", () => {
    const rows = [snap("630601201x88", "zap", 3, 1), snap("630601201-88", "zap", 5, 0)];
    const r = mergeXmlBase([base("630601201-1", "630601201-1", "u1")], groupByListing(rows));
    expect(r.foraDaRemax).toHaveLength(1);
    expect(r.foraDaRemax[0].code).toBe("630601201-88");
    expect(totalViews(r.foraDaRemax[0])).toBe(8);
  });
});

describe("dedupeByCodeKey", () => {
  it("linha com erro de coleta não soma: fica a válida", () => {
    const rows = [
      snap("630601201-5", "zap", 20, 1),
      snap("630601201x5", "zap", null, null, { error: "falhou" }),
    ];
    const [l] = dedupeByCodeKey(groupByListing(rows));
    expect(l.lines).toHaveLength(1);
    expect(l.lines[0].views).toBe(20);
    expect(l.lines[0].confirmed).toBe(true);
  });
  it("períodos diferentes somam na tela mas não vão ao proprietário como confirmados", () => {
    const rows = [
      snap("630601201-6", "zap", 20, 1),
      snap("630601201x6", "zap", 5, 0, { window_kind: "unknown" }),
    ];
    const [l] = dedupeByCodeKey(groupByListing(rows));
    expect(l.lines[0].views).toBe(25);
    expect(l.lines[0].confirmed).toBe(false);
  });
});

describe("composição da base pelo XML", () => {
  it("só venda (For Sale) entra na base; aluguel fica fora", () => {
    const xml = `<?xml version="1.0"?><ListingDataFeed><Listings>
      <Listing><ListingID>123456789-1</ListingID><TransactionType>For Sale</TransactionType></Listing>
      <Listing><ListingID>123456789-2</ListingID><TransactionType>For Rent</TransactionType></Listing>
      <Listing><ListingID>123456789-3</ListingID><TransactionType>Sale/Rent</TransactionType></Listing>
    </Listings></ListingDataFeed>`;
    const r = parseVrsync(xml);
    expect(r.total).toBe(3);
    expect(r.venda.map((a) => a.code)).toEqual(["123456789-1"]);
  });
});
