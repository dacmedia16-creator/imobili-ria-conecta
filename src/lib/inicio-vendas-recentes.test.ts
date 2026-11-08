// @vitest-environment jsdom
/**
 * Início: "Vendas recentes" igual à lista do menu Vendas (t_e99f64cb). Dados fictícios.
 * - componente único (ListaVendas) usado pelas duas telas, sem duplicar a marcação;
 * - Início: mesma consulta de antes (sales, 8, updated_at desc), sem lixeira/filtros/paginação,
 *   "Ver todas" e clique na linha abrindo a venda;
 * - complemento em lote (só os IDs exibidos): participantes, pagamento, dias na etapa;
 * - regra "Sua vez" e líder por corretor iguais às de antes.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  calls: [] as { table: string; select?: string; in?: [string, string[]] }[],
  respostas: {} as Record<string, { data: unknown; error: unknown }>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const call: (typeof mocks.calls)[number] = { table };
      mocks.calls.push(call);
      const resp = () => Promise.resolve(mocks.respostas[table] ?? { data: [], error: null });
      const b = {
        select(c: string) {
          call.select = c;
          return b;
        },
        in(col: string, vals: string[]) {
          call.in = [col, vals];
          return Object.assign(resp(), { order: () => resp() });
        },
      };
      return b;
    },
  },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    onClick,
    ...rest
  }: {
    children: unknown;
    onClick?: (e: { stopPropagation: () => void }) => void;
    "aria-label"?: string;
  }) =>
    createElement(
      "a",
      { href: "#venda", "aria-label": rest["aria-label"], onClick },
      children as never,
    ),
}));

import { ListaVendas } from "@/components/vendas/ListaVendas";
import { complementarVendasRecentes } from "./dashboard-vendas-recentes";
import { mapaLiderPorCorretor, nomesLideres, vendaEhMinhaVez } from "./vendas-lista-linha";

const ler = (p: string) => readFileSync(p, "utf8");
const inicio = ler("src/routes/_authenticated/dashboard.tsx");
const vendas = ler("src/routes/_authenticated/vendas.index.tsx");
const lista = ler("src/components/vendas/ListaVendas.tsx");

const venda = (o: Record<string, unknown> = {}) => ({
  id: "venda-0001-aaaa",
  status: "enviada_revisao",
  valor_negociado: 450000,
  imovel_id: "AP-TESTE",
  codigo_interno: null,
  corretor_id: "c1",
  modalidade: "padrao",
  created_at: "2026-10-01T12:00:00Z",
  data_assinatura: null,
  data_venda: "2026-10-01T12:00:00Z",
  corretores_ids: ["c1"],
  pagamento_tipo: "financiamento",
  pagamento_banco: "Caixa",
  pagamento_correspondente: null,
  pagamento_oba: false,
  ...o,
});

afterEach(cleanup);
beforeEach(() => {
  mocks.calls.length = 0;
  mocks.respostas = {};
});

describe("um componente só para as duas telas", () => {
  it("Vendas e Início usam ListaVendas; nenhum dos dois tem tabela ou cartão próprio", () => {
    expect(vendas).toContain("<ListaVendas");
    expect(inicio).toContain("<ListaVendas");
    for (const tela of [vendas, inicio]) {
      expect(tela).not.toContain("<TableHead>");
      expect(tela).not.toContain("<AgingBadge");
      expect(tela).not.toContain("<FinanciadaBadge");
    }
    expect(lista.match(/<TableHead\b/g)?.length).toBe(9);
  });

  it("Início: mesma consulta, sem lixeira, sem filtros, sem paginação, com Ver todas", () => {
    expect(inicio).toMatch(
      /\.from\("sales"\)\s*\.select\(RECENTES_COLUMNS\)\s*\.order\("updated_at", \{ ascending: false \}\)\s*\.limit\(8\)/,
    );
    const cartao = inicio.slice(inicio.indexOf("<CardTitle>Vendas recentes</CardTitle>"));
    expect(cartao).toContain('<Link to="/vendas">Ver todas</Link>');
    const ini = cartao.indexOf("<ListaVendas");
    const uso = cartao.slice(ini, cartao.indexOf("/>", ini));
    expect(uso).not.toMatch(/acao=|ordenacao=/);
    expect(uso).toContain('navigate({ to: "/vendas/$id", params: { id } })');
    expect(inicio).not.toMatch(/Trash2|excluirVenda|Anterior|Próxima →/);
  });

  it("Vendas mantém lixeira e ordenação (mesmos textos de antes)", () => {
    expect(vendas).toContain('aria-label="Excluir venda"');
    expect(vendas).toContain("canDeleteSale(user?.id, hasAny, s, teamIds)");
    expect(vendas).toContain("aoClicarLink={markSalesListForReturn}");
    expect(vendas).toContain("agingLimites={agingLimites}");
  });
});

describe("ListaVendas na tela", () => {
  const props = {
    profileName: { c1: "Maria Teste", l1: "Líder Teste" },
    liderIdByCorretor: { c1: "l1" },
    ehMinhaVez: () => true,
    desdeEtapa: () => new Date(Date.now() - 2 * 86_400_000).toISOString(),
    assinadaNoHistorico: () => false,
  };

  it("colunas da lista de Vendas, selos e clique na linha abre a venda", () => {
    const onAbrir = vi.fn();
    render(
      createElement(ListaVendas, {
        ...props,
        vendas: [venda()],
        mostrarLider: true,
        onAbrir,
      }),
    );
    const cabecalho = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(cabecalho).toEqual([
      "Imóvel / código",
      "Corretor",
      "Gestor/Líder",
      "Valor",
      "Status",
      "Vez de agir",
      "Nesta etapa",
      "Datas",
    ]);
    const linha = screen.getAllByRole("row")[1];
    const t = within(linha);
    t.getByText("Maria Teste");
    t.getByText("Líder Teste");
    t.getByText("R$ 450.000");
    t.getByText("Financiada");
    t.getByText("Sua vez");
    t.getByText("Gestor");
    t.getByText("Ainda não assinada");
    fireEvent.click(linha);
    expect(onAbrir).toHaveBeenCalledWith("venda-0001-aaaa");
    // O link do código não dispara o clique da linha.
    onAbrir.mockClear();
    fireEvent.click(t.getByRole("link", { name: "Abrir venda AP-TESTE" }));
    expect(onAbrir).not.toHaveBeenCalled();
  });

  it("sem ação, sem coluna extra nem lixeira; sem ordenação, títulos sem botão", () => {
    render(
      createElement(ListaVendas, {
        ...props,
        vendas: [venda()],
        mostrarLider: false,
        onAbrir: vi.fn(),
      }),
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
    expect(screen.queryByLabelText("Excluir venda")).toBeNull();
    expect(screen.queryByLabelText("Ordenar por valor")).toBeNull();
  });

  it("data oficial indisponível não vira 'Ainda não assinada'", () => {
    render(
      createElement(ListaVendas, {
        ...props,
        vendas: [venda({ data_venda: null })],
        mostrarLider: false,
        onAbrir: vi.fn(),
      }),
    );
    expect(screen.getAllByText("Data da assinatura indisponível").length).toBeGreaterThan(0);
    expect(screen.queryByText("Ainda não assinada")).toBeNull();
  });
});

describe("complemento das vendas recentes (lote, só os IDs exibidos)", () => {
  const base = {
    id: "s1",
    created_at: "2026-10-01T12:00:00Z",
    corretor_id: "criador",
    corretor_captador_id: "cap",
    corretor_vendedor_id: null,
  };

  it("participantes, pagamento e início da etapa; 3 leituras com os mesmos IDs", async () => {
    mocks.respostas.sale_status_history = {
      data: [
        { sale_id: "s1", created_at: "2026-10-05T10:00:00Z" },
        { sale_id: "s1", created_at: "2026-10-02T10:00:00Z" },
      ],
      error: null,
    };
    mocks.respostas.sale_payment = {
      data: [
        {
          sale_id: "s1",
          tipo_pagamento: "financiamento",
          financiamento_banco: "Caixa",
          financiamento_correspondente: null,
          oba_credito: true,
        },
      ],
      error: null,
    };
    mocks.respostas.sale_commission_extras = {
      data: [
        { sale_id: "s1", user_id: "aaa-vend", papel: "corretor_vendedor" },
        { sale_id: "s1", user_id: "gerente", papel: "gerente" },
      ],
      error: null,
    };
    const [r] = await complementarVendasRecentes([base]);
    expect(r).toMatchObject({
      corretores_ids: ["aaa-vend", "cap"],
      pagamento_tipo: "financiamento",
      pagamento_banco: "Caixa",
      pagamento_oba: true,
      desde_etapa: "2026-10-05T10:00:00Z",
    });
    expect(mocks.calls.map((c) => c.table).sort()).toEqual([
      "sale_commission_extras",
      "sale_payment",
      "sale_status_history",
    ]);
    for (const c of mocks.calls) expect(c.in).toEqual(["sale_id", ["s1"]]);
  });

  it("falha de leitura não esconde a venda: cai no padrão", async () => {
    for (const t of ["sale_status_history", "sale_payment", "sale_commission_extras"])
      mocks.respostas[t] = { data: null, error: { message: "x" } };
    const [r] = await complementarVendasRecentes([{ ...base, corretor_captador_id: null }]);
    expect(r).toMatchObject({
      corretores_ids: ["criador"],
      pagamento_tipo: null,
      pagamento_oba: null,
      desde_etapa: base.created_at,
    });
  });

  it("lista vazia não consulta nada", async () => {
    expect(await complementarVendasRecentes([])).toEqual([]);
    expect(mocks.calls).toHaveLength(0);
  });
});

describe("regras compartilhadas (iguais às de antes)", () => {
  const hasAny = (meus: string[]) => (r: string[]) => r.some((x) => meus.includes(x));

  it("Sua vez: admin nunca; corretor participante; gestor só da própria equipe", () => {
    const s = {
      status: "rascunho",
      corretor_id: "c1",
      modalidade: "padrao",
      corretores_ids: ["c1"],
    };
    const g = { ...s, status: "enviada_revisao" };
    const t = new Set(["c1"]);
    expect(vendaEhMinhaVez(s, { userId: "c1", hasAny: hasAny(["admin"]), teamIds: t })).toBe(false);
    expect(vendaEhMinhaVez(s, { userId: "c1", hasAny: hasAny(["corretor"]), teamIds: t })).toBe(
      true,
    );
    expect(vendaEhMinhaVez(s, { userId: "x", hasAny: hasAny(["corretor"]), teamIds: t })).toBe(
      false,
    );
    expect(vendaEhMinhaVez(g, { userId: "g", hasAny: hasAny(["gestor"]), teamIds: t })).toBe(true);
    expect(
      vendaEhMinhaVez(g, { userId: "g", hasAny: hasAny(["gestor"]), teamIds: new Set() }),
    ).toBe(false);
  });

  it("líder por corretor: membro, depois o próprio líder, depois líder auxiliar", () => {
    const mapa = mapaLiderPorCorretor(
      [
        { id: "t1", lider_id: "L1" },
        { id: "t2", lider_id: "L2" },
      ],
      [{ membro_id: "c1", team_id: "t1" }],
      [{ user_id: "aux", team_id: "t2" }],
    );
    expect(mapa).toEqual({ c1: "L1", L1: "L1", L2: "L2", aux: "L2" });
    expect(
      nomesLideres(
        { corretor_id: "c1", corretores_ids: ["c1", "aux"] },
        { L1: "A", L2: "B" },
        mapa,
      ),
    ).toBe("A, B");
  });
});
