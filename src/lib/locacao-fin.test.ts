import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lerContexto } from "./locacao";
import {
  CONFIG_FIN_PADRAO,
  competenciaLabel,
  devidoHoje,
  lerCobranca,
  lerConfigFin,
  lerContrato,
  lerPainelFin,
  mesDeslocado,
  montarExtrato,
  proprietarios,
  resumoPainel,
  type Cobranca,
} from "./locacao-fin";

// Locação Fase 2 — Financeiro parte 1 (t_be750361). O banco calcula; aqui só a leitura e os totais de exibição.

const base = {
  id: "c1",
  contrato_id: "k1",
  contrato_codigo: "CT-0001",
  competencia: "2026-11-01",
  vencimento: "2026-11-05",
  aluguel: 2000,
  condominio: 300,
  iptu: 50,
  taxa_adm: 10,
  valor: 2350,
  primeiro_aluguel: false,
  status: "aberta",
  situacao: "aberta",
  dias_atraso: 0,
  pago_em: null,
  valor_pago: null,
  multa: 0,
  juros: 0,
  inquilino_nome: "Inquilino Fictício",
  proprietario_nome: "Helena Exemplo (fictícia)",
  descontos: [],
};
const cob = (o: Record<string, unknown> = {}): Cobranca => lerCobranca({ ...base, ...o });

describe("leitura fechada", () => {
  it("regras: valores de exemplo quando nada vem do banco", () => {
    expect(lerConfigFin(null)).toEqual(CONFIG_FIN_PADRAO);
    expect(CONFIG_FIN_PADRAO).toMatchObject({
      multaPct: 10,
      jurosPctMes: 1,
      diasRepasse: 5,
      indice: "IGP-M",
      retemPrimeiroAluguel: true,
    });
  });
  it("regras: valor desconhecido cai no exemplo, valor válido é aceito", () => {
    const c = lerConfigFin({
      multa_pct: "2",
      multa_para: "hacker",
      indice: "IPCA",
      dias_repasse: 3,
    });
    expect(c.multaPct).toBe(2);
    expect(c.multaPara).toBe("proprietario");
    expect(c.indice).toBe("IPCA");
    expect(c.diasRepasse).toBe(3);
  });
  it("contrato: números vindos como texto do banco (numeric) viram número", () => {
    const k = lerContrato({ id: "k", situacao: "ativo", aluguel: "1900.00", dia_vencimento: 5 });
    expect(k.aluguel).toBe(1900);
    expect(k.situacao).toBe("ativo");
    expect(lerContrato({ situacao: "x" }).situacao).toBe("a_completar");
  });
  it("cobrança: repasse calculado e repasse feito", () => {
    const c = cob({
      status: "paga",
      situacao: "paga",
      pago_em: "2026-11-05",
      valor_pago: 2350,
      repasse_calc: {
        linhas: [
          { t: "Aluguel recebido", v: 2000 },
          { t: "Taxa de administração (10%)", v: -200 },
        ],
        total: 1800,
        previsto: "2026-11-10",
        retencao_primeiro: false,
      },
      repasse: { id: "r1", valor: 1800, feito_em: "2026-11-10", comprovante: "PIX-1" },
    });
    expect(c.repasseCalc?.total).toBe(1800);
    expect(c.repasse?.valor).toBe(1800);
    expect(c.taxaAdm).toBe(10);
  });
  it("contexto da Fase 1 aceita o papel 'financeiro' e ignora papel inventado", () => {
    expect(lerContexto({ papeis: ["financeiro", "diretor", "gestora"] }).papeis).toEqual([
      "financeiro",
      "gestora",
    ]);
  });
  it("painel vazio não quebra", () => {
    const p = lerPainelFin({});
    expect(p.cobrancas).toEqual([]);
    expect(p.faltamGerar).toBe(0);
    expect(p.podeRegras).toBe(false);
  });
});

describe("devido hoje e resumo do painel", () => {
  it("em atraso soma multa e juros de hoje; paga = valor pago; cancelada = 0", () => {
    expect(
      devidoHoje(cob({ situacao: "atraso", encargos_hoje: { multa: 200, juros: 6.67, dias: 10 } })),
    ).toBe(2556.67);
    expect(devidoHoje(cob({ status: "paga", situacao: "paga", valor_pago: 2400 }))).toBe(2400);
    expect(devidoHoje(cob({ status: "cancelada", situacao: "cancelada" }))).toBe(0);
  });

  it("a receber, recebido, em atraso, repasses e inadimplência", () => {
    const paga = cob({
      id: "p",
      status: "paga",
      situacao: "paga",
      pago_em: "2026-11-05",
      valor_pago: 2350,
      repasse_calc: { linhas: [], total: 1850, previsto: "2026-11-10", retencao_primeiro: false },
    });
    const pagaRepassada = cob({
      id: "pr",
      aluguel: 1000,
      valor: 1000,
      status: "paga",
      situacao: "paga",
      valor_pago: 1000,
      repasse_calc: { linhas: [], total: 0, previsto: "2026-11-10", retencao_primeiro: true },
      repasse: { id: "r", valor: 0, feito_em: "2026-11-10" },
    });
    const atraso = cob({
      id: "a",
      situacao: "atraso",
      dias_atraso: 4,
      encargos_hoje: { multa: 200, juros: 2.67, dias: 4 },
    });
    const aberta = cob({ id: "b", valor: 1500 });
    const cancelada = cob({ id: "x", status: "cancelada", situacao: "cancelada" });
    const antiga = cob({
      id: "o",
      situacao: "atraso",
      valor: 1000,
      encargos_hoje: { multa: 0, juros: 0, dias: 40 },
    });
    const t = resumoPainel([paga, pagaRepassada, atraso, aberta, cancelada], [antiga]);
    expect(t.aReceber).toBe(1500);
    expect(t.recebido).toBe(3350);
    expect(t.emAtraso).toBe(2552.67 + 1000);
    expect(t.qtdAtraso).toBe(2);
    expect(t.repassesTotal).toBe(1850);
    expect(t.repassesPendentes).toBe(1850);
    expect(t.qtdRepassePendente).toBe(1);
    expect(t.taxasImobiliaria).toBe(200 + 1000); // 10% de 2.000 + 1º aluguel retido de 1.000
    // inadimplência só do mês: 2.350 em atraso ÷ (2.350 + 1.000 + 2.350 + 1.500) cobrados (cancelada fora)
    expect(t.inadimplenciaPct).toBe(Math.round((2350 / 7200) * 10000) / 100);
  });
});

describe("extrato do proprietário", () => {
  it("lança as linhas de cada pagamento e o repasse, com saldo corrido", () => {
    const c1 = cob({
      id: "1",
      competencia: "2026-10-01",
      status: "paga",
      situacao: "paga",
      pago_em: "2026-10-05",
      valor_pago: 2350,
      repasse_calc: {
        linhas: [
          { t: "Aluguel recebido", v: 2000 },
          { t: "Taxa de administração (10%)", v: -200 },
          { t: "IPTU cobrado do inquilino", v: 50 },
        ],
        total: 1850,
        previsto: "2026-10-10",
      },
      repasse: { id: "r1", valor: 1850, feito_em: "2026-10-10", comprovante: "PIX-1" },
    });
    const c2 = cob({
      id: "2",
      status: "paga",
      situacao: "paga",
      pago_em: "2026-11-06",
      valor_pago: 2350,
      repasse_calc: {
        linhas: [
          { t: "Aluguel recebido", v: 2000 },
          { t: "Taxa de administração (10%)", v: -200 },
          { t: "Desconto: conserto", v: -180 },
        ],
        total: 1620,
        previsto: "2026-11-11",
      },
    });
    const aberta = cob({ id: "3" });
    const e = montarExtrato([c2, aberta, c1]);
    expect(e.map((l) => l.descricao)).toEqual([
      "Aluguel recebido",
      "Taxa de administração (10%)",
      "IPTU cobrado do inquilino",
      "Repasse feito (PIX-1)",
      "Aluguel recebido",
      "Taxa de administração (10%)",
      "Desconto: conserto",
    ]);
    expect(e[3].saldo).toBe(0);
    expect(e[e.length - 1].saldo).toBe(1620);
  });

  it("proprietários distintos ignorando maiúsculas/espaços", () => {
    const k = (nome: string) => lerContrato({ proprietario_nome: nome });
    expect(proprietarios([k("Helena"), k(" helena "), k("Otávio"), k("")])).toEqual([
      "Helena",
      "Otávio",
    ]);
  });
});

describe("competência", () => {
  it("rótulo e deslocamento de mês (virada de ano)", () => {
    expect(competenciaLabel("2026-11-01")).toBe("nov/2026");
    expect(mesDeslocado("2026-12-01", 1)).toBe("2027-01-01");
    expect(mesDeslocado("2026-01-15", -1)).toBe("2025-12-01");
  });
});

describe("tela e escopo", () => {
  const tela = readFileSync("src/components/locacao/LocacaoFinanceiro.tsx", "utf8");
  const mig = readFileSync(
    "supabase/migrations/20261111120000_locacao_fase2_financeiro.sql",
    "utf8",
  );
  it("não chama Itaú, boleto, Pix nem envio de mensagem (fora do escopo)", () => {
    for (const proibido of [/itau/i, /boleto_?gerar/i, /ziontalk/i, /sendMessage/i, /fetch\(/]) {
      expect(tela).not.toMatch(proibido);
    }
    expect(mig).not.toMatch(/net\.http|http_post|pg_net/i);
  });
  it("papel 'financeiro' é da locação (locacao_papeis), não a app_role global", () => {
    expect(mig).toMatch(/CHECK \(papel IN \('gestora', 'contratos', 'vistoria', 'financeiro'\)\)/);
    expect(mig).toMatch(/locacao_tem_papel\(auth\.uid\(\), 'financeiro'\)/);
    expect(mig).not.toMatch(/ARRAY\['financeiro'\]::public\.app_role\[\]\)\s*\n?\s*THEN/);
  });
  it("regras marcadas como 'a confirmar' na tela", () => {
    expect((tela.match(/<AConfirmar \/>/g) ?? []).length).toBeGreaterThanOrEqual(10);
  });
});
