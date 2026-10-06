import { describe, expect, it } from "vitest";
import { groupByListing, ownerMessage, whatsappLink, type Snapshot } from "./owner-feedback";

const base = {
  broker_id: "b1",
  window_from: null,
  window_to: null,
  impressions: null,
  error: null,
} as const;

const rows: Snapshot[] = [
  {
    ...base,
    portal: "imovelweb",
    collected_on: "2026-10-06",
    listing_code: "630601272-190",
    window_kind: "last30",
    window_from: "2026-09-07",
    window_to: "2026-10-06",
    views: 40,
    contacts: 2,
  },
  {
    ...base,
    portal: "zap",
    collected_on: "2026-10-06",
    listing_code: "630601272-190",
    window_kind: "unknown",
    views: 300,
    contacts: 9,
  },
  {
    ...base,
    portal: "zap",
    collected_on: "2026-09-29",
    listing_code: "630601272-190",
    window_kind: "unknown",
    views: 250,
    contacts: 7,
  },
  {
    ...base,
    portal: "cliqueimudei",
    collected_on: "2026-10-06",
    listing_code: "630601272-190",
    window_kind: "unknown",
    views: null,
    contacts: null,
    error: "HTTP 403",
  },
];

describe("owner feedback", () => {
  it("usa a coleta mais recente e calcula a variação do acumulado", () => {
    const [l] = groupByListing(rows);
    const zap = l.lines.find((x) => x.portal === "zap")!;
    expect(zap.views).toBe(300);
    expect(zap.viewsDelta).toBe(50);
    expect(zap.contactsDelta).toBe(2);
    expect(zap.confirmed).toBe(false);
  });

  it("erro de coleta fica sem número", () => {
    const [l] = groupByListing(rows);
    const cm = l.lines.find((x) => x.portal === "cliqueimudei")!;
    expect(cm.views).toBeNull();
    expect(cm.error).toBe("HTTP 403");
  });

  it("mensagem só traz números de período confirmado", () => {
    const [l] = groupByListing(rows);
    const msg = ownerMessage({ listing: l, recommendation: "Rec.", brokerName: "Ana Souza" });
    expect(msg).toContain(
      "Imovelweb (últimos 30 dias (07/09/2026 a 06/10/2026)): 40 visualizações e 2 contatos",
    );
    expect(msg).not.toContain("300");
    expect(msg).toContain("Ele também está anunciado em: ZAP, OLX e VivaReal.");
    expect(msg).not.toContain("Cliquei Mudei");
  });

  it("link do WhatsApp com e sem telefone", () => {
    expect(whatsappLink("oi", "(15) 99999-0000")).toBe("https://wa.me/5515999990000?text=oi");
    expect(whatsappLink("oi")).toBe("https://wa.me/?text=oi");
  });
});
