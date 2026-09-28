import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Contrato da correção "venda atribuída a quem criou" (Denis, 28/09/2026). O comportamento por
// perfil é provado em supabase/tests/atribuicao_participantes.sql (Postgres local descartável).
const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const up = ler("supabase/migrations/20260929100000_atribuicao_participantes.sql");
const down = ler("docs/sql/rollback/20260929100000_atribuicao_participantes.rollback.sql");
const norm = (s: string) => s.replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();
const u = norm(up);

function corpo(nome: string): string {
  const i = u.indexOf(`create or replace function public.${nome}(`);
  expect(i, nome).toBeGreaterThanOrEqual(0);
  const fim = u.indexOf("$function$;", i);
  return u.slice(i, fim);
}

describe("atribuição = participantes (migration)", () => {
  it("participantes: captador, vendedor e extras corretor_*; criador só como fallback", () => {
    const f = corpo("sale_corretores");
    expect(f).toContain("s.corretor_captador_id");
    expect(f).toContain("s.corretor_vendedor_id");
    expect(f).toContain("e.papel in ('corretor_captador', 'corretor_vendedor')");
    expect(f).toContain("not exists (select 1 from p where p.uid is not null)");
  });

  it("Início conta pelos participantes e a comissão prevista é só a parte do usuário", () => {
    const f = corpo("dashboard_stats");
    expect(f).not.toContain("where corretor_id = auth.uid()");
    expect(f).not.toContain("sum(valor_total_comissao)");
    expect(f).toContain("public.is_sale_corretor(auth.uid(), s.id)");
    expect(f).toContain("where oc.user_id = auth.uid()");
  });

  it("edição, etapa e liderança deixam de usar o criador", () => {
    for (const nome of [
      "can_edit_sale_stage",
      "can_edit_sale_comissao",
      "validate_sale_status_transition",
      "sale_management_capabilities",
      "list_vendas_comerciais_paginadas_fila",
    ]) {
      const f = corpo(nome);
      expect(f, nome).not.toMatch(/is_lead_of\((_user|actor|auth\.uid\(\)), (s|old|b)\.corretor_id\)/);
    }
    expect(corpo("validate_sale_status_transition")).toContain(
      "is_owner boolean := public.is_sale_responsavel(auth.uid(), old.id)",
    );
  });

  it("criador continua vendo (autoria) e líder dos participantes passa a ver", () => {
    const f = corpo("can_view_sale");
    expect(f).toContain("s.corretor_id = _user");
    expect(f).toContain("public.is_lead_of_sale_corretor(_user, s.id)");
    expect(u).toContain("is_lead_of_sale_corretor((select auth.uid()), id)");
  });

  it("filtro de corretor da listagem usa participantes", () => {
    for (const nome of ["list_vendas_comerciais_paginadas", "list_vendas_comerciais_paginadas_fila"]) {
      const f = corpo(nome);
      expect(f).not.toContain("s.corretor_id = any(_corretor_ids)");
      expect(f).toContain("public.is_sale_corretor(c, s.id)");
      expect(f).toContain("corretores_ids");
    }
  });

  it("helpers internos não ficam expostos a anon", () => {
    expect(u).toContain("revoke all on function public.sale_corretores(uuid) from public, anon, authenticated");
    expect(u).toContain("revoke execute on function public.is_sale_corretor(uuid, uuid) from public, anon");
  });

  it("sem DML de dados de negócio", () => {
    expect(up).not.toMatch(/\b(update public\.|delete from|insert into|truncate)\b/i);
  });

  it("rollback restaura as definições antigas e remove os helpers", () => {
    const d = norm(down);
    expect(d).toContain("is_owner boolean := (old.corretor_id = auth.uid())");
    expect(d).toContain("'minhas_vendas', (select count(*) from sales where corretor_id = auth.uid())");
    expect(d).toContain("drop function if exists public.sale_corretores(uuid)");
    expect(d).toContain("create policy sales_select on public.sales");
  });
});
