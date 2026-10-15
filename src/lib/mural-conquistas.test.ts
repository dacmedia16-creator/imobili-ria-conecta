import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  agruparQuemParabenizou,
  aplicarParabens,
  confirmarParabens,
  dataVenda,
  desfazerParabens,
  mesAtualSP,
  participantes,
  rankingComPosicao,
  resumoQuemParabenizou,
  rotuloAniversario,
  sanitizeFeed,
  ultimosMeses,
  type FeedPost,
} from "@/lib/mural-conquistas";
import { montarMenuLateral } from "@/lib/menu-lateral";
import { BirthdaysCard, FeedCard, RankingCard } from "@/components/mural/MuralConquistasView";

const post = (o: Partial<FeedPost> = {}): FeedPost => ({
  id: "p1",
  venda_em: "2026-10-15T12:00:00Z",
  captador_nome: "Ana Lima",
  vendedor_nome: "Bruno Reis",
  coordenador_nome: null,
  tipo_imovel: "Apartamento",
  bairro: "Campolim",
  cidade: "Sorocaba",
  cheers: 2,
  cheered_by_me: false,
  ...o,
});

describe("feed do mural", () => {
  it("descarta campos fora da lista branca (valor, comissão, cliente)", () => {
    const [p] = sanitizeFeed([
      {
        ...post(),
        valor_venda: 500000,
        comissao: 30000,
        cliente_nome: "Fulano",
        comprador_cpf: "1",
      },
    ]);
    expect(Object.keys(p).sort()).toEqual(Object.keys(post()).sort());
    expect(JSON.stringify(p)).not.toMatch(/500000|30000|Fulano/);
  });

  it("aceita resposta vazia/inválida sem quebrar", () => {
    expect(sanitizeFeed(null)).toEqual([]);
    expect(sanitizeFeed([{ sem_id: true }])).toEqual([]);
  });

  it("mesma pessoa em captação e venda aparece uma vez", () => {
    expect(participantes(post({ vendedor_nome: "Ana Lima" }))).toEqual([
      { nome: "Ana Lima", papel: "Captação e venda" },
    ]);
  });

  it("data da venda no fuso de São Paulo", () => {
    // 02:30 UTC do dia 1º = 23:30 do dia 31 em SP
    expect(dataVenda("2026-11-01T02:30:00Z")).toBe("31/10/2026");
    expect(mesAtualSP(new Date("2026-11-01T02:30:00Z"))).toEqual({ ano: 2026, mes: 10 });
  });
});

describe("parabéns", () => {
  it("um por pessoa: segundo clique é no-op", () => {
    const um = aplicarParabens([post()], "p1");
    expect(um[0]).toMatchObject({ cheers: 3, cheered_by_me: true });
    expect(aplicarParabens(um, "p1")).toBe(um);
  });

  it("confirma com o total do banco e desfaz em erro", () => {
    const antes = post();
    const otimista = aplicarParabens([antes], "p1");
    expect(confirmarParabens(otimista, "p1", 7)[0].cheers).toBe(7);
    expect(desfazerParabens(otimista, "p1", antes)[0]).toEqual(antes);
  });

  it("lista de quem parabenizou", () => {
    const g = agruparQuemParabenizou([
      { post_id: "p1", user_id: "a", nome: "Carla Souza" },
      { post_id: "p1", user_id: "b", nome: "Diego Alves" },
      { post_id: "p2", user_id: "a", nome: null },
    ]);
    expect(g).toEqual({ p1: ["Carla Souza", "Diego Alves"] });
    expect(resumoQuemParabenizou(g.p1, 2)).toBe("Carla e Diego");
    expect(resumoQuemParabenizou(["A", "B", "C", "D"], 6)).toBe("A, B, C e mais 3");
    expect(resumoQuemParabenizou([], 0)).toBe("");
  });
});

describe("ranking e aniversários", () => {
  it("empate divide a posição", () => {
    const r = rankingComPosicao([
      { user_id: "1", nome: "B", avatar_url: null, pontos: 2 },
      { user_id: "2", nome: "A", avatar_url: null, pontos: 2 },
      { user_id: "3", nome: "C", avatar_url: null, pontos: 1 },
    ]);
    expect(r.map((x) => [x.nome, x.posicao])).toEqual([
      ["A", 1],
      ["B", 1],
      ["C", 3],
    ]);
  });

  it("seletor de meses atravessa o ano", () => {
    expect(ultimosMeses(3, new Date("2026-02-10T12:00:00Z"))).toEqual([
      { ano: 2026, mes: 2 },
      { ano: 2026, mes: 1 },
      { ano: 2025, mes: 12 },
    ]);
  });

  it("aniversário mostra só dia/mês", () => {
    const b = { user_id: "1", nome: "Ana", avatar_url: null, dia: 5, mes: 10 };
    expect(rotuloAniversario(b, { dia: 5, mes: 10 })).toBe("hoje · 05/10");
    expect(rotuloAniversario(b, { dia: 6, mes: 10 })).toBe("05/10");
  });
});

describe("gating do menu", () => {
  const base = {
    roles: ["corretor"],
    platformAdmin: false,
    exclusiveVisible: false,
    roomVisible: false,
    feedbackVisible: false,
  };
  const tem = (ctx: Parameters<typeof montarMenuLateral>[0]) =>
    montarMenuLateral(ctx)
      .flatMap((g) => g.items)
      .some((i) => i.to === "/mural-conquistas" && i.show);

  it("módulo desligado ou ausente: sem item", () => {
    expect(tem(base)).toBe(false);
    expect(tem({ ...base, achievementsVisible: false })).toBe(false);
  });
  it("módulo ligado: item aparece", () => {
    expect(tem({ ...base, achievementsVisible: true })).toBe(true);
  });
});

describe("telas", () => {
  const noop = () => {};
  it("feed: carregando, vazio, erro e post sem dados financeiros", () => {
    const html = (feed: Parameters<typeof FeedCard>[0]["feed"]) =>
      renderToStaticMarkup(
        createElement(FeedCard, { feed, quem: {}, pending: new Set<string>(), onCheer: noop }),
      );
    expect(html({ data: null, error: null })).toContain('aria-busy="true"');
    expect(html({ data: [], error: null })).toContain("Ainda não há conquistas");
    expect(html({ data: null, error: "falhou" })).toContain('role="alert"');
    const cheio = renderToStaticMarkup(
      createElement(FeedCard, {
        feed: { data: [post({ cheered_by_me: true })], error: null },
        quem: { p1: ["Carla Souza"] },
        pending: new Set<string>(),
        onCheer: noop,
      }),
    );
    expect(cheio).toContain("Ana Lima e Bruno Reis");
    expect(cheio).toContain("Você parabenizou");
    expect(cheio).toContain("Carla");
    expect(cheio).not.toMatch(/R\$/);
  });

  it("ranking e aniversários: estados", () => {
    const rk = renderToStaticMarkup(
      createElement(RankingCard, {
        ranking: { data: [], error: null },
        periodo: { ano: 2026, mes: 10 },
        meses: [{ ano: 2026, mes: 10 }],
        onPeriodo: noop,
      }),
    );
    expect(rk).toContain("Nenhuma venda assinada em outubro de 2026");
    const bd = renderToStaticMarkup(
      createElement(BirthdaysCard, {
        birthdays: {
          data: [{ user_id: "1", nome: "Ana", avatar_url: null, dia: 15, mes: 10 }],
          error: null,
        },
        hoje: { dia: 15, mes: 10 },
      }),
    );
    expect(bd).toContain("hoje · 15/10");
    // texto visível (sem atributos/SVG): nunca ano nem idade
    expect(bd.replace(/<[^>]*>/g, " ")).not.toMatch(/\b(19|20)\d{2}\b|anos/);
  });
});
