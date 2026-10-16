import { describe, expect, it } from "vitest";
import {
  dataBR,
  filtrarPeriodo,
  normalizarComissao,
  ordenarPorData,
  totalComissao,
  type MinhaComissao,
} from "./meu-dinheiro";

const c = (o: Partial<MinhaComissao>): MinhaComissao => ({
  sale_id: "s",
  venda_em: "2026-09-01",
  imovel: "Casa · Centro",
  papel: "captador",
  minha_comissao: 0,
  ...o,
});

describe("meu dinheiro", () => {
  const hoje = "2026-10-16";
  const lista = [
    c({ sale_id: "a", venda_em: "2026-10-03", minha_comissao: 9000 }),
    c({
      sale_id: "b",
      venda_em: "2026-10-12",
      minha_comissao: 4500.25,
      papel: "captador e vendedor",
    }),
    c({ sale_id: "c", venda_em: "2026-02-20", minha_comissao: 1000 }),
    c({ sale_id: "d", venda_em: "2025-12-05", minha_comissao: 7000 }),
    c({ sale_id: "e", venda_em: null, minha_comissao: 300 }),
  ];

  it("total geral soma a comissão de todas as vendas", () => {
    expect(totalComissao(filtrarPeriodo(lista, "todas", hoje))).toBe(21800.25);
  });

  it("filtro do mês: só vendas do mês corrente", () => {
    const m = filtrarPeriodo(lista, "mes", hoje);
    expect(m.map((x) => x.sale_id)).toEqual(["a", "b"]);
    expect(totalComissao(m)).toBe(13500.25);
  });

  it("filtro do ano: só vendas do ano corrente", () => {
    const a = filtrarPeriodo(lista, "ano", hoje);
    expect(a.map((x) => x.sale_id)).toEqual(["a", "b", "c"]);
    expect(totalComissao(a)).toBe(14500.25);
  });

  it("lista vazia: total zero", () => {
    expect(totalComissao([])).toBe(0);
    expect(filtrarPeriodo([], "mes", hoje)).toEqual([]);
  });

  it("ordena da venda mais recente para a mais antiga, sem data no fim", () => {
    expect(ordenarPorData(lista).map((x) => x.sale_id)).toEqual(["b", "a", "c", "d", "e"]);
  });

  it("normaliza números vindos como texto da RPC", () => {
    const n = normalizarComissao({ sale_id: "s", minha_comissao: "9000.50" });
    expect(n.minha_comissao).toBe(9000.5);
    expect(n.venda_em).toBeNull();
    expect(n.papel).toBeNull();
    expect(normalizarComissao({ sale_id: "s", minha_comissao: null }).minha_comissao).toBe(0);
  });

  it("data em formato brasileiro", () => {
    expect(dataBR("2026-10-28")).toBe("28/10/2026");
    expect(dataBR(null)).toBe("—");
  });
});
