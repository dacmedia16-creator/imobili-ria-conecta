import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Contrato da otimização do Início (t_e68bebaf): dashboard_stats lê sales/occurrences uma única vez,
// sem mudar assinatura, segurança nem permissões. A igualdade do jsonb por cargo foi conferida no banco.
const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const V = "20261012220000_dashboard_stats_le_uma_vez";
const up = ler(`supabase/migrations/${V}.sql`);
const down = ler(`supabase/rollback/${V}.sql`);
const sem = (s: string) => s.replace(/--.*$/gm, "");

describe("dashboard_stats lê uma vez (migration)", () => {
  it("mantém nome, retorno, STABLE, INVOKER e search_path", () => {
    const u = sem(up);
    expect(u).toContain("CREATE OR REPLACE FUNCTION public.dashboard_stats()");
    expect(u).toContain("RETURNS jsonb");
    expect(u).toContain("STABLE");
    expect(u).toContain("SET search_path TO 'public'");
    expect(u).not.toMatch(/security definer/i);
    expect(u).not.toContain("dashboard_stats_v2");
  });

  it("sales e occurrences só aparecem nas CTEs materializadas", () => {
    const u = sem(up);
    expect(u).toContain("vs as materialized (select * from public.sales)");
    expect(u).toContain("vo as materialized (select * from public.occurrences)");
    expect(u).not.toMatch(/\b(from|join) (sales|occurrences)\b/);
  });

  it("guarda de versão e permissões iguais às atuais", () => {
    expect(up).toContain("9185ad948c467785f4750777ebefcd9a");
    expect(up).toContain("grant execute on function public.dashboard_stats() to authenticated, service_role;");
  });

  it("rollback volta o texto anterior (lê sales direto)", () => {
    const d = sem(down);
    expect(d).toContain("CREATE OR REPLACE FUNCTION public.dashboard_stats()");
    expect(d).toMatch(/\bfrom sales\b/);
    expect(d).not.toContain("materialized");
  });
});
