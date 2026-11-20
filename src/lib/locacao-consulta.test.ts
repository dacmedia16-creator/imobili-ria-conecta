// "Consultar imóvel" da Locação (t_241e03a9): leitura fechada da RPC e conferência do texto da migration.
// A suíte do banco (multiempresa, LGPD, limite, termo mínimo, rollback) é supabase/tests/locacao-consultar-imovel.sql
// (run-locacao-consultar-imovel.sh, homologação).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STATUS_CONSULTA, detalheEtapa, lerConsulta, termoValido } from "./locacao-consulta";

const MIG = readFileSync("supabase/migrations/20261211130000_locacao_consultar_imovel.sql", "utf8");
const RB = readFileSync("supabase/rollback/20261211130000_locacao_consultar_imovel.sql", "utf8");

describe("lerConsulta", () => {
  it("lê só os 6 campos e descarta qualquer outro (LGPD)", () => {
    const [i] = lerConsulta([
      {
        imovel_id: "IM-1",
        endereco: "Rua X, 1",
        status: "pre_analise",
        etapa: "aprovacao",
        corretor: "Fulano",
        processos_ativos: 2,
        candidato: { nome: "Secreto", cpf: "000" },
        aluguel: 3000,
      },
    ]);
    expect(i).toEqual({
      imovelId: "IM-1",
      endereco: "Rua X, 1",
      status: "pre_analise",
      etapa: "aprovacao",
      corretor: "Fulano",
      processosAtivos: 2,
    });
    expect(JSON.stringify(i)).not.toMatch(/Secreto|3000|cpf/);
  });
  it("livre nunca mostra corretor nem etapa; status desconhecido vira livre", () => {
    const [a, b] = lerConsulta([
      { imovel_id: "IM-2", status: "livre", corretor: "X", etapa: "minuta" },
      { imovel_id: "IM-3", status: "qualquer" },
    ]);
    expect(a.corretor).toBeNull();
    expect(a.etapa).toBeNull();
    expect(b.status).toBe("livre");
    expect(lerConsulta(null)).toEqual([]);
  });
  it("alugado também não mostra corretor nem etapa", () => {
    const [i] = lerConsulta([
      { imovel_id: "IM-4", status: "alugado", corretor: "X", etapa: "comissao" },
    ]);
    expect(i.status).toBe("alugado");
    expect(i.corretor).toBeNull();
    expect(i.etapa).toBeNull();
  });
  it("etapa em linguagem simples", () => {
    const [i] = lerConsulta([{ status: "contrato", etapa: "assinatura", corretor: "Y" }]);
    expect(detalheEtapa(i)).toBe("etapa: Assinatura");
  });
});

describe("termo de busca", () => {
  it("mínimo 3 e máximo 100 caracteres, sem espaços nas pontas", () => {
    expect(termoValido("  ab ")).toBeNull();
    expect(termoValido(" abc ")).toBe("abc");
    expect(termoValido("a".repeat(101))).toBeNull();
  });
});

describe("status simplificado = banco", () => {
  it("5 status com emoji e mesmas chaves da RPC", () => {
    expect(Object.keys(STATUS_CONSULTA)).toEqual([
      "livre",
      "alugado",
      "pre_analise",
      "documentacao",
      "contrato",
    ]);
    expect(Object.values(STATUS_CONSULTA).map((s) => s.emoji)).toEqual([
      "🟢",
      "⚪",
      "🟡",
      "🟠",
      "🔴",
    ]);
    expect(STATUS_CONSULTA.alugado.label).toBe("Alugado");
    expect(MIG).toContain("WHEN 0 THEN 'livre' WHEN 1 THEN 'alugado' WHEN 2 THEN 'pre_analise'");
    expect(MIG).toContain("WHEN 3 THEN 'documentacao' ELSE 'contrato' END");
    expect(MIG).toContain("WHEN t.etapa IN ('pre_analise', 'aprovacao') THEN 2");
    expect(MIG).toContain("WHEN t.situacao <> 'ativa' THEN 0");
  });
  it("chave entregue = alugado (vem antes do teste de encerrada); cancelada sem chave = livre", () => {
    const alugado = MIG.indexOf("WHEN t.chave_em IS NOT NULL OR t.etapa = 'comissao' THEN 1");
    const livre = MIG.indexOf("WHEN t.situacao <> 'ativa' THEN 0");
    expect(alugado).toBeGreaterThan(0);
    expect(alugado).toBeLessThan(livre);
  });
});

describe("migration", () => {
  it("SECURITY DEFINER, presa à imobiliária, limite 10, termo mínimo e sem dados pessoais", () => {
    expect(MIG).toMatch(/SECURITY DEFINER SET search_path TO ''/);
    expect(MIG).toContain("public.locacao_ctx()");
    expect(MIG).toContain("l.organization_id = _org");
    expect(MIG).toContain("LIMIT 10");
    expect(MIG).toContain("length(_t) < 3");
    expect(MIG).toContain(
      "REVOKE ALL ON FUNCTION public.locacao_consultar_imovel(text) FROM PUBLIC, anon;",
    );
    const saida = MIG.slice(MIG.indexOf("jsonb_build_object("));
    expect(saida).not.toMatch(/candidato|aluguel|fiador|proprietario|documento|observa/);
    expect(MIG).not.toMatch(/ALTER TABLE|CREATE POLICY|GRANT SELECT/);
  });
  it("rollback só remove a função", () => {
    expect(RB).toContain("DROP FUNCTION IF EXISTS public.locacao_consultar_imovel(text);");
  });
});
