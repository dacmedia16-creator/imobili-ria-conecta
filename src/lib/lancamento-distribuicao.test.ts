import { describe, expect, it } from "vitest";
import { calcularDistribuicaoLancamento } from "./lancamento-distribuicao";

describe("calcularDistribuicaoLancamento", () => {
  it("fecha em zero quando a soma das linhas bate exatamente com a comissão bruta (sem sobra pra imobiliária)", () => {
    const r = calcularDistribuicaoLancamento({
      valorNegociado: 100000,
      percentualComissao: 6,
      valorTotalComissao: null,
      linhas: [{ valor: 4000 }, { valor: 2000 }],
    });
    expect(r.comissao_bruta).toBe(6000);
    expect(r.total_pessoas).toBe(6000);
    expect(r.saldo_imobiliaria).toBe(0);
    expect(r.diferenca_restante).toBe(0);
    expect(r.calculo_valido).toBe(true);
    expect(r.inconsistencias).toEqual([]);
  });

  it("calcula automaticamente o saldo da imobiliária/construtora como o resto (regra 3 do pedido)", () => {
    const r = calcularDistribuicaoLancamento({
      valorNegociado: 236009.3,
      percentualComissao: 4,
      valorTotalComissao: null,
      linhas: [{ valor: 6608.25 }],
    });
    expect(r.comissao_bruta).toBe(9440.37);
    expect(r.total_pessoas).toBe(6608.25);
    expect(r.saldo_imobiliaria).toBeCloseTo(2832.12, 2);
    // Por construção algébrica, total_distribuido sempre reconcilia com a comissão bruta quando válido.
    expect(r.total_distribuido).toBeCloseTo(r.comissao_bruta, 2);
    expect(r.calculo_valido).toBe(true);
  });

  it("bloqueia quando a soma das linhas ultrapassa a comissão bruta em mais de R$0,01", () => {
    const r = calcularDistribuicaoLancamento({
      valorNegociado: 100000,
      percentualComissao: 6,
      valorTotalComissao: null,
      linhas: [{ valor: 4000 }, { valor: 2000.02 }],
    });
    expect(r.saldo_imobiliaria).toBeCloseTo(-0.02, 2);
    expect(r.calculo_valido).toBe(false);
    expect(r.inconsistencias).toHaveLength(1);
    expect(r.inconsistencias[0]).toMatch(/ultrapassa a comissão bruta/);
  });

  it("tolera exatamente R$0,01 de diferença (arredondamento) sem bloquear", () => {
    const r = calcularDistribuicaoLancamento({
      valorNegociado: 100000,
      percentualComissao: 6,
      valorTotalComissao: null,
      linhas: [{ valor: 4000 }, { valor: 2000.01 }],
    });
    expect(r.calculo_valido).toBe(true);
  });

  it("separa parceria externa (sem_cadastro_confirmado) do total de pessoas, mas soma as duas no saldo da imobiliária", () => {
    const r = calcularDistribuicaoLancamento({
      valorNegociado: 100000,
      percentualComissao: 6,
      valorTotalComissao: null,
      linhas: [{ valor: 3000 }, { valor: 1500, semCadastroConfirmado: true }],
    });
    expect(r.total_pessoas).toBe(3000);
    expect(r.parceria_externa).toBe(1500);
    expect(r.saldo_imobiliaria).toBe(1500);
    expect(r.calculo_valido).toBe(true);
  });

  it("parceria externa também conta pro bloqueio de excesso, igual uma linha de pessoa", () => {
    const r = calcularDistribuicaoLancamento({
      valorNegociado: 100000,
      percentualComissao: 6,
      valorTotalComissao: null,
      linhas: [{ valor: 5000 }, { valor: 1500, semCadastroConfirmado: true }],
    });
    expect(r.calculo_valido).toBe(false);
  });

  it("rascunho incompleto (sem valor negociado/comissão) nunca é inconsistência, mesmo com linhas cadastradas", () => {
    const r = calcularDistribuicaoLancamento({
      valorNegociado: null,
      percentualComissao: null,
      valorTotalComissao: null,
      linhas: [{ valor: 5000 }],
    });
    expect(r.comissao_bruta).toBe(0);
    expect(r.calculo_valido).toBe(true);
    expect(r.inconsistencias).toEqual([]);
  });

  it("rascunho sem nenhuma linha de comissão ainda: saldo inteiro fica com a imobiliária, sem bloquear", () => {
    const r = calcularDistribuicaoLancamento({
      valorNegociado: 100000,
      percentualComissao: 6,
      valorTotalComissao: null,
      linhas: [],
    });
    expect(r.total_pessoas).toBe(0);
    expect(r.saldo_imobiliaria).toBe(6000);
    expect(r.calculo_valido).toBe(true);
  });

  it("usa valor_total_comissao quando não há percentual informado", () => {
    const r = calcularDistribuicaoLancamento({
      valorNegociado: 100000,
      percentualComissao: null,
      valorTotalComissao: 7000,
      linhas: [{ valor: 7000 }],
    });
    expect(r.comissao_bruta).toBe(7000);
    expect(r.saldo_imobiliaria).toBe(0);
    expect(r.calculo_valido).toBe(true);
  });

  it("valor em reais prevalece quando o percentual arredondado diverge", () => {
    const r = calcularDistribuicaoLancamento({
      valorNegociado: 675000,
      percentualComissao: 4.844,
      valorTotalComissao: 32700,
      linhas: [],
    });
    expect(r.comissao_bruta).toBe(32700);
    expect(r.total_distribuido).toBe(32700);
    expect(r.calculo_valido).toBe(true);
  });

  it("prêmio soma à comissão bruta na base do saldo automático (corretores já dividem a % em cima dos dois somados)", () => {
    const r = calcularDistribuicaoLancamento({
      valorNegociado: 382524.96,
      percentualComissao: 4,
      valorTotalComissao: null,
      premioValor: 1000,
      linhas: [{ valor: 7335.45 }, { valor: 3260 }, { valor: 815.05 }],
    });
    expect(r.comissao_bruta).toBe(15301);
    expect(r.premio_valor).toBe(1000);
    expect(r.total_pessoas).toBeCloseTo(11410.5, 2);
    expect(r.saldo_imobiliaria).toBeCloseTo(4890.5, 2);
    expect(r.calculo_valido).toBe(true);
  });

  it("sem prêmio preenchido, saldo automático continua igual a antes (compatibilidade)", () => {
    const r = calcularDistribuicaoLancamento({
      valorNegociado: 100000,
      percentualComissao: 6,
      valorTotalComissao: null,
      premioValor: null,
      linhas: [{ valor: 4000 }],
    });
    expect(r.premio_valor).toBe(0);
    expect(r.saldo_imobiliaria).toBe(2000);
  });

  it("aceita percentual e valor equivalentes sobre comissão bruta + prêmio", () => {
    const r = calcularDistribuicaoLancamento({
      valorNegociado: 100000,
      percentualComissao: 4,
      valorTotalComissao: null,
      premioValor: 1000,
      linhas: [{ percentual: 45, valor: 2250 }],
    });
    expect(r.calculo_valido).toBe(true);
  });

  it("bloqueia percentual e valor divergentes", () => {
    const r = calcularDistribuicaoLancamento({
      valorNegociado: 100000,
      percentualComissao: 4,
      valorTotalComissao: null,
      linhas: [{ percentual: 45, valor: 900 }],
    });
    expect(r.calculo_valido).toBe(false);
    expect(r.inconsistencias[0]).toMatch(/Percentual e valor divergentes/);
  });

  it("bloqueio de excesso considera comissão bruta + prêmio, e a mensagem menciona o prêmio", () => {
    const r = calcularDistribuicaoLancamento({
      valorNegociado: 100000,
      percentualComissao: 6,
      valorTotalComissao: null,
      premioValor: 500,
      linhas: [{ valor: 6500.02 }],
    });
    expect(r.calculo_valido).toBe(false);
    expect(r.inconsistencias[0]).toMatch(/comissão bruta \+ prêmio/);
  });
});
