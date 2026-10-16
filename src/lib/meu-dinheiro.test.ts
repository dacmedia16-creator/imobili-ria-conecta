import { describe, expect, it } from "vitest";
import {
  aReceber,
  dataBR,
  normalizarParcela,
  recebidas,
  resumoDinheiro,
  type MinhaParcela,
} from "./meu-dinheiro";

const p = (o: Partial<MinhaParcela>): MinhaParcela => ({
  sale_id: "s",
  occurrence_id: "o",
  venda_em: "2026-09-01",
  imovel: "Casa · Centro",
  papel: "captador",
  minha_comissao: 9000,
  parcela: 1,
  parcelas: 1,
  data_prevista: null,
  valor_previsto: 0,
  recebido_em: null,
  valor_recebido: null,
  ...o,
});

describe("meu dinheiro", () => {
  const lista = [
    p({ sale_id: "a", parcela: 1, parcelas: 2, data_prevista: "2026-11-12", valor_previsto: 6000 }),
    p({
      sale_id: "a",
      parcela: 2,
      parcelas: 2,
      data_prevista: "2026-10-01",
      valor_previsto: 3000,
      recebido_em: "2026-10-02",
      valor_recebido: 2900,
    }),
    p({ sale_id: "b", data_prevista: null, valor_previsto: 4500 }),
    p({ sale_id: "c", data_prevista: "2026-10-10", valor_previsto: 1000 }),
    p({
      sale_id: "d",
      data_prevista: "2025-12-01",
      valor_previsto: 7000,
      recebido_em: "2025-12-05",
    }),
  ];

  it("a receber: datas mais próximas primeiro e 'sem data' no fim", () => {
    expect(aReceber(lista).map((x) => x.sale_id)).toEqual(["c", "a", "b"]);
  });

  it("recebidas: mais recentes primeiro", () => {
    expect(recebidas(lista).map((x) => x.sale_id)).toEqual(["a", "d"]);
  });

  it("resumo: recebido só no ano corrente, usando o valor baixado", () => {
    const r = resumoDinheiro(lista, "2026-10-16");
    expect(r.recebidoNoAno).toBe(2900);
    expect(r.aReceber).toBe(11500);
    expect(r.proximo).toBe("2026-10-10");
    expect(r.proximoAtrasado).toBe(true);
    expect(r.semData).toBe(1);
  });

  it("resumo vazio", () => {
    expect(resumoDinheiro([], "2026-10-16")).toEqual({
      recebidoNoAno: 0,
      aReceber: 0,
      proximo: null,
      proximoAtrasado: false,
      semData: 0,
    });
  });

  it("recebida sem valor baixado conta o previsto", () => {
    const r = resumoDinheiro(
      [p({ valor_previsto: 1234.5, recebido_em: "2026-01-03", valor_recebido: null })],
      "2026-10-16",
    );
    expect(r.recebidoNoAno).toBe(1234.5);
  });

  it("normaliza números vindos como texto da RPC", () => {
    const n = normalizarParcela({
      sale_id: "s",
      occurrence_id: "o",
      minha_comissao: "9000.00",
      parcela: 2,
      parcelas: "3",
      valor_previsto: "3000.50",
      valor_recebido: null,
    });
    expect(n.minha_comissao).toBe(9000);
    expect(n.parcelas).toBe(3);
    expect(n.valor_previsto).toBe(3000.5);
    expect(n.valor_recebido).toBeNull();
    expect(n.data_prevista).toBeNull();
  });

  it("data em formato brasileiro", () => {
    expect(dataBR("2026-10-28")).toBe("28/10/2026");
    expect(dataBR(null)).toBe("sem data");
  });
});
