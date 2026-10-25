import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _zerarFalhasToken,
  GRUPO_OLX_MAX_BYTES,
  receberLeadGrupoOlx,
  STATUS_POR_RESULTADO,
  type RpcReceber,
} from "./leads-grupo-olx.server";
import { ORIGEM_LABEL, ORIGENS, ORIGENS_TODAS, resumoPortal, urlGrupoOlx } from "./leads";

// Recepção do Grupo ZAP (card t_478b211e). O teste de ponta a ponta com PostgreSQL descartável
// (2 imobiliárias, payload da doc, reenvio, token, módulo, imóvel, isolamento) fica fora do repo;
// aqui: o handler com o banco simulado e as travas do texto da migration.
const MIG = readFileSync("supabase/migrations/20261025170000_leads_grupo_olx.sql", "utf8");
const RB = readFileSync("docs/sql/rollback/20261025170000_leads_grupo_olx.rollback.sql", "utf8");
const TOKEN = "A".repeat(43);

const post = (rpc: RpcReceber, body: unknown, token = TOKEN, init: RequestInit = {}) =>
  receberLeadGrupoOlx(
    new Request(`https://app/api/leads/grupo-olx/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
      ...init,
    }),
    token,
    rpc,
  );
const banco = (r: string): RpcReceber => vi.fn(async () => ({ data: { r }, error: null }));

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  _zerarFalhasToken();
  for (const m of ["log", "error", "warn", "info"] as const)
    vi.spyOn(console, m).mockImplementation(
      (...a: unknown[]) => void logs.push(a.map(String).join(" ")),
    );
});
afterEach(() => vi.restoreAllMocks());

describe("recepção Grupo ZAP: código HTTP", () => {
  it.each([
    ["ok", 200],
    ["duplicado", 200],
    ["sem_contato", 200],
    ["token", 401],
    ["modulo", 404],
    ["invalido", 400],
    ["limite", 429],
  ])("banco %s -> %i", async (r, status) => {
    expect((await post(banco(r), { originLeadId: "1" })).status).toBe(status);
  });

  it("erro do banco ou resposta estranha -> 503 (o Grupo OLX reenvia)", async () => {
    const comErro: RpcReceber = async () => ({ data: null, error: { code: "XX000" } });
    const explode: RpcReceber = async () => {
      throw new Error("rede");
    };
    expect((await post(comErro, { originLeadId: "1" })).status).toBe(503);
    expect((await post(explode, { originLeadId: "1" })).status).toBe(503);
    expect((await post(banco("???"), { originLeadId: "1" })).status).toBe(503);
  });

  it("token mal formado: 401 sem chamar o banco", async () => {
    const rpc = banco("ok");
    expect((await post(rpc, { originLeadId: "1" }, "curto")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("JSON inválido, lista ou corpo grande: recusa sem chamar o banco", async () => {
    const rpc = banco("ok");
    expect((await post(rpc, "{x")).status).toBe(400);
    expect((await post(rpc, [{ originLeadId: "1" }])).status).toBe(400);
    expect((await post(rpc, { m: "a".repeat(GRUPO_OLX_MAX_BYTES) })).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("muitos tokens errados do mesmo IP -> 429", async () => {
    const ruim = banco("token");
    const ip = {
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.1" },
    };
    for (let i = 0; i < 30; i++) await post(ruim, { originLeadId: "1" }, TOKEN, ip);
    const bom = banco("ok");
    expect((await post(bom, { originLeadId: "1" }, TOKEN, ip)).status).toBe(429);
    expect(bom).not.toHaveBeenCalled();
  });

  it("LGPD: nada do cliente nem o token vai para o log", async () => {
    const comErro: RpcReceber = async () => ({ data: null, error: { code: "XX000" } });
    await post(comErro, {
      originLeadId: "1",
      name: "Fulano Teste",
      phone: "999998888",
      email: "f@t.co",
      message: "oi secreto",
    });
    const tudo = logs.join("\n");
    for (const s of ["Fulano", "999998888", "f@t.co", "secreto", TOKEN])
      expect(tudo).not.toContain(s);
  });

  it("todos os resultados do banco têm código HTTP", () => {
    for (const r of [...MIG.matchAll(/jsonb_build_object\('r', '([a-z_]+)'\)/g)].map((m) => m[1]))
      expect(STATUS_POR_RESULTADO).toHaveProperty(r);
  });
});

describe("tela", () => {
  it("URL do Canal Pro", () => {
    expect(urlGrupoOlx("https://app.somosmaxhub.com.br/", "abc")).toBe(
      "https://app.somosmaxhub.com.br/api/leads/grupo-olx/abc",
    );
  });
  it("origem nova só no rótulo, não no cadastro manual", () => {
    expect(ORIGENS).not.toContain("grupo_olx");
    expect(ORIGENS_TODAS).toContain("grupo_olx");
    expect(ORIGEM_LABEL.grupo_olx).toMatch(/Grupo ZAP/);
  });
  it("resumo do anúncio", () => {
    expect(
      resumoPortal({
        origem: "grupo_olx",
        anuncio_codigo: "a40171",
        anuncio_portal_id: "87027856",
        portal_tipo: "CONTACT_CHAT",
        portal_temperatura: "alta",
        portal_transacao: "venda",
      }),
    ).toBe("Anúncio a40171 · Chat · Venda · temperatura alta");
    expect(resumoPortal({ origem: "manual" })).toBe("");
  });
});

describe("migration 20261025170000", () => {
  it("CHECK de origem da migration = lista da tela", () => {
    const m = MIG.match(/ADD CONSTRAINT leads_origem_check\s+CHECK \(origem IN \(([^)]+)\)\)/);
    expect([...(m?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((x) => x[1])).toEqual([
      ...ORIGENS_TODAS,
    ]);
  });
  it("token só com hash, recepção só para service_role, hash ilegível pelo app", () => {
    expect(MIG).toMatch(
      /grupo_olx_token_hash = encode\(extensions\.digest\(_token, 'sha256'\), 'hex'\)/,
    );
    expect(MIG).toMatch(
      /REVOKE ALL ON FUNCTION public\.lead_grupo_olx_receber\(text, jsonb\) FROM PUBLIC, anon, authenticated/,
    );
    expect(MIG).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.lead_grupo_olx_receber\(text, jsonb\) TO service_role;/,
    );
    expect(MIG).toMatch(/REVOKE SELECT ON public\.lead_config FROM authenticated/);
    expect(MIG).toMatch(/a\.attname <> 'grupo_olx_token_hash'/);
    expect(MIG).not.toMatch(/extraData'->>'izi'|_x->>'izi'/);
  });
  it("entra por lead_inserir -> lead_distribuir e respeita o módulo", () => {
    expect(MIG).toMatch(/public\.lead_inserir\(_org, _nome, _tel, _mail, 'grupo_olx'/);
    expect(MIG).toMatch(/PERFORM public\.lead_distribuir\(_id, NULL, 'grupo zap', NULL\)/);
    expect(MIG).toMatch(/m\.module = 'leads'/);
  });
  it("nenhum envio externo na migration", () => {
    expect(MIG).not.toMatch(/net\.http|http_post|ziontalk|pg_net/i);
  });
  it("rollback desfaz o que a migration cria e para se houver lead real", () => {
    for (const f of [
      "lead_grupo_olx_token(text)",
      "lead_grupo_olx_receber(text, jsonb)",
      "lead_portal_captacao(uuid, text)",
      "lead_portal_limpar_mensagem(text)",
    ])
      expect(RB).toContain(`DROP FUNCTION IF EXISTS public.${f}`);
    expect(RB).toMatch(/DROP TABLE IF EXISTS public\.lead_portal_recebimentos/);
    expect(RB).toMatch(/RAISE EXCEPTION 'Existem leads do Grupo ZAP/);
    expect(RB).toMatch(/'outro'\)\);\s*COMMIT;/);
  });
});
