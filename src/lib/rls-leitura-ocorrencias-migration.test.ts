import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// t_baf5d60c — leitura de comissões/parcerias da ocorrência sem RLS em cascata.
const nome = "20261020120000_rls_leitura_ocorrencias_sem_cascata.sql";
const sql = readFileSync(new URL(`../../supabase/migrations/${nome}`, import.meta.url), "utf8");
const rollback = readFileSync(new URL(`../../supabase/rollback/${nome}`, import.meta.url), "utf8");

describe("rls leitura ocorrências sem cascata (t_baf5d60c)", () => {
  it("altera só o USING das 4 policies de LEITURA (nunca WITH CHECK, ALL ou gravação)", () => {
    expect(sql).toMatch(/alter policy %I on public\.%I using \(%s\)/);
    const codigo = sql.replace(/--.*$/gm, "").toLowerCase();
    expect(codigo).not.toContain("with check");
    expect(sql).toContain("and cmd = 'SELECT'");
    const policies = [...sql.matchAll(/\('(occurrence_\w+)', '(\w+)', '([0-9a-f]{32})',/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(policies.sort()).toEqual([
      "occurrence_commissions.occ_comm_view",
      "occurrence_commissions.occurrence_commissions_co_leader_principal_read",
      "occurrence_partners.occ_part_view",
      "occurrence_partners.occurrence_partners_co_leader_principal_read",
    ]);
    for (const p of ["occ_comm_write", "occ_part_write", "co_leader_commissions_write", "co_leader_partners_write", "org_isolation"]) {
      expect(sql).not.toContain(`'${p}'`);
    }
  });

  it("listas novas são SECURITY DEFINER, search_path vazio, filtradas pela imobiliária e sem acesso anônimo", () => {
    for (const fn of ["ocorrencias_visiveis_ids", "ocorrencias_coleader_leitura_ids"]) {
      expect(sql).toMatch(new RegExp(`create or replace function public\\.${fn}\\(\\)[\\s\\S]{0,80}security definer set search_path to ''`));
    }
    expect((sql.match(/o\.organization_id = \(select public\.current_org_id\(\)\)/g) ?? []).length).toBe(2);
    expect(sql).toContain("in (select public.vendas_visiveis_ids())");
    expect(sql).toContain("in (select public.vendas_coleader_leitura_ids())");
    expect(sql).toMatch(/from public, anon;/);
  });

  it("para se a policy de produção divergir do conferido", () => {
    expect(sql).toContain("diverge do conferido em produção");
  });

  it("desfazer restaura as 4 policies, confere o md5 e só apaga as 2 listas novas", () => {
    expect((rollback.match(/^ALTER POLICY /gm) ?? []).length).toBe(4);
    expect(rollback).toContain("drop function if exists public.ocorrencias_visiveis_ids();");
    expect(rollback).toContain("drop function if exists public.ocorrencias_coleader_leitura_ids();");
    expect(rollback).toContain("policies não voltaram ao texto de produção");
    expect(rollback).not.toMatch(/\b(delete from|truncate|update public\.|drop table|drop policy)/i);
  });
});
