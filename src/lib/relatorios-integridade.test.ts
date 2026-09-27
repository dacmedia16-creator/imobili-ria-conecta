import { describe, expect, it, vi } from "vitest";
import { consultarTodasLinhas } from "./consulta-paginada";
import { confirmarLinhaAlterada, exigirConsulta } from "./relatorios-integridade";

describe("consulta financeira paginada", () => {
  it("concatena todas as páginas, inclusive a última parcial", async () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    const pagina = vi.fn(async (a: number, b: number) => ({
      data: rows.slice(a, b + 1),
      count: 5,
      error: null,
    }));
    expect(await consultarTodasLinhas("vendas", pagina, 2)).toEqual(rows);
    expect(pagina.mock.calls).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });
  it("aceita conjunto vazio sem inventar dados", async () => {
    expect(
      await consultarTodasLinhas("vendas", async () => ({ data: [], count: 0, error: null })),
    ).toEqual([]);
  });
  it("falha fechada em erro, ausência de contagem, truncamento e mudança durante a leitura", async () => {
    await expect(
      consultarTodasLinhas("vendas", async () => ({
        data: null,
        count: null,
        error: { message: "RLS" },
      })),
    ).rejects.toThrow(/RLS/);
    await expect(
      consultarTodasLinhas("vendas", async () => ({ data: [], count: null, error: null })),
    ).rejects.toThrow(/contagem/);
    await expect(
      consultarTodasLinhas("vendas", async () => ({ data: [{ id: 1 }], count: 4, error: null }), 2),
    ).rejects.toThrow(/truncada/);
    let n = 0;
    await expect(
      consultarTodasLinhas(
        "vendas",
        async () => ({ data: [{ id: ++n }], count: n === 1 ? 2 : 3, error: null }),
        1,
      ),
    ).rejects.toThrow(/contagem alterada/);
  });
});

describe("integridade dos relatórios e recebimentos", () => {
  it("aceita consulta vazia válida; rejeita erro e dado nulo sem transformar em zero", () => {
    expect(exigirConsulta({ data: [], error: null }, "ocorrências")).toEqual([]);
    expect(() =>
      exigirConsulta({ data: [], error: { message: "permissão" } }, "comissões"),
    ).toThrow(/permissão/);
    expect(() => exigirConsulta({ data: null, error: null }, "perfis")).toThrow(/perfis/);
  });
  it("confirma apenas a linha correta; rejeita zero, outra, múltiplas e erro", () => {
    expect(() => confirmarLinhaAlterada({ data: [{ id: "a" }], error: null }, "a")).not.toThrow();
    for (const data of [[], [{ id: "b" }], [{ id: "a" }, { id: "a" }]]) {
      expect(() => confirmarLinhaAlterada({ data, error: null }, "a")).toThrow(/não confirmado/);
    }
    expect(() => confirmarLinhaAlterada({ data: null, error: { message: "negado" } }, "a")).toThrow(
      /negado/,
    );
  });
});
