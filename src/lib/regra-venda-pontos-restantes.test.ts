import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260901215000_alinha_regra_comercial_pontos_restantes.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("regra comercial nos consumidores restantes", () => {
  it.each([
    "comissoes_carteira_periodo",
    "desempenho_contexto_periodo",
    "metas_progresso_periodo",
    "dashboard_movimentacao_periodo",
  ])("redefine %s", (nome) => {
    expect(migration).toContain(`function public.${nome}(`);
  });

  it("faz os quatro cálculos consumirem a regra canônica", () => {
    expect(migration.match(/public\.vendas_comerciais_validas\(\)/g)).toHaveLength(5);
    expect(migration).not.toContain("where h.para::text = 'ocorrencia_analise_financeiro'");
  });

  it("mantém os indicadores de caixa fora desta migração", () => {
    expect(migration).not.toContain("prev_recebimento");
    expect(migration).not.toContain("recebido_em");
  });

  it("remove as últimas dependências auxiliares em migration própria", () => {
    const finalizacao = readFileSync(
      new URL(
        "../../supabase/migrations/20260901215500_remove_ultimas_dependencias_regra_antiga.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(finalizacao.match(/public\.vendas_comerciais_validas\(\)/g)).toHaveLength(2);
    expect(finalizacao).toContain("drop function if exists public.resumo_desempenho_30d()");
    expect(finalizacao).not.toContain("h.para::text = 'ocorrencia_analise_financeiro'");
  });
});
