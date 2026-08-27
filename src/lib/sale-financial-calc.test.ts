import { describe, it, expect } from "vitest";
import { recalcImobiliaria, calcularPatchValorNegociado, calcularPatchOccValorNegociado, deveSincronizarComissaoFixa, verificarComissoesDesatualizadas, type OcorrenciaComissaoRow, type SaleExtraRow } from "./sale-financial-calc";

// Cenário base do pedido: venda R$730.000, comissão 6% (R$43.800), parceria 3% (R$21.900),
// parte RE/MAX 3% (R$21.900), captador R$4.927,50, vendedor R$4.927,50 (valores fixos em reais,
// nunca recalculados por percentual). Saldo inicial da imobiliária esperado: R$12.045.
const CENARIO_BASE = {
  valor_negociado: 730000,
  percentual_comissao: 6,
  valor_total_comissao: 43800,
  parceria_percentual: 3,
  parceria_valor: 21900,
  percentual_remax: 3,
  valor_remax: 21900,
  valor_comissao_captador: 4927.5,
  valor_comissao_vendedor: 4927.5,
};

describe("recalcImobiliaria — regra 3/5: saldo inicial da imobiliária", () => {
  it("total menos captador, vendedor e parceria (cenário base)", () => {
    expect(recalcImobiliaria({}, CENARIO_BASE)).toBe(12045);
  });

  it("usa o valor do patch (não o do formSale) quando a chave está presente no patch", () => {
    const resultado = recalcImobiliaria({ valor_total_comissao: 50000 }, CENARIO_BASE);
    expect(resultado).toBe(50000 - 4927.5 - 4927.5 - 21900);
  });

  it("um campo explicitamente null no patch (usuário limpou) não cai de volta pro valor do formSale", () => {
    const resultado = recalcImobiliaria({ valor_comissao_captador: null }, CENARIO_BASE);
    expect(resultado).toBe(43800 - 0 - 4927.5 - 21900);
  });

  it("sem parceria (null), não desconta nada por parceria", () => {
    const semParceria = { ...CENARIO_BASE, parceria_valor: null };
    expect(recalcImobiliaria({}, semParceria)).toBe(43800 - 4927.5 - 4927.5);
  });
});

describe("calcularPatchValorNegociado — comissão em reais como fonte oficial", () => {
  it("preserva a comissão em reais e deriva o percentual de referência", () => {
    const patch = calcularPatchValorNegociado(CENARIO_BASE, 730000);
    expect(patch.valor_negociado).toBe(730000);
    expect(patch).not.toHaveProperty("valor_total_comissao");
    expect(patch.percentual_comissao).toBe(6);
    expect(patch.parceria_valor).toBe(21900);
    expect(patch.valor_remax).toBe(21900);
    expect(patch.valor_comissao_imobiliaria).toBe(12045);
  });

  it("nunca toca captador/vendedor — são valores fixos em reais, sem percentual vinculado ao negociado", () => {
    const patch = calcularPatchValorNegociado(CENARIO_BASE, 900000);
    expect(patch).not.toHaveProperty("valor_comissao_captador");
    expect(patch).not.toHaveProperty("valor_comissao_vendedor");
  });

  it("nunca toca indicador ou líder — são valores fixos em reais descontados do próprio lado, não do negociado", () => {
    const formSale = { ...CENARIO_BASE, valor_comissao_indicador_captador: 500, valor_comissao_lider_captador: 1000 };
    const patch = calcularPatchValorNegociado(formSale, 900000);
    expect(patch).not.toHaveProperty("valor_comissao_indicador_captador");
    expect(patch).not.toHaveProperty("valor_comissao_lider_captador");
  });

  it("ao mudar o negociado, preserva a comissão em reais e recalcula somente sua referência percentual", () => {
    const patch = calcularPatchValorNegociado(CENARIO_BASE, 800000);
    expect(patch).not.toHaveProperty("valor_total_comissao");
    expect(patch.percentual_comissao).toBe(5.475); // 43.800 / 800.000
    expect(patch.parceria_valor).toBe(24000); // 3% de 800.000
    expect(patch.valor_remax).toBe(24000); // 3% de 800.000
  });

  it("valor fixo legado também gera o percentual apenas como referência", () => {
    const formSale = { valor_negociado: 500000, percentual_comissao: null, valor_total_comissao: 30000, parceria_percentual: null, percentual_remax: null };
    const patch = calcularPatchValorNegociado(formSale, 600000);
    expect(patch).not.toHaveProperty("valor_total_comissao");
    expect(patch.percentual_comissao).toBe(5);
    expect(patch).not.toHaveProperty("parceria_valor");
    expect(patch).not.toHaveProperty("valor_remax");
    expect(patch.valor_negociado).toBe(600000);
  });

  it("negociado limpo zera apenas referências derivadas, sem apagar a comissão oficial", () => {
    const patch = calcularPatchValorNegociado(CENARIO_BASE, null);
    expect(patch.valor_negociado).toBeNull();
    expect(patch).not.toHaveProperty("valor_total_comissao");
    expect(patch.percentual_comissao).toBeNull();
    expect(patch.parceria_valor).toBeNull();
    expect(patch.valor_remax).toBeNull();
  });

  it("caso real: R$ 32.700 prevalece e 4,844444% fica só como referência", () => {
    const formSale = { valor_negociado: 675000, percentual_comissao: 4.844, valor_total_comissao: 32700, parceria_percentual: null, percentual_remax: null };
    const patch = calcularPatchValorNegociado(formSale, 675000);
    expect(patch).not.toHaveProperty("valor_total_comissao");
    expect(patch.percentual_comissao).toBe(4.844444);
  });
});

describe("calcularPatchOccValorNegociado — valor em reais prevalece", () => {
  it("preserva o valor da comissão e deriva o percentual", () => {
    const patch = calcularPatchOccValorNegociado({ percentual_comissao: 4.844, valor_comissao: 32700 }, 675000);
    expect(patch).not.toHaveProperty("valor_comissao");
    expect(patch.percentual_comissao).toBe(4.844444);
  });

  it("sem percentual definido, não mexe em valor_comissao", () => {
    const patch = calcularPatchOccValorNegociado({ percentual_comissao: null, valor_comissao: null }, 730000);
    expect(patch).not.toHaveProperty("valor_comissao");
  });
});

describe("verificarComissoesDesatualizadas", () => {
  // Só captador ativo (líquido = bruto, sem indicador/líder/extra) — cada teste ajusta o que precisa.
  const sale = {
    corretor_captador: "Captador Teste", corretor_captador_id: "captador-1", valor_comissao_captador: 4927.5,
    corretor_vendedor: null, corretor_vendedor_id: null, valor_comissao_vendedor: null,
    indicador_captador: null, valor_comissao_indicador_captador: null,
    indicador_vendedor: null, valor_comissao_indicador_vendedor: null,
    lider_captador_nome: null, valor_comissao_lider_captador: null, lider_captador_id: null,
    lider_vendedor_nome: null, valor_comissao_lider_vendedor: null, lider_vendedor_id: null,
  };
  const distribuicao = { liquido_captador: 4927.5, liquido_vendedor: null };
  const linhaCaptadorOk: OcorrenciaComissaoRow = { papel: "corretor_captador", nome: "Captador Teste", valor: 4927.5, user_id: "captador-1", sale_commission_extra_id: null, managed_by_sale: true };
  const linhaManual: OcorrenciaComissaoRow = { papel: "corretor_captador", nome: "Ajuste Manual do Financeiro", valor: 999, user_id: null, sale_commission_extra_id: null, managed_by_sale: false };

  it("teste 1 — linha automática correta + linha manual do mesmo papel: aviso falso, manual nunca usada na comparação", () => {
    const desatualizado = verificarComissoesDesatualizadas({ sale, distribuicao, commissions: [linhaCaptadorOk, linhaManual], commissionExtras: [] });
    expect(desatualizado).toBe(false);
  });

  it("teste 2 — linha manual aparece ANTES da automática no array: ainda encontra a automática", () => {
    const desatualizado = verificarComissoesDesatualizadas({ sale, distribuicao, commissions: [linhaManual, linhaCaptadorOk], commissionExtras: [] });
    expect(desatualizado).toBe(false);
  });

  it("teste 3 — indicador removido do Resumo mas linha automática antiga ainda presente: aviso verdadeiro", () => {
    const linhaIndicadorVelha: OcorrenciaComissaoRow = { papel: "indicador_captador", nome: "Fulano Antigo", valor: 500, user_id: null, sale_commission_extra_id: null, managed_by_sale: true };
    const desatualizado = verificarComissoesDesatualizadas({ sale, distribuicao, commissions: [linhaCaptadorOk, linhaIndicadorVelha], commissionExtras: [] });
    expect(desatualizado).toBe(true);
  });

  it("teste 4 — indicador removido e linha automática também removida: aviso falso", () => {
    const desatualizado = verificarComissoesDesatualizadas({ sale, distribuicao, commissions: [linhaCaptadorOk], commissionExtras: [] });
    expect(desatualizado).toBe(false);
  });

  it("teste 5 — líder removido com linha automática antiga: aviso verdadeiro", () => {
    const linhaLiderVelha: OcorrenciaComissaoRow = { papel: "lider_captador", nome: "Líder Antigo", valor: 700, user_id: "lider-x", sale_commission_extra_id: null, managed_by_sale: true };
    const desatualizado = verificarComissoesDesatualizadas({ sale, distribuicao, commissions: [linhaCaptadorOk, linhaLiderVelha], commissionExtras: [] });
    expect(desatualizado).toBe(true);
  });

  it("teste 6 — captador líquido correto com linha manual adicional (extra independente): aviso falso", () => {
    const linhaManualOutroPapel: OcorrenciaComissaoRow = { papel: "outro", nome: "Ajuste avulso do financeiro", valor: 50, user_id: null, sale_commission_extra_id: null, managed_by_sale: false };
    const desatualizado = verificarComissoesDesatualizadas({ sale, distribuicao, commissions: [linhaCaptadorOk, linhaManualOutroPapel], commissionExtras: [] });
    expect(desatualizado).toBe(false);
  });

  it("teste 7 — captador automático com valor incorreto: aviso verdadeiro", () => {
    const linhaValorErrado = { ...linhaCaptadorOk, valor: 4000 };
    const desatualizado = verificarComissoesDesatualizadas({ sale, distribuicao, commissions: [linhaValorErrado], commissionExtras: [] });
    expect(desatualizado).toBe(true);
  });

  it("teste 8 — captador automático com user_id incorreto: aviso verdadeiro", () => {
    const linhaUserIdErrado = { ...linhaCaptadorOk, user_id: "outra-pessoa" };
    const desatualizado = verificarComissoesDesatualizadas({ sale, distribuicao, commissions: [linhaUserIdErrado], commissionExtras: [] });
    expect(desatualizado).toBe(true);
  });

  it("teste 9 — extra removido do Resumo mas linha ainda presente na Ocorrência: aviso verdadeiro", () => {
    const linhaExtraOrfa: OcorrenciaComissaoRow = { papel: "outro", nome: "Extra removido", valor: 200, user_id: null, sale_commission_extra_id: "extra-removido-1", managed_by_sale: true };
    const desatualizado = verificarComissoesDesatualizadas({ sale, distribuicao, commissions: [linhaCaptadorOk, linhaExtraOrfa], commissionExtras: [] });
    expect(desatualizado).toBe(true);
  });

  it("teste 10 — extra correto e uma linha manual independente: aviso falso", () => {
    const extra: SaleExtraRow = { id: "extra-1", papel: "outro", nome: "Extra Correto", valor: 200, user_id: null };
    const linhaExtraOk: OcorrenciaComissaoRow = { papel: "outro", nome: "Extra Correto", valor: 200, user_id: null, sale_commission_extra_id: "extra-1", managed_by_sale: true };
    const desatualizado = verificarComissoesDesatualizadas({ sale, distribuicao, commissions: [linhaCaptadorOk, linhaExtraOk, linhaManual], commissionExtras: [extra] });
    expect(desatualizado).toBe(false);
  });

  it("sem distribuição carregada ainda, não acusa nada (evita falso positivo durante o loading)", () => {
    const desatualizado = verificarComissoesDesatualizadas({ sale, distribuicao: null, commissions: [], commissionExtras: [] });
    expect(desatualizado).toBe(false);
  });

  it("parceria externa com captador interno vazio e R$ 0 não cria comissão sem vínculo", () => {
    const vendaComParceriaExterna = {
      ...sale,
      corretor_captador: null,
      corretor_captador_id: null,
      valor_comissao_captador: 0,
      parceria_tipo: "imobiliaria_externa",
      parceria_nome: "Bponto Imóveis",
      parceria_valor: 5550,
    };
    const desatualizado = verificarComissoesDesatualizadas({
      sale: vendaComParceriaExterna,
      distribuicao: { liquido_captador: 0, liquido_vendedor: null },
      commissions: [],
      commissionExtras: [],
    });
    expect(desatualizado).toBe(false);
  });
});

describe("deveSincronizarComissaoFixa", () => {
  it("ignora linha totalmente vazia mesmo quando o formulário envia zero", () => {
    expect(deveSincronizarComissaoFixa(null, 0, null)).toBe(false);
  });

  it("preserva linha que tenha nome, vínculo ou valor diferente de zero", () => {
    expect(deveSincronizarComissaoFixa("Captador", 0, null)).toBe(true);
    expect(deveSincronizarComissaoFixa(null, 0, "user-1")).toBe(true);
    expect(deveSincronizarComissaoFixa(null, 100, null)).toBe(true);
  });
});
