import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260905230000_restaura_movimentacao_periodo_por_modalidade.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("migration da movimentação do dashboard por modalidade", () => {
  it("preserva a regra comercial canônica mais nova", () => {
    expect(migration.match(/public\.vendas_comerciais_validas\(\)/g)).toHaveLength(2);
    expect(migration).toContain("select sale_id, venda_em em");
    expect(migration).not.toContain("ultima_transicao_periodo");
  });

  it("restaura quantidade e VGV separados para padrão e Lançamento", () => {
    expect(migration).toContain("'confirmadas_contrato_quantidade'");
    expect(migration).toContain("'confirmadas_contrato_vgv'");
    expect(migration).toContain("'confirmadas_lancamento_quantidade'");
    expect(migration).toContain("'confirmadas_lancamento_vgv'");
    expect(migration.match(/modalidade::text = 'padrao'/g)).toHaveLength(2);
    expect(migration.match(/modalidade::text = 'lancamento'/g)).toHaveLength(2);
  });

  it("mantém os campos agregados e as permissões restritas", () => {
    expect(migration).toContain("'confirmadas_quantidade'");
    expect(migration).toContain("'confirmadas_vgv'");
    expect(migration).toContain(
      "revoke all on function public.dashboard_movimentacao_periodo(timestamptz, timestamptz) from public",
    );
    expect(migration).toContain(
      "grant execute on function public.dashboard_movimentacao_periodo(timestamptz, timestamptz) to authenticated",
    );
  });
});
