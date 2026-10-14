import { describe, expect, it } from "vitest";
import {
  aiFacts,
  cleanAiText,
  codeKey,
  groupByListing,
  ownerMessage,
  pickAiSuggestion,
  similarAverage,
  whatsappLink,
  type Snapshot,
} from "./owner-feedback";

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

describe("IA do feedback", () => {
  it("envia à IA só números confirmados", () => {
    const l = groupByListing([
      {
        ...base,
        portal: "imovelweb",
        collected_on: "2026-10-06",
        listing_code: "630601001-1",
        window_kind: "last30",
        impressions: 900,
        views: 120,
        contacts: 3,
        error: null,
      } as Snapshot,
      {
        ...base,
        portal: "zap",
        collected_on: "2026-10-06",
        listing_code: "630601001-1",
        window_kind: "unknown",
        impressions: null,
        views: 999,
        contacts: 99,
        error: null,
      } as Snapshot,
    ])[0];
    const f = aiFacts(l);
    expect(f).toContain("120 visualizações");
    expect(f).not.toContain("999");
    expect(f).toContain("Também anunciado em: ZAP, OLX e VivaReal");
  });
  it("limpa markdown e quebra de linha", () => {
    expect(cleanAiText("**Ótimo** resultado.\n\nSeguimos")).toBe("Ótimo resultado. Seguimos");
  });
});

describe("sugestão da IA (t_e32ba130)", () => {
  const boa =
    "O anúncio teve 40 visualizações e 2 contatos nos últimos 30 dias, acima da média de imóveis parecidos. Seguimos acompanhando os interessados e sugiro uma conversa rápida para alinhar os próximos passos.";

  it("aceita texto em português terminado com ponto", () => {
    const r = pickAiSuggestion({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: boa }] } }],
    });
    expect(r).toEqual({ ok: true, text: boa });
  });

  it("ignora o raciocínio interno (thought) do modelo", () => {
    const r = pickAiSuggestion({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [{ text: "The listing has quite healthy views, so we should highlight", thought: true }, { text: boa }],
          },
        },
      ],
    });
    expect(r).toEqual({ ok: true, text: boa });
  });

  it("recusa resposta cortada pelo limite de tokens", () => {
    const r = pickAiSuggestion({
      candidates: [
        { finishReason: "MAX_TOKENS", content: { parts: [{ text: "O anúncio teve boa exposição e" }] } },
      ],
    });
    expect(r).toEqual({ ok: false, reason: "finish MAX_TOKENS" });
  });

  it("recusa frase sem final, mesmo com STOP", () => {
    const r = pickAiSuggestion({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "O anúncio teve boa exposição e" }] } }],
    });
    expect(r).toEqual({ ok: false, reason: "cortado" });
  });

  it("recusa resposta em inglês", () => {
    const r = pickAiSuggestion({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: "The listing has quite healthy views and we will highlight it for you." }] },
        },
      ],
    });
    expect(r).toEqual({ ok: false, reason: "idioma" });
  });

  it("recusa resposta vazia", () => {
    expect(pickAiSuggestion({ candidates: [{ finishReason: "STOP", content: { parts: [] } }] })).toEqual({
      ok: false,
      reason: "vazio",
    });
    expect(pickAiSuggestion({})).toEqual({ ok: false, reason: "sem candidato" });
  });

  it("normaliza o código igual ao banco", () => {
    expect(codeKey("630601005-0114")).toBe("630601005-114");
    expect(codeKey(" 630601005x114 ")).toBe("630601005-114");
    expect(codeKey("abc")).toBe("ABC");
  });

  it("calcula a média de parecidos sem contar o próprio imóvel e com mínimo de 5", () => {
    const keys = new Set(["630601005-1", "630601005-2", "630601005-3", "630601005-4", "630601005-5", "630601005-9"]);
    const snaps = [
      { listing_code: "630601005-0001", views: 10, contacts: 1 },
      { listing_code: "630601005-2", views: 20, contacts: 0 },
      { listing_code: "630601005-3", views: 30, contacts: 1 },
      { listing_code: "630601005-4", views: 40, contacts: 0 },
      { listing_code: "630601005-5", views: 50, contacts: 1 },
      { listing_code: "630601005-9", views: 999, contacts: 9 },
      { listing_code: "630601005-7", views: 999, contacts: 9 },
    ];
    expect(similarAverage("630601005-9", snaps, keys)).toEqual({ n: 5, mediaViews: 30, mediaContatos: 0.6 });
    expect(similarAverage("630601005-9", snaps.slice(0, 3), keys)).toBeNull();
  });

  it("inclui dados do imóvel e a comparação nos fatos da IA", () => {
    const [l] = groupByListing(rows);
    const t = aiFacts(l, {
      tipo: "casa",
      quartos: 3,
      area: 120.4,
      bairro: "Centro",
      cidade: "Sorocaba",
      preco: 650000,
      publicadoEm: "2026-09-14",
      hoje: "2026-10-14T12:00:00Z",
      comparacao: {
        portal: "imovelweb",
        periodText: "últimos 30 dias",
        criterio: "casa à venda em Sorocaba",
        n: 141,
        mediaViews: 23,
        mediaContatos: 0.5,
      },
    });
    expect(t).toContain("Imóvel: casa, 3 quartos, 120 m², Centro, Sorocaba.");
    expect(t).toContain("Preço anunciado: R$ 650.000 (só contexto");
    expect(t).toContain("Tempo de anúncio no site da RE/MAX: 30 dias.");
    expect(t).toContain("casa à venda em Sorocaba (141 imóveis): 23 visualizações e 0,5 contatos por imóvel.");
  });

  it("sem contexto, os fatos continuam iguais", () => {
    const [l] = groupByListing(rows);
    expect(aiFacts(l, undefined)).toBe(aiFacts(l));
    expect(aiFacts(l)).not.toContain("Dados do imóvel");
  });
});
