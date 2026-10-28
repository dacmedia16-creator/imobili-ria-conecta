// @vitest-environment jsdom
// Filtro "Pagamento" + etiqueta "Financiada" da lista de Vendas (t_7538ddac).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chamadas: { tabela?: string; metodo: string; args: unknown[] }[] = [];
let linhasPagamento: { sale_id: string; tipo_pagamento: string }[] = [];
vi.mock("@/integrations/supabase/client", () => {
  const builder = (tabela: string) => {
    let tipo: string | null = null;
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order"]) {
      b[m] = (...args: unknown[]) => {
        chamadas.push({ tabela, metodo: m, args });
        return b;
      };
    }
    b.eq = (...args: unknown[]) => {
      chamadas.push({ tabela, metodo: "eq", args });
      tipo = String(args[1]);
      return b;
    };
    b.range = (...args: unknown[]) => {
      chamadas.push({ tabela, metodo: "range", args });
      const data = linhasPagamento
        .filter((l) => tipo === null || l.tipo_pagamento === tipo)
        .map((l) => ({ sale_id: l.sale_id }));
      return Promise.resolve({ data, error: null });
    };
    return b;
  };
  const rpc = vi.fn(() => Promise.resolve({ data: null, error: null }));
  return { supabase: { from: (t: string) => builder(t), rpc } };
});

import { supabase } from "@/integrations/supabase/client";
import { fetchVendasComerciaisPaginadas } from "@/lib/vendas-comerciais-query";
import {
  PAGAMENTO_FILTER_OPTIONS,
  PAGAMENTO_NAO_INFORMADO,
  detalheFinanciada,
  ehFinanciada,
  fetchSelecaoPorPagamento,
  filtrarPorPagamento,
  pagamentoFilterParam,
  pagamentoFilterValido,
} from "@/lib/vendas-pagamento-filtro";
import { FinanciadaBadge } from "@/components/FinanciadaBadge";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const norm = (s: string) => s.replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();

beforeEach(() => {
  chamadas.length = 0;
  linhasPagamento = [
    { sale_id: "fin-1", tipo_pagamento: "financiamento" },
    { sale_id: "fin-2", tipo_pagamento: "financiamento" },
    { sale_id: "vis-1", tipo_pagamento: "vista" },
    { sale_id: "con-1", tipo_pagamento: "consorcio" },
  ];
});
afterEach(() => cleanup());

describe("filtro Pagamento — opções e valores", () => {
  it("tem Financiada, À vista, Consórcio e Não informado, nessa ordem", () => {
    expect(PAGAMENTO_FILTER_OPTIONS.map((o) => o.label)).toEqual([
      "Financiada",
      "À vista",
      "Consórcio",
      "Não informado",
    ]);
    expect(PAGAMENTO_FILTER_OPTIONS.map((o) => o.key)).toEqual([
      "financiamento",
      "vista",
      "consorcio",
      PAGAMENTO_NAO_INFORMADO,
    ]);
  });

  it("aceita só valores conhecidos (URL/sessão adulterada vira 'todas')", () => {
    for (const k of ["todas", "financiamento", "vista", "consorcio", PAGAMENTO_NAO_INFORMADO])
      expect(pagamentoFilterValido(k)).toBe(true);
    for (const k of ["", "Financiada", "boleto", null, undefined, "' or 1=1"])
      expect(pagamentoFilterValido(k)).toBe(false);
  });

  it("'todas' não envia parâmetro; os demais vão como estão", () => {
    expect(pagamentoFilterParam("todas")).toBeUndefined();
    expect(pagamentoFilterParam("financiamento")).toBe("financiamento");
    expect(pagamentoFilterParam(PAGAMENTO_NAO_INFORMADO)).toBe(PAGAMENTO_NAO_INFORMADO);
  });
});

describe("filtro Pagamento — RPC da lista", () => {
  it("envia _pagamento só quando há filtro (sem filtro = chamada igual à de hoje)", async () => {
    const rpc = vi.mocked(supabase.rpc);
    rpc.mockClear();
    await fetchVendasComerciaisPaginadas({ page: 0, pageSize: 10 });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("_pagamento");
    await fetchVendasComerciaisPaginadas({ page: 0, pageSize: 10, pagamento: "consorcio" });
    expect(rpc.mock.calls[1][1]).toMatchObject({ _pagamento: "consorcio" });
    await fetchVendasComerciaisPaginadas({
      page: 0,
      pageSize: 10,
      soMinhaVez: true,
      pagamento: PAGAMENTO_NAO_INFORMADO,
    });
    expect(rpc.mock.calls[2][0]).toBe("list_vendas_comerciais_paginadas_fila");
    expect(rpc.mock.calls[2][1]).toMatchObject({ _pagamento: PAGAMENTO_NAO_INFORMADO });
  });
});

describe("filtro Pagamento — cartão de efetivadas (totais filtrados)", () => {
  const efetivadas = [
    { saleId: "fin-1", v: 100 },
    { saleId: "fin-2", v: 200 },
    { saleId: "vis-1", v: 300 },
    { saleId: "con-1", v: 400 },
    { saleId: "sem-1", v: 500 }, // venda sem sale_payment
  ];
  const soma = (rows: { v: number }[]) => rows.reduce((s, r) => s + r.v, 0);

  it("'todas' não consulta nada e não filtra", async () => {
    expect(await fetchSelecaoPorPagamento("todas")).toBeNull();
    expect(chamadas).toHaveLength(0);
    expect(filtrarPorPagamento(efetivadas, null)).toHaveLength(5);
  });

  it.each([
    ["financiamento", ["fin-1", "fin-2"], 300],
    ["vista", ["vis-1"], 300],
    ["consorcio", ["con-1"], 400],
    [PAGAMENTO_NAO_INFORMADO, ["sem-1"], 500],
  ])("%s: quantidade e valor batem", async (filtro, ids, total) => {
    const sel = await fetchSelecaoPorPagamento(filtro);
    const r = filtrarPorPagamento(efetivadas, sel);
    expect(r.map((x) => x.saleId)).toEqual(ids);
    expect(soma(r)).toBe(total);
  });

  it("as 4 opções somam o total geral (nenhuma venda some ou conta duas vezes)", async () => {
    let n = 0;
    let v = 0;
    for (const o of PAGAMENTO_FILTER_OPTIONS) {
      const r = filtrarPorPagamento(efetivadas, await fetchSelecaoPorPagamento(o.key));
      n += r.length;
      v += soma(r);
    }
    expect(n).toBe(efetivadas.length);
    expect(v).toBe(soma(efetivadas));
  });

  it("lê sale_payment com a sessão do usuário (RLS), filtrando por tipo no banco", async () => {
    await fetchSelecaoPorPagamento("vista");
    expect(chamadas.every((c) => c.tabela === "sale_payment")).toBe(true);
    expect(chamadas.find((c) => c.metodo === "eq")?.args).toEqual(["tipo_pagamento", "vista"]);
    chamadas.length = 0;
    await fetchSelecaoPorPagamento(PAGAMENTO_NAO_INFORMADO);
    expect(chamadas.some((c) => c.metodo === "eq")).toBe(false);
  });
});

describe("etiqueta Financiada", () => {
  it("só para financiamento", () => {
    expect(ehFinanciada("financiamento")).toBe(true);
    for (const t of ["vista", "consorcio", null, undefined, ""])
      expect(ehFinanciada(t)).toBe(false);
  });

  it("detalhe mostra banco/correspondente quando preenchidos; senão só 'Financiada'", () => {
    expect(detalheFinanciada(null, null)).toBe("Financiada");
    expect(detalheFinanciada("  ", "")).toBe("Financiada");
    expect(detalheFinanciada("Caixa", null)).toBe("Financiada · Banco: Caixa");
    expect(detalheFinanciada(null, "Fulano Crédito")).toBe(
      "Financiada · Correspondente: Fulano Crédito",
    );
    expect(detalheFinanciada(" Itaú ", " X ")).toBe("Financiada · Banco: Itaú · Correspondente: X");
  });

  it.each(["vista", "consorcio", null])("não aparece para %s", (tipo) => {
    const { container } = render(createElement(FinanciadaBadge, { tipo }));
    expect(container.textContent).toBe("");
  });

  it("aparece para financiada, com o detalhe no hover, e o toque não abre a venda", () => {
    const abrirVenda = vi.fn();
    render(
      createElement(
        "div",
        { onClick: abrirVenda },
        createElement(FinanciadaBadge, {
          tipo: "financiamento",
          banco: "Caixa",
          correspondente: "Correspondente X",
        }),
      ),
    );
    const botao = screen.getByRole("button", { name: /Financiada/ });
    expect(botao.textContent).toBe("Financiada");
    expect(botao.getAttribute("title")).toBe(
      "Financiada · Banco: Caixa · Correspondente: Correspondente X",
    );
    fireEvent.click(botao);
    expect(abrirVenda).not.toHaveBeenCalled();
  });
});

describe("telas usam o filtro e a etiqueta", () => {
  it("lista: filtro, URL, sessão, cartão de efetivadas e etiqueta (celular e computador)", () => {
    const src = ler("src/routes/_authenticated/vendas.index.tsx");
    expect(src).toContain('aria-label="Pagamento"');
    expect(src).toContain('params.set("pagamento", pagamentoFilter)');
    expect(src).toContain("pagamentoFilter,\n        } satisfies SalesListState");
    expect(src).toContain("filters.pagamento = pagamentoFilterParam(pagamentoFilter)");
    expect(src).toContain("fetchSelecaoPorPagamento(pagamentoFilter)");
    expect(src).toContain("[dataDe, dataAte, esteira, midiaFilter, pagamentoFilter]");
    expect(src.match(/<FinanciadaBadge/g)).toHaveLength(2);
  });

  it("detalhe da venda: etiqueta no cabeçalho com o pagamento já carregado", () => {
    const src = ler("src/routes/_authenticated/vendas.$id.tsx");
    expect(src).toContain("tipo={payment?.tipo_pagamento}");
    expect(src).toContain("banco={payment?.financiamento_banco}");
    expect(src).toContain("correspondente={payment?.financiamento_correspondente}");
  });
});

describe("migration 20261028200000 — contrato", () => {
  const up = norm(ler("supabase/migrations/20261028200000_vendas_filtro_pagamento.sql"));
  const down = norm(ler("docs/sql/rollback/20261028200000_vendas_filtro_pagamento.rollback.sql"));

  it("as duas RPCs ganham _pagamento com padrão NULL, join único e filtro", () => {
    for (const nome of [
      "list_vendas_comerciais_paginadas(",
      "list_vendas_comerciais_paginadas_fila(",
    ]) {
      expect(up).toContain(`create or replace function public.${nome}`);
    }
    expect(up.match(/_pagamento text default null::text\)/g)).toHaveLength(2);
    expect(up.match(/left join public\.sale_payment sp on sp\.sale_id = s\.id/g)).toHaveLength(2);
    expect(
      up.match(
        /and \(_pagamento is null or \(_pagamento = '__nao_informado__' and sp\.sale_id is null\) or sp\.tipo_pagamento = _pagamento\)/g,
      ),
    ).toHaveLength(2);
    expect(up.match(/sp\.tipo_pagamento as pagamento_tipo/g)).toHaveLength(2);
    expect(up).not.toContain("security definer");
  });

  it("filtro entra antes da paginação (base/filtradas), não depois do limit", () => {
    expect(up.indexOf("_pagamento is null or")).toBeLessThan(up.indexOf("limit least"));
  });

  it("execução só para authenticated/service_role; anon e public revogados", () => {
    const sig = "(integer, integer, text, text[], date, date, text, uuid[], text, text)";
    for (const n of ["list_vendas_comerciais_paginadas", "list_vendas_comerciais_paginadas_fila"]) {
      expect(up).toContain(`revoke all on function public.${n}${sig} from public, anon`);
      expect(up).toContain(
        `grant execute on function public.${n}${sig} to authenticated, service_role`,
      );
    }
  });

  it("rollback remove a assinatura nova e volta à antiga, sem _pagamento", () => {
    expect(down).toContain(
      "drop function if exists public.list_vendas_comerciais_paginadas(integer, integer, text, text[], date, date, text, uuid[], text, text)",
    );
    expect(down).not.toContain("_pagamento");
    expect(down).not.toContain("sale_payment");
    expect(down.match(/_midia text default null::text\)/g)).toHaveLength(2);
  });
});
