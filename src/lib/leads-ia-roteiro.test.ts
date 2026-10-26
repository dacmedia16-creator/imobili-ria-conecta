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
  type ContextoIa,
  type Extrator,
  type FichaIa,
  type RespostaIa,
} from "./leads-ia";

// Card t_fc4d9b27: roteiro novo da Nicole (estudo de 1.347 conversas da Lais). Conversas simuladas, modelo
// de linguagem SIMULADO (mock) e nenhuma chamada de rede. O banco (passagem verificável, reengajamento,
// isolamento) foi testado em PostgreSQL descartável: scripts/leads-ia-test/test_roteiro.sql.
const MIG = readFileSync("supabase/migrations/20261026170000_leads_ia_roteiro_lais.sql", "utf8");
const RB = readFileSync("docs/sql/rollback/20261026170000_leads_ia_roteiro_lais.rollback.sql", "utf8");

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
  it("padrão: uma bolha, assistente virtual, imobiliária da org, tipo/bairro e pergunta fechada, sem link", () => {
    const t = previaPrimeiraMensagem({ ia_nome: "Nicole", ia_primeira_msg: null }, "Imob A", "Maria Souza", "no apartamento do bairro Campolim");
    expect(t).toBe(
      "Oi, Maria! Aqui é a Nicole, assistente virtual da Imob A. Vi seu interesse no apartamento do bairro Campolim. Quer saber valores e condições, ou já prefere agendar uma visita?",
    );
    expect(t).not.toMatch(/\n|https?:|www\./);
    expect(t).toMatch(/\?$/);
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
  it("banco usa o mesmo texto padrão e trava link na coluna", () => {
    expect(MIG).toContain(PRIMEIRA_MSG_PADRAO);
    expect(MIG).toMatch(/lead_config_ia_primeira_msg_sem_link/);
  });
});

describe("item 2 — dúvida primeiro, no máximo 3 perguntas, uma por turno", () => {
  it("venda vinda do portal: não pergunta finalidade (2 perguntas) e termina na visita", async () => {
    const r = await conversa(["Quero saber valores", "uns 500 mil", "financiamento"]);
    expect(r.map((x) => x.passo)).toEqual(["faixa", "pagamento", "visita"]);
    expect(r[0].resposta).toMatch(/quem confirma é o corretor/); // respondeu a dúvida antes da pergunta
    expect(r[0].resposta.indexOf("corretor")).toBeLessThan(r[0].resposta.indexOf("faixa de valor"));
    expect(perguntas(r)).toBe(2);
    expect(r[2].dados).toMatchObject({ faixa: "uns 500 mil", pagamento: ["financiamento"] });
  });
  it("sem transação do portal: finalidade, faixa e pagamento (3, uma por turno)", async () => {
    const r = await conversa(["sim", "comprar", "até 400 mil", "à vista"], { transacao: null });
    expect(r.map((x) => x.passo)).toEqual(["finalidade", "faixa", "pagamento", "visita"]);
    for (const x of r) expect((x.resposta.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
    expect(perguntas(r)).toBe(3);
  });
  it("aluguel: não pergunta forma de pagamento", async () => {
    const r = await conversa(["tenho interesse", "até 3 mil"], { transacao: "aluguel" });
    expect(r.map((x) => x.passo)).toEqual(["faixa", "visita"]);
  });
  it("nunca passa de 3 perguntas, mesmo com respostas confusas", async () => {
    const r = await conversa(["sim", "hmm", "sei lá", "talvez", "não sei", "pode ser"], { transacao: null });
    expect(perguntas(r)).toBeLessThanOrEqual(3);
    expect(r.map((x) => x.passo)).not.toContain("prazo");
    expect(r.map((x) => x.passo)).not.toContain("regiao");
  });
  it("dúvida no meio: responde e repete a pergunta do passo uma vez só", async () => {
    const r = await conversa(["sim", "ainda está disponível?", "e o condomínio?", "500 mil"]);
    expect(r[1].passo).toBe("faixa");
    // t_76243950: disponibilidade nunca é garantida; a resposta fixa é "confirmo a disponibilidade com o corretor".
    expect(r[1].resposta).toMatch(/^Confirmo a disponibilidade com o corretor\. .*faixa de valor/);
    expect(r[2].resposta).not.toMatch(/faixa de valor/); // não repete a 2ª vez
  });
});

describe("item 3 — respostas só pela ficha da captação", () => {
  it("o que a ficha tem, responde; o que não tem, \"não tenho esse dado confirmado\"", async () => {
    const r = await proximaResposta(ctx({ passo: "faixa" }), "Quantos quartos tem? E aceita permuta? Qual o condomínio?", undefined, { agora: AGORA });
    expect(r.resposta).toMatch(/^Tem 3 quartos \(1 suíte\)\. Sobre condomínio e permuta, não tenho esse dado confirmado, vou confirmar com o corretor\./);
    expect(r.dados.pendentes).toEqual(expect.arrayContaining(["condomínio", "permuta"]));
  });
  it("condomínio/IPTU, permuta, financiamento e andar sem dado: nunca estima", async () => {
    for (const t of ["qual o valor do condomínio?", "quanto é o IPTU?", "aceita permuta?", "aceita financiamento?", "qual andar?"]) {
      const r = await proximaResposta(ctx({ passo: "faixa" }), t, undefined, { agora: AGORA });
      expect(r.resposta).toContain("não tenho esse dado confirmado, vou confirmar com o corretor");
      expect(r.resposta).not.toMatch(/R\$|\d+ ?(mil|reais)|aceita (permuta|financiamento)\b(?! ?\?)|andar \d/);
      expect(r.fim).toBeNull();
    }
  });
  it("disponibilidade: NUNCA garante, nem com a ficha dizendo disponível (t_76243950)", async () => {
    for (const ficha of [FICHA, { ...FICHA, disponivel: true }, { ...FICHA, disponivel: false }]) {
      for (const t of ["ainda está disponível?", "já foi vendido?", "ainda está à venda?"]) {
        const r = await proximaResposta(ctx({ passo: "faixa", ficha }), t, undefined, { agora: AGORA });
        expect(r.resposta).toContain("Confirmo a disponibilidade com o corretor.");
        expect(r.resposta).not.toMatch(/está disponível|indisponível|já foi vendido|não está/i);
        expect(r.dados.pendentes).toContain("disponibilidade");
      }
    }
  });
  it("quando a ficha passar a ter os campos, responde com eles (sem inventar; disponibilidade continua com o corretor)", async () => {
    const ficha: FichaIa = { ...FICHA, condominio: "R$ 650,00", iptu: "R$ 120,00", aceita_permuta: false, aceita_financiamento: true, andar: "5º andar, frente", disponivel: true };
    const r = await proximaResposta(ctx({ passo: "faixa", ficha }), "Aceita permuta? aceita financiamento? qual o condomínio e o iptu? qual andar? ainda está disponível?", undefined, { agora: AGORA });
    for (const x of ["não aceita permuta", "aceita financiamento", "condomínio é de R$ 650,00", "IPTU é de R$ 120,00", "fica no 5º andar, frente", "Confirmo a disponibilidade com o corretor."])
      expect(r.resposta).toContain(x);
    expect(r.resposta).not.toContain("não tenho esse dado");
    expect(r.resposta).not.toContain("stá disponível");
  });
  it("preço e negociação: sempre o corretor, sem número", async () => {
    for (const t of ["qual o valor?", "quanto custa?", "aceita proposta?"]) {
      const r = await proximaResposta(ctx({ passo: "faixa" }), t, undefined, { agora: AGORA });
      expect(r.resposta).toMatch(/quem confirma é o corretor/);
      expect(r.resposta).not.toMatch(/R\$\s*\d/);
    }
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
  it("oferece 2 opções de dia e período e explica o pré-agendamento", async () => {
    const r = await proximaResposta(ctx(), "quero agendar uma visita", undefined, { agora: AGORA });
    expect(r.passo).toBe("visita");
    expect(r.dados.visita_opcoes).toEqual(["amanhã (terça, 27/10) de manhã", "quarta (28/10) à tarde"]);
    expect(r.resposta).toMatch(/amanhã \(terça, 27\/10\) de manhã ou quarta \(28\/10\) à tarde\?/);
    expect(r.resposta).toMatch(/pré-agendamento: o corretor confirma/);
  });
  it("escolha: diz que é pré-agendamento, quem confirma e até quando", async () => {
    const r = await conversa(["quero agendar uma visita", "a primeira"]);
    const f = r[1];
    expect(f.fim).toBe("visita");
    expect(f.resposta).toBe(
      "Pré-agendamento anotado: amanhã (terça, 27/10) de manhã. Encaminhei para {corretor}, que confirma com você até as 18h de hoje. A visita só fica marcada depois dessa confirmação, combinado?",
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
      expect(r.resposta).toMatch(/Encaminhei .*\{corretor\}/);
      expect(r.resposta_falha).toBeTruthy();
      expect(r.resposta_falha).not.toMatch(/encaminhei|\{corretor\}/i);
      expect(r.resposta_falha).toMatch(/Registrei/);
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
    expect(r[1].resposta).toMatch(/É uma casa, no bairro Centro/);
    expect(r.slice(1).some((x) => /código do anúncio/.test(x.resposta))).toBe(false);
  });
  it("código informado achado no XML (sem captação): usa a ficha do XML e guarda o código na conversa (t_76243950)", async () => {
    const fichaXml: FichaIa = { tipo: "apartamento", bairro: "Campolim", quartos: "3", suites: "1", vagas: "2", area_util_m2: "92", condominio: "R$ 720,00", iptu: "R$ 140,00 por mês" };
    const buscarImovel = vi.fn(async () => ({ capture_id: null, xml_codigo: "VIP0028", frase: "o apartamento do bairro Campolim", ficha: fichaXml }));
    const r = await conversa(["oi", "é o VIP0028", "qual o condomínio e o IPTU? ainda está disponível?"], { anuncio_codigo: null, tem_captacao: false, ficha: null, imovel_frase: null, transacao: null }, undefined, { buscarImovel });
    expect(r[1].dados.imovel_xml_codigo).toBe("VIP0028");
    expect(r[1].dados.imovel_capture_id).toBeUndefined();
    expect(r[1].resposta).toMatch(/É um apartamento com 3 quartos \(1 suíte\), 2 vagas e 92 m² de área útil, no bairro Campolim\./);
  });
  it("ficha do XML no contexto: responde condomínio e IPTU, e nunca garante disponibilidade nem deduz permuta/andar", async () => {
    const fichaXml: FichaIa = { tipo: "apartamento", bairro: "Campolim", quartos: "3", condominio: "R$ 720,00", iptu: "R$ 140,00 por mês" };
    const r = await proximaResposta(ctx({ passo: "faixa", ficha: fichaXml }), "qual o condomínio e o IPTU? ainda está disponível? aceita permuta? qual andar?", undefined, { agora: AGORA });
    expect(r.resposta).toContain("condomínio é de R$ 720,00");
    expect(r.resposta).toContain("IPTU é de R$ 140,00 por mês");
    expect(r.resposta).toContain("Confirmo a disponibilidade com o corretor.");
    expect(r.resposta).toMatch(/Sobre permuta e andar\/posição, não tenho esse dado confirmado, vou confirmar com o corretor\./);
  });
  it("cliente não sabe o código: segue sem pedir de novo", async () => {
    const r = await conversa(["oi", "não sei o código", "comprar"], { anuncio_codigo: null, tem_captacao: false, ficha: null, imovel_frase: null, transacao: null });
    expect(r[1].resposta).toMatch(/corretor para confirmar qual é o imóvel/);
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
    expect(a.resposta).toMatch(/faixa de valor/);
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
    expect(r.resposta).toMatch(/faixa de valor/);
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
    expect(r.passo).toBe("visita");
  });
  it("não chama o modelo quando as regras entendem (economia)", async () => {
    const mock = vi.fn(async () => null);
    await proximaResposta(ctx({ passo: "finalidade", transacao: null }), "alugar", mock);
    await proximaResposta(ctx({ passo: "pagamento" }), "financiamento", mock);
    expect(mock).not.toHaveBeenCalled();
  });
});
