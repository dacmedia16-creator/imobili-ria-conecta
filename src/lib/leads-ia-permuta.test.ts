// t_99359490 (Denis 31/10, tópico 6238): permuta com detalhes, sem resposta repetida, troca ≠ busca, ortografia e
// lembrete coerente. Casos tirados das conversas de 31/10 (Leonardo, Jidelson, Isabella), sem dado de cliente.
import { describe, expect, it } from "vitest";
import { finalizarResposta, proximaResposta, type ContextoIa, type RespostaIa } from "./leads-ia";
import {
  bemPermuta,
  corrigirOrtografia,
  detalhesPermuta,
  perguntaPermuta,
  PERMUTA_JA,
  PERMUTA_OK,
  PERMUTA_RECUSA,
  recusouDetalhes,
  respostaRepetida,
  resumoPermuta,
} from "./leads-ia-permuta";
import { textoCoerenteToque15, textoToque15 } from "./leads-ia-toque15";
import { ctxReferencia, REFERENCIA } from "./leads-ia-referencia.dados";

const AGORA = new Date("2026-10-31T15:00:00Z");
const base = ctxReferencia(REFERENCIA[0]);
const ctx = (dados: ContextoIa["dados"] = {}, permuta_fluxo = true): ContextoIa => ({ ...base, dados, permuta_fluxo });
const responde = (c: ContextoIa, t: string) => proximaResposta(c, t, undefined, { agora: AGORA });

describe("item 1: fluxo de permuta", () => {
  it("1a) oferta de troca: pergunta os detalhes, sem \"o corretor confirma na visita\"", async () => {
    const r = await responde(ctx(), "Aceita troca por uma chácara?");
    expect(r.resposta).toMatch(/^Legal! Me conta um pouco da chácara: onde fica, tamanho, o que tem nela, quanto você estima que vale/);
    expect(r.resposta).not.toMatch(/confirma/i);
    expect(r.fim).toBeNull();
    expect(r.dados.permuta).toMatchObject({ etapa: "detalhes", bem: "chácara" });
  });
  it("1a) carro: pergunta modelo, ano, valor e se está quitado", () => {
    expect(perguntaPermuta("carro")).toBe("Legal! Me conta um pouco do carro: modelo, ano, quanto você estima que vale e se está quitado?");
  });
  it("1a) já disse onde fica (\"chácara em Piedade\"): não pergunta onde fica de novo", () => {
    expect(perguntaPermuta("chácara", "tenho uma chácara em Piedade")).not.toMatch(/onde fica/);
  });
  it("1b) respondeu com detalhes (mesmo parciais): agradece e encaminha com PERMUTA no resumo", async () => {
    const r1 = await responde(ctx(), "Aceita troca por uma chácara?");
    const r2 = await responde(ctx(r1.dados), "fica em Piedade, uns 2 mil metros");
    expect(r2.resposta).toBe(PERMUTA_OK);
    expect(r2.fim).toBe("qualificado");
    expect(r2.resumo).toMatch(/^PERMUTA: chácara — .*Piedade/);
    expect(r2.dados.permuta?.etapa).toBe("encaminhada");
  });
  it("1b) oferta já com detalhes (2 tipos ou mais): encaminha direto, sem perguntar", async () => {
    const r = await responde(ctx(), "Tenho um terreno em Votorantim de 300 m2 quitado, aceita troca?");
    expect(r.resposta).toBe(PERMUTA_OK);
    expect(r.fim).toBe("qualificado");
  });
  it("1c) recusou dar detalhes: encaminha mesmo assim, sem insistir", async () => {
    const r1 = await responde(ctx(), "troca por terreno?");
    expect(recusouDetalhes("prefiro falar com o corretor")).toBe(true);
    const r2 = await responde(ctx(r1.dados), "prefiro não");
    expect(r2.resposta).toBe(PERMUTA_RECUSA);
    expect(r2.fim).toBe("qualificado");
    expect(r2.resumo).toMatch(/^PERMUTA: terreno/);
  });
  it("1d) depois de encaminhado: não pergunta de novo", async () => {
    const dados = { permuta: { etapa: "encaminhada" as const, bem: "chácara", relato: ["chácara em Piedade"] } };
    const r = await responde(ctx(dados), "e a troca pela chácara, vocês aceitam?");
    expect(r.resposta).toBe(PERMUTA_JA);
    expect(r.fim).toBeNull();
  });
  it("lembrete de permuta marcado pelo banco (etapa detalhes sem relato) também encaminha na resposta", async () => {
    const r = await responde(ctx({ permuta: { etapa: "detalhes", bem: "chácara" }, pagamento: ["permuta"] }), "uns 300 mil");
    expect(r.resposta).toBe(PERMUTA_OK);
    expect(r.resumo).toMatch(/PERMUTA: chácara — "uns 300 mil"/);
  });
  it("chave desligada (outras imobiliárias): comportamento de antes, sem fluxo de permuta", async () => {
    const r = await responde(ctx({}, false), "Aceita troca por uma chácara?");
    expect(r.dados.permuta).toBeUndefined();
    expect(r.resposta).not.toBe(PERMUTA_OK);
  });
  it("resumoPermuta e detalhesPermuta", () => {
    expect(resumoPermuta({ bem: "chácara", relato: ["em Piedade"] })).toBe('PERMUTA: chácara — "em Piedade"');
    expect(resumoPermuta({})).toBe("PERMUTA: bem oferecido pelo cliente");
    expect(detalhesPermuta("fica em Piedade, 2 alqueires, vale uns 400 mil")).toBe(3);
    expect(detalhesPermuta("sim")).toBe(0);
  });
});

describe("item 2: não repetir resposta", () => {
  const anterior = "Sobre a permuta, o corretor confirma com você na visita ou no contato. Quer saber mais algum detalhe?";
  it("mesma resposta (caso Jidelson 16:39/17:18) é detectada; resposta diferente não", () => {
    expect(respostaRepetida(anterior, ["Oi!", anterior])).toBe(true);
    expect(respostaRepetida("O condomínio é R$ 550 por mês e tem 2 vagas.", [anterior])).toBe(false);
    expect(respostaRepetida("Imagina!", ["Imagina!"])).toBe(false);
  });
  it("finalizarResposta: em vez de repetir, encaminha ao corretor", () => {
    const r: RespostaIa = { passo: "interesse", dados: {}, resposta: anterior, resposta_falha: null, fim: null, resumo: null };
    const f = finalizarResposta(r, "e a permuta?", [anterior], base);
    expect(f.fim).toBe("qualificado");
    expect(f.resposta).not.toBe(anterior);
    expect(f.resumo).toMatch(/não repetiu a resposta/);
  });
});

describe("item 3: troca não é busca + ortografia", () => {
  it("\"troca por terreno?\" = oferece terreno (caso Leonardo 09:42)", async () => {
    expect(bemPermuta("troca por terreno?")).toBe("terreno");
    const r = await responde(ctx(), "troca por terreno?");
    expect(r.dados.permuta?.etapa).toBe("detalhes");
    expect(r.busca).toBeUndefined();
    expect(r.resposta).toMatch(/Me conta um pouco do terreno/);
  });
  it("corrige \"Trabalamos\" e acentos comuns, sem mexer em link", () => {
    expect(corrigirOrtografia("Trabalamos com voce tambem. https://x/imovel")).toBe("Trabalhamos com você também. https://x/imovel");
  });
  it("finalizarResposta aplica a ortografia", () => {
    const r: RespostaIa = { passo: "interesse", dados: {}, resposta: "Trabalamos com financiamento.", resposta_falha: null, fim: null, resumo: null };
    expect(finalizarResposta(r, "financia?", [], base).resposta).toBe("Trabalhamos com financiamento.");
  });
});

describe("item 4: lembrete coerente", () => {
  it("visita pedida sem dia/período: pergunta dia e período, sem outras opções (caso Isabella 12:20)", () => {
    const t = textoCoerenteToque15("Isabella Teste", "Ótimo! Qual dia e período ficam melhores para a visita?");
    expect(t).toBe("Isabella, fico por aqui. Quando puder, me diz qual dia e período ficam melhores para a visita que eu aviso o corretor.");
    expect(t).not.toMatch(/op[cç]/i);
  });
  it("falta só o período: pergunta manhã ou tarde", () => {
    expect(textoCoerenteToque15("", "Perfeito, sábado. Fica melhor de manhã ou à tarde?")).toMatch(/manhã ou à tarde/);
  });
  it("permuta pendente: pede os detalhes do bem", () => {
    expect(textoCoerenteToque15("Leo", perguntaPermuta("terreno"))).toMatch(/me conta um pouco do terreno para eu avisar o corretor sobre a permuta/);
  });
  it("sem pergunta aberta: null (lembrete de sempre)", () => {
    expect(textoCoerenteToque15("Leo", "O condomínio é R$ 550.")).toBeNull();
  });
  it("textoToque15 com a chave usa o texto coerente sem chamar modelo; sem a chave, o de antes", async () => {
    const o = {
      cliente: "Isabella",
      historico: [{ autor: "ia" as const, texto: "Qual dia e período ficam melhores para a visita?" }],
      redige: false,
      escolha: { provedor: "gemini" as const, modelo: null },
      env: {},
    };
    expect((await textoToque15({ ...o, coerente: true })).texto).toMatch(/qual dia e período/);
    expect((await textoToque15({ ...o, coerente: false })).texto).not.toMatch(/qual dia e período ficam melhores para a visita que/);
  });
});
