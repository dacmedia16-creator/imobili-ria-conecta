import { describe, it, expect } from "vitest";
import {
  agruparContagemPorGrupoVenda,
  classificarGrupoVenda,
  GRUPO_VENDA_LABEL,
  STATUS_LABEL,
  validarComposicaoPagamento,
  type GrupoVenda,
  type SaleStatus,
} from "./status";

describe("validarComposicaoPagamento", () => {
  const sale = { valor_negociado: 370000 };

  it("exige o valor da carta quando a modalidade é consórcio", () => {
    expect(validarComposicaoPagamento(sale, {
      tipo_pagamento: "consorcio", entrada_valor: 10000, parcela1_valor: 35000,
    })[0].mensagem).toBe("Informe o valor da carta de consórcio");
  });

  it("aceita consórcio quando a composição fecha o valor da venda", () => {
    expect(validarComposicaoPagamento(sale, {
      tipo_pagamento: "consorcio", entrada_valor: 10000, parcela1_valor: 35000, consorcio_valor: 325000,
    })).toEqual([]);
  });

  it("exige valor financiado", () => {
    expect(validarComposicaoPagamento(sale, { tipo_pagamento: "financiamento" })[0].mensagem)
      .toBe("Informe o valor financiado");
  });

  it("informa quanto falta na composição", () => {
    expect(validarComposicaoPagamento(sale, {
      tipo_pagamento: "vista", entrada_valor: 45000,
    })[0].mensagem).toContain("R$\u00a0325.000,00 abaixo");
  });

  it("informa quanto excede na composição", () => {
    expect(validarComposicaoPagamento(sale, {
      tipo_pagamento: "vista", entrada_valor: 400000,
    })[0].mensagem).toContain("R$\u00a030.000,00 acima");
  });
});

// Fonte única e autoritativa de "todos os SaleStatus que existem": chaves de STATUS_LABEL, que já
// é um Record<SaleStatus, string> exaustivo (o TS não deixaria faltar nenhuma). Evita um array
// hardcoded aqui que poderia divergir do type SaleStatus com o tempo.
const TODOS_OS_STATUS = Object.keys(STATUS_LABEL) as SaleStatus[];

describe("classificarGrupoVenda — Etapa 1 do plano de dashboards (PLANO_SIMPLES_DASHBOARDS_RELATORIOS_ADM_MAX.md)", () => {
  const casosEsperados: [SaleStatus, GrupoVenda][] = [
    ["rascunho", "preparacao"],

    ["enviada_revisao", "futura"],
    ["devolvida_ajuste", "futura"],
    ["aprovada_gestor", "futura"],
    ["enviada_juridico", "futura"],
    ["em_elaboracao_contrato", "futura"],
    ["contrato_conferencia_gestor", "futura"],
    ["contrato_conferencia_corretor", "futura"],
    ["contrato_ok_corretor", "futura"],
    ["aguardando_assinatura", "futura"],

    ["contrato_assinado", "confirmada"],
    ["ocorrencia_pendente", "confirmada"],
    ["ocorrencia_analise_financeiro", "confirmada"],
    ["ocorrencia_devolvida_gestor", "confirmada"],
    ["ocorrencia_concluida", "confirmada"],

    ["cancelada", "encerrada"],
    ["arquivada", "encerrada"],
  ];

  it("cobre todos os 17 status de SaleStatus, sem repetir e sem faltar nenhum", () => {
    expect(casosEsperados).toHaveLength(TODOS_OS_STATUS.length);
    expect(casosEsperados.map(([status]) => status).sort()).toEqual([...TODOS_OS_STATUS].sort());
  });

  it.each(casosEsperados)("%s → %s", (status, grupoEsperado) => {
    expect(classificarGrupoVenda(status)).toBe(grupoEsperado);
  });

  it("requisito 2: ocorrencia_devolvida_gestor permanece confirmada — devolução de ocorrência é pendência operacional, não desfaz o contrato assinado", () => {
    expect(classificarGrupoVenda("ocorrencia_devolvida_gestor")).toBe("confirmada");
  });

  it("requisito 3: devolvida_ajuste permanece futura — a venda já foi enviada ao gestor pelo menos uma vez, não é mais 'em preparação'", () => {
    expect(classificarGrupoVenda("devolvida_ajuste")).toBe("futura");
  });

  it("exaustividade: todo status de SaleStatus retorna um dos 4 grupos válidos, sem exceção e sem fallback silencioso", () => {
    const gruposValidos = Object.keys(GRUPO_VENDA_LABEL) as GrupoVenda[];
    for (const status of TODOS_OS_STATUS) {
      expect(gruposValidos).toContain(classificarGrupoVenda(status));
    }
  });

  it("requisito 1: cada status pertence a exatamente um grupo (nenhum aparece em mais de uma lista de casosEsperados)", () => {
    const statusVistos = new Set<SaleStatus>();
    for (const [status] of casosEsperados) {
      expect(statusVistos.has(status)).toBe(false);
      statusVistos.add(status);
    }
  });

  it("requisito 4: valor fora do enum SaleStatus lança erro em vez de retornar undefined silenciosamente", () => {
    expect(() => classificarGrupoVenda("status_inexistente" as SaleStatus)).toThrow(
      /status_inexistente/,
    );
  });
});

describe("agruparContagemPorGrupoVenda — Etapa 2A: funil geral do dashboard usa classificarGrupoVenda", () => {
  it("preserva a soma total das contagens ao reagrupar (nenhuma venda é perdida ou duplicada)", () => {
    const contagemPorStatus: Record<SaleStatus, number> = {
      rascunho: 3,
      enviada_revisao: 2,
      devolvida_ajuste: 1,
      aprovada_gestor: 0,
      enviada_juridico: 4,
      em_elaboracao_contrato: 1,
      contrato_conferencia_gestor: 0,
      contrato_conferencia_corretor: 0,
      contrato_ok_corretor: 0,
      aguardando_assinatura: 2,
      contrato_assinado: 5,
      ocorrencia_pendente: 3,
      ocorrencia_analise_financeiro: 1,
      ocorrencia_devolvida_gestor: 2,
      ocorrencia_concluida: 7,
      cancelada: 1,
      arquivada: 2,
    };
    const totalEntrada = Object.values(contagemPorStatus).reduce((a, b) => a + b, 0);

    const totais = agruparContagemPorGrupoVenda(contagemPorStatus);
    const totalSaida = Object.values(totais).reduce((a, b) => a + b, 0);

    expect(totalSaida).toBe(totalEntrada);
  });

  it("soma corretamente as vendas de cada status dentro do grupo certo", () => {
    const totais = agruparContagemPorGrupoVenda({
      rascunho: 3,
      enviada_revisao: 2,
      devolvida_ajuste: 1,
      contrato_assinado: 5,
      ocorrencia_devolvida_gestor: 2,
      cancelada: 1,
      arquivada: 2,
    });

    expect(totais).toEqual({
      preparacao: 3,
      futura: 3, // enviada_revisao (2) + devolvida_ajuste (1)
      confirmada: 7, // contrato_assinado (5) + ocorrencia_devolvida_gestor (2)
      encerrada: 3, // cancelada (1) + arquivada (2)
    });
  });

  it("requisito 4 (repetido do dashboard): ocorrencia_devolvida_gestor conta em confirmada, não em preparação/futura", () => {
    const totais = agruparContagemPorGrupoVenda({ ocorrencia_devolvida_gestor: 9 });
    expect(totais.confirmada).toBe(9);
    expect(totais.preparacao + totais.futura + totais.encerrada).toBe(0);
  });

  it("requisito 5 (repetido do dashboard): devolvida_ajuste conta em futura, não em preparação", () => {
    const totais = agruparContagemPorGrupoVenda({ devolvida_ajuste: 4 });
    expect(totais.futura).toBe(4);
    expect(totais.preparacao).toBe(0);
  });

  it("objeto vazio (dashboard_stats().funil sem nenhuma venda ainda) retorna os 4 grupos zerados, não undefined", () => {
    expect(agruparContagemPorGrupoVenda({})).toEqual({
      preparacao: 0,
      futura: 0,
      confirmada: 0,
      encerrada: 0,
    });
  });

  it("status desconhecido no objeto de entrada lança erro (mesmo guard de classificarGrupoVenda, sem fallback silencioso)", () => {
    expect(() => agruparContagemPorGrupoVenda({ status_inexistente: 1 })).toThrow(
      /status_inexistente/,
    );
  });
});
