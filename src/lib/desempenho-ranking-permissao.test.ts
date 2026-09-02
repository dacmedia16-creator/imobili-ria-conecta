import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260902022000_restaura_permissao_desempenho_gestor.sql",
  ),
  "utf8",
).toLowerCase();

describe("permissão do contexto de desempenho", () => {
  it("mantém Gestor e Team Leader autorizados na função que alimenta gráfico e ranking", () => {
    expect(migration).toContain(
      "array[''financeiro'',''admin'',''super_admin'',''gestor'',''team_leader'']::app_role[]",
    );
  });

  it("mantém a função disponível apenas para usuários autenticados", () => {
    expect(migration).toContain(
      "revoke execute on function public.desempenho_contexto_periodo(date,date) from public, anon",
    );
    expect(migration).toContain(
      "grant execute on function public.desempenho_contexto_periodo(date,date) to authenticated",
    );
  });
});
