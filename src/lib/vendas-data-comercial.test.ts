import { describe, expect, it } from "vitest";
import { selecionarVendasComerciais } from "./vendas-data-comercial";
import { periodoMesAnterior, periodoMesAtual } from "./vendas-periodo";

const sale = {
  id: "caso-regressao",
  imovel_id: "630601207-19",
  modalidade: "padrao",
  status: "ocorrencia_concluida",
  created_at: "2026-08-19T12:00:00Z",
  updated_at: "2026-09-03T12:00:00Z",
  data_assinatura: null as string | null,
  valor_negociado: 100,
};
const validas = [{ sale_id: sale.id, venda_em: "2026-09-01T12:00:00Z" }];
const occurrences = [{ sale_id: sale.id, data_assinatura: "2026-09-01" }];
const agosto = { desde: "2026-08-01", ate: "2026-08-31" };
const setembro = { desde: "2026-09-01", ate: "2026-09-30" };

describe("atribuição por assinatura após elegibilidade canônica", () => {
  it("630601207-19: criada/movimentada em agosto, assinada em setembro, só conta setembro", () => {
    expect(selecionarVendasComerciais([sale], validas, occurrences, agosto)).toEqual([]);
    const rows = selecionarVendasComerciais([sale], validas, occurrences, setembro);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ data_venda: "2026-09-01", status: "ocorrencia_concluida" });
    expect(rows.reduce((sum, row) => sum + row.valor_negociado, 0)).toBe(100);
  });

  it("atalhos de mês usam os mesmos limites inclusivos que De/Até", () => {
    const agora = new Date(2026, 8, 9);
    for (const [periodo, quantidade] of [
      [periodoMesAnterior(agora), 0],
      [periodoMesAtual(agora), 1],
    ] as const) {
      expect(
        selecionarVendasComerciais([sale], validas, occurrences, {
          desde: periodo.de,
          ate: periodo.ate,
        }),
      ).toHaveLength(quantidade);
    }
  });

  it.each(["rascunho", "em_analise", "cancelada", "arquivada", "contrato_assinado"])(
    "não inventa elegibilidade para %s ausente da RPC, mesmo com assinatura preenchida",
    (status) =>
      expect(selecionarVendasComerciais([{ ...sale, status }], [], occurrences, setembro)).toEqual(
        [],
      ),
  );

  it("marco em setembro não substitui assinatura cadastrada em agosto", () => {
    const occ = [{ sale_id: sale.id, data_assinatura: "2026-08-31" }];
    expect(selecionarVendasComerciais([sale], validas, occ, agosto)).toHaveLength(1);
    expect(selecionarVendasComerciais([sale], validas, occ, setembro)).toHaveLength(0);
  });

  it("padrão sem assinatura não recorre à criação nem ao marco", () => {
    expect(selecionarVendasComerciais([sale], validas, [], {})).toEqual([]);
  });

  it("Lançamento usa assinatura de sales, não occurrence nem marco", () => {
    const lancamento = { ...sale, modalidade: "lancamento", data_assinatura: "2026-08-31" };
    expect(
      selecionarVendasComerciais([lancamento], validas, occurrences, agosto)[0].data_venda,
    ).toBe("2026-08-31");
  });

  it("somente Lançamento sem assinatura usa marco canônico no fuso comercial de São Paulo", () => {
    const lancamento = { ...sale, modalidade: "lancamento" };
    const marco = [{ sale_id: sale.id, venda_em: "2026-09-01T02:30:00Z" }];
    expect(selecionarVendasComerciais([lancamento], marco, [], agosto)[0].data_venda).toBe(
      "2026-08-31",
    );
    expect(selecionarVendasComerciais([lancamento], marco, [], setembro)).toEqual([]);
    expect(selecionarVendasComerciais([lancamento], [], [], agosto)).toEqual([]);
  });

  it("aceita limites isolados, período vazio e inclui o último dia sem invadir o próximo", () => {
    expect(
      selecionarVendasComerciais([sale], validas, occurrences, { ate: "2026-08-31" }),
    ).toHaveLength(0);
    expect(
      selecionarVendasComerciais([sale], validas, occurrences, { desde: "2026-09-01" }),
    ).toHaveLength(1);
    expect(
      selecionarVendasComerciais([sale], validas, occurrences, {
        desde: "2026-09-01",
        ate: "2026-09-01",
      }),
    ).toHaveLength(1);
    expect(selecionarVendasComerciais([sale], validas, occurrences, {})).toHaveLength(1);
  });

  it("duplicação na fonte não duplica contagem; ordem usa data comercial e desempate estável", () => {
    expect(
      selecionarVendasComerciais([sale, sale], [...validas, ...validas], occurrences, setembro),
    ).toHaveLength(1);
    const outra = { ...sale, id: "outra" };
    const rows = selecionarVendasComerciais(
      [sale, outra],
      [...validas, { sale_id: outra.id, venda_em: validas[0].venda_em }],
      [...occurrences, { sale_id: outra.id, data_assinatura: "2026-09-30" }],
      setembro,
    );
    expect(rows.map((row) => row.id)).toEqual(["outra", sale.id]);
  });
});
