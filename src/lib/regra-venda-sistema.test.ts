import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260901212500_alinha_indicadores_venda_regra_comercial.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("regra comercial única nos indicadores do sistema", () => {
  it("comparativo e central financeira consomem vendas comerciais válidas", () => {
    expect(migration).toContain("create function public.comparativo_comissao_6pct()");
    expect(migration).toContain("from public.vendas_comerciais_validas() v");
    expect(migration).toContain("else 'contrato_assinado' end");
  });

  it("produção por pessoa usa a mesma data comercial", () => {
    expect(migration).toContain("create or replace function public.producao_por_pessoa_dados()");
    expect(migration).toContain("'efetivada_em', v.venda_em");
    expect(migration.match(/public\.vendas_comerciais_validas\(\)/g)).toHaveLength(2);
  });

  it("não altera datas de previsão, recebimento ou repasse", () => {
    expect(migration).not.toContain("prev_recebimento");
    expect(migration).not.toContain("recebido_em");
  });
});
