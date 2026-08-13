import { describe, it, expect } from "vitest";
import {
  calcularComparativo, percentualReal, vgvEquivalente6, diferencaVgv, percentualReducao, situacaoDe,
  divergenciaCadastro, percentualMedioPonderado, resumoComparativo, agruparPorMes, primeiraDataDeStatus,
  elegivelParaComparativo, statusIndicaEnvioFinanceiro, podeAcessarComparativo6pct,
} from "./comparativo-comissao-calc";
import type { ComparativoRowComCalculo } from "./comparativo-comissao-types";

// ---- 1/2/3: cenários de validação do pedido original ----
describe("calcularComparativo — cenários de validação do pedido", () => {
  it("R$200.000 / R$8.000 → 4%, abaixo de 6%", () => {
    const r = calcularComparativo({ valorNegociado: 200000, valorTotalComissao: 8000 });
    expect(r.percentualReal).toBeCloseTo(4, 6);
    expect(r.vgvEquivalente6).toBeCloseTo(133333.33, 2);
    expect(r.diferencaVgv).toBeCloseTo(66666.67, 2);
    expect(r.percentualReducao).toBeCloseTo(33.33, 2);
    expect(r.situacao).toBe("abaixo");
  });

  it("R$200.000 / R$12.000 → exatamente 6%, diferença zero", () => {
    const r = calcularComparativo({ valorNegociado: 200000, valorTotalComissao: 12000 });
    expect(r.percentualReal).toBeCloseTo(6, 6);
    expect(r.vgvEquivalente6).toBeCloseTo(200000, 2);
    expect(r.diferencaVgv).toBeCloseTo(0, 6);
    expect(r.situacao).toBe("igual");
  });

  it("R$200.000 / R$14.000 → 7%, acima de 6%, diferença negativa", () => {
    const r = calcularComparativo({ valorNegociado: 200000, valorTotalComissao: 14000 });
    expect(r.percentualReal).toBeCloseTo(7, 6);
    expect(r.vgvEquivalente6).toBeCloseTo(233333.33, 2);
    expect(r.diferencaVgv).toBeCloseTo(-33333.33, 2);
    expect(r.situacao).toBe("acima");
  });
});

// ---- 4/5: entradas inválidas — nunca NaN/Infinity/undefined ----
describe("valores ausentes/zerados — sem NaN, Infinity ou undefined", () => {
  it("valor negociado zero", () => {
    const r = calcularComparativo({ valorNegociado: 0, valorTotalComissao: 8000 });
    expect(r.percentualReal).toBeNull();
    expect(r.percentualReducao).toBeNull();
    expect(r.diferencaVgv).toBeNull(); // não dá pra comparar contra um negociado que não existe
    expect(r.vgvEquivalente6).toBeCloseTo(133333.33, 2); // não depende do negociado
  });

  it("valor negociado nulo", () => {
    const r = calcularComparativo({ valorNegociado: null, valorTotalComissao: 8000 });
    expect(r.percentualReal).toBeNull();
    expect(r.diferencaVgv).toBeNull();
    expect(r.percentualReducao).toBeNull();
  });

  it("comissão zero", () => {
    const r = calcularComparativo({ valorNegociado: 200000, valorTotalComissao: 0 });
    expect(r.vgvEquivalente6).toBeNull();
    expect(r.diferencaVgv).toBeNull();
    expect(r.percentualReducao).toBeNull();
    expect(r.percentualReal).toBe(0);
    expect(r.situacao).toBe("abaixo");
  });

  it("comissão nula", () => {
    const r = calcularComparativo({ valorNegociado: 200000, valorTotalComissao: null });
    expect(r.vgvEquivalente6).toBeNull();
    expect(r.diferencaVgv).toBeNull();
  });

  it("nenhum campo do resultado é NaN, Infinity ou undefined em nenhum dos casos acima", () => {
    const casos = [
      { valorNegociado: 0, valorTotalComissao: 0 },
      { valorNegociado: null, valorTotalComissao: null },
      { valorNegociado: undefined, valorTotalComissao: undefined },
    ];
    for (const c of casos) {
      const r = calcularComparativo(c);
      for (const v of Object.values(r)) {
        if (typeof v === "number") {
          expect(Number.isNaN(v)).toBe(false);
          expect(Number.isFinite(v)).toBe(true);
        }
        expect(v).not.toBeUndefined();
      }
    }
  });
});

// ---- 6: arredondamento com centavos ----
describe("arredondamento — cálculo interno não arredonda antes da hora", () => {
  it("centavos não somem no cálculo intermediário (só a exibição arredonda)", () => {
    const r = calcularComparativo({ valorNegociado: 199999.99, valorTotalComissao: 7999.995 });
    // (7999.995 / 199999.99) * 100 — não deve ser pré-arredondado pra 4 antes de calcular vgv/diferença.
    expect(r.percentualReal).toBeCloseTo(4.0, 4);
    expect(r.vgvEquivalente6).toBeCloseTo(7999.995 / 0.06, 6);
    expect(r.diferencaVgv).toBeCloseTo(199999.99 - 7999.995 / 0.06, 6);
  });
});

// ---- divergência de cadastro (percentual_comissao vs. calculado) ----
describe("divergenciaCadastro", () => {
  it("sinaliza quando o percentual cadastrado diverge do calculado além da tolerância", () => {
    expect(divergenciaCadastro(5, 4)).toBe(true); // cadastrado 5%, calculado 4%
  });
  it("não sinaliza dentro da tolerância de arredondamento", () => {
    expect(divergenciaCadastro(4.001, 4)).toBe(false);
  });
  it("não sinaliza quando não há percentual cadastrado", () => {
    expect(divergenciaCadastro(null, 4)).toBe(false);
  });
});

// ---- 7: percentual médio ponderado ----
describe("percentualMedioPonderado — nunca a média simples dos percentuais individuais", () => {
  it("pondera pelo VGV de cada venda, não pela contagem", () => {
    const rows = [
      { valor_negociado: 100000, valor_total_comissao: 10000 }, // 10%
      { valor_negociado: 900000, valor_total_comissao: 18000 }, // 2%
    ];
    // média simples seria 6%; ponderada = 28000/1000000*100 = 2.8%
    const media = percentualMedioPonderado(rows);
    expect(media).toBeCloseTo(2.8, 6);
    expect(media).not.toBeCloseTo(6, 1);
  });

  it("null quando não há VGV (lista vazia ou soma zero)", () => {
    expect(percentualMedioPonderado([])).toBeNull();
    expect(percentualMedioPonderado([{ valor_negociado: 0, valor_total_comissao: 0 }])).toBeNull();
  });
});

const rowBase: ComparativoRowComCalculo = {
  sale_id: "s1", codigo_interno: "COD-1", imovel_id: "IMV-1", modalidade: "padrao", status: "ocorrencia_analise_financeiro",
  corretor_id: "c1", valor_negociado: 200000, valor_total_comissao: 8000, percentual_comissao: 4,
  data_fechamento: "2026-03-15", evento_fechamento: "ocorrencia_analise_financeiro", corretorNome: "Fulano", teamId: "t1", teamNome: "Equipe A",
  gestorId: "g1", gestorNome: "Gestor A",
  percentualReal: 4, vgvEquivalente6: 133333.33, diferencaVgv: 66666.67, percentualReducao: 33.33,
  situacao: "abaixo", divergenciaCadastro: false,
};

describe("resumoComparativo — agregação de várias vendas", () => {
  it("soma VGV/comissão e pondera o percentual médio corretamente", () => {
    const rows: ComparativoRowComCalculo[] = [
      rowBase,
      { ...rowBase, sale_id: "s2", valor_negociado: 900000, valor_total_comissao: 18000, percentualReal: 2 },
    ];
    const resumo = resumoComparativo(rows);
    expect(resumo.quantidade).toBe(2);
    expect(resumo.vgvRealTotal).toBe(1100000);
    expect(resumo.comissaoTotal).toBe(26000);
    expect(resumo.percentualMedioPonderado).toBeCloseTo((26000 / 1100000) * 100, 6);
    expect(resumo.vgvEquivalente6Total).toBeCloseTo(26000 / 0.06, 2);
    expect(resumo.diferencaTotal).toBeCloseTo(1100000 - 26000 / 0.06, 2);
  });
});

// ---- totais mensais + percentual médio ponderado por mês ----
describe("agruparPorMes — totais mensais", () => {
  it("agrupa por mês da data de fechamento e pondera o percentual por grupo, em ordem cronológica", () => {
    const rows: ComparativoRowComCalculo[] = [
      { ...rowBase, sale_id: "s1", data_fechamento: "2026-02-10", valor_negociado: 100000, valor_total_comissao: 6000 },
      { ...rowBase, sale_id: "s2", data_fechamento: "2026-02-20", valor_negociado: 300000, valor_total_comissao: 12000 },
      { ...rowBase, sale_id: "s3", data_fechamento: "2026-01-05", valor_negociado: 200000, valor_total_comissao: 12000 },
    ];
    const grupos = agruparPorMes(rows);
    expect(grupos.map((g) => g.mes)).toEqual(["2026-01", "2026-02"]);
    const fev = grupos.find((g) => g.mes === "2026-02")!;
    expect(fev.quantidade).toBe(2);
    expect(fev.vgvReal).toBe(400000);
    expect(fev.comissaoTotal).toBe(18000);
    expect(fev.percentualMedioPonderado).toBeCloseTo((18000 / 400000) * 100, 6);
  });
});

// ---- 8: regra única de efetivação (ocorrencia_analise_financeiro), igual pras duas modalidades ----
describe("elegivelParaComparativo — venda tradicional", () => {
  const base = {
    status: "ocorrencia_analise_financeiro", dataFechamento: "2026-03-15",
    eventoFechamento: "ocorrencia_analise_financeiro" as const, valorNegociado: 200000, valorTotalComissao: 8000,
  };
  it("tradicional com apenas contrato_assinado (sem ocorrencia_analise_financeiro) NÃO entra", () => {
    // contrato_assinado sozinho não basta — ainda falta o gestor preencher e enviar a ocorrência
    // ao financeiro. Sem esse evento no histórico, dataFechamento/eventoFechamento vêm nulos.
    expect(elegivelParaComparativo({ ...base, status: "contrato_assinado", dataFechamento: null, eventoFechamento: null })).toBe(false);
  });
  it("tradicional COM primeira entrada em ocorrencia_analise_financeiro entra", () => {
    expect(elegivelParaComparativo(base)).toBe(true);
  });
  it("exclui cancelada", () => {
    expect(elegivelParaComparativo({ ...base, status: "cancelada" })).toBe(false);
  });
  it("exclui arquivada", () => {
    expect(elegivelParaComparativo({ ...base, status: "arquivada" })).toBe(false);
  });
  it("rejeita mesmo com data preenchida se o evento não é ocorrencia_analise_financeiro (nunca aceita contrato_assinado como substituto, mesmo simulando uma resposta inesperada em runtime)", () => {
    expect(elegivelParaComparativo({ ...base, eventoFechamento: "contrato_assinado" as unknown as typeof base.eventoFechamento })).toBe(false);
  });
  it("exclui sem valor negociado válido (nulo, zero ou negativo)", () => {
    expect(elegivelParaComparativo({ ...base, valorNegociado: null })).toBe(false);
    expect(elegivelParaComparativo({ ...base, valorNegociado: 0 })).toBe(false);
    expect(elegivelParaComparativo({ ...base, valorNegociado: -100 })).toBe(false);
  });
  it("exclui sem valor de comissão válido (nulo, zero ou negativo)", () => {
    expect(elegivelParaComparativo({ ...base, valorTotalComissao: null })).toBe(false);
    expect(elegivelParaComparativo({ ...base, valorTotalComissao: 0 })).toBe(false);
    expect(elegivelParaComparativo({ ...base, valorTotalComissao: -100 })).toBe(false);
  });
});

describe("elegivelParaComparativo — Lançamento (mesma regra, sem exigir contrato_assinado)", () => {
  const base = {
    status: "ocorrencia_concluida", dataFechamento: "2026-03-15",
    eventoFechamento: "ocorrencia_analise_financeiro" as const, valorNegociado: 200000, valorTotalComissao: 8000,
  };
  it("Lançamento com primeira entrada em ocorrencia_analise_financeiro entra", () => {
    expect(elegivelParaComparativo(base)).toBe(true);
  });
  it("venda sem o evento fica fora dos cálculos", () => {
    expect(elegivelParaComparativo({ ...base, dataFechamento: null, eventoFechamento: null })).toBe(false);
  });
});

// ---- 9: data de fechamento = primeira entrada no evento certo (dedupe por modalidade) ----
describe("primeiraDataDeStatus — data de fechamento, uma linha por venda", () => {
  it("tradicional: usa a primeira entrada em contrato_assinado, não a mais recente (reassinatura/reabertura)", () => {
    const historico = [
      { para: "enviada_revisao", created_at: "2026-01-01" },
      { para: "contrato_assinado", created_at: "2026-02-10" },
      { para: "ocorrencia_devolvida_gestor", created_at: "2026-02-20" },
      { para: "contrato_assinado", created_at: "2026-03-01" }, // reassinatura
    ];
    expect(primeiraDataDeStatus(historico, "contrato_assinado")).toBe("2026-02-10");
  });

  it("lançamento: usa a primeira entrada em ocorrencia_analise_financeiro, mesmo com múltiplas reentradas (devolução/reenvio)", () => {
    const historico = [
      { para: "ocorrencia_analise_financeiro", created_at: "2026-08-11T19:13:16" },
      { para: "devolvida_ajuste", created_at: "2026-08-11T19:58:46" },
      { para: "ocorrencia_analise_financeiro", created_at: "2026-08-11T19:59:37" }, // reenvio
      { para: "ocorrencia_concluida", created_at: "2026-08-13T14:11:27" },
    ];
    expect(primeiraDataDeStatus(historico, "ocorrencia_analise_financeiro")).toBe("2026-08-11T19:13:16");
  });

  it("null quando a venda nunca entrou nesse status (não usa created_at/updated_at da venda)", () => {
    const historico = [{ para: "rascunho", created_at: "2026-01-01" }, { para: "enviada_revisao", created_at: "2026-01-05" }];
    expect(primeiraDataDeStatus(historico, "contrato_assinado")).toBeNull();
  });

  it("sempre devolve uma única data (string), nunca uma lista — mesmo com N reentradas no mesmo status", () => {
    const historico = Array.from({ length: 5 }, (_, i) => ({ para: "contrato_assinado", created_at: `2026-0${i + 1}-01` }));
    const resultado = primeiraDataDeStatus(historico, "contrato_assinado");
    expect(typeof resultado).toBe("string");
    expect(resultado).toBe("2026-01-01");
  });
});

// ---- contrato da RPC de inconsistências: TESTE-VITEST permanece inconsistente ----
describe("statusIndicaEnvioFinanceiro — TESTE-VITEST e outros casos", () => {
  it("TESTE-VITEST (status contrato_assinado, inserida direto no banco sem histórico) permanece inconsistente", () => {
    // A suíte de integração (financial-rules.integration.test.ts) cria vendas via INSERT direto com
    // status='contrato_assinado' e código 'TESTE-VITEST-<uuid>', sem passar pela esteira — por isso
    // nunca ganham entrada em sale_status_history. Duas checagens juntas reproduzem exatamente o
    // caso: o status já entra na janela de "indica envio ao financeiro" (não seria normal uma venda
    // de verdade ficar parada aí, já que o avanço é automático), mas ela nunca é aceita no
    // Comparativo por faltar o evento.
    expect(statusIndicaEnvioFinanceiro("contrato_assinado")).toBe(true);
    expect(elegivelParaComparativo({
      status: "contrato_assinado", dataFechamento: null, eventoFechamento: null,
      valorNegociado: 1000, valorTotalComissao: 100,
    })).toBe(false);
  });
  it("status antes da assinatura não indicam envio ao financeiro — não é inconsistência", () => {
    expect(statusIndicaEnvioFinanceiro("rascunho")).toBe(false);
    expect(statusIndicaEnvioFinanceiro("enviada_revisao")).toBe(false);
    expect(statusIndicaEnvioFinanceiro("aguardando_assinatura")).toBe(false);
  });
  it("cancelada/arquivada não indicam envio ao financeiro — fim de linha esperado, não inconsistência", () => {
    expect(statusIndicaEnvioFinanceiro("cancelada")).toBe(false);
    expect(statusIndicaEnvioFinanceiro("arquivada")).toBe(false);
  });
  it("ocorrencia_pendente/ocorrencia_analise_financeiro/ocorrencia_devolvida_gestor/ocorrencia_concluida indicam envio ao financeiro", () => {
    expect(statusIndicaEnvioFinanceiro("ocorrencia_pendente")).toBe(true);
    expect(statusIndicaEnvioFinanceiro("ocorrencia_analise_financeiro")).toBe(true);
    expect(statusIndicaEnvioFinanceiro("ocorrencia_devolvida_gestor")).toBe(true);
    expect(statusIndicaEnvioFinanceiro("ocorrencia_concluida")).toBe(true);
  });
});

// ---- 10: controle de acesso ----
describe("podeAcessarComparativo6pct — controle de acesso", () => {
  it.each([["admin"], ["super_admin"], ["financeiro"]] as const)("libera %s", (papel) => {
    expect(podeAcessarComparativo6pct([papel])).toBe(true);
  });
  it.each([["corretor"], ["gestor"], ["team_leader"], ["juridico"], ["lancamento"]] as const)("bloqueia %s", (papel) => {
    expect(podeAcessarComparativo6pct([papel])).toBe(false);
  });
  it("bloqueia usuário sem nenhum papel", () => {
    expect(podeAcessarComparativo6pct([])).toBe(false);
  });
  it("libera se pelo menos um dos papéis do usuário for autorizado (papéis acumulados)", () => {
    expect(podeAcessarComparativo6pct(["corretor", "financeiro"])).toBe(true);
  });
});

// ---- funções auxiliares isoladas ----
describe("percentualReal / vgvEquivalente6 / diferencaVgv / percentualReducao / situacaoDe (isoladas)", () => {
  it("percentualReal", () => {
    expect(percentualReal(200000, 8000)).toBeCloseTo(4, 6);
    expect(percentualReal(0, 8000)).toBeNull();
  });
  it("vgvEquivalente6", () => {
    expect(vgvEquivalente6(12000)).toBeCloseTo(200000, 2);
    expect(vgvEquivalente6(0)).toBeNull();
  });
  it("diferencaVgv", () => {
    expect(diferencaVgv(200000, 133333.33)).toBeCloseTo(66666.67, 2);
    expect(diferencaVgv(null, 133333.33)).toBeNull();
    expect(diferencaVgv(200000, null)).toBeNull();
  });
  it("percentualReducao", () => {
    expect(percentualReducao(200000, 66666.67)).toBeCloseTo(33.33, 2);
    expect(percentualReducao(0, 66666.67)).toBeNull();
    expect(percentualReducao(200000, null)).toBeNull();
  });
  it("situacaoDe com tolerância de 0,001 ponto percentual", () => {
    expect(situacaoDe(6)).toBe("igual");
    expect(situacaoDe(6.0005)).toBe("igual");
    expect(situacaoDe(6.002)).toBe("acima");
    expect(situacaoDe(5.998)).toBe("abaixo");
    expect(situacaoDe(null)).toBeNull();
  });
});
