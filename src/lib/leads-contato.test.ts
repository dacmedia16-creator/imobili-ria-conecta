import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { juntarContatos, type LeadSemContato } from "@/lib/leads";

// Card t_3284da21: telefone/e-mail do lead só depois do aceite (o banco decide).
const MIG = readFileSync(
  "supabase/migrations/20261025160000_leads_contato_apos_aceite.sql",
  "utf8",
);
const RB = readFileSync(
  "docs/sql/rollback/20261025160000_leads_contato_apos_aceite.rollback.sql",
  "utf8",
);
const DB = readFileSync("src/lib/leads-db.ts", "utf8");

const base = (id: string): LeadSemContato => ({
  id,
  nome: "Cliente",
  origem: "manual",
  mensagem: null,
  etapa: "novo",
  etapa_em: "2026-10-25T00:00:00Z",
  responsavel_id: "c1",
  atribuido_em: "2026-10-25T00:00:00Z",
  capture_id: null,
  captador_id: null,
  motivo_perda_id: null,
  motivo_perda_obs: null,
  created_at: "2026-10-25T00:00:00Z",
  updated_at: "2026-10-25T00:00:00Z",
  aceito_em: null,
  ultima_interacao_em: null,
  no_banco_desde: null,
  simulado: false,
});

describe("contato do lead só depois do aceite", () => {
  it("lead sem linha em lead_contatos fica com contato oculto", () => {
    const r = juntarContatos(
      [base("a"), base("b")],
      [{ id: "a", telefone: "15999990000", email: null }],
    );
    expect(r[0]).toMatchObject({ telefone: "15999990000", contato_liberado: true });
    expect(r[1]).toMatchObject({ telefone: null, email: null, contato_liberado: false });
  });

  it("o app não pede telefone/e-mail à tabela leads, só à RPC", () => {
    const cols = DB.match(/const LEAD_COLS =\s*"([^"]+)"/)?.[1] ?? "";
    expect(cols.split(",")).not.toContain("telefone");
    expect(cols.split(",")).not.toContain("email");
    expect(cols.split(",")).not.toContain("externo_id");
    expect(DB).toMatch(/rpc\("lead_contatos"/);
  });

  it("migration tira o SELECT do contato e libera por coluna o resto", () => {
    expect(MIG).toMatch(/REVOKE SELECT ON public\.leads FROM authenticated/);
    expect(MIG).toMatch(/NOT IN \('telefone', 'email', 'externo_id'\)/);
    expect(MIG).toMatch(/GRANT SELECT \(%s\) ON public\.leads TO authenticated/);
  });

  it("RPC: gestor sempre; responsável/TL só aceito e fora do banco; mesma imobiliária", () => {
    expect(MIG).toMatch(/l\.organization_id = _org/);
    expect(MIG).toMatch(/_gestor\s+OR \(l\.aceito_em IS NOT NULL AND l\.no_banco_desde IS NULL/);
    expect(MIG).toMatch(
      /REVOKE ALL ON FUNCTION public\.lead_contatos\(uuid\[\]\) FROM PUBLIC, anon/,
    );
  });

  it("rollback devolve o SELECT da tabela e apaga a RPC", () => {
    expect(RB).toMatch(/DROP FUNCTION IF EXISTS public\.lead_contatos\(uuid\[\]\)/);
    expect(RB).toMatch(/GRANT SELECT ON public\.leads TO authenticated/);
  });
});
