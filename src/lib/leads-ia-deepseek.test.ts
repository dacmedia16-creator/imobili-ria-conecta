// DeepSeek só na ZZ (t_3ea838d7): provedor fora da China, sem raciocínio, plano B = 2ª chamada e depois Gemini.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { proximaResposta, type ContextoIa, type FichaIa, type ResultadoParecidos } from "./leads-ia";
import { DEEPSEEK_PROVEDORES, OPENROUTER_URL, opcoesOpenRouter, type UsoModelo } from "./leads-ia-modelo";
import { redigirOpenRouter, redigirResposta, REDACAO_OR_TIMEOUT_MS, type ModoValidador } from "./leads-ia-redacao";

const DS = "deepseek/deepseek-v4-flash-0731";
const FICHA: FichaIa = {
  tipo: "casa",
  bairro: "Jardim Piratininga",
  cidade: "Sorocaba",
  quartos: "3",
  suites: "1",
  banheiros: "2",
  vagas: "2",
  area_util_m2: "120",
  negocio: "venda",
  preco: "R$ 655.000",
  preco_valor: 655000,
  condominio: "R$ 550,00",
  iptu: "R$ 55,00 por mês",
  link: "https://vipsevenimoveis.com.br/imovel/3881",
};
const AGORA = new Date("2026-10-27T13:00:00Z");
const ENV = { LEADS_IA_MODELO: "gemini", GEMINI_API_KEY: "g", OPENROUTER_API_KEY: "or" };
const ctx: ContextoIa = {
  conversa_id: "c1",
  estado: "ativa",
  versao: 3,
  passo: "interesse",
  dados: {},
  ia_nome: "Nicole",
  lead_nome: "Denis",
  imovel: null,
  org_nome: "ZZ Teste Provisionamento",
  transacao: "venda",
  anuncio_codigo: "3881",
  ficha: FICHA,
  imovel_frase: "a casa do bairro Jardim Piratininga",
  imovel_fonte: "xml",
};
const OK = { mensagem: "O condomínio é R$ 550 por mês. Quer agendar uma visita?", acao: "responder" };
const resOr = (saida: unknown, provider = "Relace") =>
  new Response(
    JSON.stringify({
      provider,
      choices: [{ message: { content: JSON.stringify(saida) } }],
      usage: { prompt_tokens: 1700, completion_tokens: 60, cost: 0.0001 },
    }),
  );
const resGemini = (saida: unknown) =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(saida) }] } }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50 },
    }),
  );
type Passo = Response | number | Error;
/** fetch falso por destino: fila do OpenRouter e fila do Gemini. */
const rede = (or: Passo[], gem: Passo[]) => {
  const f = vi.fn(async (url: string) => {
    const r = (url === OPENROUTER_URL ? or : gem).shift();
    if (r === undefined) throw new Error("chamada a mais");
    if (r instanceof Error) throw r;
    if (typeof r === "number") return new Response("x", { status: r });
    return r;
  });
  return f as unknown as typeof fetch & { mock: { calls: Array<[string, RequestInit]> } };
};
const vazio = async (): Promise<ResultadoParecidos> => ({ referencia: {}, itens: [] });

async function rodar(f: typeof fetch, modo: ModoValidador = "observar", modelo = DS) {
  const usos: UsoModelo[] = [];
  const texto = "qual o condomínio?";
  const base = await proximaResposta(ctx, texto, undefined, { agora: AGORA, buscarParecidos: vazio });
  const r = await redigirResposta(ctx, texto, base, {
    escolha: { provedor: "openrouter", modelo },
    env: ENV,
    historico: [],
    buscarParecidos: vazio,
    registrar: (u) => usos.push(u),
    fetchFn: f,
    agora: AGORA,
    modo,
  });
  return { base, r, usos };
}
const resumo = (usos: UsoModelo[]) => usos.map((u) => [u.provedor, u.tentativa, u.ok, u.erro, u.rota ?? null, u.fallback]);

describe("DeepSeek: pedido ao OpenRouter", () => {
  it("só Relace/DeepInfra/Reka, sem raciocínio, com as mesmas travas de LGPD", async () => {
    const f = rede([resOr(OK)], []);
    const r = await redigirOpenRouter("or", DS, { sistema: "s", usuario: "u" }, f);
    const body = JSON.parse(String(f.mock.calls[0][1].body));
    expect(body.provider).toMatchObject({ data_collection: "deny", zdr: true, only: [...DEEPSEEK_PROVEDORES], order: [...DEEPSEEK_PROVEDORES] });
    expect(body.reasoning).toEqual({ enabled: false });
    expect(DEEPSEEK_PROVEDORES).not.toContain("deepseek");
    expect(r.rota).toBe("Relace");
  });
  it("outros modelos do OpenRouter continuam como estavam (sem lista fixa de provedor)", () => {
    const o = opcoesOpenRouter("openai/gpt-6-luna", { effort: "low", exclude: true });
    expect(o.provider).not.toHaveProperty("only");
    expect(o.reasoning).toEqual({ effort: "low", exclude: true });
  });
});

describe("DeepSeek: plano B (observar, como a ZZ)", () => {
  it("1ª chamada ok: 1 chamada, registra modelo e provedor que respondeu", async () => {
    const f = rede([resOr(OK, "DeepInfra")], []);
    const { r, usos } = await rodar(f);
    expect(r.resposta).toBe(OK.mensagem);
    expect(f.mock.calls).toHaveLength(1);
    expect(resumo(usos)).toEqual([["openrouter", 1, true, null, "DeepInfra", false]]);
    expect(usos[0].modelo).toBe(DS);
  });
  it("erro e depois ok: tenta 1 vez de novo no DeepSeek e usa a 2ª", async () => {
    const f = rede([503, resOr(OK)], []);
    const { r, usos } = await rodar(f);
    expect(r.resposta).toBe(OK.mensagem);
    expect(resumo(usos)).toEqual([
      ["openrouter", 1, false, "http_503", null, false],
      ["openrouter", 2, true, null, "Relace", false],
    ]);
  });
  it("demora 2 vezes: vai ao Gemini (não à frase pronta) e marca fallback", async () => {
    const t = Object.assign(new Error("t"), { name: "TimeoutError" });
    const f = rede([t, t], [resGemini(OK)]);
    const { r, usos } = await rodar(f);
    expect(r.resposta).toBe(OK.mensagem);
    expect(r.sem_resposta).toBeFalsy();
    expect(resumo(usos)).toEqual([
      ["openrouter", 1, false, "timeout", null, false],
      ["openrouter", 2, false, "timeout", null, false],
      ["gemini", 2, true, null, null, true],
    ]);
  });
  it("tudo fora: 3 chamadas no máximo e só o aviso interno (nada vai ao cliente)", async () => {
    const f = rede([404, 404], [500]);
    const { r } = await rodar(f);
    expect(f.mock.calls).toHaveLength(3);
    expect(r.resposta).toBe("");
    expect(r.sem_resposta).toBe(true);
  });
  it("JSON ruim no DeepSeek: 2ª volta no DeepSeek e responde", async () => {
    const f = rede([new Response(JSON.stringify({ provider: "Reka", choices: [{ message: { content: "oi" } }] })), resOr(OK)], []);
    const { r, usos } = await rodar(f);
    expect(r.resposta).toBe(OK.mensagem);
    expect(usos.map((u) => [u.tentativa, u.bloqueio])).toEqual([[1, "formato"], [2, null]]);
  });
  it("a 1ª chamada tem tempo próprio (8 s)", () => {
    expect(REDACAO_OR_TIMEOUT_MS).toBe(8_000);
  });
});

describe("Gemini continua o padrão", () => {
  it("imobiliária com Gemini não chama o OpenRouter", async () => {
    const f = rede([], [resGemini(OK)]);
    const usos: UsoModelo[] = [];
    const base = await proximaResposta(ctx, "qual o condomínio?", undefined, { agora: AGORA, buscarParecidos: vazio });
    await redigirResposta(ctx, "qual o condomínio?", base, {
      escolha: { provedor: "gemini", modelo: null },
      env: ENV,
      historico: [],
      buscarParecidos: vazio,
      registrar: (u) => usos.push(u),
      fetchFn: f,
      agora: AGORA,
      modo: "observar",
    });
    expect(f.mock.calls.map((c) => c[0])).not.toContain(OPENROUTER_URL);
    expect(usos.map((u) => u.provedor)).toEqual(["gemini"]);
  });
  it("migration só adiciona a coluna rota (aditiva, sem mexer em lead_config)", () => {
    const sql = readFileSync("supabase/migrations/20261027160000_leads_ia_uso_rota.sql", "utf8").replace(/--.*$/gm, "");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS rota text/);
    expect(sql).not.toMatch(/UPDATE|lead_config|DROP/i);
  });
});
