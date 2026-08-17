import { describe, it, expect } from "vitest";
import {
  classificarGrupoVenda,
  fatorComissaoPropria,
  GRUPO_VENDA_LABEL,
  STATUS_LABEL,
  type GrupoVenda,
  type SaleStatus,
} from "./status";

describe("fatorComissaoPropria — regra 15: parcelas de recebimento descontam a parceria externa", () => {
  it("sem parceria, a parcela inteira é da imobiliária (fator 1)", () => {
    expect(fatorComissaoPropria(43800, 0)).toBe(1);
  });

  it("comissão total zero ou não informada, fator neutro (1) — evita divisão por zero", () => {
    expect(fatorComissaoPropria(0, 0)).toBe(1);
    expect(fatorComissaoPropria(null, 0)).toBe(1);
    expect(fatorComissaoPropria(undefined, 0)).toBe(1);
  });

  it("cenário base (comissão R$43.800, parceria R$21.900): fator 0,5 — metade da parcela é nossa", () => {
    const fator = fatorComissaoPropria(43800, 21900);
    expect(fator).toBe(0.5);
    // Uma parcela prevista de R$10.000 brutos vira R$5.000 na coluna "nossa".
    expect(Number((10000 * fator).toFixed(2))).toBe(5000);
  });

  it("parceria igual à comissão inteira: fator 0 — nada sobra pra imobiliária", () => {
    expect(fatorComissaoPropria(43800, 43800)).toBe(0);
  });

  it("parceria maior que a comissão (dado inconsistente, regra 16): fator nunca fica negativo", () => {
    const fator = fatorComissaoPropria(43800, 60000);
    expect(fator).toBe(0);
    expect(fator).toBeGreaterThanOrEqual(0);
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
