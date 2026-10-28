// Nicole em MODO OBSERVAÇÃO (t_3a4bf078): a resposta do modelo sempre sai, a trava só registra; sem frase pronta.
import { readFileSync } from "node:fs";
import { semConviteVisita } from "./leads-ia";
import { describe, expect, it, vi } from "vitest";
import { proximaResposta, type ContextoIa, type FichaIa, type ResultadoParecidos } from "./leads-ia";
import type { UsoModelo } from "./leads-ia-modelo";
import {
  AVISO_SEM_RESPOSTA,
  modoValidadorDb,
  permitidosDe,
  redigirResposta,
  validarRedacao,
  validarRedacaoDetalhe,
  visitaSemParenteses,
  type ModoValidador,
  type SaidaModelo,
} from "./leads-ia-redacao";
import { receberRetornoZionTalk, type DepsRetorno, type RespostaBanco } from "./leads-ia-retorno.server";

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
const ENV = { LEADS_IA_MODELO: "gemini", GEMINI_API_KEY: "teste" };
const ctx = (extra: Partial<ContextoIa> = {}): ContextoIa => ({
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
  ...extra,
});
const respostaGemini = (saida: unknown) =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: typeof saida === "string" ? saida : JSON.stringify(saida) }] } }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50, thoughtsTokenCount: 100 },
    }),
  );
/** fetch falso que devolve as respostas em ordem (Response pronta, status de erro ou exceção). */
const sequencia = (...rs: Array<Response | number | Error>) => {
  const f = vi.fn(async () => {
    const r = rs.shift();
    if (r instanceof Error) throw r;
    if (typeof r === "number") return new Response("erro", { status: r });
    return r!;
  });
  return f as unknown as typeof fetch & { mock: { calls: unknown[] } };
};
const vazio = async (): Promise<ResultadoParecidos> => ({ referencia: {}, itens: [] });

async function rodar(texto: string, fetchFn: typeof fetch, modo?: ModoValidador, c = ctx()) {
  const usos: UsoModelo[] = [];
  const base = await proximaResposta(c, texto, undefined, { agora: AGORA, buscarParecidos: vazio });
  const r = await redigirResposta(c, texto, base, {
    escolha: { provedor: "gemini", modelo: null },
    env: ENV,
    historico: [],
    buscarParecidos: vazio,
    registrar: (u) => usos.push(u),
    fetchFn,
    agora: AGORA,
    modo,
  });
  return { base, r, usos };
}

describe("validador: motivo + trecho (sem o texto inteiro)", () => {
  const perm = permitidosDe(FICHA, [], visitaSemParenteses(AGORA));
  const s = (mensagem: string): SaidaModelo => ({ mensagem, acao: "responder", codigo: null, registro: {} });
  it("contagem: devolve o número com a unidade e de onde a trava aceitaria (sem texto)", () => {
    const d = validarRedacaoDetalhe(s("Com 4 suítes nessa faixa não tenho. Quer ver outra?"), perm, "tem com 3 suítes?");
    expect(d).toEqual({ motivo: "contagem", trecho: "4 suites | ficha:1 busca:- cliente:-" });
  });
  it("contagem (t_a9f1b447): o número que o CLIENTE pediu não é barrado", () => {
    const p2 = permitidosDe(FICHA, [], visitaSemParenteses(AGORA), ["tem com 3 suítes?"]);
    expect(validarRedacaoDetalhe(s("Com 3 suítes nessa faixa não tenho. Quer ver outra?"), p2, "tem com 3 suítes?")).toBeNull();
  });
  it("valor e link: o valor e o link que barraram", () => {
    expect(validarRedacaoDetalhe(s("O condomínio é R$ 350. Quer visitar?"), perm, "x")).toEqual({ motivo: "valor", trecho: "r$ 350" });
    expect(validarRedacaoDetalhe(s("Veja https://outro.com/1 Gostou?"), perm, "x")).toEqual({ motivo: "link", trecho: "https://outro.com/1" });
  });
  it("mesmo resultado do validador antigo (motivo)", () => {
    for (const t of ["Está disponível sim! Quer visitar?", "Aceita financiamento sim.", "Quer? Pode? ", "O corretor te liga."]) {
      expect(validarRedacaoDetalhe(s(t), perm, "x")?.motivo ?? null).toBe(validarRedacao(s(t), perm, "x"));
    }
    expect(validarRedacaoDetalhe(s("O condomínio é R$ 550 por mês. Quer agendar uma visita?"), perm, "x")).toBeNull();
  });
  it("trecho nunca passa de 60 caracteres e mascara contato", () => {
    const d = validarRedacaoDetalhe(s(`Me liga no 15 99999-8888 ${"a".repeat(500)}`), perm, "x");
    expect(d?.motivo).toBe("tamanho");
    const d2 = validarRedacaoDetalhe(s("Fala comigo no 15 99999-8888 hoje"), perm, "x");
    expect(d2?.trecho ?? "").not.toMatch(/99999/);
    expect((d2?.trecho ?? "").length).toBeLessThanOrEqual(60);
  });
});

describe("modo observar", () => {
  // 4 suítes: nem a ficha (1) nem o cliente (3) falaram nisso = número inventado.
  const barrada = { mensagem: "Com 4 suítes nessa faixa não tenho, mas tenho outras. Quer ver?", acao: "responder" };
  it("bloquear (padrão): 2 bloqueios seguidos = frase pronta; a 2ª tentativa diz o que estava errado", async () => {
    const f = sequencia(respostaGemini(barrada), respostaGemini(barrada));
    const { base, r, usos } = await rodar("tem com 3 suítes?", f);
    expect(r.resposta).toBe(semConviteVisita(base.resposta));
    expect(r.bloqueio).toBe("contagem");
    expect(usos.map((u) => u.tentativa)).toEqual([1, 2]);
    expect(usos[0]).not.toHaveProperty("observado");
    expect(usos[0]).toMatchObject({ bloqueio: "contagem", bloqueio_trecho: "4 suites | ficha:1 busca:- cliente:2,3" });
    const corpo2 = String((f.mock.calls[1] as [unknown, RequestInit])[1].body);
    expect(corpo2).toMatch(/CORREÇÃO: Sua resposta anterior foi recusada/);
    expect(String((f.mock.calls[0] as [unknown, RequestInit])[1].body)).not.toMatch(/CORREÇÃO/);
  });
  it("bloquear: a 2ª tentativa corrigida sai no lugar da frase pronta", async () => {
    const ok = { mensagem: "Com 3 suítes, nessa faixa não tenho. Quer que eu procure com 2 suítes?", acao: "responder" };
    const { r, usos } = await rodar("tem com 3 suítes?", sequencia(respostaGemini(barrada), respostaGemini(ok)));
    expect(r.resposta).toBe(semConviteVisita(ok.mensagem));
    expect(r.redigida).toBe(true);
    expect(usos.map((u) => [u.tentativa, u.bloqueado])).toEqual([[1, true], [2, false]]);
  });
  it("observar: a mensagem do modelo SAI e o bloqueio é só registrado (motivo + trecho)", async () => {
    const { base, r, usos } = await rodar("tem com 3 suítes?", sequencia(respostaGemini(barrada)), "observar");
    expect(r.resposta).toBe(barrada.mensagem);
    expect(r.resposta).not.toBe(semConviteVisita(base.resposta));
    expect(r.redigida).toBe(true);
    expect(usos).toHaveLength(1);
    expect(usos[0]).toMatchObject({ uso: "redigir", bloqueado: true, bloqueio: "contagem", bloqueio_trecho: "4 suites | ficha:1 busca:- cliente:2,3", observado: true, tentativa: 1 });
    expect(JSON.stringify(usos)).not.toContain("nessa faixa");
  });
  it("observar (t_a9f1b447): '3 suítes' que o cliente pediu NÃO é registrado como bloqueio", async () => {
    const m = { mensagem: "Com 3 suítes, nessa faixa não tenho. Quer que eu procure com 2 suítes?", acao: "responder" };
    const { r, usos } = await rodar("tem com 3 suítes?", sequencia(respostaGemini(m)), "observar");
    expect(r.resposta).toBe(m.mensagem);
    expect(usos[0]).toMatchObject({ bloqueado: false, bloqueio: null, observado: false });
  });
  it("observar sem bloqueio: sai e registra observado=false", async () => {
    const ok = { mensagem: "O condomínio é R$ 550 por mês. Quer agendar uma visita?", acao: "responder" };
    const { r, usos } = await rodar("qual o condomínio?", sequencia(respostaGemini(ok)), "observar");
    expect(r.resposta).toBe(semConviteVisita(ok.mensagem));
    expect(usos[0]).toMatchObject({ bloqueado: false, bloqueio: null, bloqueio_trecho: null, observado: false });
  });
  it("erro do modelo: tenta 1 vez de novo e usa a 2ª resposta", async () => {
    const ok = { mensagem: "O condomínio é R$ 550 por mês. Quer agendar uma visita?", acao: "responder" };
    const f = sequencia(503, respostaGemini(ok));
    const { r, usos } = await rodar("qual o condomínio?", f, "observar");
    expect(f.mock.calls).toHaveLength(2);
    expect(r.resposta).toBe(semConviteVisita(ok.mensagem));
    expect(usos.map((u) => [u.tentativa, u.ok, u.erro])).toEqual([[1, false, "http_503"], [2, true, null]]);
  });
  it("tempo estourado 2 vezes: nenhuma frase pronta, resposta vazia e sem_resposta", async () => {
    const t = Object.assign(new Error("t"), { name: "TimeoutError" });
    const f = sequencia(t, t);
    const c = ctx({ passo: "visita", dados: { convite_visita: true } });
    const { r, usos } = await rodar("qual o condomínio?", f, "observar", c);
    expect(f.mock.calls).toHaveLength(2);
    expect(r.resposta).toBe("");
    expect(r.sem_resposta).toBe(true);
    expect(r.fim).toBeNull();
    expect(r.passo).toBe("visita");
    expect(r.dados).toEqual(c.dados);
    expect(usos.map((u) => u.erro)).toEqual(["timeout", "timeout"]);
  });
  it("JSON ruim nas 2: sem resposta (sem frase pronta)", async () => {
    const { r, usos } = await rodar("qual o condomínio?", sequencia(respostaGemini("não é json"), respostaGemini("nem isso")), "observar");
    expect(r.resposta).toBe("");
    expect(r.sem_resposta).toBe(true);
    expect(usos.map((u) => u.bloqueio)).toEqual(["formato", "formato"]);
  });
  it("bloquear: erro do modelo = 1 tentativa e frase pronta (como antes)", async () => {
    const f = sequencia(503, 503);
    const { base, r } = await rodar("qual o condomínio?", f);
    expect(f.mock.calls).toHaveLength(1);
    expect(r.resposta).toBe(semConviteVisita(base.resposta));
  });
  it("regras antes do modelo continuam: sensível, pediu pessoa e é robô? não chamam o modelo", async () => {
    for (const t of ["quero falar com um corretor", "você é um robô?", "meu advogado vai entrar em contato sobre o processo"]) {
      const f = sequencia(respostaGemini(barrada));
      const { base, r } = await rodar(t, f, "observar");
      expect(f.mock.calls).toHaveLength(0);
      expect(r.resposta).toBeTruthy();
      if (!/robô/.test(t)) expect(r.resposta).toBe(semConviteVisita(base.resposta));
    }
  });
  it("oferta com código fora dos candidatos: sai, mas não vira \"oferecido\"", async () => {
    const of = { mensagem: "Tenho outra casa no bairro. Quer ver?", acao: "oferecer", codigo: "9999" };
    const { r, usos } = await rodar("tem outras?", sequencia(respostaGemini(of)), "observar");
    expect(r.resposta).toBe(of.mensagem);
    expect(r.dados.parecidos ?? []).not.toContain("9999");
    expect(usos[0]).toMatchObject({ bloqueio: "oferta", observado: true });
  });
});

describe("servidor: modo da imobiliária e aviso \"sem resposta da IA\"", () => {
  const TOKEN = "T".repeat(43);
  const banco: RespostaBanco = {
    r: "ok",
    responder: true,
    lead_id: "l1",
    tipo: "texto",
    organization_id: "o1",
    ia_modelo_provedor: "gemini",
    ctx: ctx(),
  };
  function deps(fetchFn: typeof fetch, modo: ModoValidador | "erro") {
    const aplicar = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const avisoSemResposta = vi.fn(async () => undefined);
    const registrarUso = vi.fn(async () => undefined);
    const d: DepsRetorno = {
      receber: async () => ({ data: banco, error: null }),
      aplicar,
      reservar: async () => ({ data: [], error: null }),
      resultado: async () => undefined,
      registrarUso,
      redacaoLigada: async () => true,
      modoValidador: async () => {
        if (modo === "erro") throw new Error("x");
        return modo;
      },
      avisoSemResposta,
      env: ENV,
      fetchFn,
      esperar: async () => undefined,
      rand: () => 0,
    };
    return { d, aplicar, avisoSemResposta, registrarUso };
  }
  const post = (d: DepsRetorno, texto: string) =>
    receberRetornoZionTalk(
      new Request(`https://app/api/leads/ziontalk/${TOKEN}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contato: { telefone: "5515900000000" }, mensagem: { id: "w1", tipo: "texto", texto } }),
      }),
      TOKEN,
      d,
    );
  it("observar + modelo falhou 2x: grava resposta vazia e o aviso; nada de frase pronta", async () => {
    const { d, aplicar, avisoSemResposta } = deps(sequencia(500, 500), "observar");
    await post(d, "qual o condomínio?");
    const a = (aplicar.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(a._resposta).toBe("");
    expect(a._fim).toBeNull();
    expect(avisoSemResposta).toHaveBeenCalledWith("o1", "c1");
  });
  it("erro ao ler o modo = bloquear (frase pronta, sem aviso)", async () => {
    const { d, aplicar, avisoSemResposta } = deps(sequencia(500, 500), "erro");
    await post(d, "qual o condomínio?");
    const a = (aplicar.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(String(a._resposta)).not.toBe("");
    expect(avisoSemResposta).not.toHaveBeenCalled();
  });
  it("aviso é de sistema, não vai ao cliente, e não tem conteúdo da conversa", () => {
    expect(AVISO_SEM_RESPOSTA).toMatch(/^Sem resposta da IA/);
    const srv = readFileSync("src/lib/leads-ia-retorno.server.ts", "utf8");
    expect(srv).toMatch(/autor: "sistema",\s*texto: AVISO_SEM_RESPOSTA,\s*status: "nao_enviada"/);
  });
});

describe("leitura do modo e migration", () => {
  const db = (data: unknown, error: unknown = null) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }) }),
  });
  it("só \"observar\" liga; ausente, erro ou valor estranho = bloquear", async () => {
    expect(await modoValidadorDb(db({ ia_validador_modo: "observar" }), "o")).toBe("observar");
    expect(await modoValidadorDb(db({ ia_validador_modo: "bloquear" }), "o")).toBe("bloquear");
    expect(await modoValidadorDb(db(null), "o")).toBe("bloquear");
    expect(await modoValidadorDb(db({ ia_validador_modo: "OBSERVAR" }), "o")).toBe("bloquear");
    expect(await modoValidadorDb(db(null, { code: "42703" }), "o")).toBe("bloquear");
  });
  it("migration aditiva com padrão bloquear e rollback", () => {
    const m = readFileSync("supabase/migrations/20261027130000_leads_ia_validador_modo.sql", "utf8");
    expect(m).toMatch(/ia_validador_modo text NOT NULL DEFAULT 'bloquear'/);
    expect(m).toMatch(/CHECK \(char_length\(bloqueio_trecho\) <= 60\)/);
    const semComentario = m.replace(/^--.*$/gm, "");
    expect(semComentario).not.toMatch(/CREATE OR REPLACE FUNCTION|DROP |UPDATE public/);
    const rb = readFileSync("docs/sql/rollback/20261027130000_leads_ia_validador_modo.rollback.sql", "utf8");
    expect(rb).toMatch(/DROP COLUMN IF EXISTS ia_validador_modo/);
  });
});
