import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const V = "20261027180000_feedback_lista_padrao_org_nova.sql";
const migration = readFileSync(new URL(`../../supabase/migrations/${V}`, import.meta.url), "utf8");
const rollback = readFileSync(new URL(`../../supabase/rollback/${V}`, import.meta.url), "utf8");

describe("lista padrão do Feedback para imobiliária nova", () => {
  it("tem 55 ações (33 marketing + 22 checklist) e nada específico da Única Escolha", () => {
    expect(migration.match(/\('marketing', /g)?.length).toBe(33);
    expect(migration.match(/\('checklist', /g)?.length).toBe(22);
    const valores = migration.slice(
      migration.indexOf("FROM (VALUES"),
      migration.indexOf(") AS v("),
    );
    expect(valores).not.toMatch(/única escolha|unica escolha|sorocaba/i);
  });

  it("só copia para imobiliária sem lista e não duplica", () => {
    expect(migration).toMatch(
      /IF EXISTS \(SELECT 1 FROM public\.owner_feedback_actions WHERE organization_id = p_org\) THEN\s+RETURN 0;/,
    );
    expect(migration).toContain("ON CONFLICT (organization_id, list, category, label) DO NOTHING");
  });

  it("gatilho não bloqueia a criação da imobiliária e funções ficam fechadas", () => {
    expect(migration).toContain("AFTER INSERT ON public.organizations");
    expect(migration).toContain("EXCEPTION WHEN others THEN");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.owner_feedback_lista_padrao_copiar(uuid) FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain("SET search_path = ''");
  });

  it("rollback remove gatilho e funções sem apagar listas", () => {
    expect(rollback).toContain(
      "DROP TRIGGER IF EXISTS trg_zz_feedback_lista_padrao ON public.organizations",
    );
    expect(rollback).toContain(
      "DROP FUNCTION IF EXISTS public.owner_feedback_lista_padrao_copiar(uuid)",
    );
    expect(rollback).not.toMatch(/DELETE FROM/i);
  });
});
