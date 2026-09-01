import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260901233000_producao_pessoa_nao_duplica_venda_padrao.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("consulta de produção por pessoa", () => {
  it("só liga o rateio de vendedores detalhados a lançamentos", () => {
    expect(migration).toContain(
      "left join lanc_vendedor lv on lv.sale_id = s.id and s.modalidade::text = 'lancamento'",
    );
  });

  it("continua usando a fonte canônica de vendas comerciais", () => {
    expect(migration).toContain("from public.vendas_comerciais_validas() v");
  });
});
