import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  categoriaNaoLead,
  ehOptOut,
  opcoesVisita,
  PRIMEIRA_MSG_PADRAO,
  prazoConfirmacao,
  previaPrimeiraMensagem,
  proximaResposta,
  respostaMidia,
  validarIaConfig,
  perguntouSeRobo,
  pediuPessoa,
  faixaLonge,
  type ContextoIa,
  type Extrator,
  type FichaIa,
  type RespostaIa,
} from "./leads-ia";
import { primeiraComLinkProibido } from "./leads-ia-canal";

// Card t_fc4d9b27: roteiro novo da Nicole (estudo de 1.347 conversas da Lais). Conversas simuladas, modelo
// de linguagem SIMULADO (mock) e nenhuma chamada de rede. O banco (passagem verificável, reengajamento,
// isolamento) foi testado em PostgreSQL descartável: scripts/leads-ia-test/test_roteiro.sql.
const MIG = readFileSync("supabase/migrations/20261026170000_leads_ia_roteiro_lais.sql", "utf8");
const RB = readFileSync("docs/sql/rollback/20261026170000_leads_ia_roteiro_lais.rollback.sql", "utf8");
const MIG_XML = readFileSync("supabase/migrations/20261027080000_xml_link_locacao_primeira_msg.sql", "utf8");

const AGORA = new Date("2026-10-26T13:00:00Z"); // segunda, 10h em Brasília
const FICHA: FichaIa = { tipo: "apartamento", bairro: "Campolim", cidade: "Sorocaba", quartos: "3", suites: "1", vagas: "2", area_util_m2: "80" };

const ctx = (p: Partial<ContextoIa> = {}): ContextoIa => ({
  conversa_id: "c",
  estado: "ativa",
  versao: 1,
  passo: "interesse",
  dados: {},
  ia_nome: "Nicole",
  lead_nome: "Maria",
  imovel: null,
  org_nome: "Imob A",
  transacao: "venda",
  anuncio_codigo: "2712345678",
  tem_captacao: true,
  imovel_frase: "o apartamento do bairro Campolim",
  ficha: FICHA,
  ...p,
});

type Op = Parameters<typeof proximaResposta>[3];
async function conversa(falas: string[], p: Partial<ContextoIa> = {}, extrator?: Extrator, op: Op = {}) {
  let c = ctx(p);
  const out: RespostaIa[] = [];
  for (const f of falas) {
    const r = await proximaResposta(c, f, extrator, { agora: AGORA, ...op });
    out.push(r);
    c = { ...c, passo: r.passo, dados: r.dados, versao: c.versao + 1 };
    if (r.fim) break;
  }
  return out;
}
const perguntas = (rs: RespostaIa[]) => rs.reduce((n, r) => n + (/(comprar ou para alugar|faixa de valor|forma de pagamento)/.test(r.resposta) ? 1 : 0), 0);

describe("item 1 — 1ª mensagem", () => {
  it("padrão: uma bolha, \"Aqui é a Nicole, da <imobiliária>\" (sem \"assistente virtual\"), imóvel e pergunta fechada; sem link quando não há anúncio", () => {
    const t = previaPrimeiraMensagem({ ia_nome: "Nicole", ia_primeira_msg: null }, "Imob A", "Maria Souza", "no apartamento do bairro Campolim");
    expect(t).toBe(
      "Oi, Maria! Aqui é a Nicole, da Imob A. Vi seu interesse no apartamento do bairro Campolim. Quer saber mais detalhes ou já prefere agendar uma visita?",
    );
    expect(t).not.toMatch(/\n|https?:|www\.|assistente virtual/i);
    expect(t).toMatch(/\?$/);
  });
  it("com anúncio do XML (t_25fe1197): imóvel com valor e SÓ o link do anúncio, e termina em pergunta", () => {
    const t = previaPrimeiraMensagem(
      { ia_nome: "Nicole", ia_primeira_msg: null },
      "ZZ Teste Provisionamento",
      "Denis",
      "no apartamento de 2 quartos no bairro Jardim São Carlos, em Sorocaba, anunciado por R$ 430.000",
      "https://vipsevenimoveis.com.br/imovel/VIP0040",
    );
    expect(t).toBe(
      "Oi, Denis! Aqui é a Nicole, da ZZ Teste Provisionamento. Vi seu interesse no apartamento de 2 quartos no bairro Jardim São Carlos, em Sorocaba, anunciado por R$ 430.000. Anúncio: https://vipsevenimoveis.com.br/imovel/VIP0040 Quer saber mais detalhes ou já prefere agendar uma visita?",
    );
    expect(t).not.toMatch(/assistente virtual|dispon|permuta|financ|andar/i);
    expect(primeiraComLinkProibido(t, "https://vipsevenimoveis.com.br/imovel/VIP0040")).toBe(false); // a trava deixa sair
    expect(primeiraComLinkProibido(t)).toBe(true); // sem o link do XML, nenhum link sai
    // Link inseguro nunca entra na prévia.
    expect(previaPrimeiraMensagem({ ia_nome: "Nicole" }, "Imob", "Ana", null, "http://x.com.br/a")).not.toMatch(/http/);
  });
  it("trava de envio da 1ª mensagem: só o link do anúncio do próprio imóvel no XML; qualquer outro bloqueia", () => {
    const L = "https://imob.com.br/imovel/1";
    expect(primeiraComLinkProibido("Oi! Quer agendar?")).toBe(false);
    expect(primeiraComLinkProibido("Oi! Anúncio: https://imob.com.br/imovel/1 Quer agendar?", L)).toBe(false);
    // Revisão t_e520a9bb: "Anúncio: <qualquer domínio>" não vale mais; nem nome com TLD fora da lista.
    for (const [t, link] of [
      ["Oi! Anúncio: https://qualquer-dominio.xyz/a Quer?", L],
      ["Oi! Anúncio: https://imob.com.br/imovel/1 Quer?", null],
      ["Oi! Anúncio: https://imob.com.br/imovel/1 Anúncio: https://imob.com.br/imovel/1 Quer?", L],
      ["Oi, golpe.xyz! Anúncio: https://imob.com.br/imovel/1 Quer?", L],
      ["Oi! Aqui é a t.co/abc, da Imob. Quer?", null],
      ["Oi! Aqui é a Nicole, da golpe.co. Quer?", null],
      ["Oi! Fale com x@golpe Quer?", null],
    ] as const)
      expect(primeiraComLinkProibido(t, link), t).toBe(true);
    for (const t of [
      "Oi! Veja https://golpe.com/x Quer agendar?",
      "Oi! Anúncio: https://imob.com.br/1 e www.outro.com Quer?",
      "Oi! Anúncio: https://imob.com.br/1 Anúncio: https://imob.com.br/2 Quer?",
      "Oi! Anúncio: http://imob.com.br/1 Quer?",
      "Oi! Anúncio: https://user:senha@imob.com.br/1 Quer?",
      `Oi! Anúncio: https://imob.com.br/${"a".repeat(300)} Quer?`,
      "Oi, joao.com.br! Anúncio: https://imob.com.br/1 Quer?",
    ])
      expect(primeiraComLinkProibido(t), t).toBe(true);
  });
  it("o marcador {link} não é link: o texto personalizado pode usá-lo", () => {
    expect(validarIaConfig({ ia_nome: "Nicole", ia_boas_vindas: null, ia_primeira_msg: "Oi {nome}! {link}Quer agendar?" })).toBeNull();
  });
  it("lead sem nome não vira \"Oi, !\"; sem captação usa texto neutro", () => {
    expect(previaPrimeiraMensagem({ ia_nome: "Nicole" }, "Imob A", "Lead Grupo ZAP", null)).toMatch(/^Oi! Aqui é a Nicole/);
    expect(previaPrimeiraMensagem({ ia_nome: "Nicole" }, "Imob A", "Ana", null)).toContain("no imóvel que você viu");
  });
  it("texto editável: aceita o personalizado; recusa link e texto que não termina em pergunta", () => {
    expect(previaPrimeiraMensagem({ ia_nome: "E", ia_primeira_msg: "Olá {nome}, da {imobiliaria}. Posso ajudar?" }, "Imob B", "João", null)).toBe(
      "Olá João, da Imob B. Posso ajudar?",
    );
    expect(validarIaConfig({ ia_nome: "E", ia_boas_vindas: null, ia_primeira_msg: "Veja www.imob.com.br?" })).toMatch(/link/);
    expect(validarIaConfig({ ia_nome: "E", ia_boas_vindas: null, ia_primeira_msg: "Oi, tudo bem." })).toMatch(/pergunta/);
    expect(validarIaConfig({ ia_nome: "E", ia_boas_vindas: null, ia_primeira_msg: null })).toBeNull();
  });
  it("banco usa o mesmo texto padrão (migration t_25fe1197) e continua travando link literal na coluna", () => {
    expect(MIG_XML).toContain(PRIMEIRA_MSG_PADRAO);
    expect(MIG_XML).not.toMatch(/assistente virtual da/);
    expect(MIG).toMatch(/lead_config_ia_primeira_msg_sem_link/);
  });
});

describe("item 2 — dúvida primeiro, no máximo 3 perguntas, uma por turno", () => {
  // t_5b493bc9: faixa e pagamento não são mais perguntados pelo roteiro (só anotados se o cliente disser).
  it("venda vinda do portal: responde a dúvida e convida para a visita, sem faixa nem pagamento", async () => {
    const r = await conversa(["Quero saber valores", "uns 500 mil", "financiamento"]);
    expect(r.map((x) => x.passo)).toEqual(["interesse", "interesse", "interesse"]);
    expect(r[0].resposta).toBe("O corretor confirma o valor com você na visita ou no contato. Quer agendar uma visita para conhecer?"); // ficha sem preço
    expect(perguntas(r)).toBe(0);
    expect(r[2].dados).toMatchObject({ faixa: "uns 500 mil", pagamento: ["financiamento"] });
  });
  it("sem transação do portal: só a finalidade é perguntada (1 pergunta, uma vez)", async () => {
    const r = await conversa(["sim", "comprar", "até 400 mil", "à vista"], { transacao: null });
    expect(r.map((x) => x.passo)).toEqual(["finalidade", "interesse", "interesse", "interesse"]);
    for (const x of r) expect((x.resposta.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
    expect(perguntas(r)).toBe(1);
    expect(r[1].resposta).toBe("Perfeito! Quer agendar uma visita para conhecer?");
  });
  it("aluguel: não pergunta forma de pagamento", async () => {
    const r = await conversa(["tenho interesse", "até 3 mil"], { transacao: "aluguel" });
    expect(r.map((x) => x.passo)).toEqual(["interesse", "interesse"]);
    for (const x of r) expect(x.resposta).not.toMatch(/pagamento|financiamento/);
  });
  it("nunca passa de 3 perguntas, mesmo com respostas confusas", async () => {
    const r = await conversa(["sim", "hmm", "sei lá", "talvez", "não sei", "pode ser"], { transacao: null });
    expect(perguntas(r)).toBeLessThanOrEqual(3);
    expect(r.map((x) => x.passo)).not.toContain("prazo");
    expect(r.map((x) => x.passo)).not.toContain("regiao");
  });
  it("dúvida no meio: responde só o que foi perguntado e não convida para a visita duas vezes", async () => {
    const r = await conversa(["sim", "ainda está disponível?", "e o condomínio?", "500 mil"]);
    expect(r[1].passo).toBe("interesse");
    // t_76243950: disponibilidade nunca é garantida.
    expect(r[1].resposta).toBe("O corretor confirma a disponibilidade com você na visita ou no contato. Quer saber mais algum detalhe?");
    // t_a9f1b447 item 6: "Quer saber mais algum detalhe?" não sai repetida.
    expect(r[2].resposta).toBe(
      "O corretor confirma o valor do condomínio com você na visita ou no contato. Quer que eu te mostre outras opções parecidas ou prefere marcar uma visita?",
    );
    // t_82c89141 item 3: "o corretor confirma ... com você" é permitido; nunca pergunta faixa nem cita o corretor fora disso.
    for (const x of r) expect(x.resposta.replace(/O corretor confirma [^.]+\./g, "")).not.toMatch(/faixa de valor|corretor/);
  });
});

describe("item 3 — respostas só pela ficha da captação", () => {
  it("o que a ficha tem, responde; o que não tem, \"não tenho esse dado confirmado\"", async () => {
    const r = await proximaResposta(ctx({ passo: "faixa" }), "Quantos quartos tem? E tem vaga? Qual o condomínio?", undefined, { agora: AGORA });
    expect(r.resposta).toBe(
      "O apartamento tem 3 quartos, sendo 1 suíte e 2 vagas de garagem. O corretor confirma o valor do condomínio com você na visita ou no contato. Quer agendar uma visita para conhecer?",
    );
    expect(r.dados.pendentes).toEqual(expect.arrayContaining(["condomínio"]));
  });
  it("condomínio/IPTU, permuta, financiamento e andar sem dado: nunca estima", async () => {
    for (const t of ["qual o valor do condomínio?", "quanto é o IPTU?", "aceita financiamento?", "qual andar?"]) {
      const r = await proximaResposta(ctx({ passo: "faixa" }), t, undefined, { agora: AGORA });
      // t_82c89141 item 3: sem promessa de retorno; o corretor confirma na visita ou no contato.
      expect(r.resposta).toMatch(/^O corretor confirma .+ com você na visita ou no contato\. /);
      expect(r.resposta).not.toMatch(/já te falo|te retorno|vou confirmar/i);
      // "Vou confirmar se aceita financiamento" não afirma nada; afirmar ("Aceita financiamento, sim") é proibido.
      expect(r.resposta).not.toMatch(/R\$|\d+ ?(mil|reais)|(?<!se )aceita (permuta|financiamento)\b(?! ?\?)|andar \d/);
      expect(r.fim).toBeNull();
    }
  });
  it("disponibilidade: NUNCA garante, nem com a ficha dizendo disponível (t_76243950)", async () => {
    for (const ficha of [FICHA, { ...FICHA, disponivel: true }, { ...FICHA, disponivel: false }]) {
      for (const t of ["ainda está disponível?", "já foi vendido?", "ainda está à venda?"]) {
        const r = await proximaResposta(ctx({ passo: "faixa", ficha }), t, undefined, { agora: AGORA });
        expect(r.resposta).toContain("O corretor confirma a disponibilidade com você na visita ou no contato.");
        expect(r.resposta).not.toMatch(/está disponível|indisponível|já foi vendido|não está/i);
        expect(r.dados.pendentes).toContain("disponibilidade");
      }
    }
  });
  it("quando a ficha passar a ter os campos, responde com eles (sem inventar; disponibilidade continua com o corretor)", async () => {
    const ficha: FichaIa = { ...FICHA, condominio: "R$ 650,00", iptu: "R$ 120,00", aceita_permuta: false, aceita_financiamento: true, andar: "5º andar, frente", disponivel: true };
    const r = await proximaResposta(ctx({ passo: "faixa", ficha }), "aceita financiamento? qual o condomínio e o iptu? qual andar? ainda está disponível?", undefined, { agora: AGORA });
    for (const x of ["Aceita financiamento, sim.", "condomínio é de R$ 650 por mês", "IPTU é de R$ 120", "Fica no 5º andar, frente", "O corretor confirma a disponibilidade com você na visita ou no contato."])
      expect(r.resposta).toContain(x);
    expect(r.resposta).not.toContain("não tenho esse dado");
    expect(r.resposta).not.toContain("stá disponível");
  });
  it("preço sem dado no XML: vai confirmar, sem número; proposta só quando o cliente puxa o assunto", async () => {
    for (const t of ["qual o valor?", "quanto custa?"]) {
      const r = await proximaResposta(ctx({ passo: "faixa" }), t, undefined, { agora: AGORA });
      expect(r.resposta).toBe("O corretor confirma o valor com você na visita ou no contato. Quer agendar uma visita para conhecer?");
      expect(r.fim).toBeNull();
    }
    const p = await proximaResposta(ctx({ passo: "faixa" }), "aceita proposta?", undefined, { agora: AGORA });
    expect(p.fim).toBe("qualificado");
    expect(p.resposta).toBe("Sobre proposta e valores, já pedi para {corretor} continuar seu atendimento por aqui.");
    expect(p.resposta).not.toMatch(/R\$\s*\d/);
    expect(p.resumo).toMatch(/PROPOSTA\/NEGOCIAÇÃO/);
  });
  it("o resumo do corretor leva os temas a confirmar", async () => {
    const r = await conversa(["aceita permuta?", "500 mil", "à vista", "quero falar com o corretor"]);
    expect(r[r.length - 1].resumo).toMatch(/confirmar com o cliente: permuta/);
  });
  it("a ficha do banco só usa campos que existem na captação", () => {
    expect(MIG).toMatch(/FUNCTION public\.lead_ia_ficha\(_capture uuid, _org uuid\)/);
    const ficha = MIG.slice(MIG.indexOf("FUNCTION public.lead_ia_ficha"), MIG.indexOf("FUNCTION public.lead_ia_primeira_msg"));
    expect(ficha).toMatch(/organization_id = _org/); // isolamento: só a captação da própria org
    expect(ficha).not.toMatch(/condominio|iptu|permuta|financiamento|andar/i);
  });
});

describe("item 4 — visita com 2 opções, pré-agendamento e prazo", () => {
  it("oferece 2 opções de dia e período, sem texto de sistema (t_5b493bc9 item 13)", async () => {
    const r = await proximaResposta(ctx(), "quero agendar uma visita", undefined, { agora: AGORA });
    expect(r.passo).toBe("visita");
    expect(r.dados.visita_opcoes).toEqual(["amanhã (terça, 27/10) de manhã", "quarta (28/10) à tarde"]);
    expect(r.resposta).toBe(
      "Claro! Para conhecer o apartamento, tenho amanhã (terça, 27/10) de manhã ou quarta (28/10) à tarde. Qual fica melhor para você? Te confirmo o horário certinho.",
    );
    expect(r.resposta).not.toMatch(/pré-agendamento|corretor/);
  });
  it("escolha: confirma o combinado e diz até quando o horário é confirmado", async () => {
    const r = await conversa(["quero agendar uma visita", "a primeira"]);
    const f = r[1];
    expect(f.fim).toBe("visita");
    expect(f.resposta).toBe(
      "Combinado, amanhã (terça, 27/10) de manhã! Já pedi para {corretor} continuar seu atendimento por aqui para confirmar o horário certinho até as 18h de hoje.",
    );
    expect(f.resumo).toMatch(/PRÉ-AGENDAMENTO: amanhã \(terça, 27\/10\) de manhã \(confirmar com o cliente até as 18h de hoje\)/);
  });
  it("outro dia que o cliente propõe também vira pré-agendamento", async () => {
    const r = await conversa(["quero agendar uma visita", "quinta à tarde"]);
    expect(r[1].dados.visita).toBe("quinta à tarde");
    expect(r[1].fim).toBe("visita");
  });
  it("sem domingo e prazo de confirmação conforme o horário", () => {
    const sabado = new Date("2026-10-31T13:00:00Z");
    expect(opcoesVisita(sabado)[0]).toMatch(/^segunda/);
    expect(prazoConfirmacao(new Date("2026-10-26T21:00:00Z"))).toBe("até as 12h de amanhã"); // segunda 18h
    expect(prazoConfirmacao(sabado)).toBe("até as 18h de hoje");
  });
  it("prefere falar com o corretor: passa sem marcar visita", async () => {
    const r = await conversa(["quero agendar uma visita", "prefiro que o corretor me ligue"]);
    expect(r[1].fim).not.toBe("visita");
    expect(r[1].dados.visita).toBeUndefined();
  });
});

describe("item 5 — \"encaminhei\" verificável", () => {
  it("toda passagem leva {corretor} e um texto de falha que não afirma o envio", async () => {
    const casos = [
      await proximaResposta(ctx(), "quero falar com um corretor"),
      await proximaResposta(ctx(), "paguei o sinal e ninguém respondeu"),
      await proximaResposta(ctx(), "Quero vender o meu apartamento"),
      (await conversa(["quero agendar uma visita", "a primeira"]))[1],
      respostaMidia(ctx({ dados: { midias: 1 } })),
    ];
    for (const r of casos) {
      expect(r.fim).not.toBeNull();
      // t_82c89141 item 6a: a passagem diz que o corretor continua o atendimento.
      expect(r.resposta).toMatch(/Já pedi para \{corretor\} (te (chamar|responder)|continuar seu atendimento)/);
      expect(r.resposta_falha).toBeTruthy();
      expect(r.resposta_falha).not.toMatch(/já pedi|encaminhei|\{corretor\}/i);
      expect(r.resposta_falha).toMatch(/(Registrei|Anotei)/);
    }
  });
  it("recusa não diz que encaminhou", async () => {
    const r = await proximaResposta(ctx(), "Não, já comprei");
    expect(r.fim).toBe("sem_interesse");
    expect(r.resposta).not.toMatch(/encaminh/i);
    expect(r.resposta_falha).toBeNull();
  });
  it("o banco só troca {corretor} se gravou linha do tempo E sino; senão usa o texto de falha", () => {
    const ap = MIG.slice(MIG.indexOf("FUNCTION public.lead_ia_aplicar"), MIG.indexOf("FUNCTION public.lead_ia_roteiro_salvar"));
    expect(ap).toMatch(/_resposta_falha text DEFAULT NULL/);
    expect(ap).toMatch(/\{corretor\}/);
    expect(ap).toMatch(/lead_eventos/);
    expect(ap).toMatch(/notifications/);
  });
});

describe("item 6 — reengajamento em 2 toques, DESLIGADO por padrão", () => {
  it("coluna nasce desligada; 24 h e 72 h; só servidor reserva", () => {
    expect(MIG).toMatch(/ia_reengajar boolean NOT NULL DEFAULT false/);
    expect(MIG).toMatch(/ia_reengajar_h1 integer NOT NULL DEFAULT 24/);
    expect(MIG).toMatch(/ia_reengajar_h2 integer NOT NULL DEFAULT 72/);
    expect(MIG).toMatch(/public\.lead_ia_reengajar_reservar\(\) FROM PUBLIC, anon, authenticated/);
  });
  it("respeita allowlist, opt-out, limite diário e intervalo aleatório", () => {
    const re = MIG.slice(MIG.indexOf("FUNCTION public.lead_ia_reengajar_reservar"));
    for (const x of ["ia_reengajar", "ia_envio_allowlist", "lead_ia_optouts", "ia_envio_limite_dia", "random()", "ziontalk"]) expect(re).toContain(x);
  });
  it("rota de disparo fecha sem o segredo (404) e não agenda nada", () => {
    const rota = readFileSync("src/routes/api/leads/reengajar.ts", "utf8");
    expect(rota).toMatch(/LEADS_IA_REENGAJAR_SEGREDO/);
    expect(rota).toMatch(/404/);
    expect(MIG).not.toMatch(/cron\.schedule|pg_cron|net\.http_post/);
  });
  it("toque 2 (alternativa): \"sim\" passa ao corretor; recusa encerra; SAIR é opt-out", async () => {
    const alt = ctx({ passo: "faixa", dados: { alternativa: "a casa do bairro Centro" } });
    const sim = await proximaResposta(alt, "sim");
    expect(sim.fim).toBe("qualificado");
    expect(sim.resposta).toMatch(/a casa do bairro Centro/);
    expect((await proximaResposta(alt, "não tenho mais interesse")).fim).toBe("sem_interesse");
    expect(ehOptOut("SAIR")).toBe(true);
  });
});

describe("item 7 — código do anúncio", () => {
  it("com código do portal ou captação, nunca pede o código", async () => {
    const r = await conversa(["oi", "comprar", "até 400 mil", "à vista"], { transacao: null });
    for (const x of r) expect(x.resposta).not.toMatch(/código do anúncio/);
    const s = await proximaResposta(ctx({ ficha: null, tem_captacao: false, imovel_frase: null }), "oi");
    expect(s.resposta).not.toMatch(/código/);
  });
  it("sem nada: pede UMA vez, com exemplo, e acha a captação pelo código", async () => {
    const buscarImovel = vi.fn(async () => ({ capture_id: "cap9", frase: "a casa do bairro Centro", ficha: { tipo: "casa", bairro: "Centro" } }));
    const r = await conversa(["oi", "é o AP1234", "comprar"], { anuncio_codigo: null, tem_captacao: false, ficha: null, imovel_frase: null, transacao: null }, undefined, { buscarImovel });
    expect(r[0].passo).toBe("codigo");
    expect(r[0].resposta).toMatch(/código do anúncio\? .*por exemplo: AP1234\./);
    expect(buscarImovel).toHaveBeenCalledWith("AP1234");
    expect(r[1].dados.imovel_capture_id).toBe("cap9");
    expect(r[1].resposta).toBe("Achei! É uma casa no bairro Centro. Você procura para comprar ou para alugar?");
    expect(r.slice(1).some((x) => /código do anúncio/.test(x.resposta))).toBe(false);
  });
  it("código informado achado no XML (sem captação): usa a ficha do XML e guarda o código na conversa (t_76243950)", async () => {
    const fichaXml: FichaIa = { tipo: "apartamento", bairro: "Campolim", quartos: "3", suites: "1", vagas: "2", area_util_m2: "92", condominio: "R$ 720,00", iptu: "R$ 140,00 por mês" };
    const buscarImovel = vi.fn(async () => ({ capture_id: null, xml_codigo: "VIP0028", frase: "o apartamento do bairro Campolim", ficha: fichaXml }));
    const r = await conversa(["oi", "é o VIP0028", "qual o condomínio e o IPTU? ainda está disponível?"], { anuncio_codigo: null, tem_captacao: false, ficha: null, imovel_frase: null, transacao: null }, undefined, { buscarImovel });
    expect(r[1].dados.imovel_xml_codigo).toBe("VIP0028");
    expect(r[1].dados.imovel_capture_id).toBeUndefined();
    expect(r[1].resposta).toMatch(/^Achei! É um apartamento no bairro Campolim\. O apartamento tem 3 quartos, sendo 1 suíte, 2 vagas de garagem e 92 m²\./);
  });
  it("ficha do XML no contexto: responde condomínio e IPTU, e nunca garante disponibilidade nem deduz permuta/andar", async () => {
    const fichaXml: FichaIa = { tipo: "apartamento", bairro: "Campolim", quartos: "3", condominio: "R$ 720,00", iptu: "R$ 140,00 por mês" };
    const r = await proximaResposta(ctx({ passo: "faixa", ficha: fichaXml }), "qual o condomínio e o IPTU? ainda está disponível? qual andar?", undefined, { agora: AGORA });
    expect(r.resposta).toContain("O condomínio é de R$ 720 por mês.");
    expect(r.resposta).toContain("O IPTU é de R$ 140 por mês.");
    expect(r.resposta).toMatch(/O corretor confirma a disponibilidade e o andar e a posição com você na visita ou no contato\./);
    expect(r.dados.pendentes).toEqual(["disponibilidade", "andar/posição"]);
  });
  it("cliente não sabe o código: segue sem pedir de novo", async () => {
    const r = await conversa(["oi", "não sei o código", "comprar"], { anuncio_codigo: null, tem_captacao: false, ficha: null, imovel_frase: null, transacao: null });
    expect(r[1].resposta).toBe("Tudo bem! Já pedi para {corretor} continuar seu atendimento por aqui para te passar os detalhes.");
    expect(r.slice(1).some((x) => /código do anúncio/.test(x.resposta))).toBe(false);
  });
});

describe("item 8 — quem não é comprador nem locatário vai ao humano sem questionário", () => {
  it.each([
    ["Quero vender o meu apartamento", "proprietario"],
    ["Tenho uma casa para alugar, vocês anunciam?", "proprietario"],
    ["Sou corretor, tenho um cliente interessado", "parceiro"],
    ["Oferecemos serviços de fotografia para imobiliárias", "fornecedor"],
    ["é assunto pessoal, preciso falar com a Ana", "pessoal"],
  ])("%s -> %s", async (t, cat) => {
    expect(categoriaNaoLead(t)).toBe(cat);
    const r = await proximaResposta(ctx(), t);
    expect(r.fim).toBe("nao_lead");
    expect(r.resposta).not.toMatch(/faixa|pagamento|comprar ou/);
    expect(r.resumo).toMatch(/não é comprador nem locatário/);
  });
  it("permuta e interesse de compra continuam sendo lead", () => {
    for (const t of ["Quero dar meu carro como parte de pagamento, aceita permuta?", "quero comprar esse apartamento", "tenho interesse", "quero alugar o apartamento"])
      expect(categoriaNaoLead(t)).toBeNull();
  });
  it("banco: motivo nao_lead também avisa os gestores", () => {
    expect(MIG).toMatch(/'nao_lead'/);
    const p = MIG.slice(MIG.indexOf("FUNCTION public.lead_ia_passar"), MIG.indexOf("FUNCTION public.lead_ia_aplicar"));
    expect(p).toMatch(/nao_lead/);
  });
});

describe("mantém o que já existia", () => {
  it("pedido de humano e assunto sensível vão para pessoa em qualquer passo", async () => {
    for (const passo of ["interesse", "faixa", "pagamento", "visita"] as const) {
      expect((await proximaResposta(ctx({ passo }), "quero falar com um atendente")).fim).toBe("pediu_pessoa");
      expect((await proximaResposta(ctx({ passo }), "vou procurar o procon")).fim).toBe("sensivel");
    }
  });
  it("sem preço inventado em nenhuma conversa", async () => {
    const r = await conversa(["qual o valor?", "não sei", "financiar", "a segunda"]);
    for (const x of r) expect(x.resposta).not.toMatch(/R\$\s*\d/);
  });
  it("áudio: 1ª vez pede texto repetindo a pergunta; 2ª passa ao corretor", () => {
    const a = respostaMidia(ctx({ passo: "faixa" }));
    expect(a.resposta).toBe("Desculpe, por aqui eu só consigo ler mensagens escritas. Até quanto você pensa em investir?");
    expect(respostaMidia(ctx({ dados: { midias: 1 } })).fim).toBe("pediu_pessoa");
  });
  it("conversa antiga (passo prazo/regiao) não quebra", async () => {
    const r = await proximaResposta(ctx({ passo: "prazo", transacao: null, dados: { finalidade: "comprar", perguntas: ["finalidade"] } }), "em 3 meses");
    expect(r.dados.prazo).toBe("em 3 meses");
    expect(r.fim).toBeNull();
  });
  it("rollback restaura as funções e tira só o que esta migration criou", () => {
    for (const x of ["DROP FUNCTION IF EXISTS public.lead_ia_reengajar_reservar", "DROP COLUMN IF EXISTS ia_primeira_msg", "DROP COLUMN IF EXISTS ia_reengajar"])
      expect(RB).toContain(x);
    expect(RB).not.toMatch(/DROP TABLE/);
  });
});

describe("modelo de linguagem SIMULADO (mock)", () => {
  it("só ajuda a ENTENDER; a resposta continua do roteiro", async () => {
    const mock = vi.fn(async () => ({ finalidade: "comprar" }));
    const r = await proximaResposta(ctx({ passo: "finalidade", transacao: null, dados: { perguntas: ["finalidade"] } }), "tô querendo um cantinho meu", mock);
    expect(mock).toHaveBeenCalledOnce();
    expect(r.dados.finalidade).toBe("comprar");
    expect(r.resposta).toBe("Quer agendar uma visita para conhecer?");
  });
  it("campos fora do passo devolvidos pelo modelo são ignorados", async () => {
    const mock = vi.fn(async () => ({ finalidade: "comprar", faixa: "R$ 1 bilhão" }) as never);
    const r = await proximaResposta(ctx({ passo: "finalidade", transacao: null }), "xyz", mock);
    expect(r.dados.faixa).toBeUndefined();
  });
  it("modelo fora do ar: segue só com regras, sem travar", async () => {
    const mock = vi.fn(async () => {
      throw new Error("timeout");
    });
    const r = await proximaResposta(ctx({ passo: "pagamento", dados: { perguntas: ["faixa", "pagamento"], faixa: "x" } }), "xyz", mock, { agora: AGORA });
    expect(r.fim).toBeNull();
    expect(r.resposta).toBe("Quer agendar uma visita para conhecer?");
  });
  it("não chama o modelo quando as regras entendem (economia)", async () => {
    const mock = vi.fn(async () => null);
    await proximaResposta(ctx({ passo: "finalidade", transacao: null }), "alugar", mock);
    await proximaResposta(ctx({ passo: "pagamento" }), "financiamento", mock);
    expect(mock).not.toHaveBeenCalled();
  });
});

// Card t_25fe1197 (teste real de Denis com o VIP0040 na ZZ, 26/10) e t_59ab47d4.
describe("t_25fe1197 — valor do XML, faixa, permuta e \"é robô?\"", () => {
  const VIP0040: FichaIa = {
    tipo: "apartamento", bairro: "Jardim São Carlos", cidade: "Sorocaba", quartos: "2", suites: "1", banheiros: "2", vagas: "1",
    area_util_m2: "59", condominio: "R$ 478,00", iptu: "R$ 58,00 por mês", negocio: "venda", preco: "R$ 430.000", preco_valor: 430000,
    link: "https://vipsevenimoveis.com.br/imovel/VIP0040",
  };
  const c = (p: Partial<ContextoIa> = {}) => ({ ficha: VIP0040, imovel_fonte: "xml" as const, anuncio_codigo: "VIP0040", tem_captacao: false, org_nome: "ZZ Teste Provisionamento", ...p });

  it("com preço no XML, diz só o valor anunciado (sem falar em proposta sem o cliente puxar)", async () => {
    const r = await proximaResposta(ctx(c({ passo: "faixa" })), "qual o valor?", undefined, { agora: AGORA });
    expect(r.resposta).toBe("O apartamento está anunciado por R$ 430.000. Quer agendar uma visita para conhecer?");
    expect(r.resposta).not.toMatch(/proposta|negocia|corretor/i);
    expect(r.resposta).not.toMatch(/dispon[ií]vel|aceita permuta|aceita financiamento|andar/i);
  });
  it("condomínio e IPTU do XML são ditos; sem preço no XML, não inventa e fica com o corretor", async () => {
    const r = await proximaResposta(ctx(c({ passo: "faixa" })), "qual o condomínio e o iptu?", undefined, { agora: AGORA });
    expect(r.resposta).toBe("O condomínio é de R$ 478 por mês. O IPTU é de R$ 58 por mês. Quer agendar uma visita para conhecer?");
    const semPreco = { ...VIP0040, preco: undefined, preco_valor: undefined };
    const r2 = await proximaResposta(ctx(c({ passo: "faixa", ficha: semPreco })), "quanto custa?", undefined, { agora: AGORA });
    expect(r2.resposta).toMatch(/^O corretor confirma o valor com você na visita ou no contato\./);
    expect(r2.resposta).not.toMatch(/R\$\s*\d/);
  });
  it("locação: diz o aluguel do XML (e o condomínio/IPTU se vierem)", async () => {
    const loc: FichaIa = { tipo: "apartamento", bairro: "Campolim", cidade: "Sorocaba", quartos: "2", negocio: "locacao", aluguel: "R$ 2.500", aluguel_valor: 2500, condominio: "R$ 600,00" };
    const r = await proximaResposta(ctx(c({ passo: "faixa", ficha: loc, transacao: "aluguel" })), "qual o valor do aluguel e do condomínio?", undefined, { agora: AGORA });
    expect(r.resposta).toBe("O aluguel é de R$ 2.500 por mês. O condomínio é de R$ 600 por mês. Quer agendar uma visita para conhecer?");
  });

  it("\"120000 aceita financiamento ?\": registra a faixa e responde o financiamento no mesmo turno (sem repetir a pergunta)", async () => {
    const perto = { ...VIP0040, preco: "R$ 130.000", preco_valor: 130000 };
    const r = await proximaResposta(ctx(c({ passo: "faixa", ficha: perto, dados: { perguntas: ["faixa"] } })), "120000 aceita financiamento ?", undefined, { agora: AGORA });
    expect(r.dados.faixa).toBe("120000 aceita financiamento ?");
    expect(r.resposta).toBe("O corretor confirma se aceita financiamento com você na visita ou no contato. Quer agendar uma visita para conhecer?");
    expect(r.resposta).not.toMatch(/faixa de valor|forma de pagamento|à vista ou com financiamento/);
  });
  it("faixa muito longe do preço anunciado: confirma com naturalidade (uma vez) e depois segue", async () => {
    const rs = await conversa(["1.200.000", "isso mesmo", "à vista"], { ...c(), passo: "faixa", dados: { perguntas: ["faixa"] } });
    expect(rs[0].resposta).toBe("Só confirmando: sua faixa é de R$ 1.200.000? O apartamento está anunciado por R$ 430.000.");
    expect(rs[0].passo).toBe("faixa");
    expect(rs[1].resposta).toBe("Quer agendar uma visita para conhecer?");
    expect(rs[1].dados.faixa).toBe("1.200.000");
  });
  it("faixa longe corrigida pelo cliente: o novo valor substitui", async () => {
    const rs = await conversa(["120 mil", "desculpa, 420 mil"], { ...c(), passo: "faixa", dados: { perguntas: ["faixa"] } });
    expect(rs[0].resposta).toMatch(/^Só confirmando: sua faixa é de R\$ 120\.000\?/);
    expect(rs[1].dados.faixa).toBe("desculpa, 420 mil");
    expect(rs[1].resposta).not.toMatch(/Só confirmando/);
  });
  it("faixa perto do preço: aceita calada; faixaLonge só acima do dobro ou abaixo da metade", async () => {
    const r = await proximaResposta(ctx(c({ passo: "faixa", dados: { perguntas: ["faixa"] } })), "uns 400 mil", undefined, { agora: AGORA });
    expect(r.resposta).not.toMatch(/Só confirmando/);
    expect(faixaLonge("1.200.000", 430000)).toBe(1200000);
    expect(faixaLonge("400 mil", 430000)).toBeNull();
    expect(faixaLonge("400 mil", undefined)).toBeNull();
  });

  it("permuta com negação ou \"trocar a data\" não é permuta (revisão t_e520a9bb)", async () => {
    for (const t of ["sem permuta", "não tenho imóvel para permuta", "vou trocar com minha esposa a data", "nada de troca, à vista"]) {
      const r = await proximaResposta(ctx(c({ passo: "pagamento" })), t, undefined, { agora: AGORA });
      expect(r.fim, t).toBeNull();
      expect(r.dados.pagamento ?? [], t).not.toContain("permuta");
    }
  });
  it("faixa: CEP, telefone e \"de entrada\" não viram faixa; a confirmação vale só uma vez (revisão t_e520a9bb)", async () => {
    // Junto com uma dúvida (quando o número solto é lido como faixa), CEP/telefone/entrada não viram faixa.
    for (const t of ["meu cep é 18040000, aceita financiamento?", "me liga 98765-4321, aceita financiamento?", "tenho 50000 de entrada, aceita financiamento?", "18040-000 aceita financiamento?"]) {
      const r = await proximaResposta(ctx(c({ passo: "faixa", dados: { perguntas: ["faixa"] } })), t, undefined, { agora: AGORA });
      expect(r.dados.faixa, t).toBeUndefined();
    }
    // Já confirmou uma vez: um valor dito depois não reabre a confirmação nem troca a faixa.
    const rs = await conversa(["1.200.000", "isso mesmo", "120000"], { ...c(), passo: "faixa", dados: { perguntas: ["faixa"] } });
    expect(rs[0].resposta).toMatch(/^Só confirmando/);
    expect(rs[2].resposta).not.toMatch(/Só confirmando/);
    expect(rs[2].dados.faixa).toBe("1.200.000");
  });

  it("pagamento: \"permuta\" nunca é sugerida; se o cliente falar em permuta, registra e passa ao corretor", async () => {
    const rs = await conversa(["500 mil"], { ...c(), passo: "faixa", dados: { perguntas: ["faixa"] }, ficha: { ...VIP0040, preco_valor: 480000 } });
    expect(rs[0].resposta).toBe("Perfeito! Quer agendar uma visita para conhecer?"); // pagamento não é mais perguntado
    expect(rs[0].resposta).not.toMatch(/permuta/);
    for (const t of ["aceita permuta?", "posso dar meu carro como parte?", "pago com permuta"]) {
      const r = await proximaResposta(ctx(c({ passo: "pagamento" })), t, undefined, { agora: AGORA });
      expect(r.fim, t).toBe("qualificado");
      expect(r.resposta).toBe("Anotei! Se o proprietário aceita permuta, o corretor confirma com você. Já pedi para {corretor} continuar seu atendimento por aqui para conversar sobre isso.");
      expect(r.resposta).not.toMatch(/(?<![Ss]e (ele|o proprietário) )aceita permuta|não aceita/); // nunca afirma se aceita
      expect(r.dados.pagamento).toContain("permuta");
      expect(r.resumo).toMatch(/PERMUTA/);
    }
  });

  it("\"é robô?\": não mente — confirma que é assistente virtual e oferece o corretor; \"sim\" passa", async () => {
    const rs = await conversa(["vc é um robô?", "sim"], c());
    // Texto de Denis (t_5b493bc9): não mente, sem parênteses técnicos.
    expect(rs[0].resposta).toBe(
      "Sou a Nicole, assistente da ZZ Teste Provisionamento, e respondo por aqui com ajuda de um sistema. Se preferir falar com um corretor, te passo agora. Quer?",
    );
    const h = await proximaResposta(ctx(c()), "você é humano?", undefined, { agora: AGORA });
    expect(h.resposta).toMatch(/^Sou a Nicole, assistente .*com ajuda de um sistema\./); // nunca começa com "Sim,"
    // Falso positivo (revisão t_e520a9bb): não é pergunta sobre quem responde.
    for (const t of ["e ia ver amanhã?", "tem robô aspirador no condomínio?", "o proprietário é humano?", "a casa tem bot de portaria?"])
      expect(perguntouSeRobo(t), t).toBe(false);
    expect(rs[0].fim).toBeNull();
    expect(rs[1].fim).toBe("pediu_pessoa");
    for (const t of ["é uma IA?", "estou falando com um bot?", "isso é resposta automática?", "é uma pessoa de verdade?", "é inteligência artificial?"])
      expect(perguntouSeRobo(t), t).toBe(true);
    for (const t of ["eu ia visitar amanhã", "a bota", "quero visitar", "obrigado"]) expect(perguntouSeRobo(t), t).toBe(false);
    expect(pediuPessoa("é um robô?")).toBe(false);
  });
  it("\"é robô?\" e depois segue a conversa normalmente se não quiser o corretor", async () => {
    const rs = await conversa(["é robô?", "não precisa, quanto custa?"], { ...c(), passo: "faixa" });
    expect(rs[1].fim).toBeNull();
    expect(rs[1].resposta).toMatch(/[Ee]stá anunciado por R\$ 430\.000/);
  });
});
