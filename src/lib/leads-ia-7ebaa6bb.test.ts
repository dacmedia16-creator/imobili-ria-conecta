// t_228659f0: conversa de teste de Denis 7ebaa6bb (lead 4b41f454, VIP0137, 28/10). Os 6 pontos:
// 1/6. preço inventado com o link da VIP0036 (trava "anuncio" + link firme + imóveis mostrados no DADOS);
// 2. busca por nome de condomínio (nomeCitado, argsNome, textoBusca, RPC lead_ia_imoveis_nome);
// 3. presa no assunto (trava "repeticao" contra as 2 respostas anteriores; a 2ª tentativa trata a pergunta nova);
// 4. limite: aviso ao cliente e visita em curso (migration, NÃO aplicada);
// 5. horário inventado (trava "agenda"; o roteiro pergunta dia e período).
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { argsNome, nomeCitado, proximaResposta, type ContextoIa, type ImovelParecido } from "./leads-ia";
import type { UsoModelo } from "./leads-ia-modelo";
import {
  permitidosDe,
  redigirResposta,
  semelhanca,
  TRAVAS_FIRMES,
  travasAnuncioRepeticao,
  validarRedacaoDetalhe,
  type FalaHistorico,
  type SaidaModelo,
} from "./leads-ia-redacao";
import { buscasReferencia, ctxReferencia, ESTOQUE_ZZ, REFERENCIA } from "./leads-ia-referencia.dados";
import { mapXmlListing, textoBusca } from "./remax-xml";

const AGORA = new Date("2026-10-28T09:00:00Z");
const H = REFERENCIA.find((c) => c.id === "H")!;
const s = (mensagem: string, extra: Partial<SaidaModelo> = {}): SaidaModelo => ({ mensagem, acao: "responder", codigo: null, registro: {}, ...extra });
const im = (codigo: string): ImovelParecido => {
  const { preco_valor: _p, tipo_xml: _t, busca_texto: _b, ...r } = ESTOQUE_ZZ.find((x) => x.codigo === codigo)! as (typeof ESTOQUE_ZZ)[number];
  return r;
};
const VIP0036 = im("VIP0036");
const LINK36 = "https://vipsevenimoveis.com.br/imovel/VIP0036";
// As 2 falas ao vivo (06:03 e 06:07).
const ERRADA_0603 = `Entendi, perto de R$ 900.000. Nessa faixa, no Campolim, temos um apartamento com 2 suítes por R$ 850.000. Dá uma olhada: ${LINK36} Quer ver esse ou prefere que eu procure com 1 suíte?`;
const ERRADA_0607 = `Entendido! No Campolim, perto de R$ 900.000, temos um apartamento com 2 suítes por R$ 850.000. Dá uma olhada: ${LINK36} Quer ver esse ou prefere que eu procure com 1 suíte?`;
const CERTA_0601 = `Nessa faixa, no Campolim, não temos apartamento com 3 suítes. O mais em conta que temos é um apartamento com 3 suítes por R$ 1.170.000, em Parque Campolim. Dá uma olhada: ${LINK36} Quer ver esse ou prefere que eu procure com menos suítes?`;
const CLIENTE = ["Campolim", "3 suítes", "Não tem nada perto de 900 mil ?", "Menos suítes", "O tiver perto de 900 mil"];

const permH = (parecidos: ImovelParecido[] = [VIP0036]) => {
  const p = permitidosDe(H.ficha, parecidos, [], CLIENTE);
  p.faixa = [900000];
  p.valores.push(900000);
  return p;
};

describe("pontos 1 e 6 — preço/suítes têm de bater com o anúncio do link", () => {
  it("ANTES: 06:03 e 06:07 ('2 suítes por R$ 850.000' + link da VIP0036) saíam. DEPOIS: trava firme 'anuncio'", () => {
    for (const m of [ERRADA_0603, ERRADA_0607]) {
      const d = validarRedacaoDetalhe(s(m), permH(), "O tiver perto de 900 mil");
      expect(d?.motivo).toBe("anuncio");
      expect(d?.trecho).toMatch(/850/);
    }
    expect(TRAVAS_FIRMES.has("anuncio")).toBe(true);
  });
  it("só as suítes erradas (valor certo) também barram; quartos errados também", () => {
    const so = `Temos um apartamento com 2 suítes por R$ 1.170.000. Dá uma olhada: ${LINK36} Gostou?`;
    expect(travasAnuncioRepeticao(so, permH())).toEqual({ motivo: "anuncio", trecho: "2 suites | anúncio 3" });
    const q = `Temos um apartamento com 4 quartos por R$ 1.170.000. Dá uma olhada: ${LINK36} Gostou?`;
    expect(travasAnuncioRepeticao(q, permH())?.motivo).toBe("anuncio");
  });
  it("a fala certa das 06:01 (3 suítes, R$ 1.170.000) passa", () => {
    expect(travasAnuncioRepeticao(CERTA_0601, permH())).toBeNull();
  });
  it("a faixa do cliente ('perto de R$ 900.000') antes do link não é preço do anúncio", () => {
    const m = `Perto de R$ 900.000 não tenho; o mais perto é este, com 3 suítes por R$ 1.170.000: ${LINK36} Quer ver?`;
    expect(travasAnuncioRepeticao(m, permH())).toBeNull();
  });
  it("ANTES: link fora de DADOS era só registro (modo observar). DEPOIS: 'link' é trava firme", () => {
    const d = validarRedacaoDetalhe(s(ERRADA_0603), permH([]), "x");
    expect(d?.motivo).toBe("link");
    expect(TRAVAS_FIRMES.has("link")).toBe(true);
  });
  it("modo observar: o imóvel já mostrado (dados.mostrados) entra na trava; a fala errada não sai e a 2ª tentativa corrige", async () => {
    const certa = `Esse do Campolim tem 3 suítes e sai por R$ 1.170.000: ${LINK36} Quer que eu procure com menos suítes?`;
    const { r, usos, corpos } = await rodarGemini(
      { mostrados: [VIP0036], faixa: "perto de 900 mil" },
      "O tiver perto de 900 mil",
      [{ mensagem: ERRADA_0603, acao: "responder" }, { mensagem: certa, acao: "responder" }],
      "observar",
    );
    expect(usos[0]).toMatchObject({ tentativa: 1, bloqueio: "anuncio" });
    expect(r.resposta).toBe(certa);
    expect(r.resposta).not.toMatch(/850/);
    // O modelo recebe a VIP0036 com os dados reais (para citar de novo sem inventar).
    expect(corpos[0]).toMatch(/VIP0036/);
    expect(corpos[0]).toMatch(/1\.170\.000/);
  });
});

describe("ponto 2 — condomínio pelo nome (Cannes)", () => {
  it("nomeCitado: 'Tem cannes ??', 'Tem no condomínio cannes', e a pergunta seguinte sobre o mesmo nome", () => {
    expect(nomeCitado("Tem cannes ??")).toBe("cannes");
    expect(nomeCitado("Tem no condomínio cannes")).toBe("cannes");
    expect(nomeCitado("Tem no Condomínio CANNES?")).toBe("cannes");
    expect(nomeCitado("Qual valor do cannes ?", "cannes")).toBe("cannes");
    expect(nomeCitado("Me manda o cannes q vc tem", "cannes")).toBe("cannes");
  });
  it("nomeCitado não confunde pedido comum com nome", () => {
    for (const t of ["Tem mais opções ?", "Comprar", "Campolim", "3 suítes", "Dá para visitar ?", "Tem garagem?", "Mais detalhes"])
      expect(nomeCitado(t), t).toBeNull();
  });
  it("argsNome: nome sem acento/maiúsculas, negócio e limites", () => {
    expect(argsNome("c1", { nome: "Résidencial  CANNES!", negocio: "venda" })).toEqual({
      _conversa: "c1", _nome: "residencial cannes", _negocio: "venda", _excluir: [], _limite: 3,
    });
    expect(argsNome("c1", { nome: "x", negocio: "locacao", limite: 9 })._limite).toBe(3);
  });
  it("textoBusca guarda o nome da descrição, sem acento, sem telefone, e-mail, link nem permuta", () => {
    const t = textoBusca("Apartamento à venda, 3 quartos", "Lindo apto no Residencial Cannes! Aceita permuta. Fone (15) 99999-8888, a@b.com https://x.com/1")!;
    expect(t).toMatch(/residencial cannes/);
    expect(t).not.toMatch(/99999|@|https|permut|aceita/);
    expect(t.length).toBeLessThanOrEqual(600);
  });
  it("mapXmlListing (genérico) grava busca_texto a partir da Description", () => {
    const xml = `<Listing><ListingID>VIP0136</ListingID><Title>Apartamento à venda, 3 quartos, Parque Campolim</Title><TransactionType>For Sale</TransactionType><Details><PropertyType>Residential / Apartment</PropertyType><Description>Apartamento no Residencial Cannes, lazer completo.</Description><ListPrice>999000</ListPrice><Bedrooms>3</Bedrooms></Details><Location><City>Sorocaba</City><Neighborhood>Parque Campolim</Neighborhood></Location></Listing>`;
    const l = mapXmlListing(xml, "generico");
    expect(l?.busca_texto ?? "").toMatch(/residencial cannes/);
  });
  it("busca simulada (mesma regra da RPC): 'cannes' acha VIP0136 (R$ 999 mil) e 822 (R$ 1,1 mi), mais barato primeiro", async () => {
    const r = await buscasReferencia(H).buscarNome({ nome: "Cannes", negocio: "venda" });
    expect(r.itens.map((x) => x.codigo)).toEqual(["VIP0136", "822"]);
  });
  it("redação: o resultado vai ao modelo (busca_nome, preço, link, fora da faixa) e a resposta com a VIP0136 passa nas travas", async () => {
    const ok = "No Residencial Cannes tenho um apartamento de 3 quartos por R$ 999.000, um pouco acima dos R$ 900 mil: https://vipsevenimoveis.com.br/imovel/VIP0136 Quer ver?";
    const { r, corpos, dados } = await rodarGemini({ faixa: "até 900 mil" }, "Tem cannes ??", [{ mensagem: ok, acao: "oferecer", codigo: "VIP0136" }], "bloquear", true);
    expect(corpos[0]).toMatch(/busca_nome/);
    expect(corpos[0]).toMatch(/fora_faixa/);
    expect(corpos[0]).toMatch(/imovel\/VIP0136/);
    expect(r.resposta).toBe(ok);
    expect(r.redigida).toBe(true);
    expect(dados.nome_busca).toBe("cannes");
  });
  it("migration (NÃO aplicada): coluna busca_texto, RPC sem maiúsculas/acentos, só service_role; rollback existe", () => {
    const mig = readFileSync("supabase/migrations/20261028100000_leads_ia_nome_limite.sql", "utf8");
    const rb = readFileSync("docs/sql/rollback/20261028100000_leads_ia_nome_limite.rollback.sql", "utf8");
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS busca_texto/);
    expect(mig).toMatch(/FUNCTION public\.lead_ia_imoveis_nome/);
    expect(mig).toMatch(/lead_ia_norm\(coalesce\(x\.titulo/);
    expect(mig).toMatch(/organization_id = _cv\.organization_id/);
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\.lead_ia_imoveis_nome[^;]+FROM PUBLIC, anon, authenticated/);
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS public\.lead_ia_imoveis_nome/);
    expect(rb).toMatch(/DROP COLUMN IF EXISTS busca_texto/);
  });
});

describe("ponto 3 — presa no assunto (anti-repetição)", () => {
  const A1 = "Entendi! No Campolim, perto de R$ 900.000, temos o apartamento com 2 suítes que te mostrei. Quer ver esse ou prefere que eu procure com 1 suíte?";
  const A2 = "No Campolim, perto de R$ 900.000, não temos apartamento no condomínio Cannes. O que temos é o apartamento com 2 suítes que te mostrei. Quer ver esse ou prefere que eu procure com 1 suíte?";
  const A3 = "Sobre o condomínio Cannes, não temos apartamento disponível nessa faixa. O que temos é o apartamento com 2 suítes que te mostrei. Quer ver esse ou prefere que eu procure com 1 suíte?";
  it("ANTES: 5 respostas quase iguais saíram. DEPOIS: quase igual a uma das 2 anteriores = 'repeticao' (firme)", () => {
    const p = permH();
    p.anteriores = [A1, A2];
    expect(validarRedacaoDetalhe(s(A3), p, "Qual valor do cannes q vc tem ?")?.motivo).toBe("repeticao");
    expect(TRAVAS_FIRMES.has("repeticao")).toBe(true);
  });
  it("só as 2 anteriores contam; resposta nova (sobre o Cannes) passa", () => {
    const p = permH([VIP0036, im("VIP0136")]);
    p.anteriores = [A1, A2];
    expect(travasAnuncioRepeticao("No Residencial Cannes tenho um apartamento de 3 quartos por R$ 999.000: https://vipsevenimoveis.com.br/imovel/VIP0136 Quer ver?", p)).toBeNull();
    expect(semelhanca(A2, A3)).toBeGreaterThanOrEqual(0.6);
    expect(semelhanca("Quer agendar uma visita?", "A casa tem 3 quartos. Quer agendar uma visita?")).toBeLessThan(0.6);
  });
  it("redação: a repetida é barrada e a 2ª tentativa (que responde a pergunta nova) sai", async () => {
    const nova = "Sobre o Cannes: tenho um no Residencial Cannes por R$ 999.000: https://vipsevenimoveis.com.br/imovel/VIP0136 Quer ver?";
    const hist: FalaHistorico[] = [
      { autor: "cliente", texto: "Tem cannes ??" }, { autor: "ia", texto: A1 },
      { autor: "cliente", texto: "Tem no condomínio cannes" }, { autor: "ia", texto: A2 },
    ];
    const { r, usos, corpos } = await rodarGemini({ mostrados: [VIP0036], nome_busca: "cannes" }, "Qual valor do cannes q vc tem ?", [{ mensagem: A3, acao: "responder" }, { mensagem: nova, acao: "oferecer", codigo: "VIP0136" }], "observar", true, hist);
    if (process.env.DBG) console.log(JSON.stringify(usos.map((u) => [u.tentativa, u.bloqueio, u.bloqueio_trecho, u.erro])));
    expect(usos[0]).toMatchObject({ tentativa: 1, bloqueio: "repeticao" });
    expect(corpos[1]).toMatch(/CORREÇÃO/);
    expect(r.resposta).toBe(nova);
  });
});

describe("ajustes do DeepSeek real (conversa H)", () => {
  it("permuta x disponibilidade com a mesma frase padrão do corretor não é repetição", () => {
    const p = permH();
    p.anteriores = ["O corretor confirma se o proprietário aceita permuta com você na visita ou no contato. Quer agendar uma visita para conhecer pessoalmente?"];
    expect(travasAnuncioRepeticao("O corretor confirma a disponibilidade com você na visita ou no contato. Quer agendar uma visita para conhecer pessoalmente?", p)).toBeNull();
  });
  it("espanhol visto no DeepSeek ('Trabajamos', 'alquiler') barra", () => {
    const d = validarRedacaoDetalhe(s("Trabajamos com apartamentos também! Para compra ou alquiler?"), permH(), "Vc tb tem apartamento ?");
    expect(d?.motivo).toBe("idioma");
  });
  it("condomínio pedido pelo nome: o apartamento achado passa mesmo com o anúncio original sendo casa (sem 'perfil')", async () => {
    const ok = "No condomínio Cannes tenho um apartamento de 3 quartos por R$ 999.000: https://vipsevenimoveis.com.br/imovel/VIP0136 Quer ver?";
    const ctxPerfil = { faixa: "perto de 900 mil", busca2: { ativa: true, tipo: "apartamento" } };
    const { r, usos } = await rodarGemini(ctxPerfil, "Tem no condomínio cannes", [{ mensagem: ok, acao: "oferecer", codigo: "VIP0136" }], "observar", true);
    expect(usos[0].bloqueio ?? null).toBeNull();
    expect(r.resposta).toBe(ok);
  });
  it("condomínio achado e a resposta não mostra nenhum = 'sem_oferta' (não diz só 'o corretor confirma')", async () => {
    const ruim = "Sobre Cannes, o corretor confirma com você na visita ou no contato. Quer agendar uma visita?";
    const { usos } = await rodarGemini({}, "Tem cannes ??", [{ mensagem: ruim, acao: "responder" }, { mensagem: ruim, acao: "responder" }], "observar", true);
    expect(usos[0].bloqueio).toBe("sem_oferta");
  });
  it("2 tentativas barradas com o condomínio achado: a reserva mostra o imóvel achado com os dados do XML", async () => {
    const ruim = "Sobre Cannes, o corretor confirma com você na visita ou no contato. Quer agendar uma visita?";
    const { r, usos } = await rodarGemini({ faixa: "até 900 mil", nome_busca: "cannes" }, "Qual valor do cannes ?", [{ mensagem: ruim, acao: "responder" }, { mensagem: ruim, acao: "responder" }], "observar", true);
    if (process.env.DBG) console.log(JSON.stringify(usos.map((u) => [u.tentativa, u.bloqueio, u.bloqueio_trecho, u.erro])));
    expect(r.resposta).toBe("No Cannes tenho um apartamento com 3 quartos, por R$ 999.000: https://vipsevenimoveis.com.br/imovel/VIP0136 Fica fora da faixa que você comentou. Quer ver?");
    expect(r.bloqueio).toBe("sem_oferta");
    expect(r.dados.mostrados?.map((x) => x.codigo)).toContain("VIP0136");
    expect(r.fim).toBeNull();
  });
});

describe("ponto 4 — limite da conversa (migration, NÃO aplicada)", () => {
  const mig = readFileSync("supabase/migrations/20261028100000_leads_ia_nome_limite.sql", "utf8");
  const rb = readFileSync("docs/sql/rollback/20261028100000_leads_ia_nome_limite.rollback.sql", "utf8");
  it("ANTES: passava como 'limite' sem nada ao cliente. DEPOIS: 1 aviso curto, pelo mesmo caminho das respostas (allowlist)", () => {
    expect(mig).toMatch(/lead_ia_passar\(_cv\.id, 'limite'/);
    expect(mig).toMatch(/_aviso := 'Obrigada pela conversa! Um corretor da nossa equipe continua seu atendimento por aqui\.'/);
    expect(mig).toMatch(/INSERT INTO public\.lead_mensagens \(organization_id, conversa_id, autor, texto, status\)\s+VALUES \(_cv\.organization_id, _cv\.id, 'sistema', _aviso, public\.lead_ia_status_saida\(_cv\.id\)\)/);
  });
  it("visita sendo combinada: até +4 respostas e depois passa como 'visita' (não 'limite')", () => {
    expect(mig).toMatch(/NOT \(_vis AND _n < _c\.ia_resp_max_conversa \+ 4\)/);
    expect(mig).toMatch(/lead_ia_passar\(_cv\.id, 'visita'/);
  });
  it("não muda o valor do limite (20) nem mexe em allowlist/fila/corretor; rollback restaura a função", () => {
    expect(mig).not.toMatch(/ia_resp_max_conversa\s*=\s*\d|ALTER COLUMN ia_resp_max_conversa/);
    const codigo = mig.replace(/--[^\n]*/g, "");
    // A allowlist só é LIDA (mesma checagem da produção); nada a altera, nem fila nem envio a corretor.
    expect(codigo).not.toMatch(/(UPDATE|INSERT INTO|ALTER TABLE)\s+public\.lead_config/i);
    expect(codigo).not.toMatch(/ia_envio_allowlist\s*:?=/i);
    expect(codigo).not.toMatch(/lead_fila|corretor_envio/i);
    expect(rb).toMatch(/CREATE OR REPLACE FUNCTION public\.lead_ia_retorno_receber/);
  });
});

describe("ponto 5 — horário inventado", () => {
  it("ANTES: 'Temos visita amanhã de manhã ou sexta à tarde' saiu. DEPOIS: trava firme 'agenda'", () => {
    for (const m of [
      "Claro! Temos visita amanhã de manhã ou sexta à tarde. Qual prefere?",
      "Tenho amanhã de manhã ou quinta à tarde. Qual fica melhor?",
      "Amanhã à tarde tem sim! Posso confirmar?",
    ])
      expect(travasAnuncioRepeticao(m, permH()), m).toMatchObject({ motivo: "agenda" });
    expect(TRAVAS_FIRMES.has("agenda")).toBe(true);
  });
  it("perguntar a preferência e anotar o que o cliente disse passa", () => {
    for (const m of [
      "Claro! Qual dia e período ficam melhores para você? O corretor confirma o horário com você.",
      "Amanhã à tarde anotado! O corretor confirma o horário com você.",
      "Fica melhor de manhã ou à tarde?",
    ])
      expect(travasAnuncioRepeticao(m, permH()), m).toBeNull();
  });
  it("roteiro (plano B) da conversa H: 'Dá para visitar ?' pergunta dia e período; 'Amanhã a tarde' anota e passa", async () => {
    const b = buscasReferencia(H);
    let c: ContextoIa = ctxReferencia(H);
    const r1 = await proximaResposta(c, "Dá para visitar ?", undefined, { agora: AGORA, ...b });
    expect(r1.resposta).toMatch(/qual dia e período/);
    expect(r1.resposta).not.toMatch(/amanhã|sexta|tenho|temos/i);
    c = { ...c, passo: r1.passo, dados: r1.dados, versao: c.versao + 1 };
    const r2 = await proximaResposta(c, "Amanhã a tarde não tem como ?", undefined, { agora: AGORA, ...b });
    expect(r2.fim).toBe("visita");
    expect(r2.resposta).toMatch(/^Amanhã à tarde anotado!/);
    expect(r2.resposta).not.toMatch(/tem sim|está livre/);
  });
});

// --- apoio: redigirResposta com Gemini falso (sem rede) ---
const ENV = { LEADS_IA_MODELO: "gemini", GEMINI_API_KEY: "teste" };
const respostaGemini = (saida: unknown) =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(saida) }] } }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50 },
    }),
  );
async function rodarGemini(
  dados: Record<string, unknown>,
  texto: string,
  saidas: unknown[],
  modo: "bloquear" | "observar",
  comNome = false,
  historico: FalaHistorico[] = [],
) {
  const fila = saidas.map(respostaGemini);
  const corpos: string[] = [];
  const fetchFn = vi.fn(async (_u: unknown, i?: RequestInit) => {
    corpos.push(String(i?.body ?? ""));
    return fila.shift() ?? new Response("erro", { status: 500 });
  }) as unknown as typeof fetch;
  const b = buscasReferencia(H);
  const c: ContextoIa = { ...ctxReferencia(H), dados: dados as ContextoIa["dados"] };
  const vazio = async () => ({ referencia: {}, itens: [] });
  const base = await proximaResposta(c, texto, undefined, { agora: AGORA, buscarParecidos: vazio });
  const usos: UsoModelo[] = [];
  const r = await redigirResposta(c, texto, base, {
    escolha: { provedor: "gemini", modelo: null },
    env: ENV,
    historico,
    buscarParecidos: vazio,
    buscarNome: comNome ? b.buscarNome : undefined,
    registrar: (u) => usos.push(u),
    fetchFn,
    agora: AGORA,
    modo,
  });
  return { r, usos: usos.filter((u) => u.uso === "redigir"), corpos, dados: r.dados };
}
