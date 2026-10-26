import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _zerarFalhasRetorno,
  normalizarZionTalk,
  receberReengajar,
  receberRetornoZionTalk,
  RETORNO_MAX_BYTES,
  type DepsRetorno,
  type RespostaBanco,
} from "./leads-ia-retorno.server";
import { chamarOpenRouter, mascararContato, montarExtrator, OPENROUTER_URL, type UsoModelo } from "./leads-ia-modelo";
import { respostaMidia, type ContextoIa } from "./leads-ia";
import { urlRetornoZionTalk } from "./leads";

// Card t_6f688b4b. O banco (token, dedup, lista de liberados, SAIR, limites, isolamento) foi testado em
// PostgreSQL descartável com 2 imobiliárias (scripts/leads-ia-test/test_retorno.sql). Aqui: o handler com o
// banco, a ZionTalk e os modelos SIMULADOS (nenhuma rede real).
const MIG = readFileSync("supabase/migrations/20261025200000_leads_ia_retorno_ziontalk.sql", "utf8");
const RB = readFileSync("docs/sql/rollback/20261025200000_leads_ia_retorno_ziontalk.rollback.sql", "utf8");
const SRV = readFileSync("src/lib/leads-ia-retorno.server.ts", "utf8");
const MOD = readFileSync("src/lib/leads-ia-modelo.ts", "utf8");
const TOKEN = "T".repeat(43);
/** Argumento da 1ª chamada de um mock (sem brigar com o tipo da tupla vazia). */
const arg = (m: { mock: { calls: unknown[] } }, i: number) => (m.mock.calls[0] as unknown[])[i];
const TEL = "5515981110001";

const ctx: ContextoIa = {
  conversa_id: "cv",
  estado: "ativa",
  versao: 1,
  passo: "interesse",
  dados: {},
  ia_nome: "Emanuella",
  lead_nome: "Denis",
  imovel: null,
};

const payload = (p: Record<string, unknown> = {}) => ({
  evento: "mensagem_recebida",

  contato: { nome: "Denis", telefone: TEL },
  mensagem: { id: "wamid.ABC123", tipo: "texto", texto: "Sim, tenho interesse" },
  ...p,
});

function deps(banco: Partial<RespostaBanco> | RespostaBanco, extra: Partial<DepsRetorno> = {}) {
  const aplicar = vi.fn(async () => ({ data: { ok: true }, error: null }));
  let fila = [{ msg_id: "m1", telefone: TEL, texto: "Você procura para comprar ou para alugar?", primeira: false }];
  const reservar = vi.fn(async () => {
    const d = fila;
    fila = [];
    return { data: d, error: null };
  });
  const resultado = vi.fn(async () => undefined);
  const registrarUso = vi.fn(async () => undefined);
  const receber = vi.fn(async () => ({ data: banco, error: null }));
  const zion = vi.fn(async () => new Response("", { status: 201 }));
  const d: DepsRetorno = {
    receber,
    aplicar,
    reservar,
    resultado,
    registrarUso,
    env: {},
    fetchFn: zion as unknown as typeof fetch,
    esperar: vi.fn(async () => undefined),
    rand: () => 0.5,
    ...extra,
  };
  return { d, aplicar, reservar, resultado, registrarUso, receber, zion };
}

const post = (d: DepsRetorno, body: unknown = payload(), token = TOKEN, ct = "application/json") =>
  receberRetornoZionTalk(
    new Request(`https://app/api/leads/ziontalk/${token}`, {
      method: "POST",
      headers: { "content-type": ct },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    token,
    d,
  );

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  _zerarFalhasRetorno();
  for (const m of ["log", "error", "warn", "info"] as const)
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

describe("normalizar payload da ZionTalk", () => {
  it("formato ZionTalk (contato/mensagem)", () => {
    const m = normalizarZionTalk(payload(), "x")!;
    expect(m).toMatchObject({ id: "wamid.ABC123", telefone: TEL, texto: "Sim, tenho interesse", tipo: "texto" });
    expect(m.grupo || m.status || m.proprio).toBe(false);
  });
  it("grupo, status e próprio número", () => {
    expect(normalizarZionTalk({ ...payload(), key: { remoteJid: "1203@g.us" } }, "x")!.grupo).toBe(true);
    expect(normalizarZionTalk({ ...payload(), is_group: true }, "x")!.grupo).toBe(true);
    expect(normalizarZionTalk({ ...payload(), key: { remoteJid: "status@broadcast" } }, "x")!.status).toBe(true);
    expect(normalizarZionTalk({ ...payload(), evento: "mensagem_entregue" }, "x")!.status).toBe(true);
    expect(normalizarZionTalk({ ...payload(), fromMe: true }, "x")!.proprio).toBe(true);
    expect(normalizarZionTalk({ ...payload(), mensagem: { texto: "oi", direcao: "saida" } }, "x")!.proprio).toBe(true);
    expect(normalizarZionTalk({ ...payload(), mensagem: { texto: "oi", direcao: "entrada" } }, "x")!.proprio).toBe(false);
    expect(normalizarZionTalk({ ...payload(), direcao: "saida" }, "x")!.proprio).toBe(true);
  });
  it("áudio/arquivo sem texto vira mídia", () => {
    const m = normalizarZionTalk({ ...payload(), mensagem: { tipo: "audio", arquivo_url: "https://x/a.ogg" } }, "x")!;
    expect(m.tipo).toBe("midia");
    expect(m.texto).toBe("");
  });
  it("sem id: id estável pelo corpo (reenvio idêntico = mesmo id)", () => {
    const p = { contato: { telefone: TEL }, mensagem: { texto: "oi" } };
    const a = normalizarZionTalk(p, JSON.stringify(p))!.id;
    expect(a).toMatch(/^h:/);
    expect(normalizarZionTalk(p, JSON.stringify(p))!.id).toBe(a);
    expect(normalizarZionTalk(p, JSON.stringify({ ...p, x: 1 }))!.id).not.toBe(a);
  });
});

describe("retorno: autenticação e recusas", () => {
  it("token mal formado: 401 sem chamar o banco", async () => {
    const { d, receber } = deps({ r: "ok" });
    expect((await post(d, payload(), "curto")).status).toBe(401);
    expect(receber).not.toHaveBeenCalled();
  });
  it.each([
    ["token", 401],
    ["desligada", 403],
    ["duplicado", 200],
    ["ignorado", 200],
    ["fora_lista", 200],
    ["desconhecido", 200],
  ] as const)("banco %s -> %i e não responde nem envia", async (r, st) => {
    const { d, aplicar, zion } = deps({ r }, { env: { LEADS_IA_ENVIO_REAL: "on", ZIONTALK_LEADS_IA_API_KEY: "k" } });
    expect((await post(d)).status).toBe(st);
    expect(aplicar).not.toHaveBeenCalled();
    expect(zion).not.toHaveBeenCalled();
  });
  it("erro do banco -> 503 (reenvio é seguro por causa do dedup)", async () => {
    const d = deps({ r: "ok" }).d;
    d.receber = async () => ({ data: null, error: { code: "XX000" } });
    expect((await post(d)).status).toBe(503);
  });
  it("corpo grande demais -> 413", async () => {
    const { d } = deps({ r: "ok" });
    expect((await post(d, "x".repeat(RETORNO_MAX_BYTES + 1))).status).toBe(413);
  });
  it("método diferente de POST -> 405", async () => {
    const { d } = deps({ r: "ok" });
    const r = await receberRetornoZionTalk(new Request("https://app/x", { method: "GET" }), TOKEN, d);
    expect(r.status).toBe(405);
  });
  it("muitos tokens errados do mesmo IP -> 429", async () => {
    const { d } = deps({ r: "token" });
    const req = () =>
      receberRetornoZionTalk(
        new Request("https://app/x", { method: "POST", headers: { "cf-connecting-ip": "1.2.3.4" }, body: "{}" }),
        TOKEN,
        d,
      );
    for (let i = 0; i < 30; i++) await req();
    expect((await req()).status).toBe(429);
  });
  it("aceita formulário (contato[telefone]=...)", async () => {
    const { d, receber } = deps({ r: "ignorado" });
    const body = new URLSearchParams({ "contato[telefone]": TEL, "mensagem[texto]": "oi", "mensagem[id]": "f1", "__proto__[fromMe]": "1" }).toString();
    await post(d, body, TOKEN, "application/x-www-form-urlencoded");
    expect(({} as Record<string, unknown>).fromMe).toBeUndefined();
    expect(arg(receber, 1)).toMatchObject({ telefone: TEL, texto: "oi", id: "f1" });
  });
});

describe("retorno: resposta e envio", () => {
  const ok: RespostaBanco = { r: "ok", responder: true, lead_id: "l1", tipo: "texto", organization_id: "o1", ctx };

  it("envio desligado: responde no banco, nada sai pela ZionTalk", async () => {
    const { d, aplicar, zion, reservar } = deps(ok);
    expect((await post(d)).status).toBe(200);
    expect(aplicar).toHaveBeenCalledOnce();
    // Sem captação e sem código do portal: pede o código do anúncio UMA vez (t_fc4d9b27, item 7).
    expect(arg(aplicar, 0)).toMatchObject({ _conversa: "cv", _versao: 1, _passo: "codigo" });
    expect(reservar).not.toHaveBeenCalled();
    expect(zion).not.toHaveBeenCalled();
  });

  it("roteiro novo: com código do portal e venda, não pede código nem finalidade; manda o texto de falha", async () => {
    const novo: RespostaBanco = {
      ...ok,
      ctx: { ...ctx, transacao: "venda", anuncio_codigo: "2712345678", tem_captacao: true, imovel_frase: "o apartamento do bairro Campolim" },
    };
    const { d, aplicar } = deps(novo, { env: {} });
    await post(d, payload({ mensagem: { id: "wamid.X", tipo: "texto", texto: "quero falar com um corretor" } }));
    const a = arg(aplicar, 0) as Record<string, unknown>;
    expect(a._fim).toBe("pediu_pessoa");
    expect(a._resposta).toContain("{corretor}");
    expect(String(a._resposta_falha)).toMatch(/estou confirmando/);
    expect(String(a._resposta_falha)).not.toMatch(/Encaminhei/);
    const { d: d2, aplicar: ap2 } = deps(novo);
    await post(d2);
    expect(arg(ap2, 0)).toMatchObject({ _passo: "faixa", _resposta_falha: null });
  });

  it("envio ligado: espera humana, responde e envia 1 mensagem pela ZionTalk (fetch falso)", async () => {
    const esperar = vi.fn(async () => undefined);
    const { d, zion, resultado } = deps(ok, {
      esperar,
      env: { LEADS_IA_ENVIO_REAL: "on", ZIONTALK_LEADS_IA_API_KEY: "chave-falsa" },
    });
    await post(d);
    expect(esperar).toHaveBeenCalledWith(4000);
    expect(zion).toHaveBeenCalledOnce();
    expect(String(arg(zion, 0))).toBe("https://app.ziontalk.com/api/send_message/");
    expect(resultado).toHaveBeenCalledWith("m1", true);
  });

  it("falha da ZionTalk: marca falhou e não repete", async () => {
    const { d, resultado, zion } = deps(ok, {
      env: { LEADS_IA_ENVIO_REAL: "on", ZIONTALK_LEADS_IA_API_KEY: "k" },
      fetchFn: vi.fn(async () => new Response("erro", { status: 401 })) as unknown as typeof fetch,
    });
    await post(d);
    expect(resultado).toHaveBeenCalledWith("m1", false);
    expect(zion).not.toHaveBeenCalled();
  });

  it("banco diz não responder (SAIR, limite, passada): só envia o que estiver pendente", async () => {
    const { d, aplicar } = deps({ r: "ok", responder: false, lead_id: "l1" });
    await post(d);
    expect(aplicar).not.toHaveBeenCalled();
  });

  it("mídia: pede texto, sem chamar modelo", async () => {
    const f = vi.fn();
    const { d, aplicar } = deps(
      { ...ok, tipo: "midia" },
      { env: { LEADS_IA_MODELO: "gemini", GEMINI_API_KEY: "g" }, fetchFn: f as unknown as typeof fetch },
    );
    await post(d, payload({ mensagem: { tipo: "audio", arquivo_url: "https://x/a.ogg" } }));
    expect(f).not.toHaveBeenCalled();
    expect(String((arg(aplicar, 0) as Record<string, unknown>)._resposta)).toContain("só consigo ler mensagens escritas");
  });

  it("2ª mídia passa ao corretor", () => {
    const r = respostaMidia({ ...ctx, dados: { midias: 1 } });
    expect(r.fim).toBe("pediu_pessoa");
  });

  it("usa o waitUntil quando existe (responde rápido à ZionTalk)", async () => {
    const pend: Promise<unknown>[] = [];
    const { d } = deps(ok, { emSegundoPlano: (p) => void pend.push(p) });
    expect((await post(d)).status).toBe(200);
    expect(pend).toHaveLength(1);
    await Promise.all(pend);
  });

  it("LGPD: nada de telefone, texto ou token nos logs", async () => {
    const { d } = deps(ok, {
      env: { LEADS_IA_ENVIO_REAL: "on", ZIONTALK_LEADS_IA_API_KEY: "k" },
      fetchFn: vi.fn(async () => new Response("erro com 15981110001", { status: 500 })) as unknown as typeof fetch,
    });
    await post(d);
    d.receber = async () => ({ data: null, error: { code: "XX000" } });
    await post(d);
    const tudo = logs.join("\n");
    expect(tudo).not.toMatch(/981110001|interesse|TTTTTTTT|comprar ou alugar/);
  });
});

describe("modelos: OpenRouter com plano B no Gemini", () => {
  const resOr = (conteudo: string, custo = 0.00002) =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: conteudo } }],
        usage: { prompt_tokens: 90, completion_tokens: 8, cost: custo },
      }),
    );
  const resGemini = (t: string) =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: t }] } }],
        usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 8 },
      }),
    );

  it("OpenRouter: pede só provedores sem coleta/retenção e não manda telefone/e-mail", async () => {
    const f = vi.fn(async () => resOr('{"finalidade":"comprar"}'));
    const r = await chamarOpenRouter("k", "anthropic/claude-haiku-5.5", "finalidade", "quero comprar, meu zap 15 98111-0001 e a@b.com", f as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: true, dados: { finalidade: "comprar" }, tokens_entrada: 90, custo_usd: 0.00002 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENROUTER_URL);
    const body = JSON.parse(String(init.body));
    expect(body.provider).toMatchObject({ data_collection: "deny", zdr: true });
    expect(body.model).toBe("anthropic/claude-haiku-5.5");
    expect(JSON.stringify(body)).not.toMatch(/98111|a@b\.com/);
    expect(body.messages).toHaveLength(2); // só instrução + última fala do cliente
  });

  it("crédito esgotado (402) no OpenRouter -> cai para o Gemini e registra os dois usos", async () => {
    const f = vi.fn(async (u: string) =>
      u === OPENROUTER_URL ? new Response('{"error":{"code":402}}', { status: 402 }) : resGemini('{"finalidade":"alugar"}'),
    );
    const usos: UsoModelo[] = [];
    const ex = montarExtrator(
      { provedor: "openrouter", modelo: "openai/gpt-6-luna" },
      { OPENROUTER_API_KEY: "or", LEADS_IA_MODELO: "gemini", GEMINI_API_KEY: "g" },
      (u) => usos.push(u),
      f as unknown as typeof fetch,
    )!;
    expect(await ex("finalidade", "acho que alugar")).toEqual({ finalidade: "alugar" });
    expect(usos.map((u) => [u.provedor, u.ok, u.fallback, u.erro])).toEqual([
      ["openrouter", false, false, "http_402"],
      ["gemini", true, true, null],
    ]);
    expect(usos[1].custo_usd).toBeGreaterThan(0);
  });

  it("tudo fora do ar -> sem dado (o roteiro segue só com regras; o cliente recebe resposta)", async () => {
    const f = vi.fn(async () => {
      throw new Error("rede");
    });
    const ex = montarExtrator(
      { provedor: "openrouter", modelo: "x-ai/grok-4.7" },
      { OPENROUTER_API_KEY: "or", LEADS_IA_MODELO: "gemini", GEMINI_API_KEY: "g" },
      () => undefined,
      f as unknown as typeof fetch,
    )!;
    expect(await ex("finalidade", "talvez")).toBeNull();
  });

  it("OpenRouter escolhido mas SEM chave: usa o Gemini (OpenRouter desligado por padrão)", async () => {
    const f = vi.fn(async () => resGemini('{"finalidade":"comprar"}'));
    const usos: UsoModelo[] = [];
    const ex = montarExtrator(
      { provedor: "openrouter", modelo: "openai/gpt-6-luna" },
      { LEADS_IA_MODELO: "gemini", GEMINI_API_KEY: "g" },
      (u) => usos.push(u),
      f as unknown as typeof fetch,
    )!;
    await ex("finalidade", "x");
    expect(usos.map((u) => u.provedor)).toEqual(["gemini"]);
    expect(String(arg(f, 0))).not.toContain("openrouter");
  });

  it("sem nenhuma chave: sem modelo (só regras)", () => {
    expect(montarExtrator({ provedor: "openrouter", modelo: "a/b" }, {}, () => undefined)).toBeUndefined();
  });

  it("mascara contato antes de mandar a qualquer modelo", () => {
    expect(mascararContato("me liga 15 98111-0001 ou a@b.com")).toBe("me liga [número] ou [e-mail]");
  });
});

describe("travas no código e na migration", () => {
  it("URL do retorno", () => {
    expect(urlRetornoZionTalk("https://app.x/", "abc")).toBe("https://app.x/api/leads/ziontalk/abc");
  });
  it("migration: só hash, recusa sem gravar, dedup, permissões", () => {
    expect(MIG).toMatch(/ia_retorno_token_hash text/);
    expect(MIG).toMatch(/digest\(_token, 'sha256'\)/);
    expect(MIG).toMatch(/UNIQUE \(organization_id, externo_hash\)/);
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION public\.lead_ia_retorno_receber\(text, jsonb\)/);
    // recusas antes do primeiro INSERT
    const corpo = MIG.slice(MIG.indexOf("FUNCTION public.lead_ia_retorno_receber"));
    expect(corpo.indexOf("'desligada'")).toBeLessThan(corpo.indexOf("INSERT INTO"));
    expect(corpo.indexOf("'ignorado'")).toBeLessThan(corpo.indexOf("INSERT INTO"));
  });
  it("rollback desfaz tudo da migration", () => {
    for (const x of ["lead_ia_retorno_receber", "lead_ia_retorno_token", "lead_ia_modelo_salvar", "lead_ia_uso", "lead_ia_retorno_eventos", "ia_retorno_token_hash", "ia_modelo"])
      expect(RB).toContain(x);
  });
  it("sem segredo nem fallback de chave de outro produto", () => {
    for (const s of [SRV, MOD]) {
      expect(s).not.toMatch(/ZIONTALK_API_KEY\b|ZIONTALK_MAX_API_KEY|VISITA_PROVA_NOTIFICATION/);
      expect(s).not.toMatch(/sk-or-|AIza[0-9A-Za-z_-]{20}/);
    }
  });
});

describe("reengajamento (t_fc4d9b27): rota desligada sem segredo", () => {
  const SEG = "S".repeat(40);
  const req = (h: Record<string, string> = {}, method = "POST") => new Request("https://app/api/leads/reengajar", { method, headers: h });
  const dReeng = (env: Record<string, string>, data: unknown = [{ lead_id: "l1", toque: 1 }]) => {
    const reengajarReservar = vi.fn(async () => ({ data, error: null }));
    const reservar = vi.fn(async () => ({ data: [], error: null }));
    const zion = vi.fn(async () => new Response("", { status: 201 }));
    return { d: { reengajarReservar, reservar, resultado: vi.fn(async () => undefined), env, fetchFn: zion as unknown as typeof fetch }, reengajarReservar, zion };
  };
  it("sem segredo no servidor: 404 e nada reservado", async () => {
    const { d, reengajarReservar } = dReeng({});
    expect((await receberReengajar(req({ "x-leads-ia-segredo": SEG }), d)).status).toBe(404);
    expect(reengajarReservar).not.toHaveBeenCalled();
  });
  it("segredo errado: 404", async () => {
    const { d, reengajarReservar } = dReeng({ LEADS_IA_REENGAJAR_SEGREDO: SEG });
    expect((await receberReengajar(req({ "x-leads-ia-segredo": "x".repeat(40) }), d)).status).toBe(404);
    expect(reengajarReservar).not.toHaveBeenCalled();
  });
  it("segredo certo: reserva no máximo 1 toque; sem envio real ligado, nada sai pela ZionTalk", async () => {
    const { d, reengajarReservar, zion } = dReeng({ LEADS_IA_REENGAJAR_SEGREDO: SEG });
    const r = await receberReengajar(req({ "x-leads-ia-segredo": SEG }), d);
    expect(r.status).toBe(200);
    expect(reengajarReservar).toHaveBeenCalledOnce();
    expect(zion).not.toHaveBeenCalled();
  });
  it("GET não dispara", async () => {
    const { d, reengajarReservar } = dReeng({ LEADS_IA_REENGAJAR_SEGREDO: SEG });
    expect((await receberReengajar(req({ "x-leads-ia-segredo": SEG }, "GET"), d)).status).toBe(405);
    expect(reengajarReservar).not.toHaveBeenCalled();
  });
});
