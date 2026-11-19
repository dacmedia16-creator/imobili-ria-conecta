// @vitest-environment jsdom
/**
 * Meu Plano 2027 — telas opcionais e "o que falta" (Denis, 19/11, t_5b05b9cd). Dados fictícios.
 * 1) p45 "Pacto com o broker" e p49 "Primeiros 90 dias" não contam no %, nas telas completas nem no PDF,
 *    mas continuam no plano e as respostas ficam intactas.
 * 3) A lista do que falta usa a mesma regra do %: vazia ⇔ 100%; a soma bate com os campos que faltam.
 */
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OQueFalta } from "@/components/minha-carreira/meu-plano/OQueFalta";
import { conteudoPlanoPdf, planoFinalizado } from "./pdf-conteudo";
import type { Respostas } from "./regras";
import { ORDEM, ORDEM_CONTA, TELAS, pendencias, progresso, statusTela, tela } from "./telas";
// Plano completo fictício: o mesmo COMPLETO de pdf-incompleto.test.ts (todas as telas, inclusive p45/p49).
const PLANEJAMENTO: Respostas = {
  ...Object.fromEntries(
    ["comissao", "trans", "cres", "conv", "ticket", "dias", "ativos", "revisados"].map((k) => [
      `d.${k}`,
      "0",
    ]),
  ),
  "or.0.c": "3",
  "or.3.v": "2",
  ...Object.fromEntries([2, 3, 2, 4, 3, 1].map((v, i) => [`av.${i}`, String(v)])),
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
  "d.comissao": "200.000",
  "d.trans": "10",
  "d.cres": "20",
  "d.conv": "42",
  "d.ticket": "700.000",
  "d.dias": "120",
  "d.ativos": "8",
  "d.revisados": "30",
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

afterEach(cleanup);

const P45 = ["pa.nome", "pa.c.0", "pa.cad"];
const P49 = ["d90.cre1", "d90.venda1", "d90.parceiro", "d90.aprender"];
const sem = (S: Respostas, ks: string[]) =>
  Object.fromEntries(Object.entries(S).filter(([k]) => !ks.includes(k)));
const reqContados = ORDEM_CONTA.flatMap((id) => tela(id)!.req);

describe("p45 e p49 opcionais", () => {
  it("só p45 e p49 são opcionais; continuam na ordem do plano", () => {
    expect(TELAS.filter((t) => t.opcional).map((t) => t.id)).toEqual(["p45", "p49"]);
    expect(ORDEM).toContain("p45");
    expect(ORDEM).toContain("p49");
    expect(ORDEM_CONTA).not.toContain("p45");
    expect(ORDEM_CONTA).not.toContain("p49");
    expect(ORDEM_CONTA.length).toBe(ORDEM.length - 2);
  });

  it("orçamento (p22/p23) continua obrigatório, sem mudança", () => {
    expect(ORDEM_CONTA).toEqual(expect.arrayContaining(["p22", "p23"]));
    expect(tela("p22")!.opcional).toBeFalsy();
    expect(tela("p23")!.opcional).toBeFalsy();
  });

  it("o plano completo continua 100% sem p45/p49 preenchidas", () => {
    const S = sem(PLANEJAMENTO, [...P45, ...P49]);
    const p = progresso(S);
    expect(p.pct).toBe(100);
    expect(p.telas).toBe(p.total);
    expect(planoFinalizado(S)).toBe(true);
    expect(conteudoPlanoPdf({ respostas: S }).aviso).toBeNull();
  });

  it("preencher ou apagar p45/p49 não muda o %", () => {
    const base: Respostas = { "pq.frase": "Família", "m.faixa": "60" };
    const com = { ...base, "pa.nome": "Ana", "d90.cre1": "2027-01-20" };
    expect(progresso(com)).toEqual(progresso(base));
  });

  it("selo da tela: completa = preenchida; incompleta = opcional (nunca 'vazia'/'em parte')", () => {
    expect(statusTela("p45", {})).toBe("opc");
    expect(statusTela("p49", { "d90.cre1": "2027-01-20" })).toBe("opc");
    expect(statusTela("p45", PLANEJAMENTO)).toBe("ok");
  });

  it("as respostas já gravadas em p45/p49 ficam intactas e saem no PDF, marcadas opcional", () => {
    const S = structuredClone(PLANEJAMENTO);
    const copia = structuredClone(S);
    const c = conteudoPlanoPdf({ respostas: S });
    expect(S).toEqual(copia);
    const p45 = c.secoes.find((s) => s.id === "p45")!;
    const p49 = c.secoes.find((s) => s.id === "p49")!;
    expect(p45.ev).toMatch(/opcional$/);
    expect(p49.ev).toMatch(/opcional$/);
    expect(c.secoes.find((s) => s.id === "p22")!.ev).not.toMatch(/opcional/);
    const vals = p49.itens.flatMap((i) => (i.k === "campo" ? [i.val] : []));
    expect(vals.join(" ")).toContain("Carla, minha colega");
  });
});

describe("o que falta = mesma regra do %", () => {
  const casos: [string, Respostas][] = [
    ["vazio", {}],
    ["parcial", { "pq.frase": "Família", "m.faixa": "60", "d.comissao": "100.000" }],
    ["completo", PLANEJAMENTO],
    ["completo sem p45/p49", sem(PLANEJAMENTO, [...P45, ...P49])],
    ["completo sem a frase", sem(PLANEJAMENTO, ["pq.frase"])],
  ];
  for (const [nome, S] of casos)
    it(`${nome}: soma do que falta = campos que faltam no %, e lista vazia ⇔ 100%`, () => {
      const lista = pendencias(S);
      const faltam = lista.reduce((s, x) => s + x.faltam, 0);
      const p = progresso(S);
      expect(p.pct).toBe(Math.round((100 * (reqContados.length - faltam)) / reqContados.length));
      expect(lista.length === 0).toBe(p.pct === 100);
      // Toda tela da lista está incompleta na contagem "X/Y telas" (telas livres, sem obrigatório, não
      // pesam no % e por isso não entram na lista).
      expect(lista.length).toBeLessThanOrEqual(p.total - p.telas);
      for (const x of lista) {
        expect(["p45", "p49"]).not.toContain(x.id);
        expect(["vazio", "parc"]).toContain(statusTela(x.id, S));
      }
      // Na ordem do plano.
      const ids = lista.map((x) => x.id);
      expect(ids).toEqual(ORDEM_CONTA.filter((id) => ids.includes(id)));
    });

  it("faltar só a frase do porquê: 1 tela, 1 campo, com o nome da tela", () => {
    expect(pendencias(sem(PLANEJAMENTO, ["pq.frase"]))).toEqual([
      { id: "p20", t: tela("p20")!.t, faltam: 1 },
    ]);
  });
});

describe("OQueFalta (tela)", () => {
  const S = sem(PLANEJAMENTO, ["pq.frase", "or.0.c"]);

  it("corretor: lista as telas e leva até cada uma ao tocar", () => {
    const irTela = vi.fn();
    render(createElement(OQueFalta, { S, irTela, aberto: true }));
    expect(screen.getByTestId("o-que-falta").textContent).toMatch(/Faltam 2 telas para 100%/);
    fireEvent.click(screen.getByTestId("falta-p20"));
    expect(irTela).toHaveBeenCalledWith("p20");
    expect(screen.queryByTestId("falta-p45")).toBeNull();
  });

  it("broker: mesma lista, só leitura (sem botão)", () => {
    render(createElement(OQueFalta, { S, aberto: true }));
    const caixa = screen.getByTestId("o-que-falta");
    expect(caixa.querySelectorAll("button").length).toBe(0);
    expect(screen.getByTestId("falta-p20").textContent).toContain(tela("p20")!.t);
    expect(screen.getAllByTestId(/^falta-/).map((e) => e.dataset.testid)).toEqual(
      pendencias(S).map((x) => `falta-${x.id}`),
    );
  });

  it("plano 100%: não mostra nada", () => {
    render(createElement(OQueFalta, { S: sem(PLANEJAMENTO, [...P45, ...P49]), irTela: vi.fn() }));
    expect(screen.queryByTestId("o-que-falta")).toBeNull();
  });
});
