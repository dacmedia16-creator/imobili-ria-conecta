// t_6667db44: 3ª rodada da Nicole (bloqueio da trava 22% -> <10%) e conversa f3837c14 (casa 2542, referência I).
//  - repeticao: imóvel NOVO (link nunca mandado) não é repetição; pergunta repetida do cliente só barra cópia literal;
//    a pergunta final de sempre (\"Gostou?\") não conta. A resposta quase igual continua barrada.
//  - sem_oferta: condomínio pelo nome já mostrado (\"qual valor do cannes?\") pode responder só o valor.
//  - numero: \"encontrei 2 no Cannes\" = o \"achou\" da busca pelo nome.
//  - frase duplicada na mesma mensagem (07:58): limpeza antes das travas.
//  - \"pq enviou várias opções?\": regra 22 no prompt.
//  - perfil ativo do próprio cliente (casa -> apartamento) e reserva nunca com tipo diferente do pedido (09:24).
//  - travas firmes (anuncio, link, agenda, idioma, promessa, valor, IPTU, fotos, identidade) seguem iguais.
import { describe, expect, it, vi } from "vitest";
import { proximaResposta, type ContextoIa, type ImovelParecido } from "./leads-ia";
import type { UsoModelo } from "./leads-ia-modelo";
import {
  INSTRUCAO,
  limparMensagem,
  permitidosDe,
  redigirResposta,
  semelhancaResposta,
  travasAnuncioRepeticao,
  validarRedacaoDetalhe,
  type FalaHistorico,
  type SaidaModelo,
} from "./leads-ia-redacao";
import { buscasReferencia, ctxReferencia, ESTOQUE_ZZ, REFERENCIA } from "./leads-ia-referencia.dados";

const AGORA = new Date("2026-10-28T12:00:00Z");
const s = (mensagem: string, extra: Partial<SaidaModelo> = {}): SaidaModelo => ({ mensagem, acao: "responder", codigo: null, registro: {}, ...extra });
const im = (codigo: string): ImovelParecido => {
  const { preco_valor: _p, tipo_xml: _t, busca_texto: _b, ...r } = ESTOQUE_ZZ.find((x) => x.codigo === codigo)! as (typeof ESTOQUE_ZZ)[number];
  return r;
};
const L = (c: string) => `https://vipsevenimoveis.com.br/imovel/${c}`;
const I = REFERENCIA.find((c) => c.id === "I")!;
const H = REFERENCIA.find((c) => c.id === "H")!;
const A = REFERENCIA.find((c) => c.id === "A")!;

describe("repeticao — casos legítimos passam (rodada 'antes': 20 de 33 bloqueios)", () => {
  it("imóvel NOVO com a frase de sempre não é repetição (A: 'nesta mesma faixa' -> 3920 depois da 3921)", () => {
    const p = permitidosDe(A.ficha, [im("3920"), im("3921")], []);
    p.anteriores = [`Tenho sim! Tem outra casa no mesmo condominio, com 3 quartos e 167 m², por R$ 1.220.000. Dá uma olhada: ${L("3921")} Gostou?`];
    p.linksMandados = new Set([L("3921")]);
    const nova = `Nessa faixa, tenho outra casa no mesmo condominio, com 3 quartos e 160 m², por R$ 1.175.000. Dá uma olhada: ${L("3920")} Gostou?`;
    expect(travasAnuncioRepeticao(nova, p)).toBeNull();
  });
  it("mesmo imóvel, mesma frase: continua barrado (a trava não foi afrouxada)", () => {
    const p = permitidosDe(H.ficha, [im("VIP0136")], []);
    const ant = `O apartamento no Cannes que tenho é R$ 999.000, com 3 quartos e 1 suíte. Dá uma olhada: ${L("VIP0136")} Quer ver esse?`;
    p.anteriores = [ant];
    p.linksMandados = new Set([L("VIP0136")]);
    expect(travasAnuncioRepeticao(`Claro! ${ant}`, p)?.motivo).toBe("repeticao");
    // 7ebaa6bb: a mesma resposta 5 vezes (\"perto de R$ 900.000… prefere com 1 suíte?\") segue barrada.
    const presa = "Entendi! No Campolim, perto de R$ 900.000, temos o apartamento com 2 suítes que te mostrei. Quer ver esse ou prefere que eu procure com 1 suíte?";
    p.anteriores = [presa];
    expect(travasAnuncioRepeticao(presa.replace("Entendi!", "Entendido!"), p)?.motivo).toBe("repeticao");
  });
  it("cliente perguntou de novo o mesmo dado: resposta com outras palavras passa; cópia literal barra", () => {
    const p = permitidosDe(H.ficha, [im("VIP0136")], []);
    const ant = `O apartamento no Cannes é R$ 999.000, com 3 quartos e 1 suíte. Quer agendar uma visita para conhecer?`;
    p.anteriores = [ant];
    p.linksMandados = new Set([L("VIP0136")]);
    p.reperguntou = true;
    expect(travasAnuncioRepeticao("O do Cannes sai por R$ 999.000, com 3 quartos. Quer que eu te mande o link de novo?", p)).toBeNull();
    expect(travasAnuncioRepeticao(ant, p)?.motivo).toBe("repeticao");
  });
  it("a pergunta final de sempre não faz duas respostas diferentes virarem repetição", () => {
    const a = "As fotos estão todas no anúncio: https://x/imovel/1 Quer agendar a visita para essa casa?";
    const b = "A casa tem 3 quartos, 2 suítes e 164 m² de área. Quer agendar a visita para essa casa?";
    expect(semelhancaResposta(a, b)).toBeLessThan(0.6);
  });
});

describe("sem_oferta e numero — falsos positivos do Cannes", () => {
  const dadosH = { faixa: "perto de 900 mil", nome_busca: "cannes", mostrados: [im("VIP0136")] };
  const histCannes: FalaHistorico[] = [
    { autor: "cliente", texto: "Tem cannes ??" },
    { autor: "ia", texto: `No Cannes tenho um apartamento com 3 quartos, por R$ 999.000: ${L("VIP0136")} Quer ver?` },
  ];
  it("'Qual valor do cannes?' depois do link: responder só o valor passa (antes: sem_oferta 6 de 6)", async () => {
    const { r, usos } = await rodarGemini(H, dadosH, "Qual valor do cannes ?", [
      { mensagem: "O apartamento no Cannes sai por R$ 999.000. Quer agendar uma visita?", acao: "responder", codigo: null, registro: {} },
    ], "observar", histCannes);
    expect(usos[0].bloqueio).toBeNull();
    expect(r.resposta).toMatch(/999\.000/);
  });
  it("'Tem cannes??' na 1ª vez: sem o link continua barrado (sem_oferta firme)", async () => {
    const { usos } = await rodarGemini(H, { faixa: "perto de 900 mil" }, "Tem cannes ??", [
      { mensagem: "O apartamento no Cannes é R$ 999.000. Quer agendar uma visita?", acao: "responder", codigo: null, registro: {} },
      { mensagem: "O apartamento no Cannes é R$ 999.000. Quer agendar uma visita?", acao: "responder", codigo: null, registro: {} },
    ], "observar");
    expect(usos[0].bloqueio).toBe("sem_oferta");
  });
  it("'encontrei 2 no Cannes' passa (achou=2); 'encontrei 5' continua 'numero'", () => {
    const p = permitidosDe(H.ficha, [im("VIP0136"), im("822")], []);
    p.achouNome = 2;
    const m = (n: number) => `Encontrei ${n} imóveis no condomínio Cannes. Um apartamento com 3 quartos e 1 suíte, por R$ 999.000. Dá uma olhada: ${L("VIP0136")} Gostou?`;
    expect(validarRedacaoDetalhe(s(m(2), { acao: "oferecer", codigo: "VIP0136" }), p, "Tem cannes ??")).toBeNull();
    expect(validarRedacaoDetalhe(s(m(5), { acao: "oferecer", codigo: "VIP0136" }), p, "Tem cannes ??")?.motivo).toBe("numero");
  });
});

describe("reserva do Cannes varia a frase (pendência do t_228659f0)", () => {
  it("3 perguntas seguidas com as 2 tentativas barradas = 3 frases diferentes, todas com dado do XML", async () => {
    const ruim = { mensagem: "No Cannes tem por R$ 850.000. Quer ver?", acao: "responder", codigo: null, registro: {} };
    const hist: FalaHistorico[] = [];
    const saidas: string[] = [];
    let dados: Record<string, unknown> = { faixa: "perto de 900 mil" };
    for (const t of ["Tem cannes ??", "Qual valor do cannes q vc tem ?", "Me manda o cannes q vc tem"]) {
      const { r } = await rodarGemini(H, dados, t, [ruim, ruim], "bloquear", [...hist]);
      saidas.push(r.resposta);
      hist.push({ autor: "cliente", texto: t }, { autor: "ia", texto: r.resposta });
      dados = r.dados as Record<string, unknown>;
    }
    expect(new Set(saidas).size).toBe(3);
    for (const x of saidas) expect(x).toMatch(/R\$ (999\.000|1\.100\.000)/);
    expect(saidas.join(" ")).not.toMatch(/850/);
  });
});

describe("f3837c14 ponto 1 — frase duplicada na mesma mensagem (07:58)", () => {
  const AO_VIVO = `Entendi! Tem outra casa no Ibiti Royal Park, com 3 suítes e 265 m², por R$ 1.440.000. Dá uma olhada: ${L("2545")} Gostou? Quer ver essa ou prefere agendar a visita na outra? Quer ver essa ou prefere agendar a visita na outra?`;
  it("a limpeza corta a pergunta repetida e o 'Gostou?' extra; sobra 1 pergunta", () => {
    const m = limparMensagem(AO_VIVO);
    expect(m).toBe(`Entendi! Tem outra casa no Ibiti Royal Park, com 3 suítes e 265 m², por R$ 1.440.000. Dá uma olhada: ${L("2545")} Quer ver essa ou prefere agendar a visita na outra?`);
    expect(m.match(/\?/g)).toHaveLength(1);
  });
  it("não mexe em mensagem sem repetição nem em 'Gostou?' sozinho no fim", () => {
    const ok = `Tenho sim! Tem outra casa no Ibiti Royal Park, com 3 suítes e 236 m², por R$ 1.450.000. Dá uma olhada: ${L("2538")} Gostou?`;
    expect(limparMensagem(ok)).toBe(ok);
  });
  it("no fluxo: a mensagem do modelo sai limpa e sem bloqueio de 'perguntas'", async () => {
    const { r, usos } = await rodarGemini(I, { parecidos: ["2538"], mostrados: [im("2538")], parecido_atual: im("2538") }, "Tem mais opções ?", [
      { mensagem: AO_VIVO, acao: "oferecer", codigo: "2545", registro: {} },
    ], "observar", [], async () => ({ referencia: {}, itens: [im("2545"), im("2544")] }));
    expect(usos[0].bloqueio).toBeNull();
    expect(r.resposta.match(/Quer ver essa/g)).toHaveLength(1);
  });
});

describe("f3837c14 ponto 2 — 'pq enviou várias opções?'", () => {
  it("o prompt manda explicar em 1 frase o que fez e perguntar como seguir (regra 22, com exemplo)", () => {
    expect(INSTRUCAO).toMatch(/22\. Reclamação ou "por quê\?"[^\n]*explique em 1 frase[^\n]*pergunte como ele prefere seguir/);
    expect(INSTRUCAO).toMatch(/Cliente: "pq enviou várias opções\?" -> "Te mandei outras opções porque você pediu mais\./);
  });
});

describe("f3837c14 ponto 3 (GRAVE) — perfil apartamento do próprio cliente", () => {
  // Estado real gravado na conversa depois de \"3 dormitórios\" e \"pq enviou...\" (lido em 28/10, só leitura).
  const dadosReal = () => ({
    parecidos: ["2538", "2545"],
    parecido_atual: im("2545"),
    mostrados: [im("2538"), im("2545"), im("3968")],
    faixa: "3 dormitórios",
    busca2: { tipo: "apartamento", ativa: false, faixa: "3 dormitórios", regiao: "Campolim", quartos: 3, ofertados: ["3968"], perguntas: ["finalidade", "regiao", "faixa"], finalidade: "comprar" as const },
  });
  it("roteiro: 'manda mais opções de ap' usa o perfil apartamento (Campolim, 3 quartos), nunca uma casa", async () => {
    const b = buscasReferencia(I);
    const c: ContextoIa = { ...ctxReferencia(I), dados: dadosReal() as ContextoIa["dados"] };
    const r = await proximaResposta(c, "manda mais opções de ap", undefined, { agora: AGORA, ...b });
    expect(r.resposta).not.toMatch(/imovel\/(25\d\d)\b/);
    expect(r.resposta).toMatch(/imovel\/(3830|VIP0054|3677)\b/);
    expect(r.dados.busca2?.ativa).toBe(true);
    expect(r.busca?.itens[0].tipo).toBe("apartamento");
  });
  it("trava 'perfil': o apartamento certo passa; a casa barra", async () => {
    const certo = { mensagem: `Tenho outro apartamento no Parque Campolim, com 3 quartos e 84 m², por R$ 569.000. Dá uma olhada: ${L("3830")} Gostou?`, acao: "oferecer", codigo: "3830", registro: {} };
    const ok = await rodarGemini(I, dadosReal(), "manda mais opções de ap", [certo], "observar", [], undefined, true);
    expect(ok.usos[0].bloqueio).toBeNull();
    expect(ok.r.resposta).toMatch(/3830/);
    const casa = { mensagem: `Tenho mais uma no mesmo bairro, com 3 quartos e 226 m², por R$ 1.420.000. Dá uma olhada: ${L("2544")} Gostou?`, acao: "responder", codigo: null, registro: {} };
    const ruim = await rodarGemini(I, dadosReal(), "manda mais opções de ap", [casa, casa], "observar", [], undefined, true);
    expect(ruim.r.resposta).not.toMatch(/2544/);
  });
  it("reserva nunca manda tipo diferente do pedido; sem apartamento, diz isso", async () => {
    const casa = { mensagem: `Tenho mais uma no mesmo bairro, por R$ 1.420.000. Dá uma olhada: ${L("2544")} Gostou?`, acao: "responder", codigo: null, registro: {} };
    // Estoque sem nenhum outro apartamento: o roteiro cairia numa casa.
    const sem = { ...dadosReal(), busca2: { ...dadosReal().busca2, ofertados: ["3968", "3830", "VIP0054"] } };
    const { r, usos } = await rodarGemini(I, sem, "manda mais opções de ap", [casa, casa], "bloquear", [], undefined, true);
    expect(r.resposta).not.toMatch(/imovel\/25\d\d/);
  });
  it("busca de OUTRA pessoa (filho) continua separada: pergunta solta volta ao imóvel do lead", async () => {
    const b = buscasReferencia(I);
    const dados = { busca2: { tipo: "apartamento", para: "o filho", ativa: true, regiao: "Campolim", quartos: 3, finalidade: "comprar" as const, perguntas: ["finalidade", "regiao", "quartos"], ofertados: ["3968"], atual: im("3968") } };
    const c: ContextoIa = { ...ctxReferencia(I), dados: dados as ContextoIa["dados"] };
    const r = await proximaResposta(c, "pq enviou varios opçoes ?", undefined, { agora: AGORA, ...b });
    expect(r.dados.busca2?.ativa).toBe(false);
  });
});

describe("travas firmes continuam barrando (não foram afrouxadas)", () => {
  const p = () => {
    const x = permitidosDe(H.ficha, [im("VIP0036"), im("VIP0136")], []);
    x.linksMandados = new Set();
    return x;
  };
  it.each([
    ["anuncio", `Tenho um apartamento com 2 suítes por R$ 850.000. Dá uma olhada: ${L("VIP0036")} Gostou?`],
    ["link", "Dá uma olhada: https://vipsevenimoveis.com.br/imovel/9999 Gostou?"],
    ["agenda", "Temos visita amanhã de manhã ou sexta à tarde. Qual prefere?"],
    ["idioma", "Trabajamos con eso. ¿Tu hijo busca comprar?"],
    ["promessa", "Garanto que fica pronto. Quer visitar?"],
    ["valor", "A casa sai por R$ 640.000. Quer visitar?"],
    ["identidade", "Sou corretora da ZZ. Quer visitar?"],
  ])("%s", (motivo, msg) => {
    expect(validarRedacaoDetalhe(s(msg), p(), "oi")?.motivo).toBe(motivo);
  });
  it("iptu e fotos", () => {
    const x = p();
    x.iptuPeriodo = null;
    expect(validarRedacaoDetalhe(s("O IPTU é R$ 120,00 por ano. Quer visitar?"), x, "iptu?")?.motivo).toBe("iptu");
    x.fotos = { link: L("VIP0137") };
    expect(validarRedacaoDetalhe(s("Te mando as fotos! Quer visitar?"), x, "fotos?")?.motivo).toBe("fotos");
  });
});

// --- apoio: redigirResposta com Gemini falso (sem rede) ---
const ENV = { LEADS_IA_MODELO: "gemini", GEMINI_API_KEY: "teste" };
const respostaGemini = (saida: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(saida) }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50 } }));
async function rodarGemini(
  conv: (typeof REFERENCIA)[number],
  dados: Record<string, unknown>,
  texto: string,
  saidas: unknown[],
  modo: "bloquear" | "observar",
  historico: FalaHistorico[] = [],
  parecidos?: () => Promise<{ referencia: object; itens: ImovelParecido[] }>,
  comBuscas = false,
) {
  const fila = saidas.map(respostaGemini);
  const fetchFn = vi.fn(async () => fila.shift() ?? new Response("erro", { status: 500 })) as unknown as typeof fetch;
  const b = buscasReferencia(conv);
  const c: ContextoIa = { ...ctxReferencia(conv), dados: dados as ContextoIa["dados"] };
  const vazio = parecidos ?? (async () => ({ referencia: {}, itens: [] }));
  const extra = comBuscas ? b : { buscarParecidos: vazio };
  const base = await proximaResposta(c, texto, undefined, { agora: AGORA, ...extra });
  const usos: UsoModelo[] = [];
  const r = await redigirResposta(c, texto, base, {
    escolha: { provedor: "gemini", modelo: null },
    env: ENV,
    historico,
    buscarParecidos: comBuscas ? b.buscarParecidos : vazio,
    buscarNome: b.buscarNome,
    registrar: (u) => usos.push(u),
    fetchFn,
    agora: AGORA,
    modo,
  });
  return { r, usos: usos.filter((u) => u.uso === "redigir"), dados: r.dados };
}
