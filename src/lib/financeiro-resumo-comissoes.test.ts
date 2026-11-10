import { describe, it, expect } from "vitest";
import {
  comissaoRecebidaPelaImobiliaria,
  montarComissaoCalculada,
  resumirComissoesPorPeriodo,
} from "./financeiro-dashboard-calc";
import type { ComissaoCalculada } from "./financeiro-dashboard-types";

// Dados fictícios (sem clientes reais).
function linha(
  p: Partial<ComissaoCalculada> & { id: string; saleId: string; valor: number },
): ComissaoCalculada {
  return {
    occId: `o-${p.saleId}`,
    imovelLabel: "Imóvel teste",
    codigoInterno: null,
    dataEfetivacao: "2026-10-10",
    modalidade: "padrao",
    saleCorretorId: "corretor-1",
    papel: "corretor_vendedor",
    beneficiarioNome: "Pessoa Teste",
    beneficiarioUserId: "u1",
    teamId: "team-a",
    teamNome: "Equipe A",
    gestorId: null,
    gestorNome: null,
    percentual: null,
    origem: "automatica",
    semVinculoUsuario: false,
    situacaoRecebimentoVenda: "nao_recebido",
    ...p,
  };
}

const base = {
  id: "c1",
  saleId: "s1",
  occId: "o1",
  imovelLabel: "Casa",
  codigoInterno: null,
  dataEfetivacao: "2026-10-01",
  modalidade: "padrao",
  saleCorretorId: "c",
  teamId: null,
  teamNome: null,
  gestorId: null,
  gestorNome: null,
  papel: "corretor_vendedor",
  beneficiarioNome: "Pessoa",
  beneficiarioUserId: "u1",
  percentual: null,
  valor: 1000,
  managedBySale: true,
};

describe("fração recebida da venda (por valor previsto da parcela)", () => {
  it("parcial pesa pelo valor, não pela quantidade de parcelas", () => {
    const c = montarComissaoCalculada({
      ...base,
      parcelasDaVenda: [
        { dataRecebimento: "2026-10-05", valor: 8000 },
        { dataRecebimento: null, valor: 2000 },
      ],
    });
    expect(c.situacaoRecebimentoVenda).toBe("parcial");
    expect(c.fracaoRecebidaVenda).toBeCloseTo(0.8);
    expect(comissaoRecebidaPelaImobiliaria(c)).toBe(800);
  });
  it("tudo recebido = 100%; nada recebido ou sem parcelas = 0%", () => {
    const tudo = montarComissaoCalculada({
      ...base,
      parcelasDaVenda: [{ dataRecebimento: "2026-10-05", valor: 5000 }],
    });
    expect(comissaoRecebidaPelaImobiliaria(tudo)).toBe(1000);
    const nada = montarComissaoCalculada({
      ...base,
      parcelasDaVenda: [{ dataRecebimento: null, valor: 5000 }],
    });
    expect(comissaoRecebidaPelaImobiliaria(nada)).toBe(0);
    const sem = montarComissaoCalculada({ ...base, parcelasDaVenda: [] });
    expect(comissaoRecebidaPelaImobiliaria(sem)).toBe(0);
  });
  it("parcial com valores nulos não divide por zero", () => {
    const c = montarComissaoCalculada({
      ...base,
      parcelasDaVenda: [
        { dataRecebimento: "2026-10-05", valor: null },
        { dataRecebimento: null, valor: null },
      ],
    });
    expect(c.fracaoRecebidaVenda).toBe(0);
  });
  it("linha sem fração (legado) usa a situação da venda", () => {
    expect(
      comissaoRecebidaPelaImobiliaria(
        linha({ id: "x", saleId: "s", valor: 300, situacaoRecebimentoVenda: "recebido" }),
      ),
    ).toBe(300);
    expect(
      comissaoRecebidaPelaImobiliaria(
        linha({ id: "y", saleId: "s", valor: 300, situacaoRecebimentoVenda: "parcial" }),
      ),
    ).toBe(0);
  });
});

describe("resumirComissoesPorPeriodo", () => {
  it("conta vendas distintas (não linhas) e soma calculada/recebida/pendente por equipe e no total", () => {
    const rows = [
      // venda s1 (Equipe A) com 2 linhas, totalmente recebida
      linha({
        id: "1",
        saleId: "s1",
        valor: 600,
        fracaoRecebidaVenda: 1,
        situacaoRecebimentoVenda: "recebido",
      }),
      linha({
        id: "2",
        saleId: "s1",
        valor: 400,
        fracaoRecebidaVenda: 1,
        situacaoRecebimentoVenda: "recebido",
      }),
      // venda s2 (Equipe A) metade recebida
      linha({
        id: "3",
        saleId: "s2",
        valor: 1000,
        fracaoRecebidaVenda: 0.5,
        situacaoRecebimentoVenda: "parcial",
      }),
      // venda s3 (Equipe B) nada recebido
      linha({ id: "4", saleId: "s3", valor: 2500, teamId: "team-b", teamNome: "Equipe B" }),
      // venda s4 sem equipe
      linha({ id: "5", saleId: "s4", valor: 100, teamId: null, teamNome: null }),
    ];
    const r = resumirComissoesPorPeriodo(rows);
    expect(r.total).toEqual({
      chave: "total",
      label: "Total geral",
      transacoes: 4,
      calculada: 4600,
      recebida: 1500,
      pendente: 3100,
    });
    const a = r.porEquipe.find((l) => l.chave === "team-a")!;
    expect(a).toMatchObject({ transacoes: 2, calculada: 2000, recebida: 1500, pendente: 500 });
    const b = r.porEquipe.find((l) => l.chave === "team-b")!;
    expect(b).toMatchObject({ transacoes: 1, calculada: 2500, recebida: 0, pendente: 2500 });
    const sem = r.porEquipe.find((l) => l.chave === "sem_equipe")!;
    expect(sem.label).toBe("Sem equipe resolvida");
    // soma das equipes = total geral
    expect(r.porEquipe.reduce((s, l) => s + l.calculada, 0)).toBe(r.total.calculada);
    expect(r.porEquipe.reduce((s, l) => s + l.transacoes, 0)).toBe(r.total.transacoes);
    // ordenado pela maior comissão calculada
    expect(r.porEquipe[0].chave).toBe("team-b");
  });
  it("lista vazia = zeros, sem equipes", () => {
    const r = resumirComissoesPorPeriodo([]);
    expect(r.total).toMatchObject({ transacoes: 0, calculada: 0, recebida: 0, pendente: 0 });
    expect(r.porEquipe).toEqual([]);
  });
  it("centavos não acumulam erro de ponto flutuante", () => {
    const rows = [0.1, 0.2, 0.3].map((v, i) =>
      linha({ id: String(i), saleId: `s${i}`, valor: v, fracaoRecebidaVenda: 1 / 3 }),
    );
    const r = resumirComissoesPorPeriodo(rows);
    expect(r.total.calculada).toBe(0.6);
    expect(r.total.recebida + r.total.pendente).toBeCloseTo(0.6, 2);
  });
});
