import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Regressão: criar venda pelo app faz INSERT ... RETURNING; a policy de leitura de sales tem de deixar o
// próprio corretor ler a linha nova sem depender só da lista vendas_visiveis_ids() (snapshot anterior).
const ler = (p: string) => readFileSync(new URL(`../../supabase/${p}`, import.meta.url), "utf8");
const up = ler("migrations/20261009050000_fix_sales_select_insert_returning.sql")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");
const down = ler("rollback/20261009050000_fix_sales_select_insert_returning.sql");

describe("sales_select aceita INSERT ... RETURNING do dono", () => {
  it("mantém a lista e acrescenta só o dono ativo (corretor/captador/vendedor)", () => {
    expect(up).toMatch(/alter policy sales_select on public\.sales using \(/);
    expect(up).toContain("id IN (SELECT public.vendas_visiveis_ids())");
    expect(up).toContain("(SELECT auth.uid()) IN (corretor_id, corretor_captador_id, corretor_vendedor_id)");
    expect(up).toContain("public.is_active_user((SELECT auth.uid()))");
  });

  it("não mexe em WITH CHECK nem em outras policies", () => {
    expect(up.toLowerCase()).not.toContain("with check");
    expect((up.match(/alter policy /gi) ?? []).length).toBe(1);
    expect(up).not.toMatch(/create policy|drop policy/i);
  });

  it("para se a policy atual divergir", () => {
    expect(up).toContain("diverge do esperado");
  });

  it("rollback volta ao USING da perf_01", () => {
    expect(down).toContain(
      "alter policy sales_select on public.sales using ((id IN (SELECT public.vendas_visiveis_ids())));",
    );
  });
});
