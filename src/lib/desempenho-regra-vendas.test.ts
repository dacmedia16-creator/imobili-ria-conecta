import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260901203000_centraliza_venda_comercial_valida.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("regra de vendas do resumo Desempenho", () => {
  it("centraliza a definição comercial de venda válida", () => {
    expect(migration).toContain("create or replace function public.vendas_comerciais_validas()");
    expect(migration.match(/from public\.vendas_comerciais_validas\(\)/g)).toHaveLength(3);
    expect(migration).toContain("create or replace function public.resumo_desempenho_periodo");
    expect(migration).toContain("create or replace function public.desempenho_ranking_periodo");
    expect(migration).toContain("create or replace function public.desempenho_detalhe_periodo");
  });

  it("conta a venda desde contrato assinado e mantém os estágios posteriores", () => {
    for (const status of [
      "contrato_assinado",
      "ocorrencia_pendente",
      "ocorrencia_analise_financeiro",
      "ocorrencia_devolvida_gestor",
      "ocorrencia_concluida",
    ]) {
      expect(migration).toContain(`'${status}'`);
    }
  });

  it("usa a assinatura mais recente quando houve retorno para uma etapa anterior", () => {
    expect(migration).toContain(
      "max(h.created_at) filter (where h.para::text = 'contrato_assinado')",
    );
    expect(migration).toContain("s.status::text in (");
    expect(migration).toContain("'contrato_assinado',");
    expect(migration).toContain("'ocorrencia_concluida'");
  });

  it("mantém lançamento pela entrada no financeiro sem confundir com venda padrão", () => {
    expect(migration).toContain("s.modalidade::text = 'lancamento'");
    expect(migration).toContain("h.para::text = 'ocorrencia_analise_financeiro'");
  });

  it("não volta a exigir exclusivamente análise financeira", () => {
    expect(migration).not.toContain("with efetivadas as (");
    expect(migration).toContain("when s.modalidade::text = 'lancamento'");
  });
});
