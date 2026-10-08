import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Regra do ID RE/MAX no código do anúncio (Denis, 08/10/2026). O comportamento no banco (ligação,
// visibilidade por perfil e REMAX-TESTE) é provado em supabase/tests/portal_remax_id_sem_hifen.sql.
const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const up = ler("supabase/migrations/20261008230000_portal_remax_id_sem_hifen.sql");
const down = ler("supabase/rollback/20261008230000_portal_remax_id_sem_hifen.sql");
const REGRA_SQL = "'^([0-9]{9})(?:-|[xX]{1,2}[0-9])'";

// Mesma expressão do Postgres (o "substring ... from" devolve o 1º grupo).
const remaxId = (code: string) => /^([0-9]{9})(?:-|[xX]{1,2}[0-9])/.exec(code)?.[1] ?? null;

describe("remax_id do código do anúncio", () => {
  it.each([
    ["630601005-114", "630601005"],
    ["630591010-7", "630591010"],
    ["630591010-1204", "630591010"],
    ["630591279x16", "630591279"],
    ["630601137x102", "630601137"],
    ["630591279x3", "630591279"],
    ["630601142xx68", "630601142"],
    ["630601201xx7", "630601201"],
    ["630601337XX6", "630601337"],
    ["630601337X6", "630601337"],
  ])("liga %s ao ID %s", (code, id) => expect(remaxId(code)).toBe(id));

  it.each([
    "63060113x72", // ID com 8 dígitos
    "6306011370x72", // 10 dígitos antes do x
    "630601137x", // x sem número
    "630601137xxx5", // três x
    "630601137y12",
    "630601137 12",
    "630601137",
    "A630601137x12",
    "",
  ])("NÃO liga %s", (code) => expect(remaxId(code)).toBeNull());

  it("migration usa a mesma regra na coluna gerada e na gravação semanal", () => {
    expect(up.split(REGRA_SQL).length - 1).toBe(2);
    expect(up).toContain("ALTER COLUMN remax_id SET EXPRESSION AS");
    expect(up).toContain("CREATE OR REPLACE FUNCTION public.portal_ingest(");
    expect(up).toContain("FROM PUBLIC, anon, authenticated");
    expect(up).not.toMatch(/POLICY|GRANT/i);
  });

  it("rollback volta à regra só com hífen", () => {
    expect(down).not.toContain(REGRA_SQL);
    expect(down.split("'^([0-9]{9})-'").length - 1).toBe(2);
    expect(down).toContain("SET broker_id = NULL");
  });
});
