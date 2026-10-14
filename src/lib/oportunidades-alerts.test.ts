import { describe, expect, it } from "vitest";
import { planAlerts, runOpportunityAlerts, whatsappOptIn, type AlertRow } from "./oportunidades-alerts.server";
import type { OrgAdminClient } from "./org-scope";
import { LIMITE_DIARIO_ALERTAS, pairKey, type CaptureCandidate, type OpportunityPost } from "./oportunidades";

const now = new Date("2026-10-14T15:00:00Z");
const procura = (id: string, extra: Partial<OpportunityPost> = {}): OpportunityPost => ({
  id,
  kind: "procura",
  tipo: "Casa",
  finalidade: "Venda",
  bairro: "Campolim",
  valor_min: null,
  valor_max: 800_000,
  valor: null,
  corretor: "Ana Corretora",
  texto: "Cliente procura casa no Campolim até 800 mil",
  posted_at: "2026-10-14T12:00:00Z",
  ...extra,
});
const cap = (id: string, extra: Partial<CaptureCandidate> = {}): CaptureCandidate => ({
  id,
  captor_id: "u-bruno",
  captor_nome: "Bruno Captador",
  tipo: "Casa",
  finalidade: "Venda",
  bairro: "Campolim",
  municipio: "Sorocaba",
  valor: 780_000,
  ...extra,
});
const alerta = (post_id: string, capture_id: string, status = "dry_run", recipient_id = "u-bruno"): AlertRow => ({
  post_id,
  capture_id,
  recipient_id,
  status,
  created_at: "2026-10-14T13:00:00Z",
});

describe("planAlerts", () => {
  it("gera alerta para procura × captação que encaixa", () => {
    const p = planAlerts([procura("p1")], [cap("c1")], new Set(), [], now);
    expect(p.map((x) => [x.post.id, x.capture.id])).toEqual([["p1", "c1"]]);
  });

  it("não repete o mesmo par (já enviado ou já registrado em dry-run)", () => {
    expect(planAlerts([procura("p1")], [cap("c1")], new Set(), [alerta("p1", "c1", "sent")], now)).toEqual([]);
    expect(planAlerts([procura("p1")], [cap("c1")], new Set(), [alerta("p1", "c1")], now)).toEqual([]);
  });

  it("tenta de novo um par que falhou", () => {
    expect(planAlerts([procura("p1")], [cap("c1")], new Set(), [alerta("p1", "c1", "failed")], now)).toHaveLength(1);
  });

  it("respeita o 'não encaixa'", () => {
    expect(planAlerts([procura("p1")], [cap("c1")], new Set([pairKey("p1", "c1")]), [], now)).toEqual([]);
  });

  it("limita por captador por dia e prioriza as procuras mais novas", () => {
    const posts = Array.from({ length: LIMITE_DIARIO_ALERTAS + 2 }, (_, i) =>
      procura(`p${i}`, { posted_at: `2026-10-14T1${i}:00:00Z` }),
    );
    const p = planAlerts(posts, [cap("c1")], new Set(), [], now);
    expect(p).toHaveLength(LIMITE_DIARIO_ALERTAS);
    expect(p[0].post.id).toBe(`p${LIMITE_DIARIO_ALERTAS + 1}`);
    // alertas de hoje já contam no limite; os de ontem, não
    const hoje = Array.from({ length: LIMITE_DIARIO_ALERTAS }, (_, i) => alerta(`x${i}`, "c9"));
    expect(planAlerts(posts, [cap("c1")], new Set(), hoje, now)).toEqual([]);
    const ontem = hoje.map((a) => ({ ...a, created_at: "2026-10-13T13:00:00Z" }));
    expect(planAlerts(posts, [cap("c1")], new Set(), ontem, now)).toHaveLength(LIMITE_DIARIO_ALERTAS);
  });

  it("ignora oferta, procura vencida, quem postou a própria captação e valor fora da margem", () => {
    expect(planAlerts([procura("p1", { kind: "oferta" })], [cap("c1")], new Set(), [], now)).toEqual([]);
    expect(planAlerts([procura("p1", { posted_at: "2026-10-01T12:00:00Z" })], [cap("c1")], new Set(), [], now)).toEqual([]);
    expect(planAlerts([procura("p1", { corretor: "Bruno Captador" })], [cap("c1")], new Set(), [], now)).toEqual([]);
    expect(planAlerts([procura("p1")], [cap("c1", { valor: 900_000 })], new Set(), [], now)).toEqual([]);
  });
});

// Cliente falso: cada tabela devolve linhas fixas; filtros são ignorados; insert é registrado.
function fakeAdmin(tables: Record<string, unknown[]>, inserts: Record<string, unknown>[]) {
  const query = (table: string) => {
    const result = { data: tables[table] ?? [], error: null };
    const q: Record<string, unknown> = {
      then: (ok: (v: typeof result) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, ko),
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, ...row });
        return Promise.resolve({ data: null, error: null });
      },
    };
    for (const m of ["select", "eq", "in", "is", "gte", "not"]) q[m] = () => q;
    return q;
  };
  return { from: query } as unknown as OrgAdminClient;
}

describe("notificar_whatsapp", () => {
  it("whatsappOptIn: false em todos os papéis = fora; papel sem preferência = dentro", () => {
    const s = whatsappOptIn([
      { user_id: "a", notificar_whatsapp: false },
      { user_id: "b", notificar_whatsapp: null },
      { user_id: "c", notificar_whatsapp: false },
      { user_id: "c", notificar_whatsapp: true },
    ]);
    expect([...s].sort()).toEqual(["b", "c"]);
  });

  it("captador com notificar_whatsapp=false não entra no plano de alertas (nem em dry-run)", async () => {
    const capRow = (id: string, captor_id: string) => ({
      id,
      captor_id,
      broker_name: null,
      tipo_imovel: "Casa",
      bairro: "Campolim",
      municipio: "Sorocaba",
      valor_imovel: "780.000",
    });
    const tables = {
      organization_modules: [{ organization_id: "org1" }],
      organizations: [{ id: "org1" }],
      opportunity_posts: [procura("p1")],
      exclusive_captures: [capRow("c-sim", "u-sim"), capRow("c-nao", "u-nao")],
      profiles: [
        { id: "u-sim", nome: "Sim Captador", ativo: true },
        { id: "u-nao", nome: "Nao Captador", ativo: true },
      ],
      user_roles: [
        { user_id: "u-sim", notificar_whatsapp: true },
        { user_id: "u-nao", notificar_whatsapp: false },
      ],
      opportunity_hidden_pairs: [],
      opportunity_alerts: [],
    };
    const inserts: Record<string, unknown>[] = [];
    const r = await runOpportunityAlerts(fakeAdmin(tables, inserts), {
      send: null, // dry-run: nada sai
      pilotPhone: null,
      appUrl: "https://exemplo.local",
      now,
    });
    expect(r).toEqual({ planned: 1, sent: 0, failed: 0, dryRun: 1 });
    expect(inserts).toEqual([
      {
        table: "opportunity_alerts",
        organization_id: "org1",
        post_id: "p1",
        capture_id: "c-sim",
        recipient_id: "u-sim",
        status: "dry_run",
      },
    ]);
  });
});
