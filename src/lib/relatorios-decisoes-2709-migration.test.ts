import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (nome: string) =>
  readFileSync(new URL(`../../supabase/migrations/${nome}`, import.meta.url), "utf8");

const g1 = ler("20260927120000_relatorios_mes_assinatura_fuso_sp.sql");
const g2 = ler("20260927130000_inicio_confirmadas_e_ocorrencias_concluidas.sql");

describe("grupo 1: mês da assinatura e fuso de São Paulo", () => {
  it("Lançamento usa sales.data_assinatura e venda padrão a última assinatura", () => {
    expect(g1).toContain("s.data_assinatura::timestamp at time zone 'America/Sao_Paulo'");
    expect(g1).toContain("max(h.created_at) filter (where h.para::text = 'contrato_assinado')");
  });
  it("data_fechamento e limites de período em America/Sao_Paulo", () => {
    expect(g1).toContain("(v.venda_em at time zone 'America/Sao_Paulo')::date AS data_fechamento");
    expect(g1).toContain("(_de::timestamp at time zone 'America/Sao_Paulo')");
  });
  it("somente CREATE OR REPLACE, sem DML de dados de negócio", () => {
    for (const sql of [g1, g2]) {
      expect(sql).not.toMatch(/\b(update|delete from|insert into|drop function|truncate)\b/i);
    }
  });
});

describe("grupo 2: Início e Ocorrências concluídas", () => {
  it("card de confirmadas conta pela data da assinatura (base canônica)", () => {
    expect(g2).toContain("assinadas_periodo as (");
    expect(g2).toContain("from public.vendas_comerciais_validas() v");
    expect(g2).toContain("'confirmadas_contrato_quantidade'");
    expect(g2).toContain("'confirmadas_lancamento_quantidade'");
  });
  it("ocorrências concluídas: exclui cancelada/arquivada e desconta parceria externa", () => {
    expect(g2).toContain("s.status::text NOT IN ('cancelada', 'arquivada')");
    expect(g2).toContain("GREATEST(o.valor_comissao - COALESCE(px.valor, 0), 0)");
    expect(g2).toContain("public.occurrence_partners");
    expect(g2).toContain("oc.sem_cadastro_confirmado");
  });
  it("ocorrências concluídas: data = última assinatura em SP, sem inventar data", () => {
    expect(g2).toContain("(max(h.created_at) AT TIME ZONE 'America/Sao_Paulo')::date");
    expect(g2).toContain("o.data_assinatura\n      ) AS data_assinatura");
  });
  it("preserva a validação de acesso da RPC", () => {
    expect(g2).toContain("USING ERRCODE = '42501'");
    expect(g2).toContain("SECURITY DEFINER");
  });
});
