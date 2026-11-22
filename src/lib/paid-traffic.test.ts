import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  defaultReportPeriod,
  entriesForListing,
  insidePeriod,
  investedInPeriod,
  paidOwnerLabel,
  paidTrafficAccess,
  parseReais,
  summarizePaid,
  validatePaid,
  type PaidTrafficEntry,
} from "./paid-traffic";
import { aiFacts, diagnosis, groupByListing, ownerMessage, type Snapshot } from "./owner-feedback";
import { buildOwnerFeedbackPdf } from "./owner-feedback-pdf";

const e = (p: Partial<PaidTrafficEntry>): PaidTrafficEntry => ({
  id: Math.random().toString(36).slice(2),
  listing_code: "630601001-12",
  code_key: "630601001-12",
  canal: "meta",
  inicio: "2026-10-01",
  fim: "2026-10-31",
  visualizacoes: 500,
  contatos: 10,
  investimento: 350.5,
  created_by: "u1",
  updated_by: "u1",
  created_at: "2026-11-01T12:00:00Z",
  updated_at: "2026-11-01T12:00:00Z",
  ...p,
});
const P = { de: "2026-10-01", ate: "2026-10-31" };

const snap: Snapshot = {
  portal: "imovelweb",
  collected_on: "2026-11-02",
  listing_code: "630601001-12",
  broker_id: "b1",
  window_kind: "last30",
  window_from: "2026-10-01",
  window_to: "2026-10-31",
  impressions: 900,
  views: 120,
  contacts: 3,
  error: null,
};

describe("tráfego pago: soma e período", () => {
  it("soma só os lançamentos com o período inteiro dentro do relatório", () => {
    const s = summarizePaid(
      [
        e({ canal: "meta", visualizacoes: 500, contatos: 10 }),
        e({
          canal: "google",
          inicio: "2026-10-10",
          fim: "2026-10-20",
          visualizacoes: 200,
          contatos: 4,
        }),
        // começa antes do período: fica fora (não rateamos dias)
        e({
          canal: "google",
          inicio: "2026-09-25",
          fim: "2026-10-05",
          visualizacoes: 9999,
          contatos: 99,
        }),
        // termina depois: fora
        e({
          canal: "outro",
          inicio: "2026-10-30",
          fim: "2026-11-02",
          visualizacoes: 7777,
          contatos: 77,
        }),
      ],
      P,
    );
    expect(s).toEqual({
      views: 700,
      contacts: 14,
      canais: ["meta", "google"],
      de: "2026-10-01",
      ate: "2026-10-31",
      lancamentos: 2,
    });
  });

  it("borda do período entra (início = de, fim = até) e nada dentro = null", () => {
    expect(insidePeriod({ inicio: "2026-10-01", fim: "2026-10-31" }, P)).toBe(true);
    expect(insidePeriod({ inicio: "2026-09-30", fim: "2026-10-31" }, P)).toBe(false);
    expect(summarizePaid([e({ inicio: "2026-11-01", fim: "2026-11-05" })], P)).toBeNull();
    expect(summarizePaid([], P)).toBeNull();
    expect(summarizePaid([e({})], { de: "2026-10-31", ate: "2026-10-01" })).toBeNull();
  });

  it("resumo do proprietário não carrega o valor investido; o interno soma só o período", () => {
    const s = summarizePaid([e({ investimento: 350.5 }), e({ investimento: 100 })], P)!;
    expect(Object.keys(s)).not.toContain("investimento");
    expect(JSON.stringify(s)).not.toContain("350");
    expect(
      investedInPeriod(
        [
          e({ investimento: 350.5 }),
          e({ investimento: null }),
          e({ inicio: "2026-09-01", investimento: 1000 }),
        ],
        P,
      ),
    ).toBe(350.5);
  });

  it("período padrão = janela 'últimos 30 dias' dos portais; sem ela, 30 dias até hoje", () => {
    expect(
      defaultReportPeriod(
        [
          { from: "2026-10-02", to: "2026-10-31" },
          { from: "2026-10-01", to: "2026-10-30" },
        ],
        "2026-11-22",
      ),
    ).toEqual({
      de: "2026-10-01",
      ate: "2026-10-31",
    });
    expect(defaultReportPeriod([{ from: null, to: null }], "2026-11-22")).toEqual({
      de: "2026-10-24",
      ate: "2026-11-22",
    });
  });

  it("junta códigos com x/hífen/zeros do mesmo imóvel e só dele", () => {
    const lista = entriesForListing(
      [
        e({ listing_code: "630601001x012", code_key: "630601001-12" }),
        e({ listing_code: "630601001-13", code_key: "630601001-13" }),
      ],
      "630601001-12",
    );
    expect(lista).toHaveLength(1);
  });

  it("rótulo cita só os canais lançados (não inventa origem)", () => {
    expect(paidOwnerLabel({ canais: ["meta"] })).toBe("Tráfego pago (Meta Ads)");
    expect(paidOwnerLabel({ canais: ["meta", "google"] })).toBe(
      "Tráfego pago (Meta Ads e Google Ads)",
    );
    expect(paidOwnerLabel({ canais: ["outro"] })).toBe("Tráfego pago (outros canais)");
  });
});

describe("tráfego pago: validação igual ao banco", () => {
  const ok = {
    canal: "meta",
    inicio: "2026-10-01",
    fim: "2026-10-31",
    visualizacoes: "1.200",
    contatos: "3",
    investimento: "1.234,56",
  };
  it("aceita e converte números brasileiros", () => {
    const r = validatePaid(ok);
    expect(r.ok && r.value).toEqual({
      canal: "meta",
      inicio: "2026-10-01",
      fim: "2026-10-31",
      visualizacoes: 1200,
      contatos: 3,
      investimento: 1234.56,
    });
    expect(parseReais("")).toBeNull();
    expect(parseReais("350,5")).toBe(350.5);
    expect(parseReais("R$ 350.50")).toBe(350.5);
  });
  it("recusa negativo, fim antes do início, canal fora da lista e valor inválido", () => {
    expect(validatePaid({ ...ok, visualizacoes: "-1" }).ok).toBe(false);
    expect(validatePaid({ ...ok, contatos: "2,5" }).ok).toBe(false);
    expect(validatePaid({ ...ok, fim: "2026-09-30" }).ok).toBe(false);
    expect(validatePaid({ ...ok, canal: "tiktok" }).ok).toBe(false);
    expect(validatePaid({ ...ok, investimento: "-10" }).ok).toBe(false);
    expect(validatePaid({ ...ok, inicio: "2025-01-01" }).ok).toBe(false);
  });
});

describe("tráfego pago: permissões por papel (tela segue o banco)", () => {
  // owner_feedback_can_edit: dono/captador atual, gestor/TL dele e admin = true; outro corretor e outra org = false.
  it.each([
    ["corretor dono", true],
    ["gestor/TL do dono", true],
    ["admin da imobiliária", true],
    ["outro corretor", false],
    ["outra imobiliária", false],
  ])("%s", (_papel, podeEditar) => {
    expect(paidTrafficAccess(podeEditar)).toEqual({
      lancar: podeEditar,
      verInvestimento: podeEditar,
    });
  });

  it("migration: RLS com a regra do Feedback, isolamento por org, sem anon e validações", () => {
    const sql = readFileSync(
      "supabase/migrations/20261224120000_feedback_trafego_pago.sql",
      "utf8",
    );
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain(
      "REVOKE ALL ON public.listing_paid_traffic_entries FROM PUBLIC, anon, authenticated",
    );
    expect(sql).toMatch(/org_isolation ON public\.listing_paid_traffic_entries AS RESTRICTIVE/);
    expect(sql).toMatch(/USING \(\(SELECT public\.owner_feedback_can_edit\(listing_code\)\)\)/);
    expect(sql).toContain("CHECK (fim >= inicio)");
    expect(sql).toMatch(/visualizacoes integer NOT NULL DEFAULT 0 CHECK \(visualizacoes BETWEEN 0/);
    expect(sql).not.toMatch(/portal_listing_snapshots\s+(ADD|ALTER|DROP)/i);
    const rb = readFileSync("supabase/rollback/20261224120000_feedback_trafego_pago.sql", "utf8");
    expect(rb).toContain("TABLE IF EXISTS public.listing_paid_traffic_entries");
    expect(rb).toContain("FUNCTION IF EXISTS public.listing_paid_traffic_audit()");
  });
});

describe("tráfego pago no relatório do proprietário", () => {
  const listing = groupByListing([snap])[0];
  const paid = summarizePaid(
    [e({ canal: "meta", visualizacoes: 500, contatos: 10, investimento: 987.65 })],
    P,
  );

  it("mensagem: linha marcada 'Tráfego pago', total somado e sem valor investido", () => {
    const msg = ownerMessage({ listing, recommendation: "Rec.", brokerName: "Ana", paid });
    expect(msg).toContain(
      "• Tráfego pago (Meta Ads) (01/10/2026 a 31/10/2026): 500 visualizações e 10 contatos",
    );
    expect(msg).toContain("Total: 620 visualizações e 13 contatos");
    expect(msg).not.toMatch(/987|investid|R\$/);
    // Sem tráfego pago: mensagem igual à de antes (sem linha Total).
    expect(ownerMessage({ listing, recommendation: "Rec.", brokerName: "Ana" })).not.toContain(
      "Total:",
    );
  });

  it("diagnóstico e IA consideram o tráfego pago, sem valor e sem inventar canal", () => {
    expect(diagnosis(groupByListing([{ ...snap, views: 5, contacts: 0 }])[0])).toContain(
      "pouca exposição",
    );
    expect(diagnosis(groupByListing([{ ...snap, views: 5, contacts: 0 }])[0], paid)).toContain(
      "atraindo visitas e contatos",
    );
    const f = aiFacts(listing, undefined, paid);
    expect(f).toContain(
      "Tráfego pago lançado pelo corretor (Meta Ads, 01/10/2026 a 31/10/2026): 500 visualizações, 10 contatos",
    );
    expect(f).not.toContain("Google");
    expect(f).not.toMatch(/987|investid/);
  });

  it("PDF com a linha de tráfego pago gera sem erro e não leva o valor investido", async () => {
    const bytes = await buildOwnerFeedbackPdf({
      listing,
      brokerName: "Ana",
      ownerName: "João",
      recommendation: "Seguimos.",
      logoPng: null,
      issuedAt: new Date("2026-11-02T12:00:00Z"),
      paid,
    });
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(Buffer.from(bytes).toString("latin1")).not.toContain("987");
  });
});
