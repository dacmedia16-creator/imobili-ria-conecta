import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// t_b904eca2 (Denis 24/11, "só adm vê"): lead SEM responsável é visível só para admin/super_admin.
// A 20270103120000 (t_b855dbb8) liberava esses leads ao gestor ("para distribuir"). O teste lê a
// ÚLTIMA migration que define a regra (leads_ve_responsavel e a policy leads_read): na main, é a
// 20270103120000 e o teste falha; com a 20270104120000, passa. A simulação com usuários reais da
// Única (transação desfeita) fica no roteiro do cartão (q/sim.py).
const DIR = "supabase/migrations";
const arquivos = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

function ultimaQueContem(trecho: string): { nome: string; sql: string } {
  for (const nome of [...arquivos].reverse()) {
    const sql = readFileSync(`${DIR}/${nome}`, "utf8");
    if (sql.includes(trecho)) return { nome, sql };
  }
  throw new Error(`nenhuma migration contém ${trecho}`);
}

function bloco(sql: string, inicio: string, fim: RegExp): string {
  const i = sql.lastIndexOf(inicio);
  const resto = sql.slice(i);
  const m = resto.slice(inicio.length).search(fim);
  return m < 0 ? resto : resto.slice(0, inicio.length + m);
}

describe("leads sem responsável: só admin vê (t_b904eca2)", () => {
  const fn = ultimaQueContem("FUNCTION public.leads_ve_responsavel(");
  const corpoFn = bloco(fn.sql, "FUNCTION public.leads_ve_responsavel(", /\$\$;/);
  const pol = ultimaQueContem("CREATE POLICY leads_read");
  const corpoPol = bloco(pol.sql, "CREATE POLICY leads_read", /;/);

  it("leads_ve_responsavel (usada por lead_pega/lead_atribuir/lead_contatos/CRM) não libera NULL ao gestor", () => {
    expect(corpoFn).toMatch(/public\.leads_admin\(\)/);
    expect(corpoFn).toMatch(/leads_responsaveis_visiveis\(\)/);
    expect(corpoFn).not.toMatch(/leads_gestor\(\)/);
    expect(corpoFn).not.toMatch(/_resp IS NULL/i);
  });

  it("policy leads_read: sem responsável só pela via do admin", () => {
    expect(corpoPol).toMatch(/USING \(\(SELECT public\.leads_admin\(\)\)/);
    expect(corpoPol).not.toMatch(/leads_gestor\(\)/);
    expect(corpoPol).not.toMatch(/responsavel_id IS NULL/i);
  });

  it("rollback volta a regra anterior (gestor vê sem responsável) e apaga o registro da migration", () => {
    const rb = readFileSync(
      "docs/sql/rollback/20270104120000_leads_sem_responsavel_so_admin.rollback.sql",
      "utf8",
    );
    expect(rb).toMatch(/_resp IS NULL AND public\.leads_gestor\(\)/);
    expect(rb).toMatch(/responsavel_id IS NULL AND \(SELECT public\.leads_gestor\(\)\)/);
    expect(rb).toMatch(/schema_migrations WHERE version = '20270104120000'/);
  });
});
