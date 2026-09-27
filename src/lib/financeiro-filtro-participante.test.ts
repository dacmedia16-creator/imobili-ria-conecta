import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { participaDaVenda } from "./financeiro-dashboard-calc";

describe("filtro de corretor do Financeiro (decisão 27/09)", () => {
  it("casa o responsável da venda", () => {
    expect(participaDaVenda("a", "a", [])).toBe(true);
  });
  it("casa participante citado nas comissões mesmo sem ser o responsável", () => {
    expect(participaDaVenda("b", "a", ["a", "b"])).toBe(true);
  });
  it("não casa quem não participa", () => {
    expect(participaDaVenda("c", "a", ["b"])).toBe(false);
    expect(participaDaVenda("c", null, undefined)).toBe(false);
  });
});

describe("migration do total da lista /vendas (item 13)", () => {
  const sql = readFileSync(
    "supabase/migrations/20260927150000_vendas_total_sem_canceladas.sql",
    "utf8",
  );
  it("exclui canceladas/arquivadas somente do total em R$ nas duas RPCs", () => {
    expect(sql.match(/not in \('cancelada', 'arquivada'\)/gi)?.length).toBe(2);
    expect(sql).not.toMatch(/\b(update|delete)\s/i);
    expect(sql.match(/create or replace function/gi)?.length).toBe(2);
  });
});
