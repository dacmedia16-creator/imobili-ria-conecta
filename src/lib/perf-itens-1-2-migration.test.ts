import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../../supabase/migrations/", import.meta.url);
const ler = (nome: string) => readFileSync(new URL(nome, dir), "utf8");
const M00 = "20261008100000_perf_00_backup_definicoes.sql";
const M01 = "20261008100100_perf_01_permissoes_lista_vendas.sql";
const M02 = "20261008100200_perf_02_venda_distribuicao.sql";
const rollback = readFileSync(
  new URL("../../supabase/rollback/20261008100000_perf_itens_1_2.sql", import.meta.url),
  "utf8",
);

// trecho da migration entre os marcadores do gerador
const gerado = (sql: string) => sql.split("-- >>> GERADO")[1]?.split("-- <<< GERADO")[0] ?? "";

describe("itens 1 e 2 — permissões por lista (etapa 1)", () => {
  const sql = ler(M01);
  const bloco = gerado(sql);

  it("altera só USING de policies SELECT/ALL (nunca WITH CHECK nem gravação)", () => {
    expect(sql).toMatch(/alter policy %I on public\.%I using \(%s\)/);
    expect(sql.toLowerCase()).not.toContain("with check (");
    const cmds = [...bloco.matchAll(/\$q\$(SELECT|ALL|INSERT|UPDATE|DELETE)\$q\$/g)].map((m) => m[1]);
    expect(cmds.length).toBe(46);
    expect(new Set(cmds)).toEqual(new Set(["SELECT", "ALL"]));
  });

  it("o USING novo não chama mais a regra venda por venda", () => {
    const novos = [...bloco.matchAll(/\(\$q\$[^$]+\$q\$, \$q\$[^$]+\$q\$, \$q\$\w+\$q\$,\n\s+\$q\$[\s\S]*?\$q\$,\n\s+\$q\$([\s\S]*?)\$q\$\)/g)]
      .map((m) => m[1]);
    expect(novos.length).toBe(46);
    for (const u of novos) {
      expect(u).not.toMatch(/\b(can_view_sale|can_read_principal_sale_as_co_leader|can_manage_sale_as_co_leader|can_read_sale_juridico_certidao|can_edit_sale_as_co_leader)\(/);
    }
  });

  it("para se a policy de produção divergir do conferido", () => {
    expect(sql).toContain("diverge do conferido em produção");
  });

  it("listas são SECURITY DEFINER com search_path vazio e sem acesso anônimo", () => {
    for (const fn of ["vendas_visiveis_ids", "vendas_coleader_leitura_ids", "vendas_coleader_gestao_ids", "vendas_coleader_edicao_ids", "vendas_juridico_certidao_ids"]) {
      expect(sql).toMatch(new RegExp(`create or replace function public\\.${fn}\\(\\)[\\s\\S]{0,120}security definer[\\s\\S]{0,40}set search_path to ''`));
    }
    expect(sql).toMatch(/from public, anon;/);
  });
});

describe("itens 1 e 2 — cálculo gravado (etapa 2)", () => {
  const sql = ler(M02);

  it("mantém o resultado por gatilho nas 4 tabelas do cálculo, travando a venda", () => {
    for (const t of ["sales", "sale_commission_extras", "occurrences", "occurrence_commissions"]) {
      expect(sql).toMatch(new RegExp(`trigger zz_venda_distribuicao after insert[^;]*on public\\.${t}\\b`));
    }
    expect(sql).toMatch(/from public\.sales where id = _sale_id for update/);
  });

  it("carga inicial confere 100% antes de liberar", () => {
    expect(sql).toContain("select public.venda_distribuicao_recalcular_todas();");
    expect(sql).toContain("reconciliação falhou");
  });

  it("Painel e Financeiro leem o resultado gravado e não chamam mais o cálculo", () => {
    const b = gerado(sql);
    expect(b).toContain("CREATE OR REPLACE FUNCTION public.dashboard_stats()");
    expect(b).toContain("CREATE OR REPLACE FUNCTION public.financeiro_distribuicao_vendas()");
    expect(b).not.toContain("calcular_distribuicao_venda");
    expect(b).toContain("venda_distribuicao vd");
    // filtro de vendas válidas e de papel preservados
    expect(b).toContain("vendas_comerciais_canonicas()");
  });
});

describe("itens 1 e 2 — backup e desfazer", () => {
  it("etapa 0 copia definições sem alterar o sistema", () => {
    const sql = ler(M00).toLowerCase();
    expect(sql).toContain("max_backup.definicoes");
    expect(sql).not.toMatch(/alter policy|create or replace function public\.|drop /);
  });

  it("desfazer restaura as 46 policies e as 2 telas e remove só o que foi criado", () => {
    expect((rollback.match(/^ALTER POLICY /gm) ?? []).length).toBe(46);
    expect(rollback).toContain("CREATE OR REPLACE FUNCTION public.dashboard_stats()");
    expect(rollback).toContain("CREATE OR REPLACE FUNCTION public.financeiro_distribuicao_vendas()");
    expect(rollback).toContain("DROP TABLE IF EXISTS public.venda_distribuicao;");
    expect(rollback).not.toMatch(/\b(delete from|truncate|update public\.)/i);
  });
});

describe("regra fixa: mudou o cálculo da distribuição, recalcula todas as vendas", () => {
  it("toda migration posterior que mexe no cálculo recalcula e reconcilia", () => {
    const posteriores = readdirSync(dir).filter((f) => f.endsWith(".sql") && f > M02);
    for (const f of posteriores) {
      const sql = ler(f);
      if (/create\s+or\s+replace\s+function\s+(public\.)?calcular_distribuicao_venda/i.test(sql)) {
        expect(sql, `${f}: falta recalcular todas as vendas`).toContain("venda_distribuicao_recalcular_todas()");
        expect(sql, `${f}: falta a reconciliação`).toContain("venda_distribuicao_conferir()");
      }
    }
  });
});
