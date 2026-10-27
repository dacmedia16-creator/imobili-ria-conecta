import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  argsParecidos,
  bairroDesejado,
  MAX_PARECIDOS,
  normalizarParecidos,
  pedeOutrasOpcoes,
  PERGUNTA_PARECIDO,
  proximaResposta,
  textoParecido,
  valorFaixa,
  type ContextoIa,
  type FichaIa,
  type FiltroParecido,
  type ImovelParecido,
  type ResultadoParecidos,
  type RespostaIa,
} from "./leads-ia";

// Card t_232e13cb: Nicole oferece imóvel parecido do XML da imobiliária (regra das conversas da Laís).
// Conversas simuladas, busca SIMULADA (o banco foi testado em PG local: scripts/leads-ia-test/test_parecido.sql).
const MIG = readFileSync("supabase/migrations/20261027090000_leads_ia_imovel_parecido.sql", "utf8");
const RB = readFileSync("docs/sql/rollback/20261027090000_leads_ia_imovel_parecido.rollback.sql", "utf8");

const AGORA = new Date("2026-10-26T13:00:00Z");
const FICHA: FichaIa = { tipo: "apartamento", bairro: "Campolim", cidade: "Sorocaba", quartos: "3", suites: "1", vagas: "2", area_util_m2: "92" };
const P = (codigo: string, extra: Partial<ImovelParecido> = {}): ImovelParecido => ({
  codigo,
  tipo: "apartamento",
  bairro: "Campolim",
  cidade: "Sorocaba",
  quartos: "3",
  area_util_m2: "88",
  preco: "R$ 640.000,00",
  ...extra,
});
const CATALOGO = [P("VIP0101", { mesmo_condominio: true, url: "https://imob.exemplo.test/imovel/VIP0101" }), P("VIP0102"), P("VIP0103"), P("VIP0104")];

/** Busca simulada: devolve do catálogo o que não foi excluído, respeitando o limite. */
function buscaFake(catalogo = CATALOGO, referencia: ResultadoParecidos["referencia"] = { codigo: "VIP0028", no_xml: true, preco: 600000 }) {
  return vi.fn(async (f: FiltroParecido): Promise<ResultadoParecidos> => ({
    referencia,
    itens: f.negocio === "locacao" ? [] : catalogo.filter((i) => !f.excluir.includes(i.codigo)).slice(0, f.limite ?? 1),
  }));
}

const ctx = (p: Partial<ContextoIa> = {}): ContextoIa => ({
  conversa_id: "c",
  estado: "ativa",
  versao: 1,
  passo: "interesse",
  dados: {},
  ia_nome: "Nicole",
  lead_nome: "Maria",
  imovel: null,
  org_nome: "ZZ",
  transacao: "venda",
  anuncio_codigo: "VIP0028",
  tem_captacao: false,
  imovel_frase: "o apartamento do bairro Campolim",
  ficha: FICHA,
  imovel_fonte: "xml",
  ...p,
});

async function conversa(falas: string[], busca?: ReturnType<typeof buscaFake>, p: Partial<ContextoIa> = {}) {
  let c = ctx(p);
  const out: RespostaIa[] = [];
  for (const f of falas) {
    const r = await proximaResposta(c, f, undefined, { agora: AGORA, buscarParecidos: busca });
    out.push(r);
    c = { ...c, passo: r.passo, dados: r.dados, versao: c.versao + 1 };
    if (r.fim) break;
  }
  return out;
}
const PROIBIDO = /(disponivel|disponível|permuta|financ|andar)/i;
const ofertas = (rs: RespostaIa[]) => rs.filter((r) => /Tenho uma opção parecida/.test(r.resposta)).length;

describe("quando oferece (regra 1)", () => {
  it("(a) depois da qualificação PERGUNTA antes; só oferece se o cliente disser que sim", async () => {
    const busca = buscaFake();
    const rs = await conversa(["quero saber mais", "uns 600 mil", "financiamento", "sim, pode mostrar"], busca);
    expect(rs[2].resposta).toContain(PERGUNTA_PARECIDO);
    expect(rs[2].resposta).not.toMatch(/Tenho uma opção parecida/);
    expect(rs[3].resposta).toMatch(/Tenho uma opção parecida \(código VIP0101\)/);
    expect(rs[3].fim).toBeNull();
  });

  it("(a) cliente diz que não: volta ao roteiro (visita) sem oferecer", async () => {
    const rs = await conversa(["quero saber mais", "uns 600 mil", "financiamento", "não, obrigado"], buscaFake());
    expect(rs[3].resposta).toMatch(/^Tudo bem!/);
    expect(rs[3].resposta).toMatch(/pré-agendar uma visita/);
    expect(rs[3].fim).toBeNull();
    expect(ofertas(rs)).toBe(0);
  });

  it("(a) sem nenhum parecido no XML, nem pergunta: vai direto para a visita", async () => {
    const rs = await conversa(["quero saber mais", "uns 600 mil", "financiamento"], buscaFake([]));
    expect(rs[2].resposta).not.toContain(PERGUNTA_PARECIDO);
    expect(rs[2].resposta).toMatch(/pré-agendar uma visita/);
  });

  it("(c) cliente pede outras opções: oferece 1", async () => {
    const rs = await conversa(["tem outras opções parecidas?"], buscaFake());
    expect(rs[0].resposta).toMatch(/Tenho uma opção parecida \(código VIP0101\)/);
    expect(rs[0].dados.parecidos).toEqual(["VIP0101"]);
  });

  it("(b) quer alugar e o imóvel é de venda: diz com franqueza que só tem venda e passa ao corretor", async () => {
    const rs = await conversa(["quero saber mais", "na verdade quero alugar"], buscaFake());
    expect(rs[1].resposta).toMatch(/anunciado para venda/);
    expect(rs[1].resposta).toMatch(/Não encontrei agora uma opção de locação parecida no nosso catálogo, então vou pedir para um corretor entrar em contato com você\./);
    expect(rs[1].fim).toBe("qualificado");
    expect(rs[1].resposta).toContain("{corretor}");
    expect(rs[1].dados.faixa).toBeUndefined(); // "quero alugar" não vira faixa de valor
    expect(rs[1].resumo).toMatch(/Quer alugar/);
  });

  it("(b) faixa informada abaixo do preço do pedido: avisa e oferece um dentro da faixa", async () => {
    const busca = buscaFake(CATALOGO, { codigo: "VIP0028", no_xml: true, preco: 900000 });
    const rs = await conversa(["quero saber mais", "até 700 mil"], busca);
    expect(rs[1].resposta).toMatch(/acima da faixa que você comentou/);
    expect(rs[1].resposta).toMatch(/Tenho uma opção parecida/);
    expect(busca.mock.calls[0][0]).toMatchObject({ preco_max: 700000 });
    expect(rs[1].resposta).not.toMatch(/900/); // não cita o preço do pedido
  });

  it("(b) faixa compatível com o pedido: não oferece, segue a qualificação", async () => {
    const rs = await conversa(["quero saber mais", "até 700 mil"], buscaFake(CATALOGO, { codigo: "VIP0028", no_xml: true, preco: 600000 }));
    expect(rs[1].resposta).toMatch(/forma de pagamento/);
    expect(ofertas(rs)).toBe(0);
  });

  it("(b) fora do bairro desejado: avisa e oferece no bairro pedido", async () => {
    const busca = buscaFake([P("VIP0200", { bairro: "Jardim Europa" })]);
    const rs = await conversa(["prefiro no bairro Jardim Europa"], busca);
    expect(rs[0].resposta).toMatch(/fica no bairro Campolim/);
    expect(rs[0].resposta).toMatch(/VIP0200/);
    expect(busca.mock.calls[0][0]).toMatchObject({ bairro: "jardim europa" });
  });

  it("(b) anúncio saiu do XML: avisa e oferece parecido", async () => {
    const busca = buscaFake(CATALOGO, { codigo: "VIP0109", saiu: true, preco: 600000 });
    const rs = await conversa(["oi, quero saber mais"], busca, { ficha: null, imovel_fonte: null, anuncio_codigo: "VIP0109", imovel_frase: null, tem_captacao: false });
    expect(rs[0].resposta).toMatch(/não está mais no nosso catálogo atual/);
    expect(rs[0].resposta).toMatch(/Tenho uma opção parecida/);
  });

  it("sem buscarParecidos (servidor antigo): comportamento igual ao de antes", async () => {
    const rs = await conversa(["tem outras opções?", "uns 600 mil", "financiamento"]);
    expect(ofertas(rs)).toBe(0);
    expect(rs.map((r) => r.resposta).join(" ")).not.toContain(PERGUNTA_PARECIDO);
  });
});

describe("quantos e sem repetir (regra 3)", () => {
  it("1 por vez, até 3, nunca repete; no 4º pedido passa ao corretor", async () => {
    const busca = buscaFake();
    const rs = await conversa(["tem outras opções?", "tem outra?", "mais uma", "outra"], busca);
    expect(ofertas(rs)).toBe(3);
    expect(rs[2].dados.parecidos).toEqual(["VIP0101", "VIP0102", "VIP0103"]);
    expect(busca.mock.calls[1][0].excluir).toEqual(["VIP0101"]);
    expect(busca.mock.calls.every((c) => (c[0].limite ?? 1) === 1)).toBe(true);
    expect(rs[2].resposta).not.toMatch(/ver outra opção/); // na 3ª não oferece mais uma
    expect(rs[3].fim).toBe("qualificado");
    expect(rs[3].resposta).toMatch(/Já te mostrei as opções parecidas/);
    expect(MAX_PARECIDOS).toBe(3);
  });

  it("acabaram os parecidos: diz com franqueza e passa ao corretor", async () => {
    const rs = await conversa(["tem outras opções?", "tem outra?"], buscaFake([P("VIP0101")]));
    expect(rs[1].resposta).toMatch(/Não encontrei mais nenhuma opção parecida/);
    expect(rs[1].fim).toBe("qualificado");
  });

  it("nenhum parecido: diz com franqueza e passa ao corretor", async () => {
    const rs = await conversa(["tem algo parecido?"], buscaFake([]));
    expect(rs[0].resposta).toMatch(/não encontrei outra opção parecida/);
    expect(rs[0].fim).toBe("qualificado");
  });

  it("busca falhou (banco fora): não inventa nada, passa ao corretor", async () => {
    const rs = await conversa(["tem outras opções?"], vi.fn(async () => { throw new Error("x"); }) as never);
    expect(rs[0].fim).toBe("qualificado");
    expect(rs[0].resposta).not.toMatch(/Tenho uma opção|não encontrei/);
  });
});

describe("conteúdo e passagem (regra 4)", () => {
  it("texto só com dados do XML; nunca disponibilidade, permuta, financiamento ou andar", () => {
    const t = textoParecido(P("VIP0101", { mesmo_condominio: true, url: "https://imob.exemplo.test/imovel/VIP0101", vagas: "2" }), 1);
    expect(t).toBe(
      "Tenho uma opção parecida (código VIP0101): é um apartamento com 3 quartos, 2 vagas e 88 m² de área útil, no bairro Campolim, no mesmo condomínio. Está anunciado por R$ 640.000,00. Anúncio: https://imob.exemplo.test/imovel/VIP0101 Quer que eu peça ao corretor os detalhes desse imóvel, ou prefere ver outra opção?",
    );
    expect(t).not.toMatch(PROIBIDO);
    expect(textoParecido(P("X1", { preco: undefined, url: undefined }), 1)).not.toMatch(/anunciado|Anúncio/);
  });

  it("cliente se interessa: passa ao corretor registrando o código oferecido", async () => {
    const rs = await conversa(["tem outras opções?", "gostei, quero esse"], buscaFake());
    expect(rs[1].fim).toBe("qualificado");
    expect(rs[1].resposta).toMatch(/imóvel código VIP0101 para \{corretor\}, que confirma a disponibilidade/);
    expect(rs[1].dados.parecido_interesse).toBe("VIP0101");
    expect(rs[1].resumo).toMatch(/INTERESSE NO IMÓVEL PARECIDO código VIP0101/);
    expect(rs[1].resposta_falha).toBeTruthy();
  });

  it("quer visitar o parecido: passa ao corretor com o código (visita é com ele)", async () => {
    const rs = await conversa(["tem outras opções?", "quero visitar"], buscaFake());
    expect(rs[1].fim).toBe("qualificado");
    expect(rs[1].resposta).toMatch(/visitar o imóvel código VIP0101/);
  });

  it("dúvida sobre o parecido: responde só pelo XML; disponibilidade/permuta ficam com o corretor", async () => {
    const rs = await conversa(["tem outras opções?", "quantos quartos? aceita permuta? está disponível?"], buscaFake());
    expect(rs[1].fim).toBeNull();
    expect(rs[1].resposta).toMatch(/Tem 3 quartos/);
    expect(rs[1].resposta).toMatch(/Confirmo a disponibilidade com o corretor/);
    expect(rs[1].resposta).toMatch(/Sobre permuta, não tenho esse dado confirmado/);
    expect(rs[1].dados.parecido_atual?.codigo).toBe("VIP0101");
    expect(rs[1].dados.pendentes ?? []).toEqual([]); // pendências do pedido não se misturam
  });

  it("não gostou do parecido no meio da qualificação: segue a pergunta do roteiro", async () => {
    const rs = await conversa(["quero saber mais", "tem outras opções?", "não gostei"], buscaFake());
    expect(rs[2].resposta).toMatch(/^Tudo bem!/);
    expect(rs[2].resposta).toMatch(/faixa de valor/);
    expect(rs[2].fim).toBeNull();
  });

  it("não gostou durante a visita: volta às 2 opções de visita do imóvel pedido", async () => {
    const rs = await conversa(["quero saber mais", "uns 600 mil", "financiamento", "não", "tem outra opção?", "não"], buscaFake());
    expect(rs[3].passo).toBe("visita");
    expect(rs[4].resposta).toMatch(/Tenho uma opção parecida/);
    expect(rs[5].resposta).toMatch(/^Tudo bem! Sobre a visita: amanhã/);
    expect(rs[5].fim).toBeNull();
  });

  it("nenhuma resposta da conversa toca em disponibilidade garantida, permuta, financiamento ou andar do parecido", async () => {
    const rs = await conversa(["tem outras opções?", "tem outra?", "mais uma"], buscaFake());
    for (const r of rs) expect(r.resposta).not.toMatch(PROIBIDO);
  });
});

describe("ajudas", () => {
  it("pedeOutrasOpcoes", () => {
    for (const s of ["tem outras opções?", "Teria algo parecido?", "quero ver outros imóveis", "tem mais?", "algo mais barato", "tem outro apartamento?"])
      expect(pedeOutrasOpcoes(s), s).toBe(true);
    for (const s of ["quero saber mais", "qual o condomínio?", "outro dia eu vejo", "sim"]) expect(pedeOutrasOpcoes(s), s).toBe(false);
  });

  it("valorFaixa", () => {
    expect(valorFaixa("até 500 mil")).toEqual({ max: 500000 });
    expect(valorFaixa("entre 400 e 600 mil")).toEqual({ min: 400000, max: 600000 });
    expect(valorFaixa("a partir de 1 milhão")).toEqual({ min: 1000000 });
    expect(valorFaixa("uns 600 mil")).toEqual({ min: 510000, max: 690000 });
    expect(valorFaixa("R$ 750.000,00")).toEqual({ min: 637500, max: 862500 });
    expect(valorFaixa("de 1,2 a 1,5 milhões")).toEqual({ min: 1200000, max: 1500000 });
    expect(valorFaixa("3 quartos e 2 vagas")).toBeNull();
    expect(valorFaixa("não sei ainda")).toBeNull();
  });

  it("bairroDesejado", () => {
    expect(bairroDesejado("prefiro no bairro Jardim Europa")).toBe("jardim europa");
    expect(bairroDesejado("queria no condomínio Ibiti Royal, mas pode ser perto")).toBe("ibiti royal");
    expect(bairroDesejado("fica no bairro Campolim?")).toBeNull();
  });

  it("argsParecidos limita e limpa o que vai ao banco", () => {
    const a = argsParecidos("c", { excluir: [" A1 ", "", ...Array(30).fill("X")], negocio: "venda", preco_max: 7e5, preco_min: -1, limite: 9, bairro: "x".repeat(99) });
    expect(a._excluir).toHaveLength(20);
    expect(a._excluir[0]).toBe("A1");
    expect(a._preco_min).toBeNull();
    expect(a._preco_max).toBe(700000);
    expect(a._limite).toBe(3);
    expect(a._bairro).toHaveLength(60);
    expect(a._negocio).toBe("venda");
  });

  it("normalizarParecidos só aceita chaves conhecidas e link https", () => {
    const r = normalizarParecidos({
      referencia: { codigo: "P1", preco: 600000, saiu: true },
      itens: [
        { codigo: "A1", tipo: "apartamento", preco: "R$ 1,00", url: "javascript:alert(1)", corretor_telefone: "15999990000", andar: "5º" },
        { sem: "codigo" },
      ],
    });
    expect(r?.itens).toEqual([{ codigo: "A1", tipo: "apartamento", preco: "R$ 1,00" }]);
    expect(r?.referencia).toMatchObject({ codigo: "P1", preco: 600000, saiu: true });
    expect(normalizarParecidos(null)).toBeNull();
  });
});

describe("migration 20261027090000", () => {
  it("só cria a função de busca (só leitura), restrita ao servidor, com rollback", () => {
    expect(MIG).toMatch(/CREATE OR REPLACE FUNCTION public\.lead_ia_imoveis_parecidos/);
    expect(MIG).toMatch(/STABLE SECURITY DEFINER SET search_path TO ''/);
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION public\.lead_ia_imoveis_parecidos\([^)]*\)\s+FROM PUBLIC, anon, authenticated/);
    expect(MIG).toMatch(/GRANT EXECUTE ON FUNCTION public\.lead_ia_imoveis_parecidos\([^)]*\)\s+TO service_role/);
    expect(MIG).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER TABLE|DROP TABLE)\b/);
    expect(MIG).not.toMatch(/public\.lead_ia_reengaj|ia_reengajar/i);
    expect(MIG).not.toMatch(/'rua'|'numero'|corretor_(nome|email|telefone)'/);
    expect(RB).toMatch(/DROP FUNCTION IF EXISTS public\.lead_ia_imoveis_parecidos\(uuid, text\[\], numeric, numeric, text, text, integer, boolean, text\)/);
  });
});
