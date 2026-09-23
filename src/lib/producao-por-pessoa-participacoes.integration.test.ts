import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260923140000_producao_pessoa_participacoes_distintas.sql",
);

function sqlExecutavel() {
  return readFileSync(MIGRATION, "utf8").replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();
}

describe("produção por pessoa — contrato de participações", () => {
  const sql = sqlExecutavel();

  it("mantém a operação em uma linha e transporta vendedores como participações", () => {
    expect(sql).toContain("select distinct on (o.sale_id)");
    expect(sql).toContain("'vendedor_participacoes'");
    expect(sql).toContain("jsonb_agg");
    expect(sql).toContain("partition by sale_id");
  });

  it("calcula frações pela soma da ponta e conserva o fallback sem vínculo", () => {
    expect(sql).toContain("valor / sum(valor) over (partition by sale_id)");
    expect(sql).toContain("1::numeric / count(*) over (partition by sale_id)");
    expect(sql).toContain("coalesce(vpv.participacoes, '[]'::jsonb)");
    expect(sql).toContain("coalesce(vpv.primeira_fracao, 1)");
  });

  it("preserva as flags de parceria e a segurança da função", () => {
    expect(sql).toContain("'parceria_externa_captacao'");
    expect(sql).toContain("'parceria_externa_venda'");
    expect(sql).toContain("security invoker");
    expect(sql).toContain(
      "revoke execute on function public.producao_por_pessoa_dados() from public, anon, service_role",
    );
    expect(sql).toContain("grant execute on function public.producao_por_pessoa_dados() to authenticated");
  });
});
