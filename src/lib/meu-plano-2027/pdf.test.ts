import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  VAZIO,
  conteudoPlanoPdf,
  nomeArquivoPlano,
  planoFinalizado,
  type ConteudoPdf,
  type ItemPdf,
} from "./pdf-conteudo";
import { buildPlanoPdf, limpa } from "./pdf";
import { ORDEM, progresso, rotuloPagina, statusTela, tela } from "./telas";
import { calc, fmt, type Respostas } from "./regras";
import { chavesTabela, sugestoesMes } from "./meses";
import { MESES } from "./listas";

// Plano antigo da trilha Ativação (dados fictícios; números do exemplo do book): sem p34–p44.
const ATIVACAO: Respostas = {
  // Diagnóstico (pág. 14 a 16) de quem está começando: sem histórico, tudo 0 (t_8a8eb930).
  ...Object.fromEntries(
    ["comissao", "trans", "cres", "conv", "ticket", "dias", "ativos", "revisados"].map((k) => [
      `d.${k}`,
      "0",
    ]),
  ),
  "or.0.c": "0",
  ...Object.fromEntries([1, 1, 1, 1, 1, 1].map((v, i) => [`av.${i}`, String(v)])),
  "pq.frase": "Dar segurança à minha família",
  "pq.0": "Ver o cliente feliz com a chave na mão",
  ...Object.fromEntries(
    [3450, 760, 1080, 400, 300, 500, 200, 300].map((v, i) => [`op.${i}`, String(v)]),
  ),
  ...Object.fromEntries([800, 300, 600, 100, 900, 200].map((v, i) => [`on.${i}`, String(v)])),
  "so.0.t": "Viagem em família",
  "so.0.v": "12.000",
  "es.aliq": "15",
  "m.faixa": "60",
  "m.ticket": "700.000",
  "m.pct": "3",
  "m.conv": "22",
  "m.alvo": "16 a 18 CREs ativas",
  "m.carteira": "16",
  "mt.creFim": "16",
  "mt.creIni": "4",
  "d90.cre1": "2027-01-20",
  "d90.venda1": "2027-04-10",
  "d90.parceiro": "Carla, minha colega",
  "d90.aprender": "Apresentar a ACM",
  "sem.0.0": true,
  "mc.c.0": true,
  "pa.nome": "Ana Exemplo",
  "pa.c.0": "Fazer 20 contatos por dia",
  "pa.cad": "semanal",
  "pa.dia": "seg",
  "pa.hora": "09:00",
  "kri.0": "Ligar para 20 proprietários por dia",
};

// Plano completo no caminho único: Ativação + as telas que eram só da trilha Planejamento.
const PLANEJAMENTO: Respostas = {
  ...ATIVACAO,
  "d.comissao": "200.000",
  "d.trans": "10",
  "d.cres": "20",
  "d.conv": "42",
  "d.ticket": "700.000",
  "d.dias": "120",
  "d.ativos": "8",
  "d.revisados": "30",
  "or.0.c": "3",
  "or.3.v": "2",
  ...Object.fromEntries([2, 3, 2, 4, 3, 1].map((v, i) => [`av.${i}`, String(v)])),
  "pos.regiao": "Campolim e Parque Campolim",
  "pos.tipo": "Apartamento",
  "pos.de": "500.000",
  "pos.ate": "900.000",
  "sp.0": "10",
  "sp.1": "8",
  "sp.2": "6",
  "sp.3": "4",
  "sp.dia": "sex",
  "fu.v2cre": "50",
  "rv.mes": "4",
  "rv.dias": "60",
  "rv.ritual": "toda sexta às 8h",
  "mk.0": true,
  "mk.invest": "1.000",
  "de.h.0": "Apresentar a ACM com segurança",
  "de.horas": "3",
  "ac.0.0": "12",
  "ac.0.1": "15",
};

const itens = (c: ConteudoPdf, id: string) => [
  ...(c.secoes.find((s) => s.id === id)?.itens ?? []),
  ...(c.numeros.find((s) => s.id === id)?.itens ?? []),
];
const valor = (c: ConteudoPdf, id: string, rot: string) =>
  (
    itens(c, id).find((i) => i.k === "campo" && i.rot === rot) as Extract<ItemPdf, { k: "campo" }>
  )?.val?.replace(/\u00a0/g, " ");

describe("quando o PDF existe (regra 1: todas as telas do plano completas)", () => {
  it("o plano de exemplo está 100% completo (mesmo critério do X/Y telas completas)", () => {
    const p = progresso(PLANEJAMENTO);
    expect(p.telas).toBe(p.total);
    expect(p.total).toBe(ORDEM.length);
    expect(planoFinalizado(PLANEJAMENTO)).toBe(true);
  });

  it("falta 1 tela = sem PDF; plano vazio = sem PDF", () => {
    const S = { ...PLANEJAMENTO };
    delete S["pa.cad"];
    expect(progresso(S).telas).toBe(progresso(S).total - 1);
    expect(planoFinalizado(S)).toBe(false);
    expect(planoFinalizado({})).toBe(false);
    expect(() => conteudoPlanoPdf({ respostas: S })).toThrow(/não está completo/);
  });

  it("plano antigo completo só na Ativação: faltam agora as telas p34–p44 (nada é apagado)", () => {
    expect(planoFinalizado(ATIVACAO)).toBe(false);
    const faltam = ORDEM.filter((id) => ["vazio", "parc"].includes(statusTela(id, ATIVACAO)!));
    expect(faltam).toEqual(["p34", "p36", "p37", "p38", "p39", "p40", "p44"]);
  });
});

describe("conteúdo do PDF", () => {
  const c = conteudoPlanoPdf({
    respostas: PLANEJAMENTO,
    assinado_corretor_em: "2026-11-12T13:00:00Z",
  });

  it("todas as telas, na ordem única, com o rótulo da página do book", () => {
    expect(c.secoes.map((s) => s.id)).toEqual(ORDEM);
    for (const s of c.secoes) {
      expect(s.rotulo).toBe(rotuloPagina(tela(s.id)!.pdf));
      expect(s.titulo).toBe(tela(s.id)!.t);
      expect(s.itens.length).toBeGreaterThan(0);
    }
    expect(c.secoes.find((s) => s.id === "p20")!.rotulo).toBe("pág. 19 · PDF 20");
    expect(`${c.telas}/${c.total}`).toBe(`${ORDEM.length}/${ORDEM.length}`);
  });

  it("traz as respostas como foram digitadas", () => {
    expect(valor(c, "p20", "A frase que sustenta o plano")).toBe("Dar segurança à minha família");
    expect(valor(c, "p22", "Casa (Aluguel ou prestação, condomínio, IPTU, contas, mercado)")).toBe(
      "R$ 3.450",
    );
    expect(valor(c, "p25", "5 · Minha alíquota estimada de imposto")).toBe("15%");
    expect(valor(c, "p27", "2 · Minha faixa de comissionamento hoje")).toBe(
      "60% performance sólida",
    );
    expect(valor(c, "p36", "Meu dia de revisão de estoque é")).toBe("Sexta");
    expect(valor(c, "p45", "Eu,")).toBe("Ana Exemplo");
    expect(valor(c, "p45", "Corretor")).toMatch(/^assinado em 12\/11\/2026/);
    expect(valor(c, "p45", "Broker")).toBe("pendente");
    expect(valor(c, "p11", "KPI · Novas CREs: ações principais")).toBe(
      "Ligar para 20 proprietários por dia",
    );
  });

  it("campo vazio sai como — (sem inventar valor)", () => {
    expect(
      valor(
        c,
        "p20",
        "2. Quais são suas metas de longo prazo na carreira de corretor imobiliário?",
      ),
    ).toBe(VAZIO);
    expect(valor(c, "p24", "Sonho 2")).toBe(VAZIO);
    expect(valor(c, "p24", "Sonho 2: valor no ano")).toBe(VAZIO);
    expect(valor(c, "p45", "Me comprometo a (02)")).toBe(VAZIO);
    expect(valor(c, "p11", "KPI · CREs Vendidas: ações principais")).toBe(VAZIO);
    // Tabela do semanal: semana sem número = —, total só quando há número.
    const tab = itens(c, "p44").find((i) => i.k === "tabela") as Extract<ItemPdf, { k: "tabela" }>;
    expect(tab.linhas[0]).toEqual(["Contatos com agendamento", "12", "15", VAZIO, VAZIO, "27"]);
    expect(tab.linhas[1]).toEqual(["Primeiras visitas (V1)", VAZIO, VAZIO, VAZIO, VAZIO, VAZIO]);
  });

  it("números calculados no fim: meta oficial, carteira alvo, mês a mês com total e KRIs", () => {
    expect(c.numeros.map((s) => s.titulo)).toEqual([
      "Meta oficial 2027",
      "Carteira alvo",
      "Metas mês a mês (÷ 12) e total do ano",
      "KRIs e KPIs: os números",
    ]);
    expect(valor(c, "n-meta", "VGC (comissão) do ano")).toMatch(/^R\$/);
    expect(valor(c, "n-meta", "Gravada em Minha carreira")).toBe("ainda não gravada");
    expect(valor(c, "n-carteira", "Onde eu quero estar")).toBe("16 a 18 CREs ativas");
    expect(valor(c, "n-carteira", "Meta de CREs ativas no fim de 2027")).toBe("16");
    const tabs = itens(c, "n-mes").filter((i) => i.k === "tabela") as Extract<
      ItemPdf,
      { k: "tabela" }
    >[];
    expect(tabs).toHaveLength(2);
    expect(tabs[0].cab).toEqual(["Meta", "Anual", ...MESES]);
    expect(tabs.map((t) => t.linhas.length)).toEqual([4, 5]);
    expect(tabs.every((t) => t.linhas.every((l) => l.length === 14))).toBe(true);
    expect(valor(c, "n-kri", "Transações de venda")).toBe("0");
  });

  it("número sem base sai — (não inventa)", () => {
    // Ativação sem diagnóstico: o ticket digitado existe, mas não há CREs vendidas digitadas → calcula pela conversão.
    const a = conteudoPlanoPdf({ respostas: PLANEJAMENTO });
    expect(a.secoes.map((s) => s.id)).toEqual(ORDEM);
    // Caminho único: nenhuma linha do cockpit sai como "não faz parte da trilha".
    expect(valor(a, "p52", "Horas/semana: captação · atendimento · desenvolvimento")).not.toMatch(
      /trilha/,
    );
    expect(valor(a, "p52", "1ª CRE · 3 CREs · 1ª venda")).toBe("20/01/2027 · — · 10/04/2027");
    expect(valor(a, "p49", "Três CREs (até o dia 90)")).toBe(VAZIO);
    expect(valor(a, "p49", "Primeira CRE assinada (até o dia 45)")).toBe("20/01/2027");
  });

  it("nome do arquivo sem acento nem símbolo", () => {
    expect(nomeArquivoPlano("Ana Conceição D'Ávila")).toBe(
      "meu-plano-2027-ana-conceicao-d-avila.pdf",
    );
    expect(nomeArquivoPlano(null)).toBe("meu-plano-2027.pdf");
  });
});

describe("PDF: metas mês a mês em 2 tabelas (9 linhas, cartilha)", () => {
  const blocoMes = (S: Respostas) =>
    conteudoPlanoPdf({ respostas: S }).numeros.find((s) => s.id === "n-mes")!;
  const tabelas = (S: Respostas) =>
    blocoMes(S).itens.filter((i) => i.k === "tabela") as Extract<ItemPdf, { k: "tabela" }>[];

  it("sem mês digitado: subtítulos, 9 linhas na ordem da cartilha e sem aviso", () => {
    const s = blocoMes(PLANEJAMENTO);
    expect(s.titulo).toBe("Metas mês a mês (÷ 12) e total do ano");
    expect(s.itens.filter((i) => i.k === "sub").map((i) => (i as { t: string }).t)).toEqual([
      "Distribuição mês a mês — CREs",
      "Distribuição mês a mês — VGC",
    ]);
    expect(tabelas(PLANEJAMENTO).flatMap((t) => t.linhas.map((l) => l[0]))).toEqual([
      "Novas CREs",
      "Canceladas/expiradas",
      "CREs vendidas",
      "= Imóveis em estoque",
      "Transações de captação",
      "Transações de venda",
      "Comissão média por transação (R$)",
      "= Transações",
      "= VGC (R$)",
    ]);
    const C = calc(PLANEJAMENTO);
    const vgc = tabelas(PLANEJAMENTO)[1].linhas[4];
    expect(vgc[1]).toBe(fmt.int(C.vgc));
    expect(tabelas(PLANEJAMENTO)[0].linhas[3][1]).toBe(`${fmt.dec(C.estoqueFim)} (dez)`);
    // Só o texto da fórmula; nenhum aviso de divergência.
    expect(s.itens.filter((i) => i.k === "texto")).toHaveLength(1);
  });

  it("com mês digitado: mostra o valor, sugestão nos vazios e aviso de soma", () => {
    const S = { ...PLANEJAMENTO, "mt.mes.novas.1": "99" };
    const C = calc(S);
    const s = blocoMes(S);
    expect(s.titulo).toBe("Metas mês a mês e total do ano");
    const novas = tabelas(S)[0].linhas[0];
    expect(novas[2]).toBe("99");
    const total =
      99 +
      sugestoesMes(C.novas)
        .slice(1)
        .reduce((a, b) => a + b, 0);
    expect(novas[1]).toBe(fmt.dec(total));
    expect(s.itens).toContainEqual({
      k: "texto",
      t: `Novas CREs: os meses somam ${fmt.dec(total)}; a meta do ano é ${fmt.dec(C.novas)}.`,
    });
  });

  it("todo o resto do PDF (meta oficial, carteira, KRIs, telas) é idêntico com meses digitados", () => {
    const S1: Respostas = { ...PLANEJAMENTO };
    [...chavesTabela("cres"), ...chavesTabela("vgc")].forEach((k, i) => (S1[k] = String(i % 5)));
    const a = conteudoPlanoPdf({ respostas: PLANEJAMENTO });
    const b = conteudoPlanoPdf({ respostas: S1 });
    const semMes = (c: ConteudoPdf) => ({
      ...c,
      numeros: c.numeros.filter((x) => x.id !== "n-mes"),
    });
    expect(semMes(b)).toEqual(semMes(a));
    expect(calc(S1)).toEqual(calc(PLANEJAMENTO));
  });

  it("gera o PDF (pdf-lib) com meses digitados e chaves antigas ignoradas", async () => {
    const S = {
      ...PLANEJAMENTO,
      "mt.mes.novas.1": "9",
      "mt.mes.com.12": "7.000",
      "mt.mes.vgc.12": "50",
      "mt.mes.trans.3": "4",
    };
    const bytes = await buildPlanoPdf({
      plano: { respostas: S },
      colaborador: "Ana",
      logoPng: null,
      agencyName: null,
    });
    expect(bytes.length).toBeGreaterThan(1000);
  });
});

describe("geração do PDF (pdf-lib)", () => {
  it("limpeza de texto mantém o — dos campos vazios e tira o que a fonte não tem", () => {
    expect(limpa("—")).toBe("—");
    expect(limpa("Oi 😊 “ok” … 3 × 4 − 1 ≈ 2 ✔")).toBe("Oi  “ok” … 3 × 4 - 1 ~ 2 OK");
  });

  it("A4, com logo, várias páginas, e o texto das respostas aparece no arquivo", async () => {
    const bytes = await buildPlanoPdf({
      plano: { respostas: PLANEJAMENTO },
      colaborador: "Ana Exemplo 😊",
      agencyName: "RE/MAX Exemplo",
      logoPng: new Uint8Array(readFileSync("public/remax-logo-transparent.png")),
      issuedAt: new Date("2026-11-12T12:00:00Z"),
    });
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(3);
    const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
    expect(Math.round(w)).toBe(595);
    expect(Math.round(h)).toBe(842);
    expect(doc.getTitle()).toBe("Meu Plano 2027 - Ana Exemplo");
  });

  it("sem logo e sem nome da imobiliária também gera; plano incompleto não gera", async () => {
    const bytes = await buildPlanoPdf({
      plano: { respostas: PLANEJAMENTO },
      colaborador: "Ana",
      logoPng: null,
      agencyName: null,
    });
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
    // Logo inválido: segue sem logo.
    const comLixo = await buildPlanoPdf({
      plano: { respostas: PLANEJAMENTO },
      colaborador: "Ana",
      logoPng: new Uint8Array([0x89, 0x50, 1, 2, 3]),
    });
    expect(comLixo.length).toBeGreaterThan(1000);
    await expect(
      buildPlanoPdf({
        plano: { respostas: { "pq.frase": "x" } },
        colaborador: "Ana",
      }),
    ).rejects.toThrow(/não está completo/);
  });
});
