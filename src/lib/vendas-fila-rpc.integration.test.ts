import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260911173000_filtro_minha_vez_antes_paginacao.sql",
);

function sql() {
  return readFileSync(MIGRATION, "utf8").replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();
}

describe("fila Só minha vez — contrato SQL", () => {
  it("filtra a fila antes do limit/offset e mantém a autorização por responsável", () => {
    const source = sql();
    expect(source).toContain(
      "create or replace function public.list_vendas_comerciais_paginadas_fila",
    );
    expect(source).toContain("b.status::text = 'ocorrencia_analise_financeiro'");
    expect(source).toContain("has_role(auth.uid(), 'financeiro'::app_role)");
    expect(source).toContain("is_lead_of(auth.uid(), b.corretor_id)");
    expect(source.indexOf("from filtradas")).toBeLessThan(source.indexOf("limit least"));
  });

  it("não libera execução anônima e permite somente usuários autenticados", () => {
    const source = sql();
    expect(source).toContain(
      "revoke execute on function public.list_vendas_comerciais_paginadas_fila(integer, integer, text, text[], date, date, text, uuid[]) from public, anon",
    );
    expect(source).toContain(
      "grant execute on function public.list_vendas_comerciais_paginadas_fila(integer, integer, text, text[], date, date, text, uuid[]) to authenticated",
    );
  });
});
