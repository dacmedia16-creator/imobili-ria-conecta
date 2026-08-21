import { describe, it, expect } from "vitest";
import {
  diasEntre,
  classificarSituacaoParcela,
  classificarFaixaAging,
  montarParcela,
  montarComissaoCalculada,
  aplicarFiltrosParcelas,
  aplicarFiltrosComissoes,
  aplicarFiltrosEfetivacao,
  calcularAging,
  agruparComissoes,
  calcularResumo,
  agruparParcelasPorMes,
  podeAcessarCentralFinanceira,
  classificarVinculoBeneficiario,
  normalizarNomeParaCorrespondencia,
} from "./financeiro-dashboard-calc";
import type {
  ComissaoCalculada,
  EfetivacaoVenda,
  FinanceiroFiltros,
  ParcelaRecebimento,
} from "./financeiro-dashboard-types";

const HOJE = "2026-08-16";

function filtrosPadrao(): FinanceiroFiltros {
  return {
    dataDe: "",
    dataAte: "",
    modalidade: "todas",
    corretorId: null,
    gestorId: null,
    teamId: null,
    papel: null,
    situacaoRecebimento: "todas",
    busca: "",
    incluirCanceladas: false,
  };
}

function parcelaBase(overrides: Partial<Parameters<typeof montarParcela>[0]> = {}) {
  return montarParcela({
    saleId: "sale-1",
    occId: "occ-1",
    parcela: 1,
    imovelLabel: "Casa 1",
    codigoInterno: "COD-1",
    corretorId: "corretor-1",
    corretorNome: "Fulano",
    teamId: "team-1",
    teamNome: "Equipe A",
    gestorId: "gestor-1",
    gestorNome: "Gestora",
    saleStatus: "ocorrencia_analise_financeiro",
    modalidade: "padrao",
    cancelada: false,
    dataPrevista: "2026-08-20",
    formaPrevista: "PIX",
    valorBrutoPrevisto: 10000,
    dataRecebimento: null,
    valorRecebido: null,
    hoje: HOJE,
    ...overrides,
  });
}

// ---- controle de acesso: financeiro/admin/super_admin têm acesso, os demais papéis não. Mesma
// função usada pelo item de menu (AppShell.tsx) e pelo beforeLoad da rota (financeiro.tsx) — ver
// comentário em podeAcessarCentralFinanceira. Espelha exatamente
// comparativo-comissao-calc.test.ts's "podeAcessarComparativo6pct — controle de acesso". ----
describe("podeAcessarCentralFinanceira — controle de acesso", () => {
  it.each([["admin"], ["super_admin"], ["financeiro"]] as const)("libera %s", (papel) => {
    expect(podeAcessarCentralFinanceira([papel])).toBe(true);
  });
  it.each([["corretor"], ["gestor"], ["team_leader"], ["juridico"], ["lancamento"]] as const)(
    "bloqueia %s",
    (papel) => {
      expect(podeAcessarCentralFinanceira([papel])).toBe(false);
    },
  );
  it("bloqueia usuário sem nenhum papel", () => {
    expect(podeAcessarCentralFinanceira([])).toBe(false);
  });
  it("libera se pelo menos um dos papéis do usuário for autorizado (papéis acumulados)", () => {
    expect(podeAcessarCentralFinanceira(["corretor", "financeiro"])).toBe(true);
  });
  // Prova de "demais perfis não veem o menu nem acessam /financeiro": um usuário com VÁRIOS papéis
  // não-financeiros ao mesmo tempo (cenário real — corretor que também é gestor/team_leader/
  // jurídico) continua bloqueado. Esta é a MESMA função chamada por AppShell.tsx (show do item de
  // menu) e por financeiro.tsx (beforeLoad da rota) — ver import em ambos os arquivos — então cobrir
  // essa função aqui cobre as duas superfícies (menu e acesso direto pela URL) de uma vez.
  it("bloqueia mesmo acumulando vários papéis não-financeiros ao mesmo tempo", () => {
    expect(podeAcessarCentralFinanceira(["corretor", "gestor", "team_leader", "juridico"])).toBe(
      false,
    );
  });
});

describe("normalizarNomeParaCorrespondencia", () => {
  it("apara espaço e ignora maiúsculas/minúsculas", () => {
    expect(normalizarNomeParaCorrespondencia("Gustavo Fuentes ")).toBe(
      normalizarNomeParaCorrespondencia("gustavo fuentes"),
    );
  });
});

// ---- achado da auditoria de Divergências: classificar por que falta vínculo sem nunca inferir
// "externo" só pela ausência de correspondência (regra explícita pedida na homologação). ----
describe("classificarVinculoBeneficiario", () => {
  it("1 correspondência única no nome → vínculo pendente", () => {
    const c = classificarVinculoBeneficiario({
      marcadoExplicitamenteExterno: false,
      correspondenciasNoNome: 1,
    });
    expect(c.classificacao).toBe("vinculo_pendente");
    expect(c.tipo).toBe("Usuário correspondente encontrado — vínculo pendente");
  });
  it("0 correspondências e sem marcação explícita → sem correspondência, nunca 'externo'", () => {
    const c = classificarVinculoBeneficiario({
      marcadoExplicitamenteExterno: false,
      correspondenciasNoNome: 0,
    });
    expect(c.classificacao).toBe("sem_correspondencia");
    expect(c.tipo).toBe("Sem correspondência — revisão necessária");
  });
  it("2+ correspondências (nome duplicado/ambíguo) → sem correspondência, não escolhe uma", () => {
    const c = classificarVinculoBeneficiario({
      marcadoExplicitamenteExterno: false,
      correspondenciasNoNome: 2,
    });
    expect(c.classificacao).toBe("sem_correspondencia");
  });
  it("marcado explicitamente como externo → externo_explicito, mesmo com 0 correspondências", () => {
    const c = classificarVinculoBeneficiario({
      marcadoExplicitamenteExterno: true,
      correspondenciasNoNome: 0,
    });
    expect(c.classificacao).toBe("externo_explicito");
    expect(c.tipo).toBe("Beneficiário externo sem usuário");
  });
  it("marcação explícita como externo tem prioridade sobre qualquer contagem de nome", () => {
    const c = classificarVinculoBeneficiario({
      marcadoExplicitamenteExterno: true,
      correspondenciasNoNome: 1,
    });
    expect(c.classificacao).toBe("externo_explicito");
  });
});

// ---- diasEntre: sem erro de fuso horário ----
describe("diasEntre — datas normalizadas, sem deslocamento de fuso", () => {
  it("mesma data = 0", () => expect(diasEntre("2026-08-16", "2026-08-16")).toBe(0));
  it("um dia à frente = 1", () => expect(diasEntre("2026-08-16", "2026-08-17")).toBe(1));
  it("um dia atrás = -1", () => expect(diasEntre("2026-08-16", "2026-08-15")).toBe(-1));
  it("atravessa virada de mês/ano", () => expect(diasEntre("2025-12-31", "2026-01-01")).toBe(1));
  it("ignora horário embutido no timestamp", () =>
    expect(diasEntre("2026-08-16T23:59:59.000Z", "2026-08-17T00:00:01.000Z")).toBe(1));
});

// ---- item 3: previsto, recebido, parcial, vencido e a vencer ----
describe("classificarSituacaoParcela", () => {
  it("sem data prevista → sem_previsao", () => {
    expect(
      classificarSituacaoParcela({
        cancelada: false,
        dataPrevista: null,
        valorLiquidoPrevisto: 100,
        dataRecebimento: null,
        valorRecebido: null,
        hoje: HOJE,
      }),
    ).toBe("sem_previsao");
  });
  it("data futura sem recebimento → a_vencer", () => {
    expect(
      classificarSituacaoParcela({
        cancelada: false,
        dataPrevista: "2026-09-01",
        valorLiquidoPrevisto: 100,
        dataRecebimento: null,
        valorRecebido: null,
        hoje: HOJE,
      }),
    ).toBe("a_vencer");
  });
  it("data passada sem recebimento → vencido", () => {
    expect(
      classificarSituacaoParcela({
        cancelada: false,
        dataPrevista: "2026-08-01",
        valorLiquidoPrevisto: 100,
        dataRecebimento: null,
        valorRecebido: null,
        hoje: HOJE,
      }),
    ).toBe("vencido");
  });
  it("recebido no valor exato → recebido", () => {
    expect(
      classificarSituacaoParcela({
        cancelada: false,
        dataPrevista: "2026-08-01",
        valorLiquidoPrevisto: 100,
        dataRecebimento: "2026-08-05",
        valorRecebido: 100,
        hoje: HOJE,
      }),
    ).toBe("recebido");
  });
  it("recebido dentro da tolerância de R$0,01 → recebido", () => {
    expect(
      classificarSituacaoParcela({
        cancelada: false,
        dataPrevista: "2026-08-01",
        valorLiquidoPrevisto: 100,
        dataRecebimento: "2026-08-05",
        valorRecebido: 100.01,
        hoje: HOJE,
      }),
    ).toBe("recebido");
  });
  it("recebido menor que o previsto (diferença > R$0,01) → recebido_parcial", () => {
    expect(
      classificarSituacaoParcela({
        cancelada: false,
        dataPrevista: "2026-08-01",
        valorLiquidoPrevisto: 100,
        dataRecebimento: "2026-08-05",
        valorRecebido: 60,
        hoje: HOJE,
      }),
    ).toBe("recebido_parcial");
  });
  it("recebido maior que o previsto (diferença > R$0,01) → recebido_diferenca", () => {
    expect(
      classificarSituacaoParcela({
        cancelada: false,
        dataPrevista: "2026-08-01",
        valorLiquidoPrevisto: 100,
        dataRecebimento: "2026-08-05",
        valorRecebido: 150,
        hoje: HOJE,
      }),
    ).toBe("recebido_diferenca");
  });
  it("cancelada sempre vence sobre qualquer outra classificação", () => {
    expect(
      classificarSituacaoParcela({
        cancelada: true,
        dataPrevista: "2026-08-01",
        valorLiquidoPrevisto: 100,
        dataRecebimento: "2026-08-05",
        valorRecebido: 100,
        hoje: HOJE,
      }),
    ).toBe("cancelado_arquivado");
  });
});

// ---- item 8: faixas de aging nas datas-limite ----
describe("classificarFaixaAging — limites de cada faixa", () => {
  it("vence hoje", () => expect(classificarFaixaAging("2026-08-16", HOJE)).toBe("vence_hoje"));
  it("vence em 1 dia → prox_7", () =>
    expect(classificarFaixaAging("2026-08-17", HOJE)).toBe("prox_7"));
  it("vence em 7 dias (limite) → prox_7", () =>
    expect(classificarFaixaAging("2026-08-23", HOJE)).toBe("prox_7"));
  it("vence em 8 dias → prox_30", () =>
    expect(classificarFaixaAging("2026-08-24", HOJE)).toBe("prox_30"));
  it("vence em 30 dias (limite) → prox_30", () =>
    expect(classificarFaixaAging("2026-09-15", HOJE)).toBe("prox_30"));
  it("vence em 31 dias → d31_60", () =>
    expect(classificarFaixaAging("2026-09-16", HOJE)).toBe("d31_60"));
  it("vence em 61 dias → d61_90", () =>
    expect(classificarFaixaAging("2026-10-16", HOJE)).toBe("d61_90"));
  it("vence em 91 dias → acima_90", () =>
    expect(classificarFaixaAging("2026-11-15", HOJE)).toBe("acima_90"));
  it("venceu há 1 dia → venc_1_7", () =>
    expect(classificarFaixaAging("2026-08-15", HOJE)).toBe("venc_1_7"));
  it("venceu há 7 dias (limite) → venc_1_7", () =>
    expect(classificarFaixaAging("2026-08-09", HOJE)).toBe("venc_1_7"));
  it("venceu há 8 dias → venc_8_15", () =>
    expect(classificarFaixaAging("2026-08-08", HOJE)).toBe("venc_8_15"));
  it("venceu há 16 dias → venc_16_30", () =>
    expect(classificarFaixaAging("2026-07-31", HOJE)).toBe("venc_16_30"));
  it("venceu há 31 dias → venc_31_60", () =>
    expect(classificarFaixaAging("2026-07-16", HOJE)).toBe("venc_31_60"));
  it("venceu há 61 dias → venc_mais_60", () =>
    expect(classificarFaixaAging("2026-06-16", HOJE)).toBe("venc_mais_60"));
});

// ---- item 2: prev_recebimento já é a fatia própria, sem desconto de parceria em cima dela ----
describe("montarParcela — valor previsto já é a fatia própria", () => {
  it("líquido previsto = bruto previsto, sem parceria embutida", () => {
    const p = parcelaBase({ valorBrutoPrevisto: 10000 });
    expect(p.valorLiquidoPrevisto).toBe(10000);
    expect(p.valorParceria).toBe(0);
  });
});

// ---- item 6: comissão manual preservada e identificada ----
describe("montarComissaoCalculada — origem e vínculo", () => {
  it("managed_by_sale=true → origem automática", () => {
    const c = montarComissaoCalculada({
      id: "c1",
      saleId: "s1",
      occId: "o1",
      imovelLabel: "Casa 1",
      codigoInterno: "C1",
      dataEfetivacao: "2026-08-01",
      modalidade: "padrao",
      saleCorretorId: "corretor-1",
      teamId: null,
      teamNome: null,
      gestorId: null,
      gestorNome: null,
      papel: "corretor_captador",
      beneficiarioNome: "Fulano",
      beneficiarioUserId: "u1",
      percentual: 3,
      valor: 1000,
      managedBySale: true,
      parcelasDaVenda: [],
    });
    expect(c.origem).toBe("automatica");
  });
  it("managed_by_sale=false → origem manual, nunca reclassificada", () => {
    const c = montarComissaoCalculada({
      id: "c2",
      saleId: "s1",
      occId: "o1",
      imovelLabel: "Casa 1",
      codigoInterno: "C1",
      dataEfetivacao: "2026-08-01",
      modalidade: "padrao",
      saleCorretorId: "corretor-1",
      teamId: null,
      teamNome: null,
      gestorId: null,
      gestorNome: null,
      papel: "outro",
      beneficiarioNome: "Ajuste manual",
      beneficiarioUserId: null,
      percentual: null,
      valor: 500,
      managedBySale: false,
      parcelasDaVenda: [],
    });
    expect(c.origem).toBe("manual");
  });

  // ---- item 7: beneficiário sem user_id tratado como divergência ----
  it("papel com vínculo esperado (corretor_captador) sem user_id → semVinculoUsuario", () => {
    const c = montarComissaoCalculada({
      id: "c3",
      saleId: "s1",
      occId: "o1",
      imovelLabel: "Casa 1",
      codigoInterno: "C1",
      dataEfetivacao: "2026-08-01",
      modalidade: "padrao",
      saleCorretorId: "corretor-1",
      teamId: null,
      teamNome: null,
      gestorId: null,
      gestorNome: null,
      papel: "corretor_captador",
      beneficiarioNome: "Fulano",
      beneficiarioUserId: null,
      percentual: 3,
      valor: 1000,
      managedBySale: true,
      parcelasDaVenda: [],
    });
    expect(c.semVinculoUsuario).toBe(true);
  });
  it("indicador (sem vínculo esperado) sem user_id → não é divergência", () => {
    const c = montarComissaoCalculada({
      id: "c4",
      saleId: "s1",
      occId: "o1",
      imovelLabel: "Casa 1",
      codigoInterno: "C1",
      dataEfetivacao: "2026-08-01",
      modalidade: "padrao",
      saleCorretorId: "corretor-1",
      teamId: null,
      teamNome: null,
      gestorId: null,
      gestorNome: null,
      papel: "indicador_captador",
      beneficiarioNome: "Fulano",
      beneficiarioUserId: null,
      percentual: null,
      valor: 200,
      managedBySale: true,
      parcelasDaVenda: [],
    });
    expect(c.semVinculoUsuario).toBe(false);
  });

  // Achado real de QA: "Gustavo Fuentes" e "Gustavo Fuentes " (espaço a mais, digitado no
  // cadastro) apareciam como dois beneficiários diferentes no agrupamento — o nome tem que ser
  // aparado na origem, não só no ponto de agrupamento.
  it("nome do beneficiário com espaço a mais é aparado (não vira uma pessoa diferente ao agrupar)", () => {
    const c = montarComissaoCalculada({
      id: "c-trim",
      saleId: "s1",
      occId: "o1",
      imovelLabel: "Casa 1",
      codigoInterno: "C1",
      dataEfetivacao: "2026-08-01",
      modalidade: "padrao",
      saleCorretorId: "corretor-1",
      teamId: null,
      teamNome: null,
      gestorId: null,
      gestorNome: null,
      papel: "corretor_captador",
      beneficiarioNome: "Gustavo Fuentes ",
      beneficiarioUserId: null,
      percentual: 3,
      valor: 1000,
      managedBySale: true,
      parcelasDaVenda: [],
    });
    expect(c.beneficiarioNome).toBe("Gustavo Fuentes");
  });

  it("situação do recebimento: nenhuma parcela recebida → nao_recebido", () => {
    const c = montarComissaoCalculada({
      id: "c5",
      saleId: "s1",
      occId: "o1",
      imovelLabel: "Casa 1",
      codigoInterno: "C1",
      dataEfetivacao: "2026-08-01",
      modalidade: "padrao",
      saleCorretorId: "corretor-1",
      teamId: null,
      teamNome: null,
      gestorId: null,
      gestorNome: null,
      papel: "outro",
      beneficiarioNome: "X",
      beneficiarioUserId: null,
      percentual: null,
      valor: 100,
      managedBySale: true,
      parcelasDaVenda: [{ dataRecebimento: null }, { dataRecebimento: null }],
    });
    expect(c.situacaoRecebimentoVenda).toBe("nao_recebido");
  });
  it("situação do recebimento: todas as parcelas recebidas → recebido", () => {
    const c = montarComissaoCalculada({
      id: "c6",
      saleId: "s1",
      occId: "o1",
      imovelLabel: "Casa 1",
      codigoInterno: "C1",
      dataEfetivacao: "2026-08-01",
      modalidade: "padrao",
      saleCorretorId: "corretor-1",
      teamId: null,
      teamNome: null,
      gestorId: null,
      gestorNome: null,
      papel: "outro",
      beneficiarioNome: "X",
      beneficiarioUserId: null,
      percentual: null,
      valor: 100,
      managedBySale: true,
      parcelasDaVenda: [{ dataRecebimento: "2026-08-10" }],
    });
    expect(c.situacaoRecebimentoVenda).toBe("recebido");
  });
  it("situação do recebimento: parte recebida → parcial", () => {
    const c = montarComissaoCalculada({
      id: "c7",
      saleId: "s1",
      occId: "o1",
      imovelLabel: "Casa 1",
      codigoInterno: "C1",
      dataEfetivacao: "2026-08-01",
      modalidade: "padrao",
      saleCorretorId: "corretor-1",
      teamId: null,
      teamNome: null,
      gestorId: null,
      gestorNome: null,
      papel: "outro",
      beneficiarioNome: "X",
      beneficiarioUserId: null,
      percentual: null,
      valor: 100,
      managedBySale: true,
      parcelasDaVenda: [{ dataRecebimento: "2026-08-10" }, { dataRecebimento: null }],
    });
    expect(c.situacaoRecebimentoVenda).toBe("parcial");
  });
});

// ---- item 1 + 10: exclusão de cancelada/arquivada sem contaminar previsão ----
describe("aplicarFiltrosParcelas — cancelada/arquivada e demais filtros", () => {
  it("exclui cancelada por padrão", () => {
    const cancelada = parcelaBase({ cancelada: true, saleStatus: "cancelada" });
    const ativa = parcelaBase({ occId: "occ-2" });
    const resultado = aplicarFiltrosParcelas([cancelada, ativa], filtrosPadrao());
    expect(resultado).toEqual([ativa]);
  });
  it("inclui cancelada quando incluirCanceladas=true", () => {
    const cancelada = parcelaBase({ cancelada: true, saleStatus: "cancelada" });
    const resultado = aplicarFiltrosParcelas([cancelada], {
      ...filtrosPadrao(),
      incluirCanceladas: true,
    });
    expect(resultado).toHaveLength(1);
  });
  it("filtra por período (data prevista)", () => {
    const dentro = parcelaBase({ dataPrevista: "2026-08-10" });
    const fora = parcelaBase({ occId: "occ-2", dataPrevista: "2026-09-10" });
    const resultado = aplicarFiltrosParcelas([dentro, fora], {
      ...filtrosPadrao(),
      dataDe: "2026-08-01",
      dataAte: "2026-08-31",
    });
    expect(resultado).toEqual([dentro]);
  });
  it("filtra por situação de recebimento", () => {
    const vencida = parcelaBase({ dataPrevista: "2026-08-01" });
    const aVencer = parcelaBase({ occId: "occ-2", dataPrevista: "2026-09-01" });
    const resultado = aplicarFiltrosParcelas([vencida, aVencer], {
      ...filtrosPadrao(),
      situacaoRecebimento: "vencido",
    });
    expect(resultado).toEqual([vencida]);
  });
  it("busca por código interno ou imóvel", () => {
    const p = parcelaBase({ codigoInterno: "ABC-123" });
    expect(aplicarFiltrosParcelas([p], { ...filtrosPadrao(), busca: "abc" })).toEqual([p]);
    expect(aplicarFiltrosParcelas([p], { ...filtrosPadrao(), busca: "zzz" })).toEqual([]);
  });
});

// ---- item 11: exportação refletindo os filtros (mesma função usada pela tabela e pelo CSV) ----
describe("aplicarFiltrosComissoes / aplicarFiltrosEfetivacao — mesma fonte da tabela e do CSV", () => {
  const comissao: ComissaoCalculada = {
    id: "c1",
    saleId: "s1",
    occId: "o1",
    imovelLabel: "Casa 1",
    codigoInterno: "COD-1",
    dataEfetivacao: "2026-08-10",
    modalidade: "lancamento",
    saleCorretorId: "corretor-1",
    papel: "corretor_vendedor",
    beneficiarioNome: "Fulano",
    beneficiarioUserId: "u1",
    teamId: "team-1",
    teamNome: "Equipe A",
    gestorId: "gestor-1",
    gestorNome: "Gestora",
    percentual: 4,
    valor: 1000,
    origem: "automatica",
    semVinculoUsuario: false,
    situacaoRecebimentoVenda: "recebido",
  };
  it("modalidade filtra igual em comissões e efetivadas", () => {
    expect(
      aplicarFiltrosComissoes([comissao], { ...filtrosPadrao(), modalidade: "padrao" }),
    ).toEqual([]);
    expect(
      aplicarFiltrosComissoes([comissao], { ...filtrosPadrao(), modalidade: "lancamento" }),
    ).toEqual([comissao]);
  });
  it("filtro de papel só afeta Comissões Calculadas", () => {
    expect(aplicarFiltrosComissoes([comissao], { ...filtrosPadrao(), papel: "gestor" })).toEqual(
      [],
    );
    expect(
      aplicarFiltrosComissoes([comissao], { ...filtrosPadrao(), papel: "corretor_vendedor" }),
    ).toEqual([comissao]);
  });

  const efetivacao: EfetivacaoVenda = {
    saleId: "s1",
    imovelLabel: "Casa 1",
    codigoInterno: "COD-1",
    dataEfetivacao: "2026-08-10",
    modalidade: "lancamento",
    corretorId: "corretor-1",
    teamId: "team-1",
    gestorId: "gestor-1",
    valorNegociado: 300000,
    valorTotalComissao: 12000,
  };
  it("período/modalidade filtram efetivadas do mesmo jeito que comissões", () => {
    expect(
      aplicarFiltrosEfetivacao([efetivacao], { ...filtrosPadrao(), dataDe: "2026-09-01" }),
    ).toEqual([]);
    expect(
      aplicarFiltrosEfetivacao([efetivacao], { ...filtrosPadrao(), modalidade: "lancamento" }),
    ).toEqual([efetivacao]);
  });
});

// ---- item 8: aging agrupado sem duplicar/perder parcelas ----
describe("calcularAging", () => {
  it("separa a_vencer e vencido nas faixas certas, ignora recebido/sem_previsao", () => {
    const parcelas: ParcelaRecebimento[] = [
      parcelaBase({ occId: "o1", dataPrevista: "2026-08-17" }), // a_vencer, prox_7
      parcelaBase({ occId: "o2", dataPrevista: "2026-08-01" }), // vencido, venc_1_7..30
      parcelaBase({
        occId: "o3",
        dataPrevista: "2026-08-05",
        dataRecebimento: "2026-08-05",
        valorRecebido: 10000,
      }), // recebido, fora do aging
    ];
    const { aVencer, vencido } = calcularAging(parcelas, HOJE);
    const totalParcelasNasFaixas = [...aVencer, ...vencido].reduce((s, f) => s + f.quantidade, 0);
    expect(totalParcelasNasFaixas).toBe(2);
    expect(aVencer.find((f) => f.key === "prox_7")?.quantidade).toBe(1);
  });
});

// ---- item 5: agrupamento por beneficiário, gestor, equipe, papel, mês e geral ----
describe("agruparComissoes", () => {
  const rows: ComissaoCalculada[] = [
    {
      id: "c1",
      saleId: "s1",
      occId: "o1",
      imovelLabel: "Casa 1",
      codigoInterno: "C1",
      dataEfetivacao: "2026-08-10",
      modalidade: "padrao",
      saleCorretorId: "corretor-1",
      papel: "corretor_captador",
      beneficiarioNome: "Fulano",
      beneficiarioUserId: "u1",
      teamId: "team-1",
      teamNome: "Equipe A",
      gestorId: "gestor-1",
      gestorNome: "Gestora",
      percentual: 3,
      valor: 1000,
      origem: "automatica",
      semVinculoUsuario: false,
      situacaoRecebimentoVenda: "recebido",
    },
    {
      id: "c2",
      saleId: "s2",
      occId: "o2",
      imovelLabel: "Casa 2",
      codigoInterno: "C2",
      dataEfetivacao: "2026-09-05",
      modalidade: "padrao",
      saleCorretorId: "corretor-1",
      papel: "corretor_captador",
      beneficiarioNome: "Fulano",
      beneficiarioUserId: "u1",
      teamId: "team-1",
      teamNome: "Equipe A",
      gestorId: "gestor-1",
      gestorNome: "Gestora",
      percentual: 3,
      valor: 500,
      origem: "automatica",
      semVinculoUsuario: false,
      situacaoRecebimentoVenda: "nao_recebido",
    },
  ];
  it("agrupa por beneficiário somando os valores", () => {
    const grupos = agruparComissoes(rows, "beneficiario");
    expect(grupos).toHaveLength(1);
    expect(grupos[0].quantidade).toBe(2);
    expect(grupos[0].valorTotal).toBe(1500);
  });
  it("agrupa por mês (mês da data de efetivação)", () => {
    const grupos = agruparComissoes(rows, "mes");
    expect(grupos.map((g) => g.chave).sort()).toEqual(["2026-08", "2026-09"]);
  });
  it("geral sempre produz um único grupo com o total", () => {
    const grupos = agruparComissoes(rows, "geral");
    expect(grupos).toHaveLength(1);
    expect(grupos[0].valorTotal).toBe(1500);
  });
});

// ---- item 12: cards, tabela e gráfico produzindo o mesmo total ----
describe("calcularResumo / agruparParcelasPorMes — mesma base que a tabela", () => {
  it("previstoImobiliaria do resumo bate com a soma manual das mesmas parcelas ativas", () => {
    const parcelas = [
      parcelaBase({ occId: "o1", valorBrutoPrevisto: 10000 }),
    ];
    const resumo = calcularResumo({
      parcelas,
      comissoes: [],
      efetivadas: [],
      divergenciasAbertas: 0,
      hoje: HOJE,
    });
    const somaManual = parcelas.reduce((s, p) => s + p.valorLiquidoPrevisto, 0);
    expect(resumo.previstoImobiliaria).toBeCloseTo(somaManual, 2);
  });
  it("vgvEfetivado/comissaoBruta do resumo somam exatamente as EfetivacaoVenda passadas", () => {
    const efetivadas: EfetivacaoVenda[] = [
      {
        saleId: "s1",
        imovelLabel: "Casa 1",
        codigoInterno: null,
        dataEfetivacao: "2026-08-01",
        modalidade: "padrao",
        corretorId: "c1",
        teamId: null,
        gestorId: null,
        valorNegociado: 100000,
        valorTotalComissao: 6000,
      },
      {
        saleId: "s2",
        imovelLabel: "Casa 2",
        codigoInterno: null,
        dataEfetivacao: "2026-08-05",
        modalidade: "padrao",
        corretorId: "c1",
        teamId: null,
        gestorId: null,
        valorNegociado: 50000,
        valorTotalComissao: 3000,
      },
    ];
    const resumo = calcularResumo({
      parcelas: [],
      comissoes: [],
      efetivadas,
      divergenciasAbertas: 0,
      hoje: HOJE,
    });
    expect(resumo.vgvEfetivado).toBe(150000);
    expect(resumo.comissaoBruta).toBe(9000);
  });
  it("gráfico previsto x recebido por mês soma o mesmo total das parcelas do resumo", () => {
    const parcelas = [
      parcelaBase({
        occId: "o1",
        dataPrevista: "2026-08-10",
        valorBrutoPrevisto: 10000,
      }),
      parcelaBase({
        occId: "o2",
        dataPrevista: "2026-08-20",
        valorBrutoPrevisto: 5000,
        dataRecebimento: "2026-08-21",
        valorRecebido: 5000,
      }),
    ];
    const porMes = agruparParcelasPorMes(parcelas);
    const resumo = calcularResumo({
      parcelas,
      comissoes: [],
      efetivadas: [],
      divergenciasAbertas: 0,
      hoje: HOJE,
    });
    expect(porMes.find((m) => m.mes === "2026-08")?.previsto).toBeCloseTo(
      resumo.previstoImobiliaria,
      2,
    );
    expect(porMes.find((m) => m.mes === "2026-08")?.recebido).toBeCloseTo(
      resumo.recebidoImobiliaria,
      2,
    );
  });
});
