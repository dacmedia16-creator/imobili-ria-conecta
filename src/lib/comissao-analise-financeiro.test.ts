// @vitest-environment jsdom
// t_59cb12e0 — comissão editada em "análise do Financeiro": revisão mostra o valor novo, linha do lado
// REMAX como base informativa, "Nossa parte" correta e aviso de divergência só para Financeiro/Admin.
// Dados fictícios (espelham os números do diagnóstico t_d6b8a37b, sem usar os dados da venda real).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve({ data: null, error: null }) },
}));

import { OccurrenceReportBody } from "@/components/vendas/OccurrenceReportBody";
import { ComissaoDivergenciaAviso } from "@/components/vendas/ComissaoDivergenciaAviso";
import { divergenciaComissao, nossaParteComissao } from "./comissao-divergencia";
import type {
  OccurrenceCommissionRow,
  OccurrencePartnerRow,
  OccurrenceRow,
  SaleRow,
} from "@/lib/database.types";

afterEach(cleanup);

const sale = {
  id: "00000000-0000-4000-8000-0000000000aa",
  organization_id: "00000000-0000-4000-8000-0000000000bb",
  modalidade: "padrao",
  status: "ocorrencia_analise_financeiro",
  imovel_id: "QA-1",
  codigo_interno: "999999999-1",
  valor_anunciado: 180000,
  valor_negociado: 180000,
  percentual_comissao: 6,
  valor_total_comissao: 10800,
  percentual_remax: 3,
  valor_remax: 5400,
} as unknown as SaleRow;

const occ = (over: Partial<OccurrenceRow> = {}) =>
  ({
    id: "00000000-0000-4000-8000-0000000000cc",
    sale_id: sale.id,
    status: "pendente",
    aceita_financeiro: false,
    valor_anunciado: 180000,
    valor_negociado: 180000,
    percentual_comissao: 6,
    valor_comissao: 10800,
    ...over,
  }) as unknown as OccurrenceRow;

const partners = [
  { id: "p1", valor: 5400, tipo: "imobiliaria_externa", nome: "Parceira Exemplo" },
] as unknown as OccurrencePartnerRow[];
const commissions = [
  {
    id: "c1",
    papel: "corretor_captador",
    nome: "Carlos Captador",
    valor: 3240,
    percentual: 30,
    managed_by_sale: true,
    sale_commission_extra_id: null,
  },
] as unknown as OccurrenceCommissionRow[];

const renderReport = (o: OccurrenceRow) =>
  render(
    createElement(OccurrenceReportBody, {
      sale,
      occ: o,
      commissions,
      partners,
      parties: {},
      distribuicao: { saldo_liquido_imobiliaria: 2160 },
    }),
  );
const txt = (s: string) => s.replace(/\s+/g, " ");

describe("divergenciaComissao", () => {
  it("acusa o caso do diagnóstico: venda 6% / R$ 10.800 × ocorrência 3% / R$ 5.400", () => {
    const d = divergenciaComissao(sale, { percentual_comissao: 3, valor_comissao: 5400 });
    expect(d).toMatchObject({
      percentualVenda: 6,
      percentualOcorrencia: 3,
      valorVenda: 10800,
      valorOcorrencia: 5400,
      percentualDiferente: true,
      valorDiferente: true,
    });
  });
  it("não acusa quando batem (inclusive strings numéricas do banco)", () => {
    expect(
      divergenciaComissao(sale, { percentual_comissao: "6.000", valor_comissao: "10800.00" }),
    ).toBeNull();
  });
  it("ignora diferença só de arredondamento do % com o mesmo valor (5,964% × 6%, R$ 50.400)", () => {
    expect(
      divergenciaComissao(
        { percentual_comissao: 5.964, valor_total_comissao: 50400, modalidade: "padrao" },
        { percentual_comissao: 6, valor_comissao: 50400 },
      ),
    ).toBeNull();
  });
  it("parceria no lado vendedor: total 6% / R$ 10.800 e lado REMAX 3% / R$ 5.400 NÃO é divergência", () => {
    // Denis (04/11): com parceria, a comissão total é 6% e o lado REMAX 3% — o aviso compara só o
    // total da venda com o total da ocorrência, nunca o % / valor da REMAX.
    const vendaParceria = {
      ...sale,
      parceria_externa_venda: true,
      parceria_percentual: 3,
      parceria_valor: 5400,
    } as unknown as SaleRow;
    expect(divergenciaComissao(vendaParceria, occ())).toBeNull();
    expect(nossaParteComissao(10800, [{ valor: 5400 }])).toBe(5400);
  });
  it("acusa diferença de 1 centavo no valor", () => {
    expect(
      divergenciaComissao(sale, { percentual_comissao: 6, valor_comissao: 10799.99 })
        ?.valorDiferente,
    ).toBe(true);
  });
  it("sem ocorrência, sem valor ou Lançamento: nada a avisar", () => {
    expect(divergenciaComissao(sale, null)).toBeNull();
    expect(
      divergenciaComissao(sale, { percentual_comissao: null, valor_comissao: null }),
    ).toBeNull();
    expect(
      divergenciaComissao(
        { ...sale, modalidade: "lancamento" },
        { percentual_comissao: 3, valor_comissao: 5400 },
      ),
    ).toBeNull();
  });
});

describe("nossaParteComissao", () => {
  it("R$ 10.800 − parceria R$ 5.400 = R$ 5.400 (antes da correção ficava R$ 0)", () => {
    expect(nossaParteComissao(10800, partners)).toBe(5400);
    expect(nossaParteComissao(5400, partners)).toBe(0);
  });
  it("sem parceria = comissão total; aceita strings do banco", () => {
    expect(nossaParteComissao("10800.00", [])).toBe(10800);
    expect(nossaParteComissao(null, [])).toBe(0);
  });
});

describe("Revisão/relatório da ocorrência (OccurrenceReportBody)", () => {
  it("ocorrência sincronizada (6% / R$ 10.800): mostra o valor novo e nossa parte R$ 5.400", () => {
    const { container } = renderReport(occ());
    const t = txt(container.textContent ?? "");
    expect(t).toContain("6%");
    expect(t).toMatch(/R\$\s?10\.800,00/);
    expect(t).toContain("Nossa parte (desconta parceria)");
    expect(t).toMatch(/Nossa parte \(desconta parceria\)R\$\s?5\.400,00/);
  });
  it("linha do lado REMAX é base informativa, não recebedor", () => {
    renderReport(occ());
    const linha = screen.getByTestId("linha-lado-remax");
    expect(txt(linha.textContent ?? "")).toMatch(
      /^Lado REMAX \(base\)Base do lado REMAX — já distribuída nas linhas acima3%R\$\s?5\.400,00$/,
    );
    expect(linha.className).toContain("italic");
    // Nenhuma célula de papel chamada só "REMAX" (o rótulo antigo que parecia mais um recebedor).
    const celulas = Array.from(document.querySelectorAll("td")).map((td) => td.textContent?.trim());
    expect(celulas).not.toContain("REMAX");
  });
  it("venda sem % REMAX: a linha não aparece", () => {
    render(
      createElement(OccurrenceReportBody, {
        sale: { ...sale, percentual_remax: null } as SaleRow,
        occ: occ(),
        commissions,
        partners,
        parties: {},
      }),
    );
    expect(screen.queryByTestId("linha-lado-remax")).toBeNull();
  });
  it("ocorrência já aceita (3% / R$ 5.400 congelada): relatório continua mostrando o valor da ocorrência", () => {
    const { container } = renderReport(
      occ({ percentual_comissao: 3, valor_comissao: 5400, aceita_financeiro: true }),
    );
    const t = txt(container.textContent ?? "");
    expect(t).toMatch(/3%R\$\s?5\.400,00/);
    expect(t).toMatch(/Nossa parte \(desconta parceria\)R\$\s?0,00/);
  });
});

describe("ComissaoDivergenciaAviso", () => {
  const avisar = (o: OccurrenceRow | null, visivel = true) =>
    render(createElement(ComissaoDivergenciaAviso, { sale, occ: o, visivel }));

  it("Financeiro/Admin vê o aviso com os dois valores quando divergem", () => {
    avisar(occ({ percentual_comissao: 3, valor_comissao: 5400 }));
    const a = screen.getByTestId("aviso-divergencia-comissao");
    const t = txt(a.textContent ?? "");
    expect(t).toContain("Comissão da venda diferente da comissão da ocorrência");
    expect(t).toMatch(/Venda: 6% = R\$\s?10\.800,00/);
    expect(t).toMatch(/Ocorrência: 3% = R\$\s?5\.400,00/);
    expect(a.className).toContain("print:hidden");
    expect(a.getAttribute("role")).toBe("alert");
  });
  it("ocorrência aceita: o aviso explica que está congelada", () => {
    avisar(occ({ percentual_comissao: 3, valor_comissao: 5400, aceita_financeiro: true }));
    expect(screen.getByTestId("aviso-divergencia-comissao").textContent).toContain(
      "já foi aceita pelo Financeiro",
    );
  });
  it("sem divergência, sem permissão ou sem ocorrência: não aparece", () => {
    avisar(occ());
    expect(screen.queryByTestId("aviso-divergencia-comissao")).toBeNull();
    cleanup();
    avisar(occ({ percentual_comissao: 3, valor_comissao: 5400 }), false);
    expect(screen.queryByTestId("aviso-divergencia-comissao")).toBeNull();
    cleanup();
    avisar(null);
    expect(screen.queryByTestId("aviso-divergencia-comissao")).toBeNull();
  });
});

describe("contrato de tela e banco", () => {
  // Caminho pela raiz do projeto: no ambiente jsdom, import.meta.url não é file://.
  const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
  const route = ler("src/routes/_authenticated/vendas.$id.tsx");
  const mig = ler("supabase/migrations/20261104160000_comissao_analise_financeiro_sync.sql");
  const rb = ler("docs/sql/rollback/20261104160000_comissao_analise_financeiro_sync.rollback.sql");
  it("aviso na Revisão e na aba Ocorrência, só para financeiro/admin", () => {
    expect(route).toContain('visivel={hasAny(["financeiro", "admin", "super_admin"])}');
    expect(route).toContain(
      "<ComissaoDivergenciaAviso sale={sale} occ={occ} visivel={canFinLock} />",
    );
  });
  it("migration: só em análise, só ocorrência pendente e não aceita, só quando a comissão mudou", () => {
    expect(mig).toContain("v_sale.status::text <> 'ocorrencia_analise_financeiro'");
    expect(mig).toContain("and status = 'pendente'");
    expect(mig).toContain("and coalesce(aceita_financeiro, false) = false");
    expect(mig).toContain("new.percentual_comissao is distinct from old.percentual_comissao");
    expect(mig).toContain("new.valor_total_comissao is distinct from old.valor_total_comissao");
    expect(mig).toContain("perform public.sync_occurrence_commissions(p_sale_id)");
    expect(mig).toMatch(
      /REVOKE ALL ON FUNCTION public\.sincronizar_comissao_ocorrencia_em_analise\(uuid\) FROM PUBLIC, anon, authenticated/,
    );
    expect(mig).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.sincronizar_ocorrencia_antes_financeiro/,
    );
    // Não corrige dados existentes: fora dos corpos de função, nenhuma escrita em tabela.
    const foraDasFuncoes = mig.replace(/\$function\$[\s\S]*?\$function\$/g, "");
    expect(foraDasFuncoes).not.toMatch(/\b(update|delete\s+from|insert\s+into)\s+public\./i);
  });
  it("rollback restaura o gatilho antigo e remove a função nova", () => {
    expect(rb).toContain(
      "CREATE OR REPLACE FUNCTION public.trg_sincronizar_financeiro_ocorrencia_da_venda()",
    );
    expect(rb).toContain(
      "DROP FUNCTION IF EXISTS public.sincronizar_comissao_ocorrencia_em_analise(uuid)",
    );
    expect(rb).not.toContain("sincronizar_comissao_ocorrencia_em_analise(new.id)");
  });
});
