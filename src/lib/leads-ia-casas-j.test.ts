// t_33fb109d: conversa de teste de Denis 75957c60 (lead d0d9b70b, apto 3691 no Parque Campolim, 28/10).
// Ao vivo: "tem alguma opção de casa neste valor ?" -> "as opções que tenho são apartamentos" (a busca de casa nem
// rodou); "veja se tem casas" -> passou ao corretor sem mostrar casa; "me manda casas" -> sem resposta.
// O XML da ZZ tem ~25 casas à venda em Sorocaba entre R$ 722 mil e R$ 977 mil (lido em 28/10, só leitura).
import { describe, expect, it, vi } from "vitest";
import { proximaResposta, type ContextoIa, type RespostaIa } from "./leads-ia";
import type { UsoModelo } from "./leads-ia-modelo";
import { redigirResposta, type FalaHistorico } from "./leads-ia-redacao";
import { buscasReferencia, ctxReferencia, ESTOQUE_ZZ, REFERENCIA } from "./leads-ia-referencia.dados";

const AGORA = new Date("2026-10-28T16:50:00Z");
const J = REFERENCIA.find((c) => c.id === "J")!;
const L = (c: string) => `https://vipsevenimoveis.com.br/imovel/${c}`;
const CASAS_FAIXA = new Set(ESTOQUE_ZZ.filter((x) => x.tipo === "casa" && x.preco_valor >= 722500 && x.preco_valor <= 977500).map((x) => x.codigo));
const codigoDe = (t: string) => /imovel\/([A-Z0-9]+)/.exec(t)?.[1] ?? null;

async function rodar(): Promise<RespostaIa[]> {
  const b = buscasReferencia(J);
  let c: ContextoIa = ctxReferencia(J);
  const out: RespostaIa[] = [];
  for (const f of J.falas) {
    const r = await proximaResposta(c, f.cliente, undefined, { agora: AGORA, ...b });
    out.push(r);
    c = { ...c, passo: r.passo, dados: r.dados, versao: c.versao + 1 };
  }
  return out;
}

describe("conversa J (75957c60) — Denis pediu casas e não recebeu", () => {
  it("roteiro: as 3 falas pedindo casa mostram uma casa DIFERENTE na faixa, com link, sem passar ao corretor", async () => {
    const rs = await rodar();
    if (process.env.REF_MOSTRAR) rs.forEach((r, i) => console.log(i, r.resposta));
    // 1ª parte segue igual: ficha e um apartamento parecido.
    expect(rs[0].resposta).toMatch(/3 quartos/);
    expect(rs[1].resposta).toMatch(/apartamento[^]*imovel\//);
    const casas = rs.slice(2);
    const vistos = new Set<string>();
    for (const r of casas) {
      expect(r.fim).toBeNull();
      expect(r.resposta).toMatch(/\bcasa\b/);
      expect(r.resposta).not.toMatch(/apartamento/);
      const cod = codigoDe(r.resposta);
      expect(cod).not.toBeNull();
      expect(CASAS_FAIXA.has(cod!)).toBe(true); // casa de verdade, perto de R$ 850.000
      expect(vistos.has(cod!)).toBe(false); // nunca repete
      vistos.add(cod!);
      expect(r.busca?.itens[0].tipo).toBe("casa");
      expect(r.intencao).toBe("opcoes"); // liga a trava sem_oferta no modelo
    }
    // A busca usa compra e a faixa do anúncio (nada de "comprar ou alugar?" / "qual bairro?" quando ele insiste).
    expect(casas[0].dados.busca2).toMatchObject({ tipo: "casa", finalidade: "comprar", ativa: true });
    expect(casas[0].dados.busca2?.faixa).toMatch(/850\.000/);
    for (const r of casas) expect(r.resposta).not.toMatch(/comprar ou (para )?alugar|qual bairro|quantos quartos|até quanto/i);
  });

  it("'veja se tem casas' respondendo a uma pergunta da busca (estado real gravado às 13:50) procura já", async () => {
    const b = buscasReferencia(J);
    const dados = { faixa: "perto de R$ 850.000", finalidade: "comprar" as const, parecidos: ["3693"], mostrados: [], busca2: { tipo: "casa", ativa: true, etapa: "finalidade" as const, perguntas: ["finalidade" as const], ofertados: [] } };
    const c: ContextoIa = { ...ctxReferencia(J), dados: dados as unknown as ContextoIa["dados"] };
    const r = await proximaResposta(c, "veja se tem casas", undefined, { agora: AGORA, ...b });
    expect(CASAS_FAIXA.has(codigoDe(r.resposta) ?? "-")).toBe(true);
    expect(r.dados.busca2?.etapa).toBeUndefined();
    expect(r.fim).toBeNull();
  });

  it("busca para OUTRA pessoa continua perguntando (o atalho é só para o próprio cliente)", async () => {
    const b = buscasReferencia(J);
    const r = await proximaResposta(ctxReferencia(J), "tem casa para o meu filho também?", undefined, { agora: AGORA, ...b });
    expect(r.resposta).toMatch(/\?$/);
    expect(r.resposta).not.toMatch(/imovel\//);
  });

  it("casa sem valor dito ('vcs trabalham com casa?') segue com as perguntas de antes", async () => {
    const b = buscasReferencia(J);
    const r = await proximaResposta(ctxReferencia(J), "vcs trabalham com casa?", undefined, { agora: AGORA, ...b });
    expect(r.resposta).toMatch(/^Trabalhamos sim!/);
    expect(r.resposta).not.toMatch(/imovel\//);
  });

  it("com o modelo: as falas reais de 13:50 ('só tenho apartamentos' e 'passar' sem casa) são barradas e sai a casa", async () => {
    const ruins = [
      { mensagem: "Entendido, você quer uma casa nessa faixa. Nesse momento, as opções que tenho são apartamentos. Quer ver este apartamento de 3 quartos por R$ 860.000 ou prefere que eu procure uma casa com características parecidas?", acao: "responder", codigo: null, registro: {} },
      { mensagem: "Entendi, você quer uma casa. Vou anotar isso para a equipe. Quer seguir vendo o apartamento de 3 quartos por R$ 860.000 ou prefere esperar novidades?", acao: "passar", codigo: null, registro: { nova_busca: "casa, faixa perto de R$ 850.000" } },
    ];
    const hist: FalaHistorico[] = [
      { autor: "ia", texto: J.primeira },
      { autor: "cliente", texto: "tem mais opções ?" },
      { autor: "ia", texto: J.falas[1].antes! },
    ];
    const { r, usos } = await rodarModelo({ parecidos: ["3693"], mostrados: [], faixa: "perto de R$ 850.000", finalidade: "comprar" }, "tem alguma opção de casa neste valor ?", ruins, "observar", hist);
    expect(usos.map((u) => u.bloqueio)).toEqual(["sem_oferta", "sem_oferta"]);
    expect(r.fim).toBeNull();
    expect(CASAS_FAIXA.has(codigoDe(r.resposta) ?? "-")).toBe(true);
    expect(r.resposta).not.toMatch(/são apartamentos|time de corretores/);
  });

  it("com o modelo: oferta certa de casa com link passa de primeira", async () => {
    const certo = { mensagem: `Tenho sim! Uma casa no Jardim Novo Horizonte, com 3 quartos e 129 m², por R$ 850.000. Dá uma olhada: ${L("VIP0150")} Gostou?`, acao: "oferecer", codigo: "VIP0150", registro: {} };
    const { r, usos } = await rodarModelo({ parecidos: ["3693"], mostrados: [], faixa: "perto de R$ 850.000", finalidade: "comprar" }, "tem alguma opção de casa neste valor ?", [certo], "observar", []);
    expect(usos[0].bloqueio).toBeNull();
    expect(r.resposta).toMatch(/VIP0150/);
    expect(r.dados.busca2?.ofertados).toContain("VIP0150");
  });
});

// --- apoio: redigirResposta com Gemini falso (sem rede) ---
const ENV = { LEADS_IA_MODELO: "gemini", GEMINI_API_KEY: "teste" };
const respostaGemini = (saida: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(saida) }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50 } }));
async function rodarModelo(dados: Record<string, unknown>, texto: string, saidas: unknown[], modo: "bloquear" | "observar", historico: FalaHistorico[]) {
  const fila = saidas.map(respostaGemini);
  const fetchFn = vi.fn(async () => fila.shift() ?? new Response("erro", { status: 500 })) as unknown as typeof fetch;
  const b = buscasReferencia(J);
  const c: ContextoIa = { ...ctxReferencia(J), dados: dados as ContextoIa["dados"] };
  const base = await proximaResposta(c, texto, undefined, { agora: AGORA, ...b });
  const usos: UsoModelo[] = [];
  const r = await redigirResposta(c, texto, base, {
    escolha: { provedor: "gemini", modelo: null },
    env: ENV,
    historico,
    buscarParecidos: b.buscarParecidos,
    buscarNome: b.buscarNome,
    registrar: (u) => usos.push(u),
    fetchFn,
    agora: AGORA,
    modo,
  });
  return { r, usos: usos.filter((u) => u.uso === "redigir") };
}
