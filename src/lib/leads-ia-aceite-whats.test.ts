import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _zerarFalhasRetorno,
  receberRetornoZionTalk,
  responderCorretor,
  type DepsRetorno,
  type RespostaBanco,
} from "./leads-ia-retorno.server";

// t_63c55cee (Denis 31/10): corretor aceita o lead respondendo "ACEITO <código>" no WhatsApp da Nicole.
// O banco foi ensaiado em produção dentro de transação desfeita (14 casos: lista, código inválido, "não aceito",
// aceite com código, duplicado, já aceito, expirado, único pendente, número desconhecido, admin-cliente de teste,
// zero mensagens/conversas/leads/eventos de cliente criados). Aqui: texto da migration e o handler simulado.
const MIG = readFileSync("supabase/migrations/20261031030000_leads_ia_aceite_whats.sql", "utf8");
const RB = readFileSync(
  "docs/sql/rollback/20261031030000_leads_ia_aceite_whats.rollback.sql",
  "utf8",
);
const ENV = { LEADS_IA_ENVIO_REAL: "on", ZIONTALK_LEADS_IA_API_KEY: "k" };
const TOKEN = "T".repeat(43);
const TEL = "5515999997268";
const fn = (nome: string, args = "(") => {
  const i = MIG.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}${args}`);
  expect(i, nome).toBeGreaterThanOrEqual(0);
  return MIG.slice(i, MIG.indexOf("END $function$", i) + 20);
};

describe("migration: aceite pelo WhatsApp", () => {
  it("chave nasce desligada e só vale junto com o aviso ao corretor (rollback da liberação desliga)", () => {
    expect(MIG).toMatch(/ia_aceite_whats boolean NOT NULL DEFAULT false/);
    const r = fn("lead_ia_retorno_receber");
    expect(r).toMatch(/IF _c\.ia_aceite_whats AND _c\.ia_aviso_corretor_whats THEN/);
  });
  it("corretor é desviado ANTES do fluxo de cliente (sem conversa, sem IA, sem limites)", () => {
    const r = fn("lead_ia_retorno_receber");
    const desvio = r.indexOf("public.lead_aceite_whats_receber(");
    expect(desvio).toBeGreaterThan(0);
    expect(desvio).toBeLessThan(r.indexOf("INSERT INTO public.lead_ia_retorno_eventos"));
    expect(desvio).toBeLessThan(r.indexOf("lead_ia_registrar_cliente"));
    expect(r).toMatch(/IF _ace IS NOT NULL THEN RETURN _ace; END IF;/);
  });
  it("corretor = telefone do cadastro + pode ser responsável + é o da passagem ou já recebeu passagem", () => {
    const f = fn("lead_aceite_whats_receber");
    expect(f).toMatch(/\(public\.lead_ia_contatos\(p\.telefone, NULL\)\)\[1\] = _chave/);
    expect(f).toMatch(/public\.lead_pode_ser_responsavel\(p\.id, _org\)/);
    expect(f).toMatch(/p\.id = _c\.ia_corretor_passagem_id/);
    expect(f).toMatch(/IF coalesce\(_n, 0\) = 0 THEN RETURN NULL; END IF;/);
    expect(f).toMatch(/_acao := 'ambiguo'/); // 2 cadastros com o mesmo telefone: não aceita nada
  });
  it("aceite usa a MESMA função do botão (lead_aceitar) com a identidade do corretor e marca a nota", () => {
    const f = fn("lead_aceite_whats_receber");
    expect(f).toMatch(/PERFORM public\.lead_aceitar\(_l\.id\);/);
    expect(f).toMatch(
      /set_config\('request\.jwt\.claims', jsonb_build_object\('sub', _u, 'role', 'authenticated'\)::text, true\)/,
    );
    expect(f).toMatch(/set_config\('request\.jwt\.claims', coalesce\(_old, ''\), true\)/);
    expect(f).toMatch(/nota = 'aceito pelo WhatsApp'/);
  });
  it("só aceita lead passado pela IA para AQUELE corretor, ainda dele, sem aceite, aberto e no prazo", () => {
    const p = fn("lead_aceite_pendente");
    expect(p).toMatch(/_l\.responsavel_id = _user AND _l\.aceito_em IS NULL/);
    expect(p).toMatch(/_l\.etapa NOT IN \('ganho', 'perdido'\) AND _l\.no_banco_desde IS NULL/);
    expect(p).toMatch(/make_interval\(mins => .*prazo_aceite_min/);
    expect(p).toMatch(/a\.user_id = _user AND a\.evento IN \('passagem', 'reenvio'\)/);
    const f = fn("lead_aceite_whats_receber");
    expect(f).toMatch(/k\.user_id = _u AND k\.organization_id = _org AND k\.codigo = _cod/); // código é por corretor
    expect(f).toMatch(
      /ELSIF NOT public\.lead_aceite_pendente\(_l, _u\) THEN\s+_acao := 'expirado'/,
    );
  });
  it("sem código: 1 pendente aceita; 2+ lista e não aceita nada", () => {
    const f = fn("lead_aceite_whats_receber");
    expect(f).toMatch(/ELSIF _np = 1 THEN\s+_lead := _unico;/);
    expect(f).toMatch(/_acao := 'lista';[\s\S]*Nenhum foi aceito ainda\./);
  });
  it("frases: aceito/aceita/ok aceito + código; 'não aceito' e nome nunca contam", () => {
    const p = fn("lead_aceite_whats_parse");
    expect(p).toMatch(/public\.lead_ia_norm/); // sem acento, minúsculas
    expect(p).toMatch(/\^\(\?:\(\?:ok\|/); // ancorado no começo: "não aceito" não casa
    expect(p).toMatch(/\(\?:aceito\|aceita\|aceitar\|aceitei\|aceite\)/);
    expect(p).toMatch(/\(\[0-9\]\{1,8\}\)\)\?\$/); // só código numérico até o fim
  });
  it("idempotente: 1 linha por mensagem (hash do id); sem telefone nem texto no registro", () => {
    expect(MIG).toMatch(/UNIQUE \(organization_id, externo_hash\)/);
    expect(fn("lead_aceite_whats_receber")).toMatch(
      /ON CONFLICT \(organization_id, externo_hash\) DO NOTHING RETURNING id INTO _ev;\s+IF _ev IS NULL THEN RETURN jsonb_build_object\('r', 'duplicado'\)/,
    );
    const tabela = MIG.slice(MIG.indexOf("CREATE TABLE IF NOT EXISTS public.lead_aceite_whats ("));
    expect(tabela.slice(0, tabela.indexOf(");"))).not.toMatch(/telefone|texto/);
  });
  it("aviso ganha 'Para aceitar, responda: ACEITO <código>' só com a chave ligada e lead pendente", () => {
    const t = fn("lead_aviso_corretor_texto", "(_lead uuid, _reenvio boolean, _codigo integer)");
    expect(t).toMatch(/'Para aceitar, responda: ACEITO ' \|\| _codigo/);
    expect(t).toMatch(/ELSE 'Aceite no ADM em Meus leads em até '/); // sem código = texto de antes
    const r = fn("lead_avisos_corretor_reservar");
    expect(r).toMatch(
      /IF _a\.aceite THEN[\s\S]*IF public\.lead_aceite_pendente\(_l, _a\.user_id\) THEN/,
    );
    expect(r).toMatch(/c\.ia_aviso_corretor_whats AND c\.ia_ativa/);
  });
  it("número desconhecido pedindo aceite: resposta curta limitada a 5 por hora", () => {
    const r = fn("lead_ia_retorno_receber");
    expect(r).toMatch(
      /acao = 'nao_corretor' AND w\.created_at > now\(\) - interval '1 hour'\) < 5/,
    );
    expect(r).toMatch(/Este número não está no cadastro de corretores/);
  });
  it("tudo só para o servidor (service_role); tabelas com RLS e sem acesso do navegador", () => {
    for (const t of ["lead_aceite_codigos", "lead_aceite_whats"]) {
      expect(MIG).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(MIG).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
    }
    for (const n of [
      "lead_aceite_whats_parse(text)",
      "lead_aceite_codigo(uuid, uuid, uuid)",
      "lead_aceite_pendente(public.leads, uuid)",
      "lead_aceite_lista(uuid, uuid)",
      "lead_aceite_whats_receber(public.lead_config, text, text, text)",
      "lead_aceite_whats_resultado(uuid, boolean)",
      "lead_aviso_corretor_texto(uuid, boolean, integer)",
      "lead_ia_retorno_receber(text, jsonb)",
    ]) {
      expect(MIG).toContain(`REVOKE ALL ON FUNCTION public.${n} FROM PUBLIC, anon, authenticated;`);
      expect(MIG).toContain(`GRANT EXECUTE ON FUNCTION public.${n} TO service_role;`);
    }
  });
  it("rollback: 1 passo desliga a chave da ZZ", () => {
    expect(RB).toMatch(/SET ia_aceite_whats = false/);
    expect(RB).toMatch(/eb0a260a-db2f-4cbf-b031-f0c2aebb407c/);
  });
});

function deps(banco: RespostaBanco, extra: Partial<DepsRetorno> = {}) {
  const zion = vi.fn(async () => new Response("", { status: 201 }));
  const d: DepsRetorno = {
    receber: vi.fn(async () => ({ data: banco, error: null })),
    aplicar: vi.fn(async () => ({ data: null, error: null })),
    reservar: vi.fn(async () => ({ data: [], error: null })),
    resultado: vi.fn(async () => undefined),
    registrarUso: vi.fn(async () => undefined),
    aceiteResultado: vi.fn(async () => undefined),
    historico: vi.fn(async () => []),
    env: ENV,
    fetchFn: zion as unknown as typeof fetch,
    esperar: async () => undefined,
    ...extra,
  };
  return { d, zion };
}
const req = (texto: string) =>
  new Request(`https://x/api/leads/ziontalk/${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contato: { telefone: TEL },
      mensagem: { id: "wamid.1", tipo: "texto", texto },
    }),
  });

describe("servidor: resposta ao corretor", () => {
  afterEach(() => {
    _zerarFalhasRetorno();
    vi.restoreAllMocks();
  });

  it("corretor aceitou: envia só a confirmação, marca enviada e não chama a IA nem o envio de cliente", async () => {
    const { d, zion } = deps({
      r: "corretor",
      resposta_id: "r1",
      resposta: "Lead Daniela aceito ✅",
    });
    const res = await receberRetornoZionTalk(req("ACEITO 8958"), TOKEN, d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ r: "corretor" });
    expect(zion).toHaveBeenCalledTimes(1);
    const body = new URLSearchParams(
      String((zion.mock.calls[0] as unknown[] as [string, RequestInit])[1].body),
    );
    expect(body.get("msg")).toBe("Lead Daniela aceito ✅");
    expect(body.get("mobile_phone")).toBe(`+${TEL}`);
    expect(d.aceiteResultado).toHaveBeenCalledWith("r1", true);
    expect(d.aplicar).not.toHaveBeenCalled();
    expect(d.reservar).not.toHaveBeenCalled();
    expect(d.registrarUso).not.toHaveBeenCalled();
  });

  it("corretor sem resposta (conversa repetida): nada sai", async () => {
    const { d, zion } = deps({ r: "corretor", resposta_id: null, resposta: null });
    const res = await receberRetornoZionTalk(req("boa noite"), TOKEN, d);
    expect(res.status).toBe(200);
    expect(zion).not.toHaveBeenCalled();
    expect(d.aplicar).not.toHaveBeenCalled();
  });

  it("duplicado (reenvio da ZionTalk): nada sai", async () => {
    const { d, zion } = deps({ r: "duplicado" });
    await receberRetornoZionTalk(req("ACEITO 8958"), TOKEN, d);
    expect(zion).not.toHaveBeenCalled();
  });

  it("número desconhecido pedindo aceite: resposta curta; sem resposta do banco, nada sai", async () => {
    const a = deps({
      r: "desconhecido",
      resposta_id: "r9",
      resposta: "Este número não está no cadastro",
    });
    await receberRetornoZionTalk(req("aceito 1234"), TOKEN, a.d);
    expect(a.zion).toHaveBeenCalledTimes(1);
    const b = deps({ r: "desconhecido" });
    await receberRetornoZionTalk(req("oi"), TOKEN, b.d);
    expect(b.zion).not.toHaveBeenCalled();
  });

  it("envio desligado: não chama a ZionTalk", async () => {
    const { d, zion } = deps(
      { r: "corretor", resposta_id: "r1", resposta: "Lead aceito ✅" },
      { env: {} },
    );
    await receberRetornoZionTalk(req("ACEITO"), TOKEN, d);
    expect(zion).not.toHaveBeenCalled();
    expect(d.aceiteResultado).not.toHaveBeenCalled();
  });

  it("falha no envio: marca falhou, não repete e o log não tem telefone nem texto", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFn = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const aceiteResultado = vi.fn(async () => undefined);
    const ok = await responderCorretor(TEL, "r1", "Lead Daniela aceito ✅", {
      env: ENV,
      fetchFn,
      aceiteResultado,
    });
    expect(ok).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(aceiteResultado).toHaveBeenCalledWith("r1", false);
    const log = JSON.stringify(err.mock.calls);
    expect(log).not.toContain(TEL);
    expect(log).not.toContain("7268");
    expect(log).not.toContain("Daniela");
  });
});
