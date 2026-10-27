import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  argsBusca,
  pedeOutrasOpcoes,
  proximaResposta,
  type ContextoIa,
  type FichaIa,
  type FiltroBusca,
  type FiltroParecido,
  type ImovelParecido,
  type ResultadoParecidos,
  type RespostaIa,
} from "./leads-ia";

// Card t_5b493bc9: teste real de Denis (27/10/2026, lead 4c2e125f, ZZ, VIP0119). "A ideia é que a pessoa pense
// que está falando com uma pessoa real." Ficha e imóveis abaixo = dados REAIS do XML da ZZ (lidos só para
// leitura em 27/10); busca SIMULADA com eles (a função do banco é testada em PG local:
// scripts/leads-ia-test/test_busca_nova.sql).
const MIG = readFileSync("supabase/migrations/20261027110000_leads_ia_busca_nova.sql", "utf8");
const RB = readFileSync("docs/sql/rollback/20261027110000_leads_ia_busca_nova.rollback.sql", "utf8");

const AGORA = new Date("2026-10-27T03:16:00Z"); // terça, 00:16 em Brasília (hora do teste de Denis)
const VIP0119: FichaIa = {
  tipo: "casa",
  bairro: "Condominio Ibiti Reserva",
  cidade: "Sorocaba",
  quartos: "3",
  suites: "1",
  banheiros: "3",
  vagas: "4",
  area_util_m2: "150",
  area_terreno_m2: "250",
  condominio: "R$ 420,00",
  iptu: "R$ 100,00 por mês",
  negocio: "venda",
  preco: "R$ 1.199.000",
  preco_valor: 1199000,
  link: "https://vipsevenimoveis.com.br/imovel/VIP0119",
};
// lead_ia_imoveis_parecidos para esta conversa, em produção (somente leitura, 27/10): 3921, 3920, 2501.
const PARECIDOS: ImovelParecido[] = [
  { codigo: "3921", tipo: "casa", bairro: "Condominio Ibiti Reserva", cidade: "Sorocaba", quartos: "3", suites: "1", vagas: "4", area_util_m2: "167", preco: "R$ 1.220.000", url: "https://vipsevenimoveis.com.br/imovel/3921", mesmo_bairro: true },
  { codigo: "3920", tipo: "casa", bairro: "Condominio Ibiti Reserva", cidade: "Sorocaba", quartos: "3", suites: "2", vagas: "4", area_util_m2: "160", preco: "R$ 1.175.000", url: "https://vipsevenimoveis.com.br/imovel/3920", mesmo_bairro: true },
  { codigo: "2501", tipo: "casa", bairro: "Condominio Ibiti Reserva", cidade: "Sorocaba", quartos: "3", suites: "3", vagas: "4", area_util_m2: "169", area_terreno_m2: "250", preco: "R$ 1.150.000", url: "https://vipsevenimoveis.com.br/imovel/2501", mesmo_bairro: true },
];
// Apartamentos reais da ZZ no Parque Campolim (XML de 27/10).
const APTOS = [
  { codigo: "VIP0158", quartos: "2", area_util_m2: "47", valor: 350000 },
  { codigo: "3931", quartos: "2", area_util_m2: "51", valor: 351000 },
  { codigo: "3656", quartos: "1", area_util_m2: "47", valor: 389000 },
  { codigo: "3861", quartos: "2", area_util_m2: "48", valor: 415000 },
].map((a) => ({ ...a, tipo: "apartamento", bairro: "Parque Campolim", cidade: "Sorocaba", url: `https://vipsevenimoveis.com.br/imovel/${a.codigo}` }));

const buscaParecidos = () =>
  vi.fn(async (f: FiltroParecido): Promise<ResultadoParecidos> => ({
    referencia: { codigo: "VIP0119", no_xml: true, tipo: "casa", bairro: "Condominio Ibiti Reserva", cidade: "Sorocaba", preco: 1199000 },
    itens: PARECIDOS.filter((p) => !f.excluir.includes(p.codigo)).slice(0, f.limite ?? 1),
  }));
/** Mesma regra da função do banco: tipo, região, faixa; ordem pelo preço mais perto do teto. */
const buscaImoveis = () =>
  vi.fn(async (f: FiltroBusca): Promise<ResultadoParecidos> => {
    const max = f.preco_max ?? 1e12;
    const itens = APTOS.filter((a) => (!f.tipo || a.tipo === f.tipo) && a.valor <= max && (!f.regiao || a.bairro.toLowerCase().includes(f.regiao)))
      .filter((a) => !f.excluir.includes(a.codigo))
      .sort((a, b) => Math.abs(a.valor - max) - Math.abs(b.valor - max))
      .slice(0, f.limite ?? 1)
      .map(({ valor, ...a }) => ({ ...a, preco: `R$ ${valor.toLocaleString("pt-BR")}` }));
    return { referencia: {}, itens };
  });

const ctx = (p: Partial<ContextoIa> = {}): ContextoIa => ({
  conversa_id: "501cd380",
  estado: "ativa",
  versao: 1,
  passo: "interesse",
  dados: {},
  ia_nome: "Nicole",
  lead_nome: "Denis (teste)",
  imovel: null,
  org_nome: "ZZ Teste Provisionamento",
  transacao: "venda",
  anuncio_codigo: "VIP0119",
  tem_captacao: false,
  imovel_frase: "a casa do bairro Condominio Ibiti Reserva",
  ficha: VIP0119,
  imovel_fonte: "xml",
  ...p,
});

async function conversa(falas: string[], p: Partial<ContextoIa> = {}) {
  let c = ctx(p);
  const bp = buscaParecidos();
  const bi = buscaImoveis();
  const out: RespostaIa[] = [];
  for (const f of falas) {
    const r = await proximaResposta(c, f, undefined, { agora: AGORA, buscarParecidos: bp, buscarImoveis: bi });
    out.push(r);
    c = { ...c, passo: r.passo, dados: r.dados, versao: c.versao + 1 };
    if (r.fim) break;
  }
  return { out, bp, bi };
}
const responde = async (t: string, p: Partial<ContextoIa> = {}) =>
  (await proximaResposta(ctx(p), t, undefined, { agora: AGORA, buscarParecidos: buscaParecidos(), buscarImoveis: buscaImoveis() })).resposta;

/** O que nunca pode aparecer no tom novo (itens 2, 3, 7, 8, 9, 10, 12, 13). */
const ROBO = /(Proposta e negocia|faixa de valor|forma de pagamento|à vista ou com financiamento|quem confirma é o corretor|peça ao corretor|pedir ao corretor|\(código|código \w|Tenho uma opção parecida|pré-agendamento: o corretor|não sou uma pessoa|assistente virtual|Encaminhei|Está anunciado|R\$ [\d.]+,00)/;

// A conversa real de Denis, refeita (1ª mensagem: texto do banco, que não muda neste card).
const PRIMEIRA =
  "Oi, Denis! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse na casa de 3 quartos no bairro Condominio Ibiti Reserva, em Sorocaba, anunciada por R$ 1.199.000. Anúncio: https://vipsevenimoveis.com.br/imovel/VIP0119 Quer saber mais detalhes ou já prefere agendar uma visita?";
const FALAS = [
  "qual valor do Condominio ?",
  "tem mais opçõe s?",
  "nesta mesma faixa",
  "me manda mais opção primeiro",
  "tem mais opções ?",
  "eu queria ver um imovel para o meu filho tb vcs trabalha com apartamento ?",
  "comprar",
  "no campolim",
  "até 400 mil",
  "gostei",
];
const ESPERADO = [
  "O condomínio é de R$ 420 por mês. Quer agendar uma visita para conhecer?",
  "Tenho sim! Tem outra casa no mesmo condomínio, com 3 quartos e 167 m², por R$ 1.220.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3921 Gostou? Se quiser, marco uma visita para você ver as duas.",
  "Tenho mais uma no mesmo condomínio, com 3 quartos e 160 m², por R$ 1.175.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3920 Gostou? Se quiser, marco uma visita.",
  "Tenho mais uma no mesmo condomínio, com 3 quartos e 169 m², por R$ 1.150.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/2501 Gostou? Se quiser, marco uma visita.",
  "Essas são as opções que tenho agora nesse perfil. Gostou de alguma? Se quiser, marco uma visita.",
  "Trabalhamos sim! Para o seu filho, seria para comprar ou para alugar?",
  "Perfeito! E em qual bairro ou região de Sorocaba ele prefere?",
  "Certo! E até quanto ele pensa em investir?",
  "Ótimo! Achei um apartamento no bairro Parque Campolim, em Sorocaba, com 1 quarto e 47 m², por R$ 389.000. Dá uma olhada: https://vipsevenimoveis.com.br/imovel/3656 O que acha? Se quiser, te mando outra opção.",
  "Que bom que gostou! Já pedi para {corretor} te chamar aqui para combinar a visita desse apartamento.",
];

describe("conversa real do lead 4c2e125f (27/10), refeita", () => {
  it("cada resposta, com o tom novo", async () => {
    const { out, bp, bi } = await conversa(FALAS);
    const linhas = [`Nicole: ${PRIMEIRA}`];
    FALAS.forEach((f, i) => linhas.push(`Cliente: ${f}`, `Nicole: ${out[i]?.resposta ?? "(sem resposta)"}`));
    if (process.env.PREVIA_OUT) writeFileSync(process.env.PREVIA_OUT, `${linhas.join("\n")}\n\nResumo para o corretor: ${out.at(-1)?.resumo}\n`);
    expect(out.map((r) => r.resposta)).toEqual(ESPERADO);
    for (const r of out) {
      expect(r.resposta, r.resposta).not.toMatch(ROBO);
      expect(r.resposta).not.toMatch(/^Obrigada!/);
      expect((r.resposta.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
    }
    // Itens 6 e 7: parecido logo no 1º pedido, com faixa = preço do imóvel (±15% no banco), sem perguntar pagamento.
    expect(bp.mock.calls[0][0]).toMatchObject({ negocio: "venda", excluir: [], preco_min: null, preco_max: null });
    expect(out.slice(0, 5).map((r) => r.passo)).not.toContain("pagamento");
    // Item 11: a busca nova é registrada para o corretor, sem perder o interesse na casa.
    const fim = out.at(-1)!;
    expect(fim.fim).toBe("qualificado");
    expect(fim.resposta_falha).toBe("Que bom que gostou! Anotei tudo aqui e já te retorno por aqui.");
    expect(fim.resumo).toMatch(/Imóvel: a casa do bairro Condominio Ibiti Reserva; anúncio VIP0119/);
    expect(fim.resumo).toMatch(/parecidos oferecidos pela IA: 3921, 3920, 2501/);
    expect(fim.resumo).toMatch(/SEGUNDA BUSCA \(para o filho\): apartamento, para comprar, região campolim, faixa até 400 mil, oferecidos: 3656, INTERESSE no código 3656/);
    expect(bi.mock.calls[0][0]).toMatchObject({ tipo: "apartamento", negocio: "venda", preco_max: 400000, regiao: "campolim", cidade: "Sorocaba", excluir: [] });
  });
});

describe("pergunta objetiva: só o dado, 1 ou 2 frases, e 1 pergunta natural", () => {
  it("condomínio (o caso exato de Denis)", async () => {
    expect(await responde("qual valor do Condominio ?")).toBe("O condomínio é de R$ 420 por mês. Quer agendar uma visita para conhecer?");
  });
  it("IPTU, área, vagas, quartos, valor e bairro", async () => {
    const casos: [string, string][] = [
      ["quanto é o IPTU?", "O IPTU é de R$ 100 por mês."],
      ["qual a metragem?", "A casa tem 150 m², num terreno de 250 m²."],
      ["tem garagem?", "A casa tem 4 vagas de garagem."],
      ["quantas vagas?", "A casa tem 4 vagas de garagem."],
      ["quantos quartos?", "A casa tem 3 quartos, sendo 1 suíte."],
      ["qual o valor?", "A casa está anunciada por R$ 1.199.000."],
      ["qual o bairro?", "Fica no Condominio Ibiti Reserva, em Sorocaba. O endereço certinho eu te passo quando confirmar a visita."],
    ];
    for (const [t, dado] of casos) {
      const r = await responde(t);
      expect(r, t).toBe(`${dado} Quer agendar uma visita para conhecer?`);
      expect(r).not.toMatch(ROBO);
    }
  });
  it("concordância pelo tipo: apartamento fica \"anunciado\"", async () => {
    const ap: FichaIa = { ...VIP0119, tipo: "apartamento", preco: "R$ 430.000" };
    expect(await responde("qual o valor?", { ficha: ap })).toBe("O apartamento está anunciado por R$ 430.000. Quer agendar uma visita para conhecer?");
  });
  it("dado que não está no XML: vou confirmar (e vira pendência do corretor)", async () => {
    const semIptu: FichaIa = { ...VIP0119, iptu: undefined };
    const r = await proximaResposta(ctx({ ficha: semIptu }), "e o iptu?", undefined, { agora: AGORA });
    expect(r.resposta).toBe("Vou confirmar o valor do IPTU e já te falo. Quer agendar uma visita para conhecer?");
    expect(r.dados.pendentes).toContain("IPTU");
    expect(await responde("aceita financiamento?")).toBe("Vou confirmar se aceita financiamento e já te falo. Quer agendar uma visita para conhecer?");
    expect(await responde("ainda está disponível?")).toBe("Vou confirmar a disponibilidade e já te falo. Quer agendar uma visita para conhecer?");
  });
  it("2ª pergunta: não repete o convite da visita; pergunta se quer mais algum detalhe", async () => {
    const { out } = await conversa(["qual valor do Condominio ?", "e o iptu?"]);
    expect(out[1].resposta).toBe("O IPTU é de R$ 100 por mês. Quer saber mais algum detalhe?");
  });
  it("\"sim\" ao convite: oferece 2 horários, como atendente", async () => {
    const { out } = await conversa(["qual valor do Condominio ?", "sim"]);
    expect(out[1].passo).toBe("visita");
    expect(out[1].resposta).toBe(
      "Ótimo! Para conhecer a casa, tenho amanhã (quarta, 28/10) de manhã ou quinta (29/10) à tarde. Qual fica melhor para você? Te confirmo o horário certinho.",
    );
  });
  it("proposta só quando o cliente puxa o assunto (e aí passa, uma vez, com naturalidade)", async () => {
    const r = await proximaResposta(ctx(), "aceita proposta?", undefined, { agora: AGORA });
    expect(r.fim).toBe("qualificado");
    expect(r.resposta).toBe("Sobre proposta e valores, já pedi para {corretor} te chamar aqui para conversar com você.");
    for (const t of ["qual valor do Condominio ?", "qual o valor?", "quanto é o IPTU?"]) expect(await responde(t)).not.toMatch(/proposta|negocia/i);
  });
  it("pedido de detalhes: manda a ficha UMA vez, sem repetir tipo/bairro/valor da 1ª mensagem", async () => {
    const { out } = await conversa(["quero saber mais detalhes", "me passa mais detalhes"]);
    expect(out[0].resposta).toBe(
      "Claro! A casa tem 3 quartos, sendo 1 suíte, 4 vagas de garagem e 150 m², num terreno de 250 m². O condomínio é de R$ 420 por mês e o IPTU, R$ 100 por mês. Quer agendar uma visita para conhecer?",
    );
    expect(out[1].resposta).not.toMatch(/3 quartos/);
  });
});

describe("itens 6 e 7: outras opções antes do roteiro; pagamento nunca fora de hora", () => {
  it("variações e erros de digitação", () => {
    for (const t of ["tem mais opçõe s?", "tem mais opções ?", "me manda mais opção primeiro", "tem outras?", "tem outro?", "algo parecido?", "outras opcoes", "mais opçoes", "tem outra casa?", "Tem mais?"])
      expect(pedeOutrasOpcoes(t), t).toBe(true);
    for (const t of ["qual valor do condomínio?", "quero agendar outro dia", "outra forma de pagamento", "sim", "tem garagem?"]) expect(pedeOutrasOpcoes(t), t).toBe(false);
  });
  it("\"nesse valor\" / \"parecido com esse\" também traz um parecido", async () => {
    for (const t of ["quero algo nesse valor", "queria parecido com esse"]) expect(await responde(t)).toMatch(/^Tenho sim! Tem outra casa no mesmo condomínio/);
  });
  it("nenhuma resposta da conversa pergunta a forma de pagamento ou a faixa de valor", async () => {
    const { out } = await conversa(["qual valor do Condominio ?", "não", "não", "obrigado"]);
    for (const r of out) expect(r.resposta).not.toMatch(/pagamento|à vista|faixa|até quanto/i);
  });
  it("faixa só quando o cliente quer opções e não há preço de referência", async () => {
    const semPreco: FichaIa = { tipo: "casa", bairro: "Centro", cidade: "Sorocaba" };
    const { out } = await conversa(["tem outras opções?", "até 500 mil"], { ficha: semPreco, imovel_fonte: "captacao" });
    expect(out[0].resposta).toBe("Claro! Até quanto você pensa em investir?");
    expect(out[1].resposta).toMatch(/^Perfeito! Tenho sim! Tem outra casa/);
  });
});

describe("item 11: pergunta nova sempre primeiro; busca nova sem perder a casa", () => {
  it("nunca responde \"Obrigada!\" nem oferece visita a uma pergunta", async () => {
    const r = await responde("eu queria ver um imovel para o meu filho tb vcs trabalha com apartamento ?");
    expect(r).toBe("Trabalhamos sim! Para o seu filho, seria para comprar ou para alugar?");
  });
  it("sem achar no XML: diz que vai procurar e passa, sem perder o interesse na casa", async () => {
    const { out } = await conversa(["vcs trabalham com terreno? é pro meu irmão", "comprar", "tanto faz", "até 100 mil"]);
    const fim = out.at(-1)!;
    expect(fim.resposta).toBe("Ótimo! Agora não achei um terreno nesse perfil por aqui, mas vou procurar para o seu irmão. Já pedi para {corretor} te chamar aqui com as opções.");
    expect(fim.resumo).toMatch(/Imóvel: a casa do bairro Condominio Ibiti Reserva.*SEGUNDA BUSCA \(para o irmão\): terreno, para comprar/);
  });
  it("busca nova vai ao banco só com filtros válidos", () => {
    expect(argsBusca("c", { tipo: "mansão", negocio: "venda", excluir: ["  ", "A1"], regiao: "x".repeat(99), preco_max: -1 })).toMatchObject({
      _tipo: null,
      _negocio: "venda",
      _preco_max: null,
      _excluir: ["A1"],
    });
    expect(argsBusca("c", { tipo: "apartamento", negocio: "locacao", excluir: [], limite: 9 })._limite).toBe(3);
  });
});

describe("limites que continuam valendo", () => {
  it("\"é robô?\": não mente, resposta curta e natural (texto de Denis)", async () => {
    const r = await proximaResposta(ctx(), "estou falando com um robô?", undefined, { agora: AGORA });
    expect(r.resposta).toBe("Sou a Nicole, assistente da ZZ Teste Provisionamento, e respondo por aqui com ajuda de um sistema. Se preferir falar com um corretor, te passo agora. Quer?");
  });
  it("o corretor só aparece na passagem, nunca como pergunta de fecho", async () => {
    const { out } = await conversa(FALAS);
    for (const r of out.filter((x) => !x.fim)) expect(r.resposta).not.toMatch(/corretor/i);
  });
  it("migration nova: só leitura, mesma imobiliária, só servidor, com rollback", () => {
    expect(MIG).toMatch(/STABLE SECURITY DEFINER SET search_path TO ''/);
    expect(MIG).toMatch(/y\.organization_id = _cv\.organization_id AND y\.last_run = _run/);
    expect(MIG).toMatch(/FROM PUBLIC, anon, authenticated/);
    expect(MIG).toMatch(/TO service_role/);
    expect(MIG).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER TABLE|DROP)\b/);
    expect(RB).toMatch(/DROP FUNCTION IF EXISTS public\.lead_ia_imoveis_busca/);
  });
});
