// @vitest-environment jsdom
// Filtro "Pagamento" + etiqueta "Financiada" da lista de Vendas (t_7538ddac).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chamadas: { tabela?: string; metodo: string; args: unknown[] }[] = [];
let linhasPagamento: { sale_id: string; tipo_pagamento: string; oba_credito?: boolean }[] = [];
vi.mock("@/integrations/supabase/client", () => {
  const builder = (tabela: string) => {
    const filtros: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order"]) {
      b[m] = (...args: unknown[]) => {
        chamadas.push({ tabela, metodo: m, args });
        return b;
      };
    }
    b.eq = (...args: unknown[]) => {
      chamadas.push({ tabela, metodo: "eq", args });
      filtros[String(args[0])] = args[1];
      return b;
    };
    b.range = (...args: unknown[]) => {
      chamadas.push({ tabela, metodo: "range", args });
      const data = linhasPagamento
        .filter((l) =>
          Object.entries(filtros).every(
            ([col, val]) => ((l as Record<string, unknown>)[col] ?? false) === val,
          ),
        )
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
  PAGAMENTO_FINANCIADA_OBAH,
  PAGAMENTO_NAO_INFORMADO,
  detalheFinanciada,
  rotuloFinanciada,
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
    { sale_id: "fin-1", tipo_pagamento: "financiamento", oba_credito: true },
    { sale_id: "fin-2", tipo_pagamento: "financiamento", oba_credito: false },
    // Oba marcado em venda à vista (não acontece hoje em produção): não pode virar "Obah".
    { sale_id: "vis-1", tipo_pagamento: "vista", oba_credito: true },
    { sale_id: "con-1", tipo_pagamento: "consorcio" },
  ];
});
afterEach(() => cleanup());

describe("filtro Pagamento — opções e valores", () => {
  it("tem Financiada, Financiada pela Obah, À vista, Consórcio e Não informado, nessa ordem", () => {
    expect(PAGAMENTO_FILTER_OPTIONS.map((o) => o.label)).toEqual([
      "Financiada",
      "Financiada pela Obah",
      "À vista",
      "Consórcio",
      "Não informado",
    ]);
    expect(PAGAMENTO_FILTER_OPTIONS.map((o) => o.key)).toEqual([
      "financiamento",
      PAGAMENTO_FINANCIADA_OBAH,
      "vista",
      "consorcio",
      PAGAMENTO_NAO_INFORMADO,
    ]);
  });

  it("aceita só valores conhecidos (URL/sessão adulterada vira 'todas')", () => {
    for (const k of [
      "todas",
      "financiamento",
      PAGAMENTO_FINANCIADA_OBAH,
      "vista",
      "consorcio",
      PAGAMENTO_NAO_INFORMADO,
    ])
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
    [PAGAMENTO_FINANCIADA_OBAH, ["fin-1"], 100],
    ["vista", ["vis-1"], 300],
    ["consorcio", ["con-1"], 400],
    [PAGAMENTO_NAO_INFORMADO, ["sem-1"], 500],
  ])("%s: quantidade e valor batem", async (filtro, ids, total) => {
    const sel = await fetchSelecaoPorPagamento(filtro);
    const r = filtrarPorPagamento(efetivadas, sel);
    expect(r.map((x) => x.saleId)).toEqual(ids);
    expect(soma(r)).toBe(total);
  });

  it("as 4 opções de tipo somam o total geral (nenhuma venda some ou conta duas vezes)", async () => {
    let n = 0;
    let v = 0;
    // "Financiada pela Obah" é um recorte de "Financiada", não um tipo a mais.
    for (const o of PAGAMENTO_FILTER_OPTIONS.filter((x) => x.key !== PAGAMENTO_FINANCIADA_OBAH)) {
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
    chamadas.length = 0;
    await fetchSelecaoPorPagamento(PAGAMENTO_FINANCIADA_OBAH);
    expect(chamadas.filter((c) => c.metodo === "eq").map((c) => c.args)).toEqual([
      ["tipo_pagamento", "financiamento"],
      ["oba_credito", true],
    ]);
  });

  it("Obah é recorte de Financiada: Financiada continua com todas, com e sem Obah", async () => {
    const fin = filtrarPorPagamento(efetivadas, await fetchSelecaoPorPagamento("financiamento"));
    const obah = filtrarPorPagamento(
      efetivadas,
      await fetchSelecaoPorPagamento(PAGAMENTO_FINANCIADA_OBAH),
    );
    expect(fin.map((x) => x.saleId)).toEqual(["fin-1", "fin-2"]);
    expect(obah.every((x) => fin.includes(x))).toBe(true);
    expect(obah.map((x) => x.saleId)).not.toContain("vis-1"); // Oba em venda à vista não entra
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

describe("etiqueta Financiada · Obah (t_1e3dda48)", () => {
  it("rótulo: Obah só em financiada com oba_credito = true", () => {
    expect(rotuloFinanciada("financiamento", true)).toBe("Financiada · Obah");
    expect(rotuloFinanciada("financiamento", false)).toBe("Financiada");
    expect(rotuloFinanciada("financiamento", null)).toBe("Financiada");
    expect(rotuloFinanciada("financiamento", undefined)).toBe("Financiada");
    for (const t of ["vista", "consorcio", null, undefined]) {
      expect(rotuloFinanciada(t, true)).toBeNull();
      expect(rotuloFinanciada(t, false)).toBeNull();
    }
  });

  it("mostra 'Financiada · Obah' e o balão de banco/correspondente não muda", () => {
    render(
      createElement(FinanciadaBadge, {
        tipo: "financiamento",
        banco: "Caixa",
        correspondente: "Correspondente X",
        obaCredito: true,
      }),
    );
    const botao = screen.getByRole("button", { name: /Financiada/ });
    expect(botao.textContent).toBe("Financiada · Obah");
    expect(botao.getAttribute("title")).toBe(
      "Financiada · Banco: Caixa · Correspondente: Correspondente X",
    );
  });

  it.each([
    ["financiamento", false, "Financiada"],
    ["vista", true, ""],
    ["consorcio", true, ""],
    [null, true, ""],
  ])("tipo %s + oba %s -> '%s'", (tipo, obaCredito, texto) => {
    const { container } = render(createElement(FinanciadaBadge, { tipo, obaCredito }));
    expect(container.textContent).toBe(texto);
  });

  it("lista e detalhe passam o oba_credito para a etiqueta", () => {
    const lista = ler("src/routes/_authenticated/vendas.index.tsx");
    expect(lista.match(/obaCredito=\{s\.pagamento_oba\}/g)).toHaveLength(2);
    const det = ler("src/routes/_authenticated/vendas.$id.tsx");
    expect(det).toContain("obaCredito={payment?.oba_credito}");
  });

  it("RPC: a opção Obah vai como _pagamento = 'financiamento_obah'", async () => {
    const rpc = vi.mocked(supabase.rpc);
    rpc.mockClear();
    await fetchVendasComerciaisPaginadas({
      page: 0,
      pageSize: 10,
      pagamento: pagamentoFilterParam(PAGAMENTO_FINANCIADA_OBAH),
    });
    expect(rpc.mock.calls[0][1]).toMatchObject({ _pagamento: "financiamento_obah" });
  });
});

describe("migration 20261028233000 (Obah) — contrato", () => {
  const up = norm(ler("supabase/migrations/20261028233000_vendas_filtro_pagamento_obah.sql"));
  const down = norm(
    ler("docs/sql/rollback/20261028233000_vendas_filtro_pagamento_obah.rollback.sql"),
  );
  const atual = norm(ler("supabase/migrations/20261028200000_vendas_filtro_pagamento.sql"));

  it("as duas RPCs ganham a opção Obah e o campo pagamento_oba, sem mudar a assinatura", () => {
    expect(
      up.match(
        /or \(_pagamento = 'financiamento_obah' and sp\.tipo_pagamento = 'financiamento' and sp\.oba_credito\)/g,
      ),
    ).toHaveLength(2);
    expect(up.match(/sp\.oba_credito as pagamento_oba/g)).toHaveLength(2);
    expect(up).not.toContain("drop function");
    expect(up).not.toContain("security definer");
    expect(up.match(/_pagamento text default null::text\)/g)).toHaveLength(2);
    // "Financiada" segue igual: tipo_pagamento = _pagamento (com e sem Obah)
    expect(up.match(/or sp\.tipo_pagamento = _pagamento\)/g)).toHaveLength(2);
  });

  it("permissões iguais às de hoje (authenticated/service_role; anon e public revogados)", () => {
    const sig = "(integer, integer, text, text[], date, date, text, uuid[], text, text)";
    for (const n of ["list_vendas_comerciais_paginadas", "list_vendas_comerciais_paginadas_fila"]) {
      for (const sql of [up, down]) {
        expect(sql).toContain(`revoke all on function public.${n}${sig} from public, anon`);
        expect(sql).toContain(
          `grant execute on function public.${n}${sig} to authenticated, service_role`,
        );
      }
    }
  });

  it("rollback = definição de hoje (sem Obah), mesma assinatura", () => {
    expect(down).not.toContain("financiamento_obah");
    expect(down).not.toContain("pagamento_oba");
    expect(down).not.toContain("drop function");
    const corpo = (s: string) =>
      s.slice(s.indexOf("create or replace function"), s.indexOf("revoke all"));
    expect(corpo(down)).toBe(corpo(atual));
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
