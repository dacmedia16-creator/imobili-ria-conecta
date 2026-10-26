import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ehOptOut,
  ehSensivel,
  pediuPessoa,
  perguntaComercial,
  resumoQualificacao,
  validarIaConfig,
} from "./leads-ia";
import {
  cabePrimeiraHoje,
  canalTeste,
  canalZionTalk,
  ENVIO_LIMITE_DIA_PADRAO,
  escolherCanal,
  intervaloAleatorioMs,
  telefoneE164,
  temLink,
  ZIONTALK_SEND_URL,
} from "./leads-ia-canal";
import { extratorGemini } from "./leads-ia.functions";

// Card t_8046ecb0. As regras de acesso, opt-out, deduplicação e passagem ao corretor estão no banco e
// foram testadas em PostgreSQL descartável (2 imobiliárias). Aqui: roteiro da IA (modelo SIMULADO),
// adaptador ZionTalk (fetch falso, nenhuma rede) e travas do texto da migration.
const MIG = readFileSync("supabase/migrations/20261025180000_leads_ia_atendimento.sql", "utf8");
const RB = readFileSync("docs/sql/rollback/20261025180000_leads_ia_atendimento.rollback.sql", "utf8");
const CANAL = readFileSync("src/lib/leads-ia-canal.ts", "utf8");


// Roteiro (conversas simuladas por item): src/lib/leads-ia-roteiro.test.ts (t_fc4d9b27).
describe("modelo de linguagem SIMULADO (mock)", () => {
  it("extrator Gemini usa só fetch falso (nenhuma rede real) e entende o JSON", async () => {
    const f = vi.fn(async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"pagamento":["FGTS"]}' }] } }] })),
    );
    const ex = extratorGemini("chave-falsa", f as unknown as typeof fetch);
    expect(await ex("pagamento", "vou usar o fundo de garantia")).toEqual({ pagamento: ["FGTS"] });
    expect(f).toHaveBeenCalledOnce();
  });
});

describe("detectores", () => {
  it("opt-out", () => {
    for (const t of ["SAIR", "sair.", "SAIR,", "quero sair", "sair por favor", "me tira da lista", "Pare", "não quero mais receber mensagens", "pare de me mandar mensagem", "remova meu número"])
      expect(ehOptOut(t)).toBe(true);
    for (const t of ["Sim", "quero sair do aluguel", "pode mandar"]) expect(ehOptOut(t)).toBe(false);
  });
  it("sensível / pessoa / comercial sem falso positivo em respostas comuns", () => {
    for (const t of ["comprar", "em 3 meses", "financiamento", "centro"]) {
      expect(ehSensivel(t)).toBe(false);
      expect(pediuPessoa(t)).toBe(false);
      expect(perguntaComercial(t)).toBe(false);
    }
  });
});

describe("configuração e 1ª mensagem", () => {
  it("valida nome e boas-vindas", () => {
    expect(validarIaConfig({ ia_nome: " ", ia_boas_vindas: null })).not.toBeNull();
    expect(validarIaConfig({ ia_nome: "Lais", ia_boas_vindas: "x".repeat(401) })).not.toBeNull();
    expect(validarIaConfig({ ia_nome: "Lais", ia_boas_vindas: "Oi" })).toBeNull();
  });
  it("resumo vazio", () => {
    expect(resumoQualificacao({})).toBe("Sem dados de qualificação.");
  });
});

describe("canal ZionTalk (envio real DESLIGADO)", () => {
  const fone = "15999990000";
  it("sem flag ou sem chave própria = canal de teste (falha fechada)", () => {
    expect(escolherCanal({}).nome).toBe("teste");
    expect(escolherCanal({ LEADS_IA_ENVIO_REAL: "on" }).nome).toBe("teste");
    expect(escolherCanal({ ZIONTALK_LEADS_IA_API_KEY: "k" }).nome).toBe("teste");
    expect(escolherCanal({ LEADS_IA_ENVIO_REAL: "on", ZIONTALK_API_KEY: "outra" }).nome).toBe("teste");
    expect(escolherCanal({ LEADS_IA_ENVIO_REAL: "on", ZIONTALK_LEADS_IA_API_KEY: "k" }).nome).toBe("ziontalk");
  });
  it("canal de teste nunca chama a rede", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    expect(await canalTeste.enviar(fone, "oi")).toEqual({ status: "teste" });
    expect(f).not.toHaveBeenCalled();
    f.mockRestore();
  });
  it("ZionTalk: endpoint oficial, Basic Auth com a chave, E.164, 201 = enviada (fetch falso)", async () => {
    const f = vi.fn(async (_u: string, _i: RequestInit) => new Response("ok", { status: 201 }));
    const r = await canalZionTalk("chave-falsa", f as unknown as typeof fetch).enviar(fone, "Olá");
    expect(r).toEqual({ status: "enviada" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(ZIONTALK_SEND_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa("chave-falsa:")}`);
    expect(String(init.body)).toContain("mobile_phone=%2B5515999990000");
  });
  it("erro em texto simples não quebra; 5xx repete, 4xx não", async () => {
    const f5 = vi.fn(async () => new Response("Internal error", { status: 500 }));
    expect(await canalZionTalk("k", f5 as unknown as typeof fetch).enviar(fone, "x")).toEqual({ status: "falhou", erro: "http_500", repetir: true });
    const f4 = vi.fn(async () => new Response("Bad", { status: 400 }));
    expect(await canalZionTalk("k", f4 as unknown as typeof fetch).enviar(fone, "x")).toEqual({ status: "falhou", erro: "http_400", repetir: false });
  });
  it("telefone inválido não envia", async () => {
    const f = vi.fn();
    expect((await canalZionTalk("k", f as unknown as typeof fetch).enviar("123", "x")).status).toBe("falhou");
    expect(f).not.toHaveBeenCalled();
    expect(telefoneE164("(15) 99999-0000")).toBe("+5515999990000");
    expect(telefoneE164("+55 15 3333-4444")).toBe("+551533334444");
  });
  it("não reaproveita chaves de outros produtos", () => {
    const codigo = CANAL.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
    expect(codigo).not.toMatch(/process\.env|VISITA_PROVA_NOTIFICATION|ZIONTALK_MAX_API_KEY|"ZIONTALK_API_KEY"/);
  });
});

describe("travas da migration", () => {
  it("IA nasce desligada e em modo teste", () => {
    expect(MIG).toMatch(/ia_ativa boolean NOT NULL DEFAULT false/);
    expect(MIG).toMatch(/ia_canal text NOT NULL DEFAULT 'teste'/);
  });
  it("1 lead = 1 conversa; RLS e módulo nas tabelas novas", () => {
    expect(MIG).toMatch(/CONSTRAINT lead_conversas_um_por_lead UNIQUE \(lead_id\)/);
    for (const t of ["lead_conversas", "lead_mensagens", "lead_ia_optouts"])
      expect(MIG).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
    expect(MIG).toMatch(/zz_mt_modulo_leads ON public\.lead_conversas/);
  });
  it("funções do servidor fora do alcance do app", () => {
    expect(MIG).toMatch(/lead_ia_aplicar\(uuid, integer, text, jsonb, text, text, text\),\s+public\.lead_ia_canal_definir\(uuid, text\) FROM PUBLIC, anon, authenticated/);
  });
  it("gatilho em QUALQUER lead novo e nunca bloqueia a entrada", () => {
    expect(MIG).toMatch(/AFTER INSERT ON public\.leads/);
    expect(MIG).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING 'lead_ia_iniciar/);
  });
  it("migration não envia nada e não usa segredo", () => {
    expect(MIG).not.toMatch(/http|net\.http_post|api_key|ziontalk\.com/i);
  });
  it("rollback desfaz tudo", () => {
    for (const x of ["DROP TRIGGER IF EXISTS zz_lead_ia_iniciar", "DROP TABLE IF EXISTS public.lead_conversas", "DROP COLUMN IF EXISTS ia_ativa"])
      expect(RB).toContain(x);
  });
});

describe("travas do envio futuro por QR Code (ainda desligadas)", () => {
  it("limite de 1ª mensagem por dia: padrão baixo (10) e bloqueia ao atingir", () => {
    expect(ENVIO_LIMITE_DIA_PADRAO).toBe(10);
    expect(cabePrimeiraHoje(9, 10)).toBe(true);
    expect(cabePrimeiraHoje(10, 10)).toBe(false);
    expect(cabePrimeiraHoje(0, 0)).toBe(false);
    expect(MIG).toMatch(/ia_envio_limite_dia integer NOT NULL DEFAULT 10/);
  });
  it("intervalo aleatório entre envios dentro da faixa", () => {
    expect(intervaloAleatorioMs(60, 180, () => 0)).toBe(60_000);
    expect(intervaloAleatorioMs(60, 180, () => 1)).toBe(180_000);
    expect(intervaloAleatorioMs(10, 20, () => 0)).toBe(30_000);
    expect(MIG).toMatch(/ia_envio_intervalo_min_s integer NOT NULL DEFAULT 60/);
    expect(MIG).toMatch(/lead_ia_envio_definir\(uuid, integer, integer, integer\) FROM PUBLIC, anon, authenticated/);
  });
  it("nenhum link na 1ª mensagem", () => {
    for (const x of ["veja https://x.com", "www.imob.com.br", "acesse imob.com.br/ap", "site.app"]) expect(temLink(x)).toBe(true);
    for (const x of ["Recebi seu contato pelo anúncio no ZAP", "R$ 500.000", "Sr. João"]) expect(temLink(x)).toBe(false);
    expect(validarIaConfig({ ia_nome: "Emanuella", ia_boas_vindas: "veja www.imob.com.br" })).not.toBeNull();
    expect(MIG).toMatch(/lead_config_ia_boas_vindas_sem_link/);
  });
});

describe("envio real por lista de liberados (t_5d8c0b63)", () => {
  const ENVIO = readFileSync("src/lib/leads-ia-envio.functions.ts", "utf8");
  it("só envia se o servidor tiver flag + chave própria e o banco liberar o contato", () => {
    expect(ENVIO).toMatch(/escolherCanal\(/);
    expect(ENVIO).toMatch(/lead_ia_envio_reservar/);
    expect(ENVIO).toMatch(/leads_gestor/);
    expect(ENVIO).not.toMatch(/console\.(log|error)\([^)]*(telefone|texto)/);
  });
  it("sem chave geral: canal real exige o contato na lista", () => {
    expect(MIG).toMatch(/ia_envio_allowlist text\[\] NOT NULL DEFAULT '\{\}'/);
    expect(MIG).toMatch(/lead_ia_contatos\(l\.telefone, NULL\) && c\.ia_envio_allowlist/);
    expect(MIG).toMatch(/lead_ia_envio_reservar\(uuid\),\s+public\.lead_ia_envio_resultado\(uuid, boolean\) FROM PUBLIC, anon, authenticated/);
  });
});
