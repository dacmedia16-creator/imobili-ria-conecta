import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ehOptOut,
  ehSensivel,
  pediuPessoa,
  perguntaComercial,
  previaPrimeiraMensagem,
  proximaResposta,
  resumoQualificacao,
  validarIaConfig,
  type ContextoIa,
} from "./leads-ia";
import { canalTeste, canalZionTalk, escolherCanal, telefoneE164, ZIONTALK_SEND_URL } from "./leads-ia-canal";
import { extratorGemini } from "./leads-ia.functions";

// Card t_8046ecb0. As regras de acesso, opt-out, deduplicação e passagem ao corretor estão no banco e
// foram testadas em PostgreSQL descartável (2 imobiliárias). Aqui: roteiro da IA (modelo SIMULADO),
// adaptador ZionTalk (fetch falso, nenhuma rede) e travas do texto da migration.
const MIG = readFileSync("supabase/migrations/20261025180000_leads_ia_atendimento.sql", "utf8");
const RB = readFileSync("docs/sql/rollback/20261025180000_leads_ia_atendimento.rollback.sql", "utf8");
const CANAL = readFileSync("src/lib/leads-ia-canal.ts", "utf8");

const ctx = (p: Partial<ContextoIa> = {}): ContextoIa => ({
  conversa_id: "c",
  estado: "ativa",
  versao: 1,
  passo: "interesse",
  dados: {},
  ia_nome: "Lais",
  lead_nome: "Maria",
  imovel: null,
  ...p,
});

/** Roda uma conversa inteira e devolve as respostas. */
async function conversa(falas: string[], extrator?: Parameters<typeof proximaResposta>[2]) {
  let c = ctx();
  const out = [];
  for (const f of falas) {
    const r = await proximaResposta(c, f, extrator);
    out.push(r);
    c = { ...c, passo: r.passo, dados: r.dados, versao: c.versao + 1 };
    if (r.fim) break;
  }
  return out;
}

describe("roteiro de qualificação", () => {
  it("fluxo completo: comprar, prazo, pagamento, faixa, região, visita -> passa ao corretor", async () => {
    const r = await conversa([
      "Sim, tenho interesse",
      "Quero comprar",
      "Em uns 3 meses",
      "Financiamento com FGTS",
      "Até 500 mil",
      "Campolim",
      "Prefiro visitar",
    ]);
    expect(r.map((x) => x.passo)).toEqual(["finalidade", "prazo", "pagamento", "faixa", "regiao", "proximo_passo", "fim"]);
    const ult = r[r.length - 1];
    expect(ult.fim).toBe("qualificado");
    expect(ult.resumo).toBe(
      "Quer comprar; prazo: Em uns 3 meses; pagamento: financiamento, FGTS; faixa: Até 500 mil; região: Campolim; prefere agendar visita.",
    );
    expect(ult.resposta).toContain("visita");
  });

  it("pergunta comprar/alugar, prazo, pagamento, faixa e região", async () => {
    const r = await conversa(["sim", "alugar", "agora", "à vista", "3 mil", "centro"]);
    expect(r[0].resposta).toMatch(/comprar ou para alugar/);
    expect(r[1].resposta).toMatch(/quando/);
    expect(r[2].resposta).toMatch(/financiamento, à vista ou usando FGTS/);
    expect(r[3].resposta).toMatch(/faixa de valor/);
    expect(r[4].resposta).toMatch(/região/);
    expect(r[5].resposta).toMatch(/visita ou que o corretor/);
  });

  it("cliente pede uma pessoa -> IA para", async () => {
    const r = await conversa(["sim", "quero falar com um corretor"]);
    expect(r[1].fim).toBe("pediu_pessoa");
  });

  it("assunto sensível (reclamação, jurídico, dinheiro) -> IA para", async () => {
    for (const t of ["vou processar vocês", "quero meu dinheiro de volta", "paguei o sinal e ninguém respondeu", "isso é um absurdo"]) {
      expect((await proximaResposta(ctx({ passo: "faixa" }), t)).fim).toBe("sensivel");
    }
  });

  it("sem interesse na 1ª resposta -> encerra educadamente", async () => {
    expect((await proximaResposta(ctx(), "Não, já comprei")).fim).toBe("sem_interesse");
  });

  it("NUNCA responde preço/condição/disponibilidade: avisa que o corretor confirma e repete a pergunta", async () => {
    for (const t of ["qual o valor?", "ainda está disponível?", "aceita permuta?", "quanto é o condomínio"]) {
      const r = await proximaResposta(ctx({ passo: "finalidade" }), t);
      expect(r.fim).toBeNull();
      expect(r.passo).toBe("finalidade");
      expect(r.resposta).toMatch(/corretor confirma/);
      expect(r.resposta).not.toMatch(/R\$|\d/);
    }
  });

  it("não entendeu: repete uma vez, na segunda anota e segue (não trava)", async () => {
    const a = await proximaResposta(ctx({ passo: "finalidade" }), "hmm talvez");
    expect(a.passo).toBe("finalidade");
    expect(a.resposta).toMatch(/não entendi/);
    const b = await proximaResposta(ctx({ passo: "finalidade", dados: a.dados }), "hmm talvez");
    expect(b.passo).toBe("prazo");
  });

  it("todas as respostas vêm de textos fixos (sem número inventado)", async () => {
    const r = await conversa(["sim", "comprar", "logo", "financiar", "não sei", "zona sul", "contato"]);
    for (const x of r) expect(x.resposta).not.toMatch(/R\$\s*\d/);
  });
});

describe("modelo de linguagem SIMULADO (mock)", () => {
  it("o modelo só ajuda a ENTENDER; a resposta continua fixa", async () => {
    const mock = vi.fn(async () => ({ finalidade: "comprar" }));
    const r = await proximaResposta(ctx({ passo: "finalidade" }), "tô querendo um cantinho meu", mock);
    expect(mock).toHaveBeenCalledOnce();
    expect(r.dados.finalidade).toBe("comprar");
    expect(r.resposta).toMatch(/para quando/);
  });

  it("campos fora do passo devolvidos pelo modelo são ignorados", async () => {
    const mock = vi.fn(async () => ({ finalidade: "comprar", faixa: "R$ 1 bilhão" }) as never);
    const r = await proximaResposta(ctx({ passo: "finalidade" }), "xyz", mock);
    expect(r.dados.faixa).toBeUndefined();
  });

  it("modelo fora do ar: segue só com regras", async () => {
    const mock = vi.fn(async () => {
      throw new Error("timeout");
    });
    const r = await proximaResposta(ctx({ passo: "finalidade" }), "xyz", mock);
    expect(r.resposta).toMatch(/não entendi/);
  });

  it("não chama o modelo quando as regras já entendem (economia)", async () => {
    const mock = vi.fn(async () => null);
    await proximaResposta(ctx({ passo: "finalidade" }), "alugar", mock);
    expect(mock).not.toHaveBeenCalled();
  });

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
  it("prévia igual à regra do banco", () => {
    expect(previaPrimeiraMensagem({ ia_nome: "Lais", ia_boas_vindas: null }, "Org A", "Maria Souza", "apartamento no bairro Campolim")).toBe(
      "Olá, Maria! Aqui é Lais, da Org A. Recebi seu contato sobre o imóvel apartamento no bairro Campolim. Você ainda tem interesse? (Se não quiser receber mensagens, responda SAIR.)",
    );
  });
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
