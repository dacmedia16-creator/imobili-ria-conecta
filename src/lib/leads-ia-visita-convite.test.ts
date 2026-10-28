// t_66ad4609: Denis (28/10, conversa e3db2183): a Nicole oferece visita em quase toda resposta. Regra aprovada:
// 1) responde só o que foi perguntado; 2) convida só com sinal de interesse; 3) depois de convidar, 3 respostas sem
// convite; 4) ignorou ou \"agora não\" = para até o cliente puxar o assunto; 5) pediu visita = marca na hora.
import { describe, expect, it } from "vitest";
import { politicaVisita, proximaResposta, temConviteVisita, tirarConviteVisita, type ContextoIa } from "./leads-ia";
import { aplicarPoliticaVisita, INSTRUCAO, montarMensagens, redigirResposta, type FalaHistorico } from "./leads-ia-redacao";
import { buscasReferencia, ctxReferencia, REFERENCIA } from "./leads-ia-referencia.dados";

const AGORA = new Date("2026-10-27T13:00:00Z");
const K = REFERENCIA.find((c) => c.id === "K")!;
const L = REFERENCIA.find((c) => c.id === "L")!;
const ctx = ctxReferencia(K);
const h = (...falas: Array<[FalaHistorico["autor"], string]>): FalaHistorico[] => falas.map(([autor, texto]) => ({ autor, texto }));
const CONVITE = "O condomínio é R$ 550 por mês. Quer agendar uma visita para conhecer?";

describe("temConviteVisita / tirarConviteVisita", () => {
  it("reconhece os convites da conversa e3db2183 e não confunde com a frase do corretor", () => {
    expect(temConviteVisita(K.falas[0].antes!)).toBe(true);
    expect(temConviteVisita("Sobre a disponibilidade, o corretor confirma com você na visita ou no contato.")).toBe(false);
    expect(temConviteVisita("Tenho mais uma. Dá uma olhada: https://x/1 Gostou? Se quiser, marco uma visita.")).toBe(true);
    expect(temConviteVisita("Quer ver essa casa ou prefere seguir com os apartamentos?")).toBe(false);
  });
  it("tira só o convite: mantém o dado, o link e a frase do corretor", () => {
    expect(tirarConviteVisita(K.falas[1].antes!)).toBe("Sobre a disponibilidade, o corretor confirma com você na visita ou no contato.");
    expect(tirarConviteVisita("Dá uma olhada: https://x/822 Quer conhecer algum dos dois?")).toBe("Dá uma olhada: https://x/822");
    expect(tirarConviteVisita("Claro! Quer agendar uma visita?")).toBe("Claro! Quer saber mais algum detalhe?");
    expect(tirarConviteVisita("Essa é a casa. Quer visitar essa ou prefere seguir com os apartamentos?")).toBe("Essa é a casa. Prefere seguir com os apartamentos?");
    expect(tirarConviteVisita("Link: https://x/1 Prefere visitar ou ver outra opção?")).toBe("Link: https://x/1 Quer ver outra opção?");
  });
});

describe("politicaVisita (regras 1 a 5)", () => {
  const inicio = h(["ia", K.primeira]);
  it("1) sem sinal de interesse: não convida (detalhes, disponibilidade, mais opções)", () => {
    expect(politicaVisita(ctx, "me passa mais Detalhes", inicio).pode).toBe(false);
    expect(politicaVisita(ctx, "esta disponivel ?", inicio).pode).toBe(false);
    expect(politicaVisita(ctx, "vc tem mais opções ?", inicio).pode).toBe(false);
  });
  it("2) sinais de interesse: gostou, endereço, vaga, financiamento, fotos, visita", () => {
    for (const t of ["gostei desse", "qual o endereço?", "tem quantas vagas?", "aceita financiamento?", "tem fotos?", "da pra visitar?"])
      expect(politicaVisita(ctx, t, inicio).pode, t).toBe(true);
  });
  it("a 1ª mensagem fixa (\"...ou já prefere agendar uma visita?\") não conta como convite", () => {
    expect(politicaVisita(ctx, "gostei, tem quantas vagas?", inicio)).toMatchObject({ pode: true, motivo: "sinal" });
  });
  it("3) depois de convidar: 3 respostas sem convite, mesmo com sinal; na 4ª pode de novo", () => {
    const base = h(["ia", K.primeira], ["cliente", "tem vaga?"], ["ia", "Tem 2 vagas. Quer agendar uma visita?"], ["cliente", "sim, e o iptu?"]);
    // \"sim\" aceita o convite = pode (regra 5); as perguntas seguintes sem convite contam o intervalo.
    const r1 = h(...base.map((m) => [m.autor, m.texto] as [FalaHistorico["autor"], string]), ["ia", "O IPTU é R$ 54 por mês."]);
    expect(politicaVisita(ctx, "gostei, e as fotos?", r1)).toMatchObject({ pode: false, motivo: "intervalo" });
    const r2 = [...r1, { autor: "cliente" as const, texto: "e o condominio" }, { autor: "ia" as const, texto: "R$ 550." }];
    expect(politicaVisita(ctx, "gostei", r2).motivo).toBe("intervalo");
    const r3 = [...r2, { autor: "cliente" as const, texto: "quantos m2" }, { autor: "ia" as const, texto: "80 m²." }];
    expect(politicaVisita(ctx, "gostei bastante", r3)).toMatchObject({ pode: true, motivo: "sinal" });
  });
  it("3) o cliente puxou o assunto: pode mesmo no intervalo", () => {
    const hi = h(["ia", K.primeira], ["cliente", "tem vaga?"], ["ia", "Tem 2 vagas. Quer agendar uma visita?"], ["cliente", "ok"], ["ia", "Claro!"]);
    expect(politicaVisita(ctx, "quando podemos visitar ?", hi)).toMatchObject({ pode: true, motivo: "pedido" });
  });
  it("4) ignorou o convite: para e guarda a recusa; \"agora não\" também", () => {
    const hi = h(["ia", K.primeira], ["cliente", "tem vaga?"], ["ia", "Tem 2 vagas. Quer agendar uma visita?"]);
    expect(politicaVisita(ctx, "e o iptu?", hi)).toMatchObject({ pode: false, motivo: "recusou", recusada: true });
    expect(politicaVisita(ctx, "agora nao, e o iptu?", hi)).toMatchObject({ pode: false, recusada: true });
    const depois = { ...ctx, dados: { visita_recusada: true } };
    expect(politicaVisita(depois, "gostei bastante do ap", h(["ia", "R$ 54."]))).toMatchObject({ pode: false, motivo: "recusou" });
  });
  it("4/5) depois da recusa, o cliente pede visita: libera e marca", () => {
    const depois = { ...ctx, dados: { visita_recusada: true } };
    expect(politicaVisita(depois, "quero visitar sabado de manha", [])).toMatchObject({ pode: true, motivo: "pedido", recusada: false });
  });
  it("agendamento em andamento (dia sem período) segue", () => {
    expect(politicaVisita({ ...ctx, dados: { visita_dia_pendente: "sábado" } }, "de manha", []).pode).toBe(true);
  });
});

describe("no fluxo (plano B e prompt)", () => {
  it("o prompt manda não convidar por padrão e recebe convite_visita", () => {
    expect(INSTRUCAO).toMatch(/24\. Convite para visita: NÃO termine as respostas com convite/);
    expect(INSTRUCAO).not.toMatch(/registre em "registro\.pendente" e convide para a visita/);
    const m = montarMensagens({ ctx, texto: "x", historico: [], candidatos: [], visita: [], convite_visita: false });
    expect(m.usuario).toContain('"convite_visita":"nao"');
  });
  it("aplicarPoliticaVisita: tira o convite, guarda a recusa e não mexe na passagem ao corretor", () => {
    const r = { passo: "interesse" as const, dados: {}, resposta: CONVITE, resposta_falha: null, fim: null, resumo: null };
    expect(aplicarPoliticaVisita(r, { pode: false, motivo: "sem_sinal" }).resposta).toBe("O condomínio é R$ 550 por mês.");
    expect(aplicarPoliticaVisita(r, { pode: true, motivo: "sinal" }).resposta).toBe(CONVITE);
    expect(aplicarPoliticaVisita(r, { pode: false, motivo: "recusou", recusada: true }).dados).toMatchObject({ visita_recusada: true });
    const fim = { ...r, fim: "visita" as const, resposta: "Sábado de manhã anotado! Já pedi para {corretor} continuar." };
    expect(aplicarPoliticaVisita(fim, { pode: false, motivo: "sem_sinal" }).resposta).toBe(fim.resposta);
  });
  it("conversa L com o roteiro: só convida no \"gostei, vagas\"; depois do \"agora não\" nunca mais; o pedido marca na hora", async () => {
    const b = buscasReferencia(L);
    let c: ContextoIa = ctxReferencia(L);
    const hist: FalaHistorico[] = [{ autor: "ia", texto: L.primeira }];
    const saidas: Array<{ resposta: string; fim: string | null }> = [];
    for (const f of L.falas) {
      const base = await proximaResposta(c, f.cliente, undefined, { agora: AGORA, ...b });
      // Sem chave de modelo: sai o roteiro (plano B), já com a política aplicada.
      const r = await redigirResposta(c, f.cliente, base, { escolha: { provedor: "gemini", modelo: null }, env: {}, historico: [...hist], registrar: () => undefined, agora: AGORA });
      saidas.push(r);
      hist.push({ autor: "cliente", texto: f.cliente }, { autor: "ia", texto: r.resposta });
      c = { ...c, passo: r.passo, dados: r.dados, versao: c.versao + 1 };
    }
    const convites = saidas.map((s) => temConviteVisita(s.resposta));
    expect(convites[0]).toBe(false); // condomínio: sem sinal
    expect(convites[2]).toBe(false); // \"agora não\"
    expect(convites[3]).toBe(false); // financiamento, mas recusou
    expect(convites[4]).toBe(false); // gostou, mas recusou e não puxou o assunto
    expect(saidas[5].fim).toBe("visita"); // pediu: marca na hora
    expect(saidas[5].resposta).toMatch(/[Ss]ábado de manhã anotado/);
  });
});
