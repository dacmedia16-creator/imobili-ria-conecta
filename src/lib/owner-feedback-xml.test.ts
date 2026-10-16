import { describe, expect, it } from "vitest";
import { mergeXmlBase, type ListingFeedback, type XmlBaseRow } from "./owner-feedback";

const portal = (code: string, views: number, brokerId: string | null = null): ListingFeedback => ({
  code,
  brokerId,
  lastCollectedOn: "2026-10-15",
  lines: [{ portal: "zap", views, contacts: 1 } as unknown as ListingFeedback["lines"][number]],
});
const base = (code: string, code_key: string, broker_id: string | null, corretor_xml: string | null = null): XmlBaseRow => ({
  code,
  code_key,
  broker_id,
  corretor_xml,
});

describe("mergeXmlBase", () => {
  it("sem XML bom mantém o comportamento antigo", () => {
    const p = [portal("123456789-1", 5)];
    expect(mergeXmlBase([], p)).toEqual({ listings: p, foraDaRemax: [] });
  });
  it("XML é a base; portal entra pela chave (x/zeros) e o resto vai para fora da RE/MAX", () => {
    const r = mergeXmlBase(
      [base("123456789-0042", "123456789-42", "u1"), base("123456789-7", "123456789-7", null, "Fulano")],
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
    const r = mergeXmlBase([base("123456789-1", "123456789-1", null)], [portal("123456789-1", 1, "u9")]);
    expect(r.listings[0].brokerId).toBe("u9");
  });
});
