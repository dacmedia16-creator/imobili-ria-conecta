import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extrairLead, idDoLead, receberLeadC2s, STATUS_C2S, type RpcC2s } from "./leads-c2s.server";
import { ORIGEM_LABEL, ORIGENS, ORIGENS_TODAS, prazoDoLead, textoPrazo, type Lead } from "./leads";

// t_32f5458d (Denis 24/11/2026): C2S -> ADM, MESMO corretor do C2S, sem prazo de aceite, WhatsApp com 3 itens.
// O ensaio de ponta a ponta (migration + 8 cenários na ZZ Teste, desfeito por RAISE) fica fora do repo; aqui: o handler
// com banco simulado e as travas do texto da migration.
const MIG = readFileSync("supabase/migrations/20270102120000_leads_c2s.sql", "utf8");
const RB = readFileSync("docs/sql/rollback/20270102120000_leads_c2s.rollback.sql", "utf8");
const TOKEN = "A".repeat(43);
const fn = (nome: string) => {
  const i = MIG.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  expect(i, nome).toBeGreaterThanOrEqual(0);
  return MIG.slice(i, MIG.indexOf("$function$;", i) + 11);
};

const post = (
  rpc: RpcC2s,
  body: unknown,
  token = TOKEN,
  buscar?: (id: string) => Promise<Record<string, unknown> | null>,
) =>
  receberLeadC2s(
    new Request(`https://app/api/leads/c2s/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    token,
    rpc,
    buscar,
  );
const banco = (r: string): RpcC2s => vi.fn(async () => ({ data: { r }, error: null }));
const LEAD = {
  data: {
    id: "abc123",
    attributes: {
      created_at: "2026-11-24T10:00:00-03:00",
      customer: { name: "Cliente Fictício", phone: "5511900000001" },
      seller: { email: "corretor@example.com", name: "Corretor Fictício" },
      product: { prop_ref: "AP1", description: "[AP1] Apto" },
    },
    messages: [{ sender_type: "Customer", body: "Olá", created_at: "2026-11-24T10:00:00-03:00" }],
  },
};

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  for (const m of ["log", "error", "warn", "info"] as const)
    vi.spyOn(console, m).mockImplementation(
      (...a: unknown[]) => void logs.push(a.map(String).join(" ")),
    );
});

describe("handler do webhook C2S", () => {
  it("lead completo vai ao banco e o resultado vira o código HTTP", async () => {
    const rpc = banco("ok");
    const r = await post(rpc, LEAD);
    expect(r.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(TOKEN, LEAD.data);
    expect((await post(banco("duplicado"), LEAD)).status).toBe(200);
    expect((await post(banco("antigo"), LEAD)).status).toBe(200);
    expect((await post(banco("token"), LEAD)).status).toBe(401);
    expect((await post(banco("modulo"), LEAD)).status).toBe(404);
  });
  it("token fora do formato: 401 sem chamar o banco", async () => {
    const rpc = banco("ok");
    expect((await post(rpc, LEAD, "curto")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("corpo inválido: 400; erro do banco: 503 (o C2S reenvia)", async () => {
    expect((await post(banco("ok"), "não é json")).status).toBe(400);
    expect((await post(banco("ok"), [1, 2])).status).toBe(400);
    const erro: RpcC2s = vi.fn(async () => ({ data: null, error: { code: "XX000" } }));
    expect((await post(erro, LEAD)).status).toBe(503);
  });
  it("webhook só com o id: busca o lead completo no C2S", async () => {
    const rpc = banco("ok");
    const buscar = vi.fn(async () => LEAD as Record<string, unknown>);
    expect((await post(rpc, { id: "abc123" }, TOKEN, buscar)).status).toBe(200);
    expect(buscar).toHaveBeenCalledWith("abc123");
    expect(rpc).toHaveBeenCalledWith(TOKEN, LEAD.data);
    expect((await post(banco("ok"), { id: "abc123" })).status).toBe(400); // sem token do C2S no servidor
  });
  it("LGPD: nenhum log com nome, telefone, e-mail ou mensagem", async () => {
    await post(
      vi.fn(async () => ({ data: null, error: { code: "XX000" } })),
      LEAD,
    );
    await post(
      vi.fn(async () => {
        throw new Error("Cliente Fictício 5511900000001");
      }),
      LEAD,
    );
    const tudo = logs.join("\n");
    for (const pii of ["Cliente Fictício", "5511900000001", "corretor@example.com", "Olá", TOKEN])
      expect(tudo).not.toContain(pii);
  });
  it("extrai lead de {data}, {lead} ou direto; id só com caracteres seguros", () => {
    expect(extrairLead({ data: { id: 1 } })).toEqual({ id: 1 });
    expect(extrairLead({ lead: { id: 2 } })).toEqual({ id: 2 });
    expect(extrairLead({ id: 3 })).toEqual({ id: 3 });
    expect(idDoLead({ id: "a1b2" })).toBe("a1b2");
    expect(idDoLead({ id: "../x" })).toBeNull();
    expect(Object.keys(STATUS_C2S)).toContain("antigo");
  });
});

describe("regra 1 — mesmo corretor do C2S (Denis 24/11)", () => {
  it("casa por e-mail e depois por nome único; senão o responsável padrão, registrado no evento", () => {
    const r = fn("lead_c2s_responsavel");
    expect(r).toMatch(/lower\(u\.email\) = _e AND public\.lead_pode_ser_responsavel/);
    expect(r).toMatch(/cardinality\(_ids\) = 1/);
    const rec = fn("lead_c2s_receber");
    expect(rec).toMatch(/lead_c2s_responsavel\(_c\.organization_id, _s->>'email', _s->>'name'\)/);
    expect(rec).toMatch(/_resp := _c\.ia_corretor_passagem_id/);
    expect(rec).toMatch(/sem correspondência no ADM/);
  });
  it("não usa rodízio nem captador", () => {
    const rec = fn("lead_c2s_receber");
    expect(rec).not.toMatch(
      /lead_distribuir\(|lead_rodizio_proximo\(|captador_id|lead_portal_captacao\(/,
    );
  });
});

describe("regra 2 — sem prazo de aceite; fica com o corretor até ser arquivado", () => {
  it("lead do C2S entra aceito e marcado sem_prazo", () => {
    expect(fn("lead_c2s_receber")).toMatch(/sem_prazo = true/);
    expect(fn("lead_c2s_receber")).toMatch(
      /aceito_em = CASE WHEN _resp IS NOT NULL THEN now\(\) END/,
    );
  });
  it("os 3 prazos por tempo ignoram lead sem_prazo", () => {
    const p = fn("leads_processar_prazos");
    expect(p.match(/NOT l\.sem_prazo AND/g)?.length).toBe(3);
  });
  it("transferência manual mantém sem prazo (já aceito pelo novo corretor)", () => {
    expect(fn("lead_atribuir")).toMatch(/aceito_em = CASE WHEN _l\.sem_prazo THEN now\(\) END/);
  });
  it("tela: lead sem prazo não mostra prazo nenhum", () => {
    const l = {
      etapa: "novo",
      responsavel_id: "u",
      sem_prazo: true,
      aceito_em: null,
      created_at: "2026-01-01",
    } as unknown as Lead;
    const c = {
      prazo_aceite_min: 30,
      prazo_primeira_interacao_dias: 7,
      prazo_sem_interacao_dias: 30,
    } as never;
    expect(prazoDoLead(l, c)).toEqual({ tipo: "sem_prazo" });
    expect(textoPrazo(prazoDoLead(l, c))).toBeNull();
  });
});

describe("regra 3 — WhatsApp ao corretor com telefone, imóvel e histórico", () => {
  it("texto tem os 3 itens numa mensagem", () => {
    const t = fn("lead_c2s_aviso_texto");
    expect(t).toMatch(/'Telefone: ' \|\| coalesce\(public\.lead_aviso_telefone_txt\(l\.telefone\)/);
    expect(t).toMatch(/'Imóvel: '/);
    expect(t).toMatch(/'Histórico: '/);
  });
  it("sai na chegada e na transferência manual, com chave própria (sem depender da Nicole)", () => {
    expect(fn("lead_c2s_receber")).toMatch(/IF _c\.c2s_aviso_whats THEN[\s\S]*'c2s'/);
    expect(fn("lead_atribuir")).toMatch(/'transferencia'/);
    const r = fn("lead_avisos_corretor_reservar");
    expect(r).toMatch(/a\.evento IN \('c2s', 'transferencia'\) AND c\.c2s_aviso_whats/);
    expect(r).toMatch(/lead_c2s_aviso_texto\(_a\.lead_id, _a\.evento = 'transferencia'\)/);
    expect(MIG).toMatch(/'c2s', 'transferencia'\)\)/);
  });
  it("Nicole/aquecimento intocados: a migration não liga ia_* nem aquecer_*", () => {
    expect(MIG).not.toMatch(
      /SET[^;]*\b(ia_ativa|aquecer_ativo|ia_aviso_corretor_whats)\s*=\s*true/i,
    );
  });
});

describe("só leads novos, tudo desligado, permissões e rollback", () => {
  it("lead criado antes de c2s_desde não entra (sem estoque antigo)", () => {
    expect(fn("lead_c2s_receber")).toMatch(
      /IF _criado < _c\.c2s_desde THEN RETURN jsonb_build_object\('r', 'antigo'\)/,
    );
  });
  it("nasce desligado: sem token não entra; aviso default false", () => {
    expect(MIG).toMatch(/c2s_aviso_whats boolean NOT NULL DEFAULT false/);
    expect(fn("lead_c2s_receber")).toMatch(
      /c2s_token_hash = encode\(extensions\.digest\(_token, 'sha256'\), 'hex'\)/,
    );
  });
  it("funções novas só para o servidor", () => {
    for (const n of [
      "lead_c2s_receber(text, jsonb)",
      "lead_c2s_token_gerar(uuid, timestamptz)",
      "lead_c2s_desligar(uuid)",
    ]) {
      expect(MIG).toContain(`REVOKE ALL ON FUNCTION public.${n} FROM PUBLIC, anon, authenticated;`);
      expect(MIG).toContain(`GRANT EXECUTE ON FUNCTION public.${n} TO service_role;`);
    }
  });
  it("origem C2S aparece na tela", () => {
    expect(ORIGENS_TODAS).toContain("c2s");
    expect(ORIGENS).not.toContain("c2s"); // não entra no cadastro manual
    expect(ORIGEM_LABEL.c2s).toBe("C2S");
  });
  it("rollback desfaz funções e colunas", () => {
    expect(RB).toMatch(/DROP FUNCTION IF EXISTS public\.lead_c2s_receber/);
    expect(RB).toMatch(/DROP COLUMN IF EXISTS sem_prazo/);
    expect(RB).toMatch(/DROP COLUMN IF EXISTS c2s_token_hash/);
  });
});
